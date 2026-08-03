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

// Why: the watch is driven by an injected stub rather than a real fs.watch.
// Handles are process-wide and vitest shares one process across files, so real
// watchers here starve other suites' watchers (and made this file flaky). It
// also makes every event deterministic — `fireEvent` replaces waiting on the
// filesystem. Binding is `transcript-native-watcher.ts`'s job, tested there.
type StubWatcher = {
  filePath: string
  onEvent: () => void
  onError: () => void
  bound: boolean
  rebindNeeded: boolean
  disposed: boolean
  bindAttempts: number
  /** Set to make the next bind() fail, as it does on network filesystems. */
  bindFails: boolean
}

function createStubWatcherFactory() {
  const watchers: StubWatcher[] = []
  const factory = (filePath: string, onEvent: () => void, onError: () => void) => {
    const stub: StubWatcher = {
      filePath,
      onEvent,
      onError,
      bound: false,
      rebindNeeded: true,
      disposed: false,
      bindAttempts: 0,
      bindFails: false
    }
    watchers.push(stub)
    return {
      bind: (): boolean => {
        stub.bindAttempts += 1
        if (stub.bindFails) {
          // Why: the real watcher leaves itself detached when `watch()` throws.
          stub.bound = false
          stub.rebindNeeded = true
          return false
        }
        stub.bound = true
        stub.rebindNeeded = false
        return true
      },
      invalidate: (): void => {
        stub.bound = false
        stub.rebindNeeded = true
      },
      needsRebind: (): boolean => stub.rebindNeeded,
      dispose: (): void => {
        stub.disposed = true
        stub.bound = false
      }
    }
  }
  // Why: findLast, not find — a pane that switches transcripts leaves the old
  // stub in the list, and the live one is the most recently created.
  const forPath = (filePath: string): StubWatcher | undefined =>
    watchers.findLast((w) => w.filePath === filePath && !w.disposed)
  return { factory, watchers, forPath }
}

