import { resolveLiveAgentTitleName } from './live-agent-title-name'
import { resolveNewestTabRename, resolveNewestTerminalTabRename } from './newest-tab-rename'
import { isMeaningfulOpenCodeTerminalTitle } from './opencode-terminal-title'
import type { Tab, TerminalTab } from './types'

// Why: a live title carrying a real name is the agent renaming its own session,
// which the user expects to win like a manual tab rename. Status, identity-echo,
// and spinner/cwd frames yield no name and fall through to the generated title,
// so a working agent doesn't repaint the tab as a status. This is the unproven
// path — an OSC name Orca could not match to a rename record; a confirmed
// rename arrives as `agentSessionTitle` and outranks everything here.
function liveTitleRename(liveTitle: string, defaultTitle?: string): string {
  return resolveLiveAgentTitleName(liveTitle, { defaultTitle }) ? liveTitle : ''
}

export function resolveTerminalTabTitle(
  tab: Pick<
    TerminalTab,
    | 'customTitle'
    | 'customTitleAt'
    | 'agentSessionTitle'
    | 'agentSessionTitleAt'
    | 'quickCommandLabel'
    | 'generatedTitle'
    | 'title'
    | 'defaultTitle'
  >,
  generatedTitlesEnabled: boolean,
  fallback = ''
): string {
  const liveTitle = tab.title?.trim() ?? ''
  return (
    resolveNewestTerminalTabRename(tab) ||
    tab.quickCommandLabel?.trim() ||
    (isMeaningfulOpenCodeTerminalTitle(liveTitle) ? liveTitle : '') ||
    liveTitleRename(liveTitle, tab.defaultTitle) ||
    (generatedTitlesEnabled ? tab.generatedTitle?.trim() : '') ||
    liveTitle ||
    fallback
  )
}

export function resolveUnifiedTabLabel(
  tab:
    | Pick<
        Tab,
        | 'customLabel'
        | 'customLabelAt'
        | 'agentSessionLabel'
        | 'agentSessionLabelAt'
        | 'quickCommandLabel'
        | 'generatedLabel'
        | 'label'
      >
    | undefined,
  generatedTitlesEnabled: boolean,
  fallback = ''
): string {
  const liveLabel = tab?.label?.trim() ?? ''
  return (
    resolveNewestTabRename({
      manualRename: tab?.customLabel,
      manualRenameAt: tab?.customLabelAt,
      agentRename: tab?.agentSessionLabel,
      agentRenameAt: tab?.agentSessionLabelAt
    }) ||
    tab?.quickCommandLabel?.trim() ||
    (isMeaningfulOpenCodeTerminalTitle(liveLabel) ? liveLabel : '') ||
    liveTitleRename(liveLabel) ||
    (generatedTitlesEnabled ? tab?.generatedLabel?.trim() : '') ||
    liveLabel ||
    fallback
  )
}
