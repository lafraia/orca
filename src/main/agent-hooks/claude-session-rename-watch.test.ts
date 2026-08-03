import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createClaudeSessionRenameWatch,
  type ClaudeSessionRename,
  type ClaudeSessionRenameWatch
} from './claude-session-rename-watch'

const renameRecord = (title: string): string =>
  `${JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: 's1' })}\n`

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for rename')
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('createClaudeSessionRenameWatch', () => {
  let dir: string
  let watch: ClaudeSessionRenameWatch | null = null
  let renames: ClaudeSessionRename[]

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'orca-rename-watch-'))
    renames = []
  })

  afterEach(async () => {
    watch?.dispose()
    watch = null
    await rm(dir, { recursive: true, force: true })
  })

  it('reports the rename already in a transcript when the pane appears', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('billing-fix'))
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))

    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])

    await waitFor(() => renames.length > 0)
    expect(renames).toEqual([{ paneKey: 'tab-1:leaf-1', customTitle: 'billing-fix' }])
  })

  it('reports a later rename and stays silent on re-appends of the same name', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('first'))
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))
    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)

    // Why: Claude re-appends the record every turn; restamping an unchanged
    // rename would keep pushing it past a later manual rename.
    await writeFile(transcriptPath, renameRecord('first') + renameRecord('first'))
    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(renames).toHaveLength(1)

    await writeFile(transcriptPath, renameRecord('first') + renameRecord('second'))
    await waitFor(() => renames.length === 2)
    expect(renames[1]).toEqual({ paneKey: 'tab-1:leaf-1', customTitle: 'second' })
  })

  it('ignores panes with no transcript path and drops panes that disappear', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('billing-fix'))
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))

    watch.sync([{ paneKey: 'tab-1:leaf-1' }])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(renames).toHaveLength(0)

    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)

    watch.sync([])
    await writeFile(transcriptPath, renameRecord('after-close'))
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(renames).toHaveLength(1)
  })

  it('stays quiet for an unreadable transcript, as on a remote host', async () => {
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))
    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath: join(dir, 'absent.jsonl') }])
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(renames).toHaveLength(0)
  })

  it('keeps watching every pane it is given, so callers must pass the full set', async () => {
    const first = join(dir, 'first.jsonl')
    const second = join(dir, 'second.jsonl')
    await writeFile(first, renameRecord('one'))
    await writeFile(second, renameRecord('two'))
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))

    watch.sync([
      { paneKey: 'tab-1:leaf-1', transcriptPath: first },
      { paneKey: 'tab-2:leaf-1', transcriptPath: second }
    ])
    await waitFor(() => renames.length === 2)

    // Why: the hook feed reports only changed identities. Syncing that delta
    // would drop pane 2's watch; callers pass the full identity set instead.
    watch.sync([
      { paneKey: 'tab-1:leaf-1', transcriptPath: first },
      { paneKey: 'tab-2:leaf-1', transcriptPath: second }
    ])
    await writeFile(second, renameRecord('two-renamed'))

    await waitFor(() => renames.length === 3)
    expect(renames[2]).toEqual({ paneKey: 'tab-2:leaf-1', customTitle: 'two-renamed' })
  })

  it('picks up a pane that only appears on a later reconcile', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('late-pane'))
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))

    // Why: at startup the hook feed is silent, so the first reconcile sees no
    // panes; the pane must still be picked up when a later tick reports it.
    watch.sync([])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(renames).toHaveLength(0)

    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)
    expect(renames[0]).toEqual({ paneKey: 'tab-1:leaf-1', customTitle: 'late-pane' })
  })

  it('re-reads from scratch when the pane starts a new transcript', async () => {
    const first = join(dir, 'first.jsonl')
    const second = join(dir, 'second.jsonl')
    await writeFile(first, renameRecord('first-session'))
    await writeFile(second, renameRecord('second-session'))
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename))

    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath: first }])
    await waitFor(() => renames.length === 1)
    watch.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath: second }])
    await waitFor(() => renames.length === 2)

    expect(renames.map((rename) => rename.customTitle)).toEqual(['first-session', 'second-session'])
  })
})
