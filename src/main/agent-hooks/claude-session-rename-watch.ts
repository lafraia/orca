import { open } from 'node:fs/promises'
import {
  CLAUDE_CUSTOM_TITLE_TAIL_BYTES,
  findLastClaudeCustomTitle
} from '../../shared/claude-session-custom-title'
import {
  createTranscriptNativeWatcher,
  type TranscriptNativeWatcher
} from '../native-chat/transcript-native-watcher'

/** Why: a rename appends one small record; a trailing debounce collapses the
 *  write burst around it into a single tail read. */
const READ_DEBOUNCE_MS = 150

/** Why: the hook-driven feed can go quiet for a whole session (a restored pane
 *  whose only activity is `/rename`), so callers reconcile on this cadence to
 *  pick up panes and re-check best-effort fs.watch bindings. */
export const CLAUDE_SESSION_RENAME_RECONCILE_MS = 30_000

export type ClaudeSessionRename = { paneKey: string; customTitle: string }

export type ClaudeSessionRenameSource = Readonly<{
  paneKey: string
  transcriptPath?: string
}>

export type ClaudeSessionRenameWatch = {
  /** Reconcile against the live provider sessions; drops panes no longer present. */
  sync: (sources: readonly ClaudeSessionRenameSource[]) => void
  /** Every rename seen so far. Why: renames found during startup are pushed
   *  before the renderer subscribes, and an unchanged value never re-emits, so
   *  the renderer pulls this once it is listening. */
  getKnownRenames: () => ClaudeSessionRename[]
  dispose: () => void
}

async function readLastCustomTitle(filePath: string): Promise<string | null> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(filePath, 'r')
  } catch {
    // Remote (SSH) panes report a transcript path on their own host, so the
    // path simply does not resolve here. Callers degrade to the OSC title.
    return null
  }
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - CLAUDE_CUSTOM_TITLE_TAIL_BYTES)
    const length = size - start
    if (length <= 0) {
      return null
    }
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, start)
    return findLastClaudeCustomTitle(buffer.toString('utf8'))
  } catch {
    return null
  } finally {
    await handle.close().catch(() => {})
  }
}

type WatchEntry = {
  transcriptPath: string
  watcher: TranscriptNativeWatcher
  timer: ReturnType<typeof setTimeout> | null
  /** Last value emitted for this pane, so re-appends of an unchanged rename
   *  stay silent — restamping would let a stale rename outrank a newer one. */
  lastTitle: string | null
  reading: boolean
  rereadRequested: boolean
  disposed: boolean
}

/**
 * Watches each live Claude pane's transcript for `/rename`, the only signal
 * that separates a deliberate session rename from the auto-generated summaries
 * Claude publishes on the same OSC title channel.
 */
export function createClaudeSessionRenameWatch(
  onRename: (rename: ClaudeSessionRename) => void
): ClaudeSessionRenameWatch {
  const entries = new Map<string, WatchEntry>()

  function disposeEntry(entry: WatchEntry): void {
    entry.disposed = true
    if (entry.timer !== null) {
      clearTimeout(entry.timer)
      entry.timer = null
    }
    entry.watcher.dispose()
  }

  function read(paneKey: string, entry: WatchEntry): void {
    if (entry.reading) {
      entry.rereadRequested = true
      return
    }
    entry.reading = true
    void readLastCustomTitle(entry.transcriptPath)
      .then((customTitle) => {
        if (entry.disposed || !customTitle || customTitle === entry.lastTitle) {
          return
        }
        entry.lastTitle = customTitle
        onRename({ paneKey, customTitle })
      })
      .finally(() => {
        entry.reading = false
        if (entry.disposed) {
          return
        }
        // Why: the native watcher detaches itself when the parent dir reports a
        // rename (a replaced transcript). Nothing else drives a rebind between
        // provider-session pushes, so without this the watch dies after the
        // first such event and later renames go unseen.
        if (entry.watcher.needsRebind()) {
          entry.watcher.bind()
        }
        if (entry.rereadRequested) {
          entry.rereadRequested = false
          read(paneKey, entry)
        }
      })
  }

  function schedule(paneKey: string, entry: WatchEntry): void {
    if (entry.disposed || entry.timer !== null) {
      return
    }
    entry.timer = setTimeout(() => {
      entry.timer = null
      read(paneKey, entry)
    }, READ_DEBOUNCE_MS)
    entry.timer.unref?.()
  }

  return {
    sync(sources): void {
      const live = new Set<string>()
      for (const source of sources) {
        const transcriptPath = source.transcriptPath?.trim()
        if (!transcriptPath) {
          continue
        }
        live.add(source.paneKey)
        const existing = entries.get(source.paneKey)
        if (existing) {
          if (existing.transcriptPath === transcriptPath) {
            // Why: fs.watch binding is best-effort on network filesystems, so
            // retry on every reconcile rather than trusting the first bind.
            if (existing.watcher.needsRebind() && existing.watcher.bind()) {
              // Why: a rename written while the watcher was unbound produced no
              // event, so catch up now — the next write may never come.
              read(source.paneKey, existing)
            }
            continue
          }
          // A new transcript is a new conversation; its rename is unrelated.
          disposeEntry(existing)
          entries.delete(source.paneKey)
        }
        const entry: WatchEntry = {
          transcriptPath,
          watcher: createTranscriptNativeWatcher(
            transcriptPath,
            () => schedule(source.paneKey, entry),
            () => schedule(source.paneKey, entry)
          ),
          timer: null,
          lastTitle: null,
          reading: false,
          rereadRequested: false,
          disposed: false
        }
        entries.set(source.paneKey, entry)
        entry.watcher.bind()
        read(source.paneKey, entry)
      }
      for (const [paneKey, entry] of entries) {
        if (!live.has(paneKey)) {
          disposeEntry(entry)
          entries.delete(paneKey)
        }
      }
    },
    getKnownRenames(): ClaudeSessionRename[] {
      const renames: ClaudeSessionRename[] = []
      for (const [paneKey, entry] of entries) {
        if (entry.lastTitle) {
          renames.push({ paneKey, customTitle: entry.lastTitle })
        }
      }
      return renames
    },
    dispose(): void {
      for (const entry of entries.values()) {
        disposeEntry(entry)
      }
      entries.clear()
    }
  }
}
