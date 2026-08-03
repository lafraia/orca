import { describe, expect, it } from 'vitest'
import { resolveTerminalTabTitle, resolveUnifiedTabLabel } from './tab-title-resolution'

describe('tab title resolution', () => {
  it('uses live terminal titles when generated titles are disabled', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: 'Claude working' },
        false
      )
    ).toBe('Claude working')
  })

  it('places generated titles between manual and live titles when enabled', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: 'Claude working' },
        true
      )
    ).toBe('Refactor auth')
    expect(
      resolveTerminalTabTitle(
        { customTitle: 'Payments', generatedTitle: 'Refactor auth', title: 'Claude working' },
        true
      )
    ).toBe('Payments')
  })

  it('uses meaningful native OpenCode session titles before generated titles', () => {
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: null,
          generatedTitle: 'Refactor auth',
          title: 'OC | Native Stable Session'
        },
        true
      )
    ).toBe('OC | Native Stable Session')
  })

  it('lets a confirmed agent rename outrank every derived label', () => {
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: null,
          agentSessionTitle: 'billing-fix',
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: '⠐ Some task summary'
        },
        true
      )
    ).toBe('billing-fix')
  })

  it('resolves manual and agent renames by which happened last', () => {
    const tab = {
      customTitle: 'Payments',
      customTitleAt: 3000,
      agentSessionTitle: 'billing-fix',
      agentSessionTitleAt: 2000,
      generatedTitle: 'Refactor auth',
      title: '⠐ Some task summary'
    }
    expect(resolveTerminalTabTitle(tab, true)).toBe('Payments')
    expect(resolveTerminalTabTitle({ ...tab, agentSessionTitleAt: 4000 }, true)).toBe('billing-fix')
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: 'Payments',
          customLabelAt: 3000,
          agentSessionLabel: 'billing-fix',
          agentSessionLabelAt: 4000,
          generatedLabel: 'Fix flaky tests',
          label: '✳ Some task summary'
        },
        true
      )
    ).toBe('billing-fix')
  })

  it('lets an agent-set name outrank the generated title', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: '⠐ Ship the rename fix' },
        true
      )
    ).toBe('⠐ Ship the rename fix')
    expect(
      resolveUnifiedTabLabel(
        { customLabel: null, generatedLabel: 'Fix flaky tests', label: '✳ Ship the rename fix' },
        true
      )
    ).toBe('✳ Ship the rename fix')
  })

  it('keeps manual renames and quick commands ahead of agent-set names', () => {
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: 'Payments',
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: '⠐ Ship the rename fix'
        },
        true
      )
    ).toBe('Payments')
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: null,
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: '⠐ Ship the rename fix'
        },
        true
      )
    ).toBe('Run tests')
  })

  it('keeps generated titles ahead of agent status and cwd frames', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: '✳ Claude Code' },
        true
      )
    ).toBe('Refactor auth')
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: '..-cost-savings' },
        true
      )
    ).toBe('Refactor auth')
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: null,
          generatedTitle: 'Refactor auth',
          title: 'Terminal 2',
          defaultTitle: 'Terminal 2'
        },
        true
      )
    ).toBe('Refactor auth')
  })

  it('keeps generated titles ahead of generic OpenCode titles', () => {
    expect(
      resolveTerminalTabTitle(
        { customTitle: null, generatedTitle: 'Refactor auth', title: 'OpenCode' },
        true
      )
    ).toBe('Refactor auth')
  })

  it('places quick command labels between manual and generated titles', () => {
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: null,
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: 'pnpm test'
        },
        true
      )
    ).toBe('Run tests')
    expect(
      resolveTerminalTabTitle(
        {
          customTitle: 'Manual label',
          quickCommandLabel: 'Run tests',
          generatedTitle: 'Refactor auth',
          title: 'pnpm test'
        },
        true
      )
    ).toBe('Manual label')
  })

  it('uses the same priority for unified tab labels', () => {
    expect(
      resolveUnifiedTabLabel(
        { customLabel: null, generatedLabel: 'Fix flaky tests', label: 'Codex working' },
        true
      )
    ).toBe('Fix flaky tests')
  })

  it('uses quick command labels before generated unified labels', () => {
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: null,
          quickCommandLabel: 'Run build',
          generatedLabel: 'Fix flaky tests',
          label: 'Codex working'
        },
        true
      )
    ).toBe('Run build')
  })

  it('uses meaningful native OpenCode labels before generated unified labels', () => {
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: null,
          generatedLabel: 'Fix flaky tests',
          label: 'OC | Native Stable Session'
        },
        true
      )
    ).toBe('OC | Native Stable Session')
  })

  it('keeps manual and quick command labels ahead of native OpenCode labels', () => {
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: 'Manual label',
          quickCommandLabel: 'Run build',
          generatedLabel: 'Fix flaky tests',
          label: 'OC | Native Stable Session'
        },
        true
      )
    ).toBe('Manual label')
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: null,
          quickCommandLabel: 'Run build',
          generatedLabel: 'Fix flaky tests',
          label: 'OC | Native Stable Session'
        },
        true
      )
    ).toBe('Run build')
  })
})
