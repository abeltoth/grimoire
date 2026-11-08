/**
 * npm run jira:check [-- --claude-folder <dir>] [--jql <query>]
 *
 * Checks your claude.ai Atlassian connector the way the board's Jira sync
 * reaches it, on a Claude Code process that never gets a message: what
 * your connectors are, the Atlassian connector's tools, and what its sites
 * and one search answer, read as the sync reads them. No tokens are spent
 * and no sign-in is printed. --claude-folder uses a profile's Claude
 * folder, as Grimoire does for any profile but Personal.
 */
import { parseArgs } from 'node:util';
import { DEFAULT_JIRA_QUERY } from '@grimoire/contract';
import { type Connector, type ToolResult, openConnectors } from '../agents/claude/connectors';
import { JIRA_READ_ONLY, JIRA_TOOLS, atlassianIn, jsonOf, readSearch, readSite } from './jira';

const { values } = parseArgs({
  options: { 'claude-folder': { type: 'string' }, jql: { type: 'string', default: DEFAULT_JIRA_QUERY } },
});
if (values['claude-folder']) process.env['CLAUDE_CONFIG_DIR'] = values['claude-folder'];

/** How much of an answer is printed as it came. */
const RAW_CHARS = 1_500;

const connectors = await openConnectors(JIRA_READ_ONLY);
try {
  await check();
} catch (error) {
  console.log(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  connectors.close();
}

async function check(): Promise<void> {
  console.log('Asking Claude Code for your claude.ai connectors…');
  const listed = await connectors.list();
  console.log(`\nYour claude.ai connectors (${listed.length}):`);
  for (const connector of listed) {
    const error = connector.error ? `: ${connector.error}` : '';
    console.log(`  ${connector.name}: ${connector.status}${error}, ${connector.tools.length} tools`);
  }
  const atlassian = atlassianIn(listed);
  if (!atlassian) {
    console.log('\nNo Atlassian connector here: the Kanban board shows no Jira cards, and says nothing of it.');
    return;
  }
  printTools(atlassian);
  if (atlassian.status !== 'connected') {
    console.log(`\n${atlassian.name} is ${atlassian.status}: the board says so, and shows the issues last synced.`);
    return;
  }

  const sites = await call(atlassian, JIRA_TOOLS.sites, {});
  const site = readSite(sites);
  console.log(`\nThe site the board searches: cloud ID ${site.cloudId}, ${site.url || 'no https address'}`);

  console.log(`\nSearching with: ${values.jql}`);
  const found = await call(atlassian, JIRA_TOOLS.search, {
    cloudId: site.cloudId,
    jql: values.jql,
    fields: ['summary', 'description', 'status', 'issuetype', 'priority'],
    maxResults: 10,
  });
  const page = readSearch(found, site.url);
  console.log(`\nRead as the board reads it: ${page.issues.length} issues${page.next ? ', and a next page' : ''}`);
  for (const issue of page.issues) {
    const about = [issue.type, issue.priority && `${issue.priority} priority`].filter(Boolean).join(', ');
    console.log(`  ${issue.key}  ${issue.status} → ${issue.column}  (${about || 'no type or priority'})`);
    console.log(`      ${issue.summary}${issue.description ? ` [${issue.description.length} chars of description]` : ''}`);
  }
  const json = jsonOf(found, JIRA_TOOLS.search);
  const first = Array.isArray(json)
    ? json[0]
    : (json as { issues?: unknown[] } | null)?.issues?.[0];
  if (first !== undefined) {
    console.log('\nThe first issue as it came:');
    console.log(clipped(JSON.stringify(first, null, 2)));
  }
}

/** The connector's tools, those Grimoire may call marked, those it calls marked again. */
function printTools(atlassian: Connector): void {
  const used = new Set<string>(Object.values(JIRA_TOOLS));
  console.log(`\n${atlassian.name}'s tools (* Grimoire may call it, ** the sync calls it):`);
  for (const tool of atlassian.tools) {
    console.log(`  ${tool}${used.has(tool) ? ' **' : JIRA_READ_ONLY.has(tool) ? ' *' : ''}`);
  }
  const missing = [...JIRA_READ_ONLY].filter((tool) => !atlassian.tools.includes(tool));
  if (missing.length) console.log(`  Not there, though Grimoire expects them: ${missing.join(', ')}`);
  console.log(
    '  (Claude Code lists no input schemas; a call with arguments the tool doesn’t take fails, saying which it takes.)',
  );
}

/** Calls the tool, printing the shape of its answer, and how it came, cut short. */
async function call(atlassian: Connector, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  console.log(`\nCalling ${tool} ${JSON.stringify({ ...args, ...(args['jql'] ? { jql: '…' } : {}) })}`);
  const started = Date.now();
  const result = await connectors.call(atlassian, tool, args);
  console.log(`  answered in ${Date.now() - started} ms with ${shapeOf(result)}`);
  const text = result.content.find((block) => block.type === 'text')?.text;
  if (text !== undefined) console.log(clipped(`  first text block: ${text}`));
  return result;
}

/** What an answer is made of: its blocks' types and its structured content's members. */
function shapeOf(result: ToolResult): string {
  const blocks = result.content.map((block) => block.type).join(', ') || 'no content blocks';
  const structured =
    result.structuredContent === undefined
      ? ''
      : `, and structured content with ${Object.keys(result.structuredContent as object).join(', ')}`;
  return `${blocks}${structured}`;
}

function clipped(text: string): string {
  return text.length > RAW_CHARS ? `${text.slice(0, RAW_CHARS)}\n  … ${text.length - RAW_CHARS} more characters` : text;
}
