import { test, expect } from './helpers/orca-app'
import {
  focusActiveTerminalInput,
  getTerminalContent,
  sendToTerminal,
  waitForActivePanePtyId,
  waitForActiveTerminalManager,
  waitForTerminalOutput
} from './helpers/terminal'
import { ensureTerminalVisible, waitForActiveWorktree, waitForSessionReady } from './helpers/store'
import {
  clearTerminalPtyWriteLog,
  installTerminalPtyWriteSpy,
  readTerminalPtyWriteEntries
} from './helpers/terminal-pty-write-spy'

const DRAFT = 'ORCA_CODEX_PASTE_DRAFT_SHOULD_STAY_UNSENT'
const CODEX_TRUST_PROMPT_RE = /Do[\s\S]*you[\s\S]*trust[\s\S]*contents/i

function pastePayload(repeats = 4): string {
  const lines = [
    'Repository: stablyai/orca',
    '',
    'Required exact revision:',
    '',
    '0123456789abcdef0123456789abcdef01234567',
    '',
    'This is validation only:',
    '',
    '- Do not modify files.',
    '',
    '- Do not commit or push.',
    '',
    '- If the worktree is dirty before starting, stop and report it.',
    '',
    '- Use native Windows PowerShell, Node 24, and pnpm 10.',
    '',
    '- Confirm the checked-out full SHA before testing.',
    '',
    'Run:',
    '',
    '1. pnpm typecheck',
    '',
    '2. pnpm lint',
    '',
    '3. Run the focused Node 24 suite and report every result.',
    '',
    '4. Run the registered Electron gate exactly as written.',
    '',
    'If anything fails, include the first useful stack trace and distinguish product failure from test-harness or environmental failure.'
  ]
  return Array.from({ length: repeats }, () => lines.join('\r\n')).join('\r\n\r\n')
}

async function activateTestRepository(
  page: Parameters<typeof focusActiveTerminalInput>[0],
  repoPath: string
): Promise<void> {
  await page.evaluate(async (targetRepoPath) => {
    const normalizePath = (value: string): string => value.replaceAll('\\', '/').toLowerCase()
    await window.api.repos.add({ path: targetRepoPath })
    const store = window.__store
    if (!store) {
      throw new Error('Orca store unavailable')
    }
    await store.getState().fetchRepos()
    const repo = store
      .getState()
      .repos.find((candidate) => normalizePath(candidate.path) === normalizePath(targetRepoPath))
    if (!repo) {
      throw new Error('Seeded repository unavailable')
    }
    await store.getState().updateRepo(repo.id, { externalWorktreeVisibility: 'show' })
    await store.getState().fetchWorktrees(repo.id)
    const worktree = store
      .getState()
      .worktreesByRepo[repo.id]?.find(
        (candidate) => normalizePath(candidate.path) === normalizePath(targetRepoPath)
      )
    if (!worktree) {
      throw new Error('Seeded worktree unavailable')
    }
    store.getState().setActiveWorktree(worktree.id)
    store.getState().createTab(worktree.id)
  }, repoPath)
}

async function enableTerminalAccessibilityDom(
  page: Parameters<typeof focusActiveTerminalInput>[0],
  ptyId: string
): Promise<void> {
  await page.evaluate((targetPtyId) => {
    const managers = Array.from(window.__paneManagers?.values() ?? [])
    const pane = managers
      .flatMap((manager) => manager.getPanes?.() ?? [])
      .find((candidate) => candidate.container.dataset.ptyId === targetPtyId)
    if (!pane) {
      throw new Error(`Terminal pane ${targetPtyId} is unavailable`)
    }
    // Why: xterm paints to canvas by default. Screen-reader mode mirrors the
    // visible prompt into DOM rows so the regression assertions stay user-facing.
    pane.terminal.options.screenReaderMode = true
    pane.terminal.refresh(0, pane.terminal.rows - 1)
  }, ptyId)
  await expect(
    page.locator(`[data-pty-id=${JSON.stringify(ptyId)}] .xterm-accessibility-tree`)
  ).toBeAttached({ timeout: 10_000 })
}

async function waitForCodexComposerReady(
  page: Parameters<typeof focusActiveTerminalInput>[0]
): Promise<void> {
  // Why: Codex can render its header before delayed MCP startup takes over the
  // composer. Let that startup begin, then paste only after the TUI is idle.
  await page.waitForTimeout(5_000)
  await expect
    .poll(async () => await getTerminalContent(page, 12_000), { timeout: 60_000 })
    .not.toMatch(/Booting MCP server|tab to queue message/i)
  // Why: absence of boot states alone can pass on an empty screen; the idle
  // composer placeholder is the positive ready marker (mirrors the product's
  // codex-composer-prompt draft-paste signal).
  await expect
    .poll(async () => await getTerminalContent(page, 12_000), { timeout: 60_000 })
    .toMatch(/Ask Codex/i)
}

