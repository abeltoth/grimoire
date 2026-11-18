/** The connector, by its name on claude.ai, such as "claude.ai Atlassian". */
export const ATLASSIAN = /atlassian/i;

/** The connector's tools Grimoire calls, by their own names. */
export const JIRA_TOOLS = {
  /** The Atlassian sites you can reach: each one's cloud ID, address and scopes. */
  sites: 'getAccessibleAtlassianResources',
  /** Who you're signed in as: your account's ID, to assign an issue you create to. */
  user: 'atlassianUserInfo',
  /** The issues a JQL query finds, a page at a time. */
  search: 'searchJiraIssuesUsingJql',
  /** One issue, with the fields asked for: read again once its status changed, or once it's created. */
  issue: 'getJiraIssue',
  /** The changes of status an issue's workflow allows it now. */
  transitions: 'getTransitionsForJiraIssue',
  /** Changes an issue's status by one of those: one of the two tools Grimoire calls that write to Jira. */
  transition: 'transitionJiraIssue',
  /** Creates an issue you confirmed: the other tool that writes. */
  create: 'createJiraIssue',
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
  JIRA_TOOLS.user,
]);

/**
 * Every tool of the connector Grimoire may call, on the Claude Code
 * process that writes: those that read, transitionJiraIssue, which
 * changes an issue's status as you move its card, and createJiraIssue,
 * which creates one you confirmed. Nothing else can change Jira.
 */
export const JIRA_ALLOWED: ReadonlySet<string> = new Set([
  ...JIRA_READ_ONLY,
  JIRA_TOOLS.transition,
  JIRA_TOOLS.create,
]);
