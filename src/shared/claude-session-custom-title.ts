// Claude persists the name `/rename` set as a `custom-title` transcript record,
// separate from the `ai-title` record it writes for its own generated session
// summaries. The OSC terminal title fuses both into one string, so the
// transcript is the only place a deliberate rename can be told apart from an
// auto-generated task summary.

const CUSTOM_TITLE_RECORD_TYPE = 'custom-title'

// Why: the record is re-appended on every turn, so it is dense near the tail —
// a bounded tail read finds the current one without scanning a large file.
export const CLAUDE_CUSTOM_TITLE_TAIL_BYTES = 256 * 1024

export function extractClaudeCustomTitle(line: string): string | null {
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
  const trimmed = customTitle.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * The most recent `/rename` value in a transcript tail, or null when the chunk
 * holds none. A cleared rename (empty `customTitle`) reads as no rename.
 */
export function findLastClaudeCustomTitle(chunk: string): string | null {
  const lines = chunk.split('\n')
  // Why: the first line of a tail read can be a fragment of a longer record;
  // JSON.parse rejects it, so no separate boundary handling is needed.
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const title = extractClaudeCustomTitle(lines[index] ?? '')
    if (title) {
      return title
    }
  }
  return null
}