async function waitFor(predicate: () => boolean, what = 'rename'): Promise<void> {
  // Why: only awaits promise resolution now (a bounded tail read), not an OS
  // event, so this settles in microtasks even on a saturated machine.
  for (let attempt = 0; attempt < 500; attempt += 1) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('createClaudeSessionRenameWatch', () => {
  let dir: string
  let watch: ClaudeSessionRenameWatch | null = null
  let renames: ClaudeSessionRename[]
  let stubs: ReturnType<typeof createStubWatcherFactory>

  function startWatch(): ClaudeSessionRenameWatch {
    stubs = createStubWatcherFactory()
    watch = createClaudeSessionRenameWatch((rename) => renames.push(rename), {
      createWatcher: stubs.factory
    })
    return watch
  }

  /** Stand in for the filesystem notifying the watcher of an append. */
  function fireEvent(filePath: string): void {
    stubs.forPath(filePath)?.onEvent()
  }

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

    startWatch().sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])

    await waitFor(() => renames.length > 0)
    expect(renames).toEqual([{ paneKey: 'tab-1:leaf-1', customTitle: 'billing-fix' }])
  })

  it('reports a later rename and stays silent on re-appends of the same name', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('first'))
    startWatch().sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)

    // Why: Claude re-appends the record every turn; restamping an unchanged
    // rename would keep pushing it past a later manual rename.
    await writeFile(transcriptPath, renameRecord('first') + renameRecord('first'))
    fireEvent(transcriptPath)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(renames).toHaveLength(1)

    await writeFile(transcriptPath, renameRecord('first') + renameRecord('second'))
    fireEvent(transcriptPath)
    await waitFor(() => renames.length === 2)
    expect(renames[1]).toEqual({ paneKey: 'tab-1:leaf-1', customTitle: 'second' })
  })

  it('ignores panes with no transcript path and drops panes that disappear', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('billing-fix'))
    startWatch().sync([{ paneKey: 'tab-1:leaf-1' }])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(renames).toHaveLength(0)

    watch?.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)

    watch?.sync([])
    expect(stubs.watchers.at(-1)?.disposed).toBe(true)
    await writeFile(transcriptPath, renameRecord('after-close'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(renames).toHaveLength(1)
  })

  it('stays quiet for an unreadable transcript, as on a remote host', async () => {
    startWatch().sync([{ paneKey: 'tab-1:leaf-1', transcriptPath: join(dir, 'absent.jsonl') }])
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(renames).toHaveLength(0)
  })

  it('keeps watching every pane it is given, so callers must pass the full set', async () => {
    const first = join(dir, 'first.jsonl')
    const second = join(dir, 'second.jsonl')
    await writeFile(first, renameRecord('one'))
    await writeFile(second, renameRecord('two'))

    startWatch().sync([
      { paneKey: 'tab-1:leaf-1', transcriptPath: first },
      { paneKey: 'tab-2:leaf-1', transcriptPath: second }
    ])
    await waitFor(() => renames.length === 2)

    // Why: the hook feed reports only changed identities. Syncing that delta
    // would drop pane 2's watch; callers pass the full identity set instead.
    watch?.sync([
      { paneKey: 'tab-1:leaf-1', transcriptPath: first },
      { paneKey: 'tab-2:leaf-1', transcriptPath: second }
    ])
    await writeFile(second, renameRecord('two-renamed'))
    fireEvent(second)

    await waitFor(() => renames.length === 3, 'the second pane to still be watched')
    expect(renames[2]).toEqual({ paneKey: 'tab-2:leaf-1', customTitle: 'two-renamed' })
  })

  it('re-reads after a bind that only succeeds on a later reconcile', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('before-bind'))
    startWatch()
    watch?.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)

    // Why: with the watcher unbound, a rename produces no event at all, and a
    // reconcile whose bind also fails must not pretend it caught up.
    const stub = stubs.forPath(transcriptPath)
    expect(stub).toBeDefined()
    if (!stub) {
      return
    }
    stub.rebindNeeded = true
    stub.bindFails = true
    await writeFile(transcriptPath, renameRecord('written-while-unbound'))

    const attemptsBeforeFailedBind = stub.bindAttempts
    watch?.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await new Promise((resolve) => setTimeout(resolve, 100))
    // Asserted so the silence below is a failed bind, not a skipped one.
    expect(stub.bindAttempts).toBeGreaterThan(attemptsBeforeFailedBind)
    expect(stub.bound).toBe(false)
    expect(renames).toHaveLength(1)

    // Only the catch-up read on a *successful* rebind can surface the rename.
    stub.bindFails = false
    watch?.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])

    await waitFor(() => renames.length === 2, 'the catch-up read after rebind')
    expect(stub.bound).toBe(true)
    expect(renames[1]).toEqual({
      paneKey: 'tab-1:leaf-1',
      customTitle: 'written-while-unbound'
    })
  })

  it('exposes what it has seen so a late subscriber can catch up', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('billing-fix'))
    const started = startWatch()

    expect(started.getKnownRenames()).toEqual([])
    started.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)

    // Why: the startup push happens before the renderer subscribes, and an
    // unchanged rename never re-emits — without this the name is lost for good.
    expect(started.getKnownRenames()).toEqual([
      { paneKey: 'tab-1:leaf-1', customTitle: 'billing-fix' }
    ])
  })

  it('stops replaying a rename the transcript has cleared', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('billing-fix'))
    startWatch().sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => watch?.getKnownRenames().length === 1, 'the rename to be cached')

    // Why: a cleared rename leaves the cached title stale, and the snapshot
    // would hand a fresh renderer a name the transcript already dropped.
    await writeFile(transcriptPath, renameRecord('billing-fix') + renameRecord(''))
    fireEvent(transcriptPath)
    await waitFor(() => watch?.getKnownRenames().length === 0, 'the cached rename to clear')

    expect(renames).toHaveLength(1)
  })

  it('picks up a pane that only appears on a later reconcile', async () => {
    const transcriptPath = join(dir, 'session.jsonl')
    await writeFile(transcriptPath, renameRecord('late-pane'))

    // Why: at startup the hook feed is silent, so the first reconcile sees no
    // panes; the pane must still be picked up when a later tick reports it.
    startWatch().sync([])
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(renames).toHaveLength(0)

    watch?.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath }])
    await waitFor(() => renames.length === 1)
    expect(renames[0]).toEqual({ paneKey: 'tab-1:leaf-1', customTitle: 'late-pane' })
  })

  it('re-reads from scratch when the pane starts a new transcript', async () => {
    const first = join(dir, 'first.jsonl')
    const second = join(dir, 'second.jsonl')
    await writeFile(first, renameRecord('first-session'))
    await writeFile(second, renameRecord('second-session'))

    startWatch().sync([{ paneKey: 'tab-1:leaf-1', transcriptPath: first }])
    await waitFor(() => renames.length === 1)
    watch?.sync([{ paneKey: 'tab-1:leaf-1', transcriptPath: second }])
    await waitFor(() => renames.length === 2)

    expect(renames.map((rename) => rename.customTitle)).toEqual(['first-session', 'second-session'])
  })
})
