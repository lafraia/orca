import { describe, expect, it } from 'vitest'
import { extractClaudeCustomTitle, findLastClaudeCustomTitle } from './claude-session-custom-title'

const renameRecord = (title: string): string =>
  JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: 's1' })

describe('extractClaudeCustomTitle', () => {
  it('reads the name a rename record carries', () => {
    expect(extractClaudeCustomTitle(renameRecord('  billing-fix  '))).toBe('billing-fix')
  })

  it('ignores every other record type, including the generated session name', () => {
    expect(
      extractClaudeCustomTitle(JSON.stringify({ type: 'ai-title', aiTitle: 'Fix the intake flow' }))
    ).toBeNull()
    expect(
      extractClaudeCustomTitle(JSON.stringify({ type: 'agent-name', agentName: 'billing-fix' }))
    ).toBeNull()
    expect(extractClaudeCustomTitle(JSON.stringify({ type: 'user', message: {} }))).toBeNull()
  })

  it('ignores malformed lines and cleared renames', () => {
    expect(extractClaudeCustomTitle('')).toBeNull()
    expect(extractClaudeCustomTitle('{"type":"custom-title"')).toBeNull()
    expect(extractClaudeCustomTitle(renameRecord('   '))).toBeNull()
    expect(
      extractClaudeCustomTitle(JSON.stringify({ type: 'custom-title', customTitle: 42 }))
    ).toBeNull()
  })
})

describe('findLastClaudeCustomTitle', () => {
  it('returns the most recent rename in the chunk', () => {
    const chunk = [
      renameRecord('first'),
      JSON.stringify({ type: 'user', message: {} }),
      renameRecord('second'),
      JSON.stringify({ type: 'ai-title', aiTitle: 'Some generated summary' })
    ].join('\n')
    expect(findLastClaudeCustomTitle(chunk)).toBe('second')
  })

  it('survives a leading partial record from a mid-file tail read', () => {
    const chunk = ['e":"custom-title","customTitle":"truncated"}', renameRecord('whole')].join('\n')
    expect(findLastClaudeCustomTitle(chunk)).toBe('whole')
  })

  it('treats a cleared rename as the newest state, not a miss', () => {
    // Why: clearing a rename is itself the newest record. Scanning past it would
    // resurface a name the user already removed.
    const chunk = [renameRecord('A'), renameRecord('')].join('\n')
    expect(findLastClaudeCustomTitle(chunk)).toBeNull()

    const restored = [renameRecord('A'), renameRecord(''), renameRecord('B')].join('\n')
    expect(findLastClaudeCustomTitle(restored)).toBe('B')
  })

  it('returns null when the chunk holds no rename', () => {
    expect(findLastClaudeCustomTitle('')).toBeNull()
    expect(findLastClaudeCustomTitle(JSON.stringify({ type: 'user' }))).toBeNull()
  })
})