test.describe('Windows Codex multiline paste', () => {
  test.use({ seedTestRepo: false })

  test('multiline Ctrl+V keeps the existing Codex draft unsent @local-real-codex', async ({
    orcaPage,
    testRepoPath
  }) => {
    test.skip(process.platform !== 'win32', 'Windows ConPTY coverage is Windows-only')
    test.skip(
      process.env.ORCA_E2E_REAL_CODEX !== '1',
      'Set ORCA_E2E_REAL_CODEX=1 to exercise the locally installed Codex TUI'
    )
    test.slow()

    await waitForSessionReady(orcaPage)
    await activateTestRepository(orcaPage, testRepoPath)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    const ptyId = await waitForActivePanePtyId(orcaPage)
    await sendToTerminal(orcaPage, ptyId, 'codex -m orca-e2e-invalid-model\r')
    await expect
      .poll(() => getTerminalContent(orcaPage, 12_000), { timeout: 20_000 })
      .toMatch(/Do[\s\S]*you[\s\S]*trust[\s\S]*contents|OpenAI Codex/i)
    if (CODEX_TRUST_PROMPT_RE.test(await getTerminalContent(orcaPage, 12_000))) {
      await sendToTerminal(orcaPage, ptyId, '\r')
    }
    await waitForTerminalOutput(orcaPage, 'OpenAI Codex', 20_000, 30_000)
    await waitForCodexComposerReady(orcaPage)
    await enableTerminalAccessibilityDom(orcaPage, ptyId)
    await focusActiveTerminalInput(orcaPage)
    await orcaPage.keyboard.type(DRAFT)
    const terminalDom = orcaPage.locator(
      `[data-pty-id=${JSON.stringify(ptyId)}] .xterm-accessibility-tree`
    )
    await expect(terminalDom).toContainText(DRAFT, { timeout: 10_000 })
    await orcaPage.evaluate((text) => window.api.ui.writeClipboardText(text), pastePayload())

    await orcaPage.keyboard.press('Control+V')
    await expect(terminalDom).toContainText('[Pasted Content', { timeout: 10_000 })
    await expect(terminalDom).toContainText(DRAFT)
    await orcaPage.waitForTimeout(2_000)
    await expect(terminalDom).not.toContainText('Working')
    await expect(terminalDom).not.toContainText('unexpected status 404')
  })

  test('blocks large multiline paste before native ConPTY receives input', async ({
    electronApp,
    orcaPage,
    testRepoPath
  }) => {
    test.skip(process.platform !== 'win32', 'Windows ConPTY coverage is Windows-only')
    test.slow()

    await waitForSessionReady(orcaPage)
    await activateTestRepository(orcaPage, testRepoPath)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
    await waitForActiveTerminalManager(orcaPage, 30_000)

    await installTerminalPtyWriteSpy(electronApp)
    const ptyId = await waitForActivePanePtyId(orcaPage)
    const payload = pastePayload(110)
    const expectedText = payload.replace(/\r?\n/g, '\r')
    expect(Buffer.byteLength(expectedText, 'utf8')).toBeGreaterThan(64 * 1024)
    await enableTerminalAccessibilityDom(orcaPage, ptyId)
    await focusActiveTerminalInput(orcaPage)
    await orcaPage.keyboard.type(DRAFT)
    const terminalDom = orcaPage.locator(
      `[data-pty-id=${JSON.stringify(ptyId)}] .xterm-accessibility-tree`
    )
    await expect(terminalDom).toContainText(DRAFT, { timeout: 10_000 })
    await clearTerminalPtyWriteLog(electronApp)
    await orcaPage.evaluate((text) => window.api.ui.writeClipboardText(text), payload)
    try {
      await orcaPage.keyboard.press('Control+V')
      await expect(
        orcaPage.getByText(
          'Large multiline paste blocked on Windows to protect your current input.',
          { exact: false }
        )
      ).toBeVisible({ timeout: 10_000 })
      await expect(terminalDom).toContainText(DRAFT)
      const pasteWrites = (await readTerminalPtyWriteEntries(electronApp)).filter(
        (entry) => entry.id === ptyId
      )
      expect(pasteWrites).toHaveLength(0)
    } finally {
      await sendToTerminal(orcaPage, ptyId, '\x03').catch(() => undefined)
    }
  })
})
