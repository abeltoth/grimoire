import type { JiraTransition } from '@grimoire/contract';
import type { Connector, Connectors, ToolResult } from '@grimoire/service/claude/connectors';
import {
  type FetchedIssue,
  ISSUE_FIELDS,
  readOne,
  readSearch,
  readSite,
  readTransitions,
} from './jira-fields';
import { ATLASSIAN, JIRA_ALLOWED, JIRA_READ_ONLY, JIRA_TOOLS } from './jira-tools';

/**
 * Your Jira issues, through your claude.ai Atlassian connector: the one
 * place that calls the connector's tools, and knows what they take. The
 * sites and the search are confirmed against the real connector; an
 * issue's transitions, making one and reading the issue again aren't
 * yet. `npm run jira:check` shows what the connector really has and
 * answers.
 */

/** The tools the sync calls; the Atlassian connector is the one that has them. */
const SYNC_TOOLS = [JIRA_TOOLS.sites, JIRA_TOOLS.search];
/** The tools moving a card calls. */
const MOVE_TOOLS = [
  JIRA_TOOLS.sites,
  JIRA_TOOLS.transitions,
  JIRA_TOOLS.transition,
  JIRA_TOOLS.issue,
];

/** The most issues on the board, and how many are asked for at a time. */
export const MAX_ISSUES = 100;
const PAGE = 50;

/** What a sync found: no connector, one to connect again, one that failed, or the issues. */
export type JiraFetch =
  | { outcome: 'none' }
  | { outcome: 'needs-auth' }
  | { outcome: 'failed'; error: string }
  | { outcome: 'synced'; issues: FetchedIssue[] };

/**
 * The Atlassian connector among yours, if you have one. You may have
 * several, such as "claude.ai Atlassian" and "claude.ai Atlassian Rovo":
 * the one with the tools the sync calls comes first, then one connected.
 */
export function atlassianIn(connectors: readonly Connector[]): Connector | undefined {
  const atlassian = connectors.filter((connector) => ATLASSIAN.test(connector.name));
  const syncs = (connector: Connector) =>
    SYNC_TOOLS.every((tool) => connector.tools.includes(tool));
  return (
    atlassian.find(syncs) ??
    atlassian.find((connector) => connector.status === 'connected') ??
    atlassian[0]
  );
}

/**
 * Fetches the issues the query finds, through the Atlassian connector on
 * a Claude Code process `open` starts, which is stopped once they're in.
 */
export async function fetchJira(
  open: (allowed: ReadonlySet<string>) => Promise<Connectors>,
  jql: string,
): Promise<JiraFetch> {
  let connectors: Connectors | undefined;
  try {
    connectors = await open(JIRA_READ_ONLY);
    const reached = await reach(connectors, SYNC_TOOLS);
    if (reached.outcome !== 'reached') return reached;
    const { atlassian } = reached;
    const call = (tool: string, args: Record<string, unknown>) =>
      connectors!.call(atlassian, tool, args);
    const site = readSite(await call(JIRA_TOOLS.sites, {}));
    const issues: FetchedIssue[] = [];
    let next: string | undefined;
    do {
      const page = readSearch(
        await call(JIRA_TOOLS.search, {
          cloudId: site.cloudId,
          jql,
          fields: ISSUE_FIELDS,
          maxResults: Math.min(PAGE, MAX_ISSUES - issues.length),
          ...(next ? { nextPageToken: next } : {}),
        }),
        site.url,
      );
      for (const issue of page.issues) {
        if (!issues.some((had) => had.key === issue.key)) issues.push(issue);
      }
      next = page.next;
    } while (next && issues.length < MAX_ISSUES);
    return { outcome: 'synced', issues: issues.slice(0, MAX_ISSUES) };
  } catch (error) {
    return { outcome: 'failed', error: error instanceof Error ? error.message : String(error) };
  } finally {
    connectors?.close();
  }
}

/**
 * The Atlassian connector among those Claude Code lists, connected and
 * with these tools; or there's none, it needs connecting again, or why it
 * can't be used.
 */
async function reach(
  connectors: Connectors,
  tools: readonly string[],
): Promise<
  { outcome: 'reached'; atlassian: Connector } | Exclude<JiraFetch, { outcome: 'synced' }>
> {
  const atlassian = atlassianIn(await connectors.list());
  if (!atlassian || atlassian.status === 'disabled') return { outcome: 'none' };
  if (atlassian.status === 'needs-auth') return { outcome: 'needs-auth' };
  if (atlassian.status === 'pending') {
    return { outcome: 'failed', error: `${atlassian.name} took too long to connect` };
  }
  if (atlassian.status === 'failed') {
    return { outcome: 'failed', error: atlassian.error || `${atlassian.name} failed to connect` };
  }
  const missing = tools.filter((tool) => !atlassian.tools.includes(tool));
  if (missing.length) {
    return {
      outcome: 'failed',
      error: `${atlassian.name} has no ${missing.join(' or ')}; it has ${atlassian.tools.join(', ') || 'no tools'}`,
    };
  }
  return { outcome: 'reached', atlassian };
}

/**
 * The Atlassian connector reached to move cards: its tools called on the
 * site the board searches, on a Claude Code process kept for it.
 */
export interface JiraSite {
  call(tool: string, args: Record<string, unknown>): Promise<ToolResult>;
  cloudId: string;
  /** The site's address, such as https://acme.atlassian.net; empty when it isn't https. */
  url: string;
  close(): void;
}

/**
 * Reaches the Atlassian connector to move cards, through a Claude Code
 * process `open` starts that may call transitionJiraIssue too. Rejects,
 * saying why, when there's none here or it can't be used; the process is
 * stopped then.
 */
export async function openJira(
  open: (allowed: ReadonlySet<string>) => Promise<Connectors>,
): Promise<JiraSite> {
  const connectors = await open(JIRA_ALLOWED);
  try {
    const reached = await reach(connectors, MOVE_TOOLS);
    if (reached.outcome === 'none') throw new Error('There’s no Atlassian connector here');
    if (reached.outcome === 'needs-auth') {
      throw new Error('The Atlassian connector needs connecting again on claude.ai');
    }
    if (reached.outcome === 'failed') throw new Error(reached.error);
    const { atlassian } = reached;
    const call = (tool: string, args: Record<string, unknown>) =>
      connectors.call(atlassian, tool, args);
    const site = readSite(await call(JIRA_TOOLS.sites, {}));
    return { call, ...site, close: () => connectors.close() };
  } catch (error) {
    connectors.close();
    throw error;
  }
}

/** The changes of status Jira allows the issue now. */
export async function transitionsOf(jira: JiraSite, key: string): Promise<JiraTransition[]> {
  return readTransitions(
    await jira.call(JIRA_TOOLS.transitions, { cloudId: jira.cloudId, issueIdOrKey: key }),
  );
}

/**
 * Changes the issue's status in Jira by one of the transitions it allows;
 * what it answers when it does isn't read. Rejects when Jira refuses,
 * such as for a field the change needs that only Jira asks for.
 */
export async function transitionIssue(
  jira: JiraSite,
  key: string,
  transition: string,
): Promise<void> {
  await jira.call(JIRA_TOOLS.transition, {
    cloudId: jira.cloudId,
    issueIdOrKey: key,
    transition: { id: transition },
  });
}

/** The issue as Jira has it now. */
export async function issueOf(jira: JiraSite, key: string): Promise<FetchedIssue> {
  return readOne(
    await jira.call(JIRA_TOOLS.issue, {
      cloudId: jira.cloudId,
      issueIdOrKey: key,
      fields: ISSUE_FIELDS,
    }),
    jira.url,
  );
}
