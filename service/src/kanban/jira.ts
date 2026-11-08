import type { CardColumn, JiraIssue } from '@grimoire/contract';
import type { Connector, Connectors, ToolResult } from '../agents/claude/connectors';

/**
 * Your Jira issues, through your claude.ai Atlassian connector: the one
 * place that knows the connector's tools, what they take and what they
 * answer. None of it is confirmed against the real connector yet; each
 * answer is read with care, and one that doesn't match says what didn't.
 * `npm run jira:check` shows what the connector really has and answers.
 */

/** The connector, by its name on claude.ai, such as "claude.ai Atlassian". */
export const ATLASSIAN = /atlassian/i;

/** The connector's tools Grimoire calls, by their own names. */
export const JIRA_TOOLS = {
  /** The Atlassian sites you can reach: each one's cloud ID, address and scopes. */
  sites: 'getAccessibleAtlassianResources',
  /** The issues a JQL query finds, a page at a time. */
  search: 'searchJiraIssuesUsingJql',
} as const;

/**
 * Every tool of the connector Grimoire may call: only ones that read. A
 * direct call asks no permission, so nothing else can be called.
 */
export const JIRA_READ_ONLY: ReadonlySet<string> = new Set([
  JIRA_TOOLS.sites,
  JIRA_TOOLS.search,
  'getJiraIssue',
  'atlassianUserInfo',
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
    Object.values(JIRA_TOOLS).every((tool) => connector.tools.includes(tool));
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
    const atlassian = atlassianIn(await connectors.list());
    if (!atlassian || atlassian.status === 'disabled') return { outcome: 'none' };
    if (atlassian.status === 'needs-auth') return { outcome: 'needs-auth' };
    if (atlassian.status === 'pending') {
      return { outcome: 'failed', error: `${atlassian.name} took too long to connect` };
    }
    if (atlassian.status === 'failed') {
      return { outcome: 'failed', error: atlassian.error || `${atlassian.name} failed to connect` };
    }
    const missing = Object.values(JIRA_TOOLS).filter((tool) => !atlassian.tools.includes(tool));
    if (missing.length) {
      return {
        outcome: 'failed',
        error: `${atlassian.name} has no ${missing.join(' or ')}; it has ${atlassian.tools.join(', ') || 'no tools'}`,
      };
    }
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
  const sites = list.filter(isObject).filter((site) => typeof site['id'] === 'string' && site['id']);
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
    throw new Error(`${JIRA_TOOLS.search} answered with no list of issues (it has ${keys || 'nothing'})`);
  }
  const issues = list.map((issue, i) => readIssue(issue, site, i));
  const page = isObject(json) ? json : {};
  const next =
    typeof page['nextPageToken'] === 'string' && page['nextPageToken'] && page['isLast'] !== true
      ? page['nextPageToken']
      : undefined;
  return { issues, ...(next ? { next } : {}) };
}

/** An issue as the search answered it: Jira's own shape, its fields under `fields`, or the same fields flat. */
function readIssue(issue: unknown, site: string, i: number): FetchedIssue {
  if (!isObject(issue) || typeof issue['key'] !== 'string' || !issue['key']) {
    throw new Error(`${JIRA_TOOLS.search}'s issue ${i + 1} has no key`);
  }
  const key = issue['key'];
  const fields = isObject(issue['fields']) ? issue['fields'] : issue;
  const summary = typeof fields['summary'] === 'string' ? fields['summary'].trim() : '';
  if (!summary) throw new Error(`${JIRA_TOOLS.search}'s issue ${key} has no summary`);
  const status = fields['status'];
  const category = isObject(status) ? status['statusCategory'] : fields['statusCategory'];
  const description = plainText(fields['description']);
  return {
    key,
    url: site ? `${site}/browse/${encodeURIComponent(key)}` : '',
    summary,
    description:
      description.length > MAX_DESCRIPTION ? `${description.slice(0, MAX_DESCRIPTION - 1)}…` : description,
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
  const word = String(said).toLowerCase().replace(/[\s_-]/g, '');
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
  return written(description).replace(/\n{3,}/g, '\n\n').trim();
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
