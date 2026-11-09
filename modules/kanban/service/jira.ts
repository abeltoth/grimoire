import type { CardColumn, JiraIssue, JiraTransition } from '@grimoire/contract';
import {
  type Connector,
  type Connectors,
  ToolFailed,
  type ToolResult,
} from '@grimoire/service/agents/claude/connectors';

/**
 * Your Jira issues, through your claude.ai Atlassian connector: the one
 * place that knows the connector's tools, what they take and what they
 * answer. The sites and the search are confirmed against the real
 * connector; an issue's transitions, making one and reading the issue
 * again aren't yet. Each answer is read with care, and one that doesn't
 * match says what didn't. `npm run jira:check` shows what the connector
 * really has and answers.
 */

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

/** The tools the sync calls; the Atlassian connector is the one that has them. */
const SYNC_TOOLS = [JIRA_TOOLS.sites, JIRA_TOOLS.search];
/** The tools moving a card calls. */
const MOVE_TOOLS = [
  JIRA_TOOLS.sites,
  JIRA_TOOLS.transitions,
  JIRA_TOOLS.transition,
  JIRA_TOOLS.issue,
];

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

/** The most issues on the board, and how many are asked for at a time. */
export const MAX_ISSUES = 100;
const PAGE = 50;
/** The issue's fields asked for. */
const FIELDS = ['summary', 'description', 'status', 'issuetype', 'priority'];
/** The longest description kept: a new chat's first message has room for it. */
const MAX_DESCRIPTION = 8_000;

/** An issue as the board keeps it. */
export interface FetchedIssue extends JiraIssue {
  summary: string;
  /** Its description as plain text; empty when it has none. */
  description: string;
  column: CardColumn;
}

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
          fields: FIELDS,
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
    await jira.call(JIRA_TOOLS.issue, { cloudId: jira.cloudId, issueIdOrKey: key, fields: FIELDS }),
    jira.url,
  );
}

/** The transitions an issue allows, from Jira's own shape, a plain list, or a list under another name. */
export function readTransitions(result: ToolResult): JiraTransition[] {
  const tool = JIRA_TOOLS.transitions;
  const json = jsonOf(result, tool);
  const list = Array.isArray(json) ? json : arrayIn(json, ['transitions', 'values', 'results']);
  if (!list)
    throw new Error(`${tool} answered with no list of transitions (it has ${membersOf(json)})`);
  return list.map((transition, i) => readTransition(transition, i));
}

/**
 * A transition: its ID and name, and the status it leads to, under `to`
 * as Jira has it, or flat; the status's category says its column.
 */
function readTransition(transition: unknown, i: number): JiraTransition {
  const tool = JIRA_TOOLS.transitions;
  if (!isObject(transition)) throw new Error(`${tool}'s transition ${i + 1} isn't an object`);
  const id = transition['id'];
  if ((typeof id !== 'string' && typeof id !== 'number') || id === '') {
    throw new Error(`${tool}'s transition ${i + 1} has no ID (it has ${membersOf(transition)})`);
  }
  const name = nameOf(transition);
  const to = isObject(transition['to']) ? transition['to'] : undefined;
  const status = nameOf(to ?? transition['to'] ?? transition['toStatus']) || name;
  const category = to?.['statusCategory'] ?? transition['statusCategory'];
  if (category === undefined || category === null) {
    throw new Error(
      `${tool}'s transition "${name || id}" says no category of the status it leads to (it has ${membersOf(to ?? transition)})`,
    );
  }
  return {
    id: String(id),
    name: name || status,
    status: status || String(id),
    column: columnOf(category),
  };
}

/** The issue a read of one answered with: Jira's own shape, or it under `issue`. */
export function readOne(result: ToolResult, site: string): FetchedIssue {
  const json = jsonOf(result, JIRA_TOOLS.issue);
  const issue = isObject(json) && isObject(json['issue']) ? json['issue'] : json;
  return readIssue(issue, site, 0, JIRA_TOOLS.issue);
}

