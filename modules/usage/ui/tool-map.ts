import { Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import type { ToolCall, UsedTool } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { ChatList } from '@ui/app/core/chat-list';
import { tokenCount } from '@ui/app/core/tokens';
import { serverOf, toolName } from '@ui/app/core/tool-name';
import { type Tile, squarify } from './treemap-layout';
import { uses } from './usage-format';

/** A block of the map: a tool, an MCP server's tools together, or the rest as "Other". */
export interface MapBlock {
  key: string;
  name: string;
  /** The tools it stands for, whose heaviest calls it lists when picked. */
  tools: string[];
  uses: number;
  /** The tokens its results added to the chats' context. */
  context: number;
}

/** A block as drawn: its place in percent of the map, and how dark, 0-100, for its context per use. */
interface DrawnBlock {
  block: MapBlock;
  left: number;
  top: number;
  width: number;
  height: number;
  shade: number;
}

/** The most blocks drawn; past them, the rest are one "Other". */
const MOST = 12;

/** The map's width against its height. */
export const ASPECT = 2.5;

/** The lightest shade, so the lightest block still shows on the page. */
const LIGHTEST = 25;

/**
 * The tools that added to the context, largest first, an MCP server's
 * together; past the most drawn, the rest as "Other".
 */
export function blocksOf(tools: readonly UsedTool[]): MapBlock[] {
  const groups = new Map<string, MapBlock>();
  for (const tool of tools) {
    if (!(tool.context > 0)) continue;
    const server = serverOf(tool.name);
    const key = server ? `mcp ${server}` : tool.name;
    const block = groups.get(key) ?? {
      key,
      name: server ?? tool.name,
      tools: [],
      uses: 0,
      context: 0,
    };
    block.tools.push(tool.name);
    block.uses += tool.uses;
    block.context += tool.context;
    groups.set(key, block);
  }
  // A server with one tool is named for the tool.
  const blocks = [...groups.values()].map((block) =>
    block.tools.length === 1 ? { ...block, name: toolName(block.tools[0]!) } : block,
  );
  blocks.sort((a, b) => b.context - a.context || a.name.localeCompare(b.name));
  if (blocks.length <= MOST) return blocks;
  const rest = blocks.slice(MOST - 1);
  return [
    ...blocks.slice(0, MOST - 1),
    {
      key: 'other',
      name: `Other · ${rest.length} more`,
      tools: rest.flatMap((block) => block.tools),
      uses: rest.reduce((all, block) => all + block.uses, 0),
      context: rest.reduce((all, block) => all + block.context, 0),
    },
  ];
}

/** Each block's context per use, as a shade from the lightest to full, on a log scale, as they span a thousandfold. */
export function shadesOf(blocks: readonly MapBlock[]): number[] {
  const each = blocks.map((block) => Math.log(block.context / Math.max(block.uses, 1)));
  const least = Math.min(...each);
  const most = Math.max(...each);
  return each.map((n) =>
    most > least ? LIGHTEST + ((100 - LIGHTEST) * (n - least)) / (most - least) : 100,
  );
}

/** What a call ran on, short: a file by its name. */
function shortTarget(target: string): string {
  return /^[^\s]*[\\/][^\s]*$/.test(target)
    ? (target.split(/[\\/]/).filter(Boolean).at(-1) ?? target)
    : target;
}

/**
 * The context the tools' results added to the chats, as a map of blocks:
 * a block's size is its tokens, its shade how many it adds a use. A block
 * picked lists its heaviest calls, each opening its chat.
 */
@Component({
  selector: 'gr-usage-tool-map',
  templateUrl: './tool-map.html',
  styleUrls: ['./tool-map.css'],
})
export class UsageToolMap {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly list = inject(ChatList);

  readonly tools = input.required<readonly UsedTool[]>();
  /** The span's start, to ask for the heaviest calls over it. */
  readonly since = input.required<number>();

  protected readonly aspect = ASPECT;
  protected readonly count = tokenCount;
  protected readonly uses = uses;
  protected readonly short = shortTarget;
  protected readonly hovered = signal<string | null>(null);
  /** The block whose heaviest calls are listed; none again over another span. */
  protected readonly picked = linkedSignal<number, string | null>({
    source: this.since,
    computation: () => null,
  });
  protected readonly calls = signal<{ key: string; calls?: ToolCall[]; error?: string } | null>(
    null,
  );

  protected readonly drawn = computed((): DrawnBlock[] => {
    const blocks = blocksOf(this.tools());
    const tiles = squarify(
      blocks.map((block) => block.context),
      ASPECT,
      1,
    );
    const shades = shadesOf(blocks);
    return tiles.map((tile: Tile, i) => ({
      block: blocks[i]!,
      left: (tile.x / ASPECT) * 100,
      top: tile.y * 100,
      width: (tile.w / ASPECT) * 100,
      height: tile.h * 100,
      shade: shades[i]!,
    }));
  });

  /** All the blocks together, read out when none is under the pointer. */
  protected readonly whole = computed(() =>
    this.drawn().reduce(
      (all, { block }) => ({ context: all.context + block.context, uses: all.uses + block.uses }),
      { context: 0, uses: 0 },
    ),
  );

  /** The block under the pointer or focus, else the one picked. */
  protected readonly shown = computed(() => {
    const key = this.hovered() ?? this.picked();
    return this.drawn().find(({ block }) => block.key === key)?.block;
  });

  protected readonly pickedBlock = computed(
    () => this.drawn().find(({ block }) => block.key === this.picked())?.block,
  );

  /** The picked block's calls, once read. */
  protected readonly pickedCalls = computed(() => {
    const calls = this.calls();
    return calls && calls.key === this.picked() ? calls : null;
  });

  /** A block's tokens a use, short. */
  protected perUse(block: MapBlock): string {
    return tokenCount(block.context / Math.max(block.uses, 1));
  }

  protected spoken(block: MapBlock): string {
    return `${block.name}: ${tokenCount(block.context)} tokens of context, ${uses(block.uses)}, ${this.perUse(block)} a use`;
  }

  protected show(key: string | null): void {
    this.hovered.set(key);
  }

  /** Lists a block's heaviest calls, or closes them when it's picked again. */
  protected pick(block: MapBlock): void {
    if (this.picked() === block.key) return this.picked.set(null);
    this.picked.set(block.key);
    void this.load(block, this.since());
  }

  private async load(block: MapBlock, since: number): Promise<void> {
    this.calls.set({ key: block.key });
    try {
      const calls = await this.bridge.invoke('search.toolCalls', { since, tools: block.tools });
      if (this.picked() === block.key) this.calls.set({ key: block.key, calls });
    } catch (error) {
      if (this.picked() === block.key)
        this.calls.set({
          key: block.key,
          error: error instanceof Error ? error.message : String(error),
        });
    }
  }

  protected open(call: ToolCall): void {
    void this.list.openChat({
      id: call.chatId,
      agent: call.agent,
      title: call.title,
      ...(call.cwd ? { cwd: call.cwd } : {}),
      updatedAt: 0,
    });
  }

  protected readonly toolName = toolName;
}
