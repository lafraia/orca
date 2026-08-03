import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  resolveTerminalTabTitle,
  resolveUnifiedTabLabel
} from '../../../../shared/tab-title-resolution'
import { createTestStore, makeWorktree, seedStore } from './store-test-helpers'

const WORKTREE_ID = 'repo1::/path/wt1'

function seedWorktree(store: ReturnType<typeof createTestStore>): string {
  seedStore(store, {
    settings: { ...getDefaultSettings('/tmp'), tabAutoGenerateTitle: true },
    worktreesByRepo: {
      repo1: [makeWorktree({ id: WORKTREE_ID, repoId: 'repo1', path: '/path/wt1' })]
    }
  })
  return store.getState().createTab(WORKTREE_ID).id
}

function terminalTab(store: ReturnType<typeof createTestStore>) {
  return store.getState().tabsByWorktree[WORKTREE_ID][0]
}

function unifiedTab(store: ReturnType<typeof createTestStore>) {
  return store.getState().unifiedTabsByWorktree[WORKTREE_ID][0]
}

describe('agent session rename', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('stores the rename apart from the live and generated titles, and shows it', () => {
    const store = createTestStore()
    const tabId = seedWorktree(store)
    store.getState().updateTabTitle(tabId, '⠐ Some task summary')

    store.getState().setTabAgentSessionTitle(tabId, '  billing-fix  ')

    const tab = terminalTab(store)
    expect(tab.agentSessionTitle).toBe('billing-fix')
    expect(tab.title).toBe('⠐ Some task summary')
    expect(unifiedTab(store).agentSessionLabel).toBe('billing-fix')
    expect(resolveTerminalTabTitle(tab, true, 'Terminal')).toBe('billing-fix')
    expect(resolveUnifiedTabLabel(unifiedTab(store), true, 'Terminal')).toBe('billing-fix')
  })

  it('ignores an empty rename and an unchanged re-report', () => {
    const store = createTestStore()
    const tabId = seedWorktree(store)

    store.getState().setTabAgentSessionTitle(tabId, '   ')
    expect(terminalTab(store).agentSessionTitle).toBeUndefined()

    store.getState().setTabAgentSessionTitle(tabId, 'billing-fix')
    const stampedAt = terminalTab(store).agentSessionTitleAt
    expect(stampedAt).toBeTypeOf('number')

    // Why: Claude re-appends the rename record every turn; restamping it would
    // keep pushing a stale rename past a newer manual one.
    store.getState().setTabAgentSessionTitle(tabId, 'billing-fix')
    expect(terminalTab(store).agentSessionTitleAt).toBe(stampedAt)
  })

  it('lets a later manual rename win, and a later agent rename win back', () => {
    // Why: the two renames are ordered by wall clock, so drive it explicitly —
    // same-millisecond calls would tie and make the assertion clock-dependent.
    vi.useFakeTimers()
    const store = createTestStore()
    const tabId = seedWorktree(store)

    store.getState().setTabAgentSessionTitle(tabId, 'billing-fix')
    vi.advanceTimersByTime(1000)
    store.getState().setTabCustomTitle(tabId, 'Payments')
    expect(resolveTerminalTabTitle(terminalTab(store), true, 'Terminal')).toBe('Payments')
    expect(resolveUnifiedTabLabel(unifiedTab(store), true, 'Terminal')).toBe('Payments')

    vi.advanceTimersByTime(1000)
    store.getState().setTabAgentSessionTitle(tabId, 'invoice-fix')
    expect(resolveTerminalTabTitle(terminalTab(store), true, 'Terminal')).toBe('invoice-fix')
    expect(resolveUnifiedTabLabel(unifiedTab(store), true, 'Terminal')).toBe('invoice-fix')
  })
})
