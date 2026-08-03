// Claude persists the name `/rename` set as a `custom-title` transcript record,
// separate from the `ai-title` record it writes for its own generated session
// summaries. The OSC terminal title fuses both into one string, so the
// transcript is the only place a deliberate rename can be told apart from an
// auto-generated task summary.

const CUSTOM_TITLE_RECORD_TYPE = 'custom-title'

// Why: the record is re-appended on every turn, so it is dense near the tail —
// a bounded tail read finds the current one without scanning a large file.
export const CLAUDE_CUSTOM_TITLE_TAIL_BYTES = 256 * 1024

/**
 * The trimmed name on a `custom-title` line — empty string for a rename the
 * user cleared — or null when the line is not a `custom-title` record.
 *
 * Why the empty-vs-null split: the backward scan has to stop at the newest
 * record it finds, and a cleared rename is a record. Folding both into null
 * would let the scan walk past a clear and resurface an older name.
 */
function parseClaudeCustomTitleLine(line: string): string | null {
  // Why: cheap reject before JSON.parse — transcripts are mostly large message
  // records and this scan runs over every line of the tail.
  if (!line.includes(CUSTOM_TITLE_RECORD_TYPE)) {
    return null
  }
  let record: unknown
  try {
    record = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof record !== 'object' || record === null) {
    return null
  }
  const { type, customTitle } = record as { type?: unknown; customTitle?: unknown }
  if (type !== CUSTOM_TITLE_RECORD_TYPE || typeof customTitle !== 'string') {
    return null
  }
  return customTitle.trim()
}

/** The name a `custom-title` line carries, or null for any other line. */
export function extractClaudeCustomTitle(line: string): string | null {
  const title = parseClaudeCustomTitleLine(line)
  return title ? title : null
}

/**
 * The most recent `/rename` value in a transcript tail, or null when the chunk
 * holds none. A cleared rename (empty `customTitle`) is the newest state, so it
 * reads as no rename rather than falling back to an older name.
 */
export function findLastClaudeCustomTitle(chunk: string): string | null {
  const lines = chunk.split('\n')
  // Why: the first line of a tail read can be a fragment of a longer record;
  // JSON.parse rejects it, so no separate boundary handling is needed.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const title = parseClaudeCustomTitleLine(lines[index] ?? '')
    if (title !== null) {
      return title.length > 0 ? title : null
    }
  }
  return null
}
