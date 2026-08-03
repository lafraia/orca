// Resolves the stable "conversation name" an agent row can show instead of the
// live last-message preview. Sources, in the same precedence the tab bar uses
// (tab-title-resolution.ts): newest rename (manual or agent-set) → quick-command
// label → OpenCode's semantic session title → an unconfirmed agent-set live
// name → Orca's generated title.
// Live titles are accepted only when they carry a real name — pure status,
// identity-echo, and spinner/cwd titles yield null so callers keep the
// last-message label.
import type { AgentType } from './agent-status-types'
import { resolveLiveAgentTitleName } from './live-agent-title-name'
import { resolveNewestTerminalTabRename } from './newest-tab-rename'
import { isMeaningfulOpenCodeTerminalTitle } from './opencode-terminal-title'
import type { TerminalTab } from './types'

export type ConversationNameTab = Pick<
  TerminalTab,
  | 'customTitle'
  | 'customTitleAt'
  | 'agentSessionTitle'
  | 'agentSessionTitleAt'
  | 'quickCommandLabel'
  | 'generatedTitle'
  | 'title'
  | 'defaultTitle'
>

/**
 * The conversation name for an agent row, or null when no usable name exists
 * and the caller should keep its last-message label.
 */
export function getAgentRowConversationName(
  tab: ConversationNameTab,
  agentType: AgentType | null | undefined,
  generatedTitlesEnabled: boolean
): string | null {
  const rename = resolveNewestTerminalTabRename(tab)
  if (rename) {
    return rename
  }
  const quickCommandLabel = tab.quickCommandLabel?.trim()
  if (quickCommandLabel) {
    return quickCommandLabel
  }
  const liveTitle = tab.title?.trim() ?? ''
  if (isMeaningfulOpenCodeTerminalTitle(liveTitle)) {
    return liveTitle
  }
  // Why: a live title carrying a real name is the agent's own session rename,
  // which the user expects to win like a manual tab rename does — Orca's
  // first-prompt title is a guess and must not shadow it.
  const liveName = resolveLiveAgentTitleName(liveTitle, {
    agentType,
    defaultTitle: tab.defaultTitle
  })
  if (liveName) {
    return liveName
  }
  return (generatedTitlesEnabled ? tab.generatedTitle?.trim() : '') || null
}
