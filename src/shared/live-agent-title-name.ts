// Extracts the name an agent's live OSC title carries — a renamed session
// (Claude `/rename`), a task summary — or null when the frame is only status.
// Renames arrive on the same OSC channel as status, so callers that let a
// rename outrank their own derived labels need this gate to reject identity
// echoes ("✳ Claude Code"), synthetic status labels, cwd frames, and default
// terminal labels.
import type { AgentType } from './agent-status-types'
import { isClaudeManagementTitle } from './agent-title-core'
import { stripLeadingAgentTitleDecorationOrEmpty } from './agent-title-decoration'
import { formatAgentTypeLabel, WELL_KNOWN_AGENT_LABELS } from './agent-type-label'
import { SYNTHETIC_AGENT_TITLE_PROFILES } from './synthetic-agent-title'

// Why: synthetic status titles ("Codex ready", "Cursor - action required") are
// state, not names. Precomputed once; the profile table is a module constant.
const SYNTHETIC_STATUS_TITLES_LOWER: ReadonlySet<string> = new Set(
  Object.values(SYNTHETIC_AGENT_TITLE_PROFILES).flatMap((profile) => [
    profile.workingLabel.toLowerCase(),
    profile.permissionLabel.toLowerCase(),
    profile.idleLabel.toLowerCase()
  ])
)

// Why: retained rows without a live tab synthesize `title: 'Agent'`
// (worktree-agent-row-fallback-tab.ts); it is a placeholder, not a name.
const FALLBACK_TAB_TITLE_LOWER = 'agent'

const AGENT_IDENTITY_ALIASES_LOWER: Readonly<Record<string, readonly string[]>> = {
  claude: ['claude code'],
  gemini: ['gemini cli']
}

// Why: tab-level callers resolve a label with no agent identity in hand, so an
// idle echo like "✳ Claude Code" has to be rejected against every known name.
const KNOWN_AGENT_IDENTITIES_LOWER: readonly string[] = [
  ...new Set([
    ...Object.values(WELL_KNOWN_AGENT_LABELS).map((label) => label.toLowerCase()),
    ...Object.values(AGENT_IDENTITY_ALIASES_LOWER).flat()
  ])
]

const STATUS_WITH_CONTEXT_RE = /^(?:ready|idle|done)(?:\s+\([^)]*\))?$/i
const DEFAULT_TERMINAL_TITLE_RE = /^terminal \d+$/i

function isIdentityStatusTitle(titleLower: string, identityLower: string): boolean {
  return (
    titleLower === identityLower ||
    titleLower === `${identityLower} ready` ||
    titleLower === `${identityLower} idle` ||
    titleLower === `${identityLower} done` ||
    titleLower === `${identityLower} working` ||
    titleLower === `${identityLower} thinking` ||
    titleLower === `${identityLower} running` ||
    titleLower === `${identityLower} - action required`
  )
}

function isAgentIdentityStatusTitle(
  titleLower: string,
  agentType: AgentType | null | undefined
): boolean {
  if (
    KNOWN_AGENT_IDENTITIES_LOWER.some((identity) => isIdentityStatusTitle(titleLower, identity))
  ) {
    return true
  }
  // Custom harness names are absent from the well-known table, so also test the
  // caller's own identity when it knows one.
  return isIdentityStatusTitle(titleLower, formatAgentTypeLabel(agentType).toLowerCase())
}

function isCwdLikeTitle(title: string): boolean {
  // Hook-less agents over SSH surface spinner+cwd titles (#8711); once the
  // spinner is stripped, what remains is a path, not a conversation name. `..`
  // covers the abbreviated cwd shells write once the agent exits.
  if (/^(?:~|\.\.|[\\/]|[A-Za-z]:[\\/])/.test(title)) {
    return true
  }
  // A single path-ish token ("orca/workspaces") is still a cwd, not a name.
  return !/\s/.test(title) && /[\\/]/.test(title)
}

export type LiveAgentTitleNameOptions = {
  /** The agent owning the title, when known — covers custom harness names. */
  agentType?: AgentType | null
  /** The tab's stable default label ("Terminal 3"), which is not a name. */
  defaultTitle?: string
}

/**
 * The name an agent's live title carries, or null when the title is status
 * decoration the caller should look past.
 */
export function resolveLiveAgentTitleName(
  liveTitle: string | null | undefined,
  options: LiveAgentTitleNameOptions = {}
): string | null {
  const stripped = stripLeadingAgentTitleDecorationOrEmpty(liveTitle?.trim() ?? '').trim()
  if (!stripped) {
    return null
  }
  const lower = stripped.toLowerCase()
  if (
    SYNTHETIC_STATUS_TITLES_LOWER.has(lower) ||
    lower === FALLBACK_TAB_TITLE_LOWER ||
    isAgentIdentityStatusTitle(lower, options.agentType) ||
    STATUS_WITH_CONTEXT_RE.test(stripped) ||
    DEFAULT_TERMINAL_TITLE_RE.test(stripped) ||
    isClaudeManagementTitle(stripped) ||
    isCwdLikeTitle(stripped)
  ) {
    return null
  }
  const defaultTitle = options.defaultTitle?.trim()
  if (defaultTitle && stripped === defaultTitle) {
    return null
  }
  return stripped
}
