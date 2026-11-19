import type { ToolGroups, UsedTool } from '@grimoire/contract';
import { serverOf, toolName } from '@ui/app/core/tool-name';
import type { Slice } from './pie-chart';
import { uses } from './usage-format';

/** What a tool's calls break down by, and what more than one of those is. */
export interface Breakdown {
  by: string;
  unit: string;
}

/** The tools whose calls break down by group. */
export const BREAKDOWNS: ReadonlyMap<string, Breakdown> = new Map([
  ['Bash', { by: 'command', unit: 'commands' }],
  ['PowerShell', { by: 'command', unit: 'commands' }],
  ['Read', { by: 'folder', unit: 'folders' }],
  ['WebFetch', { by: 'site', unit: 'sites' }],
]);

/**
 * A slice for each tool by the context its results added, an MCP server's
 * tools together, each with how often it was used; a tool that breaks down
 * is keyed by its name, to be picked.
 */
export function toolSlices(tools: readonly UsedTool[]): Slice[] {
  const slices = new Map<string, Slice & { tools: string[]; uses: number }>();
  for (const tool of tools) {
    if (!(tool.context > 0)) continue;
    const server = serverOf(tool.name);
    const id = server ? `mcp ${server}` : tool.name;
    const slice = slices.get(id) ?? { name: server ?? tool.name, value: 0, uses: 0, tools: [] };
    slice.tools.push(tool.name);
    slice.value += tool.context;
    slice.uses += tool.uses;
    slices.set(id, slice);
  }
  return [...slices.values()].map(({ tools: [first, ...others], uses: n, name, value }) => ({
    // A server with one tool is named for the tool.
    name: others.length ? name : toolName(first!),
    value,
    note: uses(n),
    ...(!others.length && BREAKDOWNS.has(first!) ? { key: first! } : {}),
  }));
}

/** A slice for each group of a tool's calls, and the rest of the tool's context as "Other". */
export function groupSlices(tool: string, read: ToolGroups): Slice[] {
  const folders = BREAKDOWNS.get(tool)?.by === 'folder';
  const groups = read.groups.map((group) => ({
    name: folders ? folderName(group.name, group.cwd) : group.name,
    ...(folders ? { title: group.name } : {}),
    value: group.context,
    note: uses(group.uses),
  }));
  const rest = read.context - groups.reduce((all, group) => all + group.value, 0);
  return [...groups, { name: 'Other', value: Math.max(rest, 0), rest: true, count: read.more }];
}

/** A folder by its place in the chat's folder, or else by its last two parts. */
export function folderName(folder: string, cwd?: string): string {
  const home = cwd
    ?.replace(/\\/g, '/')
    .replace(/^([a-z]):/, (_, drive: string) => `${drive.toUpperCase()}:`)
    .replace(/\/$/, '');
  if (home && folder === home) return home.split('/').at(-1)!;
  if (home && folder.startsWith(`${home}/`)) return folder.slice(home.length + 1);
  return folder.split('/').filter(Boolean).slice(-2).join('/') || folder;
}
