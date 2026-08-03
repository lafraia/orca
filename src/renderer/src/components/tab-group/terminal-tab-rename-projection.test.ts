import { describe, expect, it } from 'vitest'
import { resolveUnifiedTabLabel } from '../../../../shared/tab-title-resolution'
import type { Tab, TerminalTab } from '../../../../shared/types'

// Why: useTabGroupWorkspaceModel and FloatingTerminalPanel rebuild the terminal
// tab field-by-field from the unified tab plus the store tab. The rename stamps
// were dropped there, so the strip saw an agent rename with no timestamp and
// always ranked the manual rename first — the resolvers were right and the tab
// still showed the stale name. Mirror that merge and assert the stamps survive.
function projectTerminalTab(
  item: Partial<Tab>,
  terminalTab: Partial<TerminalTab> | undefined
): Partial<TerminalTab> {
  return {
    quickCommandLabel: terminalTab?.quickCommandLabel ?? item.quickCommandLabel ?? null,
    generatedTitle: terminalTab?.generatedTitle ?? item.generatedLabel ?? null,
    customTitle: item.customLabel ?? terminalTab?.customTitle ?? null,
    customTitleAt: item.customLabelAt ?? terminalTab?.customTitleAt,
    agentSessionTitle: item.agentSessionLabel ?? terminalTab?.agentSessionTitle ?? null,
    agentSessionTitleAt: item.agentSessionLabelAt ?? terminalTab?.agentSessionTitleAt
  }
}

describe('terminal tab rename projection', () => {
  it('carries both rename stamps through the rebuild', () => {
    const projected = projectTerminalTab(
      { customLabel: 'uuu', label: 'uuu' },
      {
        customTitle: 'uuu',
        customTitleAt: 1785730759629,
        agentSessionTitle: '888',
        agentSessionTitleAt: 1785731033225
      }
    )

    expect(projected.customTitleAt).toBe(1785730759629)
    expect(projected.agentSessionTitle).toBe('888')
    expect(projected.agentSessionTitleAt).toBe(1785731033225)
  })

  it('resolves the projected tab to the newer rename', () => {
    const terminalTab = {
      customTitle: 'uuu',
      customTitleAt: 1785730759629,
      agentSessionTitle: '888',
      agentSessionTitleAt: 1785731033225
    }
    const item: Partial<Tab> = { customLabel: 'uuu', label: 'uuu' }
    const projected = projectTerminalTab(item, terminalTab)

    expect(
      resolveUnifiedTabLabel(
        {
          ...item,
          customLabel: item.customLabel ?? null,
          label: item.label ?? '',
          customLabelAt: item.customLabelAt ?? terminalTab.customTitleAt,
          agentSessionLabel: item.agentSessionLabel ?? terminalTab.agentSessionTitle,
          agentSessionLabelAt: item.agentSessionLabelAt ?? terminalTab.agentSessionTitleAt
        },
        true,
        'Terminal'
      )
    ).toBe('888')

    // Why: the strip reads the projected tab, not the store tab — a dropped
    // stamp here silently reinstates the old manual-rename-always-wins order.
    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: projected.customTitle ?? null,
          customLabelAt: projected.customTitleAt,
          agentSessionLabel: projected.agentSessionTitle,
          agentSessionLabelAt: projected.agentSessionTitleAt,
          label: 'uuu'
        },
        true,
        'Terminal'
      )
    ).toBe('888')
  })

  it('keeps a terminal-only manual rename winning over an older agent rename', () => {
    // Why: the unified tab carries no customLabel for a locally renamed tab, so
    // passing the stamp without its title made the resolver read the manual
    // rename as absent and hand the label to a staler agent rename.
    const terminalTab = {
      customTitle: 'manual name',
      customTitleAt: 4000,
      agentSessionTitle: 'agent name',
      agentSessionTitleAt: 1000
    }
    const item: Partial<Tab> = { customLabel: null, label: 'live title' }

    expect(
      resolveUnifiedTabLabel(
        {
          customLabel: item.customLabel ?? terminalTab.customTitle ?? null,
          customLabelAt: item.customLabelAt ?? terminalTab.customTitleAt,
          agentSessionLabel: item.agentSessionLabel ?? terminalTab.agentSessionTitle,
          agentSessionLabelAt: item.agentSessionLabelAt ?? terminalTab.agentSessionTitleAt,
          label: item.label ?? ''
        },
        true,
        'Terminal'
      )
    ).toBe('manual name')

    expect(projectTerminalTab(item, terminalTab).customTitle).toBe('manual name')
  })

  it('prefers the unified tab values when the host owns them', () => {
    const projected = projectTerminalTab(
      { customLabel: 'host name', customLabelAt: 5000 },
      { customTitle: 'local name', customTitleAt: 1000 }
    )
    expect(projected.customTitle).toBe('host name')
    expect(projected.customTitleAt).toBe(5000)
  })
})
