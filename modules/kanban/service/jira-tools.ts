/** The connector, by its name on claude.ai, such as "claude.ai Atlassian". */
export const ATLASSIAN = /atlassian/i;

/** The connector's tools Grimoire calls, by their own names. */
export const JIRA_TOOLS = {
  /** The Atlassian sites you can reach: each one's cloud ID, address and scopes. */
  sites: 'getAccessibleAtlassianResources',
  /** The issues a JQL query finds, a page at a time. */
  search: 'searchJiraIssuesUsingJql',
  /** One issue, with the fields asked for: read again once its status changed. */
  issue: 'getJiraIssue',
  /** The changes of status an issue's workflow allows it now. */
  transitions: 'getTransitionsForJiraIssue',
  /** Changes an issue's status by one of those: the one tool Grimoire calls that writes to Jira. */
  transition: 'transitionJiraIssue',
} as const;

/**
 * The tools of the connector the sync and `npm run jira:check` may call:
 * only ones that read. A direct call asks no permission, so nothing else
 * can be called on their Claude Code processes.
 */
export const JIRA_READ_ONLY: ReadonlySet<string> = new Set([
  JIRA_TOOLS.sites,
  JIRA_TOOLS.search,
  JIRA_TOOLS.issue,
  JIRA_TOOLS.transitions,
  'atlassianUserInfo',
]);

/**
 * Every tool of the connector Grimoire may call, on the Claude Code
 * process that moves cards: those that read, and transitionJiraIssue, the
 * one that writes, which changes an issue's status as you move its card.
 * Nothing else can change Jira.
 */
export const JIRA_ALLOWED: ReadonlySet<string> = new Set([
  ...JIRA_READ_ONLY,
  JIRA_TOOLS.transition,
]);