/**
 * What Jira said when one of the connector's tools failed: the messages
 * of its own error answer, such as {"errorMessages":[],"errors":
 * {"resolution":"Resolution is required."}}, when the tool passed it on,
 * or the tool's text as it is.
 */
export function jiraSaid(error: unknown): string {
  if (!(error instanceof ToolFailed)) return error instanceof Error ? error.message : String(error);
  const said = error.said;
  if (!said) return 'it said no more';
  const at = said.indexOf('{');
  if (at === -1) return said;
  try {
    const json = JSON.parse(said.slice(at)) as unknown;
    if (!isObject(json)) return said;
    const messages = [
      ...(Array.isArray(json['errorMessages']) ? json['errorMessages'] : []),
      ...(isObject(json['errors']) ? Object.values(json['errors']) : []),
    ].filter((message): message is string => typeof message === 'string' && !!message.trim());
    return messages.length ? messages.join(' ') : said;
  } catch {
    return said;
  }
}

/**
 * The JSON a tool answered with: its structured content, or the first of
 * its text blocks that is JSON. Throws, naming the tool, when there's none.
 */
export function jsonOf(result: ToolResult, tool: string): unknown {
  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }
  const texts = result.content.flatMap((block) =>
    block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
  );
  for (const text of texts) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // Not JSON: the next block may be.
    }
  }
  const said = texts.join(' ').trim();
  throw new Error(
    said
      ? `${tool} didn't answer in JSON: ${said.length > 120 ? `${said.slice(0, 119)}…` : said}`
      : `${tool} answered with no text`,
  );
}

/** The Jira site to search: the first site you can reach that has Jira. */
export function readSite(result: ToolResult): { cloudId: string; url: string } {
  const json = jsonOf(result, JIRA_TOOLS.sites);
  const list = Array.isArray(json) ? json : arrayIn(json, ['resources', 'sites', 'values']);
  if (!list) throw new Error(`${JIRA_TOOLS.sites} didn't answer with a list of sites`);
  const sites = list
    .filter(isObject)
    .filter((site) => typeof site['id'] === 'string' && site['id']);
  const jira = sites.find((site) => hasJira(site['scopes'])) ?? sites[0];
  if (!jira) throw new Error(`${JIRA_TOOLS.sites} listed no site with a cloud ID`);
  const url = typeof jira['url'] === 'string' ? jira['url'].replace(/\/+$/, '') : '';
  return { cloudId: jira['id'] as string, url: url.startsWith('https://') ? url : '' };
}

/** The issues on a page of a search's results, and the token for the next page, when there's one. */
export function readSearch(
  result: ToolResult,
  site: string,
): { issues: FetchedIssue[]; next?: string } {
  const json = jsonOf(result, JIRA_TOOLS.search);
  const list = Array.isArray(json) ? json : arrayIn(json, ['issues', 'values', 'results']);
  if (!list) {
    const keys = isObject(json) ? Object.keys(json).join(', ') : typeof json;
    throw new Error(
      `${JIRA_TOOLS.search} answered with no list of issues (it has ${keys || 'nothing'})`,
    );
  }
  const issues = list.map((issue, i) => readIssue(issue, site, i));
  const page = isObject(json) ? json : {};
  const next =
    typeof page['nextPageToken'] === 'string' && page['nextPageToken'] && page['isLast'] !== true
      ? page['nextPageToken']
      : undefined;
  return { issues, ...(next ? { next } : {}) };
}

/**
 * An issue as the search, or a read of one, answered it: Jira's own shape,
 * its fields under `fields`, or the same fields flat.
 */
