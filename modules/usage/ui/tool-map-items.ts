import type { ToolTarget, UsedTool } from '@grimoire/contract';
import { serverOf, toolName } from '@ui/app/core/tool-name';

/**
 * A block of the map: a tool, an MCP server's tools together, what a tool
 * ran on such as a file or command, or the rest of them as "Other".
 */
export interface MapItem {
  key: string;
  /** Its name on its block, such as a tool's, or a file's without its folders. */
  name: string;
  /** Its name in full, read out under the map, such as a file's path or a whole command. */
  full: string;
  uses: number;
  /** The tokens its results added to the chats' context. */
  context: number;
  /** A tool's, or a server's, tools: picked, the map zooms into what they ran on. */
  tools?: string[];
  /** How many chats it ran in. */
  chats?: number;
  /** The chat it added the most to, which opens when it's picked. */
  chat?: ToolTarget['chat'];
  /** What "Other" holds: picked, the map zooms into them. */
  rest?: MapItem[];
  /** Written as code, as a file or a command is. */
  code?: true;
}

/** The most blocks a map draws; past them, the rest are one "Other". */
const MOST = 8;

/** The lightest shade, so the lightest block still shows on the page. */
const LIGHTEST = 25;

const sumOf = (items: readonly MapItem[], of: (item: MapItem) => number) =>
  items.reduce((all, item) => all + of(item), 0);

const largestFirst = (a: MapItem, b: MapItem) =>
  b.context - a.context || a.name.localeCompare(b.name);

/** The tools that added to the context, largest first, an MCP server's together. */
export function toolItems(tools: readonly UsedTool[]): MapItem[] {
  const groups = new Map<string, MapItem & { tools: string[] }>();
  for (const tool of tools) {
    if (!(tool.context > 0)) continue;
    const server = serverOf(tool.name);
    const key = server ? `mcp ${server}` : tool.name;
    const name = server ?? tool.name;
    const item = groups.get(key) ?? { key, name, full: name, tools: [], uses: 0, context: 0 };
    item.tools.push(tool.name);
    item.uses += tool.uses;
    item.context += tool.context;
    groups.set(key, item);
  }
  // A server with one tool is named for the tool.
  return [...groups.values()]
    .map((item) => {
      if (item.tools.length > 1) return item;
      const name = toolName(item.tools[0]!);
      return { ...item, name, full: name };
    })
    .sort(largestFirst);
}

/** What a call ran on, short: a file by its name, without its folders. */
export function shortTarget(target: string): string {
  return /^\S*[\\/]\S*$/.test(target)
    ? (target.split(/[\\/]/).filter(Boolean).at(-1) ?? target)
    : target;
}

/**
 * What tools ran on, largest first, each file or command a block; of
 * several tools, each says its tool in full.
 */
export function targetItems(targets: readonly ToolTarget[], several: boolean): MapItem[] {
  return targets
    .filter((each) => each.context > 0)
    .map((each) => {
      const tool = toolName(each.tool);
      const full = each.target ? (several ? `${tool} · ${each.target}` : each.target) : tool;
      return {
        key: `${each.tool} ${each.target ?? ''}`,
        name: each.target ? shortTarget(each.target) : tool,
        full,
        uses: each.uses,
        context: each.context,
        chats: each.chats,
        chat: each.chat,
        ...(each.target ? { code: true as const } : {}),
      };
    })
    .sort(largestFirst);
}

/** The blocks a map draws: the largest, and past the most it draws the rest as "Other". */
export function blocksOf(items: readonly MapItem[]): MapItem[] {
  if (items.length <= MOST) return [...items];
  const rest = items.slice(MOST - 1);
  const name = `Other · ${rest.length} more`;
  return [
    ...items.slice(0, MOST - 1),
    {
      key: 'other',
      name,
      full: name,
      uses: sumOf(rest, (item) => item.uses),
      context: sumOf(rest, (item) => item.context),
      rest,
    },
  ];
}

/**
 * Each block's context per use, as a shade from the lightest to full, on a
 * log scale, as they span a thousandfold.
 */
export function shadesOf(items: readonly MapItem[]): number[] {
  const each = items.map((item) => Math.log(item.context / Math.max(item.uses, 1)));
  const least = Math.min(...each);
  const most = Math.max(...each);
  return each.map((n) =>
    most > least ? LIGHTEST + ((100 - LIGHTEST) * (n - least)) / (most - least) : 100,
  );
}
