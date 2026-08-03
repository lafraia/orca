// A tab can be renamed two ways, and both are the user acting deliberately:
// in Orca's tab strip (`customTitle`) or from inside the agent (Claude
// `/rename`, surfaced as `agentSessionTitle`). Neither outranks the other by
// origin, so the more recent rename wins. A rename with no timestamp predates
// the field and loses to a stamped one.

import type { TerminalTab } from './types'

export type TabRenameCandidates = {
  manualRename: string | null | undefined
  manualRenameAt: number | undefined
  agentRename: string | null | undefined
  agentRenameAt: number | undefined
}

export function resolveNewestTabRename(candidates: TabRenameCandidates): string {
  const manual = candidates.manualRename?.trim() ?? ''
  const agent = candidates.agentRename?.trim() ?? ''
  if (!manual) {
    return agent
  }
  if (!agent) {
    return manual
  }
  // Ties go to the manual rename: it is the one the user performed in Orca, so
  // it is the act they just watched take effect.
  return (candidates.agentRenameAt ?? 0) > (candidates.manualRenameAt ?? 0) ? agent : manual
}

export type TerminalTabRenameFields = Pick<
  TerminalTab,
  'customTitle' | 'customTitleAt' | 'agentSessionTitle' | 'agentSessionTitleAt'
>

/** The newest rename on a terminal-tab-shaped record. */
export function resolveNewestTerminalTabRename(tab: TerminalTabRenameFields): string {
  return resolveNewestTabRename({
    manualRename: tab.customTitle,
    manualRenameAt: tab.customTitleAt,
    agentRename: tab.agentSessionTitle,
    agentRenameAt: tab.agentSessionTitleAt
  })
}
