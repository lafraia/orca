import { describe, expect, it } from 'vitest'
import { resolveLiveAgentTitleName } from './live-agent-title-name'

describe('resolveLiveAgentTitleName', () => {
  it('returns the renamed session behind the agent status decoration', () => {
    expect(resolveLiveAgentTitleName('⠐ Patient sync spike')).toBe('Patient sync spike')
    expect(resolveLiveAgentTitleName('✳ Investigate replay bug')).toBe('Investigate replay bug')
  })

  it('rejects identity echoes without being told which agent owns the tab', () => {
    for (const title of [
      'Claude',
      '✳ Claude Code',
      'Claude Code - action required',
      '✦ Gemini CLI',
      'Codex working',
      'Cursor Agent',
      '⠋ Grok',
      'claude agents',
      'Agent'
    ]) {
      expect(resolveLiveAgentTitleName(title)).toBeNull()
    }
  })

  it('rejects status, placeholder, and default terminal frames', () => {
    expect(resolveLiveAgentTitleName('')).toBeNull()
    expect(resolveLiveAgentTitleName('✳')).toBeNull()
    expect(resolveLiveAgentTitleName('Codex ready')).toBeNull()
    expect(resolveLiveAgentTitleName('◇ Ready (orca)')).toBeNull()
    expect(resolveLiveAgentTitleName('Terminal 3')).toBeNull()
    expect(resolveLiveAgentTitleName('Session 2', { defaultTitle: 'Session 2' })).toBeNull()
  })

  it('rejects cwd frames, including the abbreviated form shells write', () => {
    expect(resolveLiveAgentTitleName('⠋ ~/orca/workspaces')).toBeNull()
    expect(resolveLiveAgentTitleName('/Users/dev/repo')).toBeNull()
    expect(resolveLiveAgentTitleName('C:\\repos\\orca')).toBeNull()
    expect(resolveLiveAgentTitleName('orca/workspaces')).toBeNull()
    expect(resolveLiveAgentTitleName('..-cost-savings')).toBeNull()
    expect(resolveLiveAgentTitleName('../orca')).toBeNull()
  })

  it('keeps names that merely contain status words or a slash', () => {
    expect(resolveLiveAgentTitleName('Fix a/b toggle in settings')).toBe(
      'Fix a/b toggle in settings'
    )
    expect(resolveLiveAgentTitleName('Make the ready state idle-safe')).toBe(
      'Make the ready state idle-safe'
    )
  })

  it('rejects a custom harness identity echo when the agent type is known', () => {
    expect(resolveLiveAgentTitleName('mycli ready', { agentType: 'mycli' })).toBeNull()
    expect(resolveLiveAgentTitleName('mycli ready')).toBe('mycli ready')
  })
})
