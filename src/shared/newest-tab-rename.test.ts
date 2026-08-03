import { describe, expect, it } from 'vitest'
import { resolveNewestTabRename } from './newest-tab-rename'

describe('resolveNewestTabRename', () => {
  it('returns the more recent of the two renames', () => {
    expect(
      resolveNewestTabRename({
        manualRename: 'Payments',
        manualRenameAt: 1000,
        agentRename: 'billing-fix',
        agentRenameAt: 2000
      })
    ).toBe('billing-fix')
    expect(
      resolveNewestTabRename({
        manualRename: 'Payments',
        manualRenameAt: 3000,
        agentRename: 'billing-fix',
        agentRenameAt: 2000
      })
    ).toBe('Payments')
  })

  it('uses whichever rename exists when only one is set', () => {
    expect(
      resolveNewestTabRename({
        manualRename: '  Payments  ',
        manualRenameAt: undefined,
        agentRename: null,
        agentRenameAt: undefined
      })
    ).toBe('Payments')
    expect(
      resolveNewestTabRename({
        manualRename: '   ',
        manualRenameAt: 9000,
        agentRename: ' billing-fix ',
        agentRenameAt: undefined
      })
    ).toBe('billing-fix')
  })

  it('lets a stamped rename beat one that predates the timestamps', () => {
    expect(
      resolveNewestTabRename({
        manualRename: 'Payments',
        manualRenameAt: undefined,
        agentRename: 'billing-fix',
        agentRenameAt: 2000
      })
    ).toBe('billing-fix')
  })

  it('keeps the manual rename on an exact tie', () => {
    expect(
      resolveNewestTabRename({
        manualRename: 'Payments',
        manualRenameAt: 2000,
        agentRename: 'billing-fix',
        agentRenameAt: 2000
      })
    ).toBe('Payments')
  })

  it('returns empty when neither rename is set', () => {
    expect(
      resolveNewestTabRename({
        manualRename: null,
        manualRenameAt: undefined,
        agentRename: undefined,
        agentRenameAt: undefined
      })
    ).toBe('')
  })
})