function readIssue(
  issue: unknown,
  site: string,
  i: number,
  tool: string = JIRA_TOOLS.search,
): FetchedIssue {
  if (!isObject(issue) || typeof issue['key'] !== 'string' || !issue['key']) {
    throw new Error(`${tool}'s issue ${i + 1} has no key`);
  }
  const key = issue['key'];
  const fields = isObject(issue['fields']) ? issue['fields'] : issue;
  const summary = typeof fields['summary'] === 'string' ? fields['summary'].trim() : '';
  if (!summary) throw new Error(`${tool}'s issue ${key} has no summary`);
  const status = fields['status'];
  const category = isObject(status) ? status['statusCategory'] : fields['statusCategory'];
  const description = plainText(fields['description']);
  return {
    key,
    url: site ? `${site}/browse/${encodeURIComponent(key)}` : '',
    summary,
    description:
      description.length > MAX_DESCRIPTION
        ? `${description.slice(0, MAX_DESCRIPTION - 1)}…`
        : description,
    type: nameOf(fields['issuetype']),
    priority: nameOf(fields['priority']),
    status: nameOf(status),
    column: columnOf(category),
  };
}

/**
 * The column a status's category puts an issue in: To Do (new), In
 * Progress (indeterminate) or Done (done), by its key or its name. One
 * Jira didn't say, or names otherwise, is to do.
 */
export function columnOf(category: unknown): CardColumn {
  const said = (isObject(category) ? (category['key'] ?? category['name']) : category) ?? '';
  const word = String(said)
    .toLowerCase()
    .replace(/[\s_-]/g, '');
  if (word === 'done') return 'done';
  if (word === 'indeterminate' || word === 'inprogress') return 'doing';
  return 'todo';
}

/**
 * A description as plain text: as it is when it's text already, or
 * written out from Atlassian Document Format, its paragraphs apart, its
 * lists' items each on a line, its mentions and links as their text.
 */
export function plainText(description: unknown): string {
  if (typeof description === 'string') return description.trim();
  if (!isObject(description)) return '';
  return written(description)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A node of Atlassian Document Format, written out. */
function written(node: Record<string, unknown>, list?: { ordered: boolean; at: number }): string {
  const attrs = isObject(node['attrs']) ? node['attrs'] : {};
  const inner = (within?: { ordered: boolean; at: number }) =>
    (Array.isArray(node['content']) ? node['content'] : [])
      .filter(isObject)
      .map((child, i) => written(child, within && { ...within, at: within.at + i }))
      .join('');
  switch (node['type']) {
    case 'text':
      return typeof node['text'] === 'string' ? node['text'] : '';
    case 'hardBreak':
      return '\n';
    case 'mention':
    case 'emoji':
    case 'status':
    case 'date':
      return String(attrs['text'] ?? attrs['shortName'] ?? '');
    case 'inlineCard':
    case 'blockCard':
      return String(attrs['url'] ?? '');
    case 'bulletList':
      return `${inner({ ordered: false, at: 1 })}\n`;
    case 'orderedList':
      return `${inner({ ordered: true, at: Number(attrs['order'] ?? 1) || 1 })}\n`;
    case 'listItem':
      return `${list?.ordered ? `${list.at}.` : '-'} ${inner().trim()}\n`;
    case 'paragraph':
    case 'heading':
    case 'codeBlock':
    case 'blockquote':
    case 'panel':
      return `${inner()}\n\n`;
    case 'rule':
      return '\n';
    default:
      return inner();
  }
}

/** A field's name, such as a status's or priority's; empty when it has none. */
function nameOf(field: unknown): string {
  if (typeof field === 'string') return field;
  return isObject(field) && typeof field['name'] === 'string' ? field['name'] : '';
}

/** Whether a site's scopes, when it lists them, include Jira's. */
function hasJira(scopes: unknown): boolean {
  return Array.isArray(scopes) && scopes.some((scope) => String(scope).includes('jira'));
}

/** The first array among an object's members by these names, if any. */
function arrayIn(json: unknown, names: string[]): unknown[] | undefined {
  if (!isObject(json)) return undefined;
  for (const name of names) {
    const member = json[name];
    if (Array.isArray(member)) return member;
    // A GraphQL-like answer keeps its list under nodes.
    if (isObject(member) && Array.isArray(member['nodes'])) return member['nodes'];
  }
  return undefined;
}

/** What an answer has: an object's members, or what it is otherwise. */
function membersOf(json: unknown): string {
  return isObject(json)
    ? Object.keys(json).join(', ') || 'nothing'
    : Array.isArray(json)
      ? 'a list'
      : typeof json;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
