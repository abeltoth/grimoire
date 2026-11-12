import { createReadStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { EFFORT_LEVELS, type EffortLevel, type SubagentStats } from '@grimoire/contract';
import { claudeHome } from './config-dir';

/** What a task message says a subagent's run took so far. */
export interface TaskUsage {
  total_tokens?: number;
  tool_uses?: number;
  duration_ms?: number;
}

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Leaves out the parts that are undefined, so merging stats never wipes one out. */
function defined(stats: SubagentStats): SubagentStats {
  return Object.fromEntries(
    Object.entries(stats).filter(([, value]) => value !== undefined),
  ) as SubagentStats;
}

/** What a task message's usage says the run took. */
export function statsFromUsage(usage: TaskUsage | undefined): SubagentStats {
  if (!usage) return {};
  return defined({
    durationMs: number(usage.duration_ms),
    tokens: number(usage.total_tokens),
    toolUses: number(usage.tool_uses),
  });
}

/**
 * What the result of the tool call that started a subagent says its run
 * took; empty for any other tool's result, or one sent before it ended.
 */
export function statsFromResult(result: unknown): SubagentStats {
  if (!result || typeof result !== 'object') return {};
  const r = result as Record<string, unknown>;
  const tools = (r['toolStats'] ?? undefined) as Record<string, unknown> | undefined;
  const count = (key: string) => number(tools?.[key]) ?? 0;
  return defined({
    durationMs: number(r['totalDurationMs']),
    tokens: number(r['totalTokens']),
    toolUses: number(r['totalToolUseCount']),
    tools: tools
      ? {
          read: count('readCount'),
          search: count('searchCount'),
          shell: count('bashCount'),
          edit: count('editFileCount'),
          other: count('otherToolCount'),
        }
      : undefined,
    lines: tools ? { added: count('linesAdded'), removed: count('linesRemoved') } : undefined,
  });
}

/** What the file Claude Code keeps beside a subagent's saved run says of how it ran. */
export function statsFromMeta(meta: unknown): SubagentStats {
  if (!meta || typeof meta !== 'object') return {};
  const m = meta as Record<string, unknown>;
  const effort = m['effort'];
  const shape = m['requestShape'];
  return defined({
    effort: EFFORT_LEVELS.includes(effort as EffortLevel) ? (effort as EffortLevel) : undefined,
    background: typeof shape === 'string' ? shape === 'background' : undefined,
    depth: number(m['spawnDepth']),
  });
}

/**
 * What Claude Code saved of how the subagent the chat's tool call `toolId`
 * started ran and what it took. The SDK leaves both out of the saved
 * messages it reads, so they're read from its files: the file beside the
 * run, and the result of the tool call, in the chat's or a subagent's run.
 */
export async function savedSubagentStats(
  chatId: string,
  toolId: string,
  home = claudeHome(),
): Promise<SubagentStats> {
  const folder = await chatFolder(chatId, home);
  if (!folder) return {};
  const runs = path.join(folder, chatId, 'subagents');
  const names = await readdir(runs).catch(() => [] as string[]);
  let stats: SubagentStats = {};
  for (const name of names.filter((n) => n.endsWith('.meta.json'))) {
    const meta = await readFile(path.join(runs, name), 'utf8')
      .then((text) => JSON.parse(text) as Record<string, unknown>)
      .catch(() => undefined);
    if (meta?.['toolUseId'] === toolId) {
      stats = statsFromMeta(meta);
      break;
    }
  }
  const files = [
    path.join(folder, `${chatId}.jsonl`),
    ...names.filter((n) => n.endsWith('.jsonl')).map((n) => path.join(runs, n)),
  ];
  for (const file of files) {
    const took = await tookIn(file, toolId);
    if (took) return { ...stats, ...took };
  }
  return stats;
}

/** The folder under Claude Code's projects the chat is saved in; undefined when it's in none. */
async function chatFolder(chatId: string, home: string): Promise<string | undefined> {
  const projects = path.join(home, 'projects');
  for (const name of await readdir(projects).catch(() => [] as string[])) {
    const folder = path.join(projects, name);
    if ((await readdir(folder).catch(() => [] as string[])).includes(`${chatId}.jsonl`))
      return folder;
  }
  return undefined;
}

/** What a task notification's text says the run took, as saved for one that ran in the background. */
export function statsFromNotification(text: string, toolId: string): SubagentStats {
  const at = text.indexOf(`<tool-use-id>${toolId}</tool-use-id>`);
  const usage = at === -1 ? undefined : /<usage>(.*?)<\/usage>/s.exec(text.slice(at))?.[1];
  if (!usage) return {};
  const tag = (name: string) => {
    const value = new RegExp(`<${name}>(\\d+)</${name}>`).exec(usage)?.[1];
    return value === undefined ? undefined : Number(value);
  };
  return statsFromUsage({
    total_tokens: tag('subagent_tokens'),
    tool_uses: tag('tool_uses'),
    duration_ms: tag('duration_ms'),
  });
}

/**
 * What a run's file says the tool call `toolId`'s subagent took: its
 * result's output when that has it, else the last notification of its
 * task, as for one that ran in the background; undefined when it says none.
 */
async function tookIn(file: string, toolId: string): Promise<SubagentStats | undefined> {
  const stream = createReadStream(file, 'utf8');
  stream.on('error', () => {});
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let notified: SubagentStats | undefined;
  try {
    for await (const line of lines) {
      // Most lines say nothing of it: only those that could are read.
      if (!line.includes(toolId)) continue;
      if (line.includes('<task-notification>')) {
        const stats = statsFromNotification(line, toolId);
        if (Object.keys(stats).length) notified = stats;
      }
      if (!line.includes('"toolUseResult"')) continue;
      const message = JSON.parse(line) as {
        toolUseResult?: unknown;
        message?: { content?: unknown };
      };
      const content = message.message?.content;
      const answers =
        Array.isArray(content) &&
        content.some(
          (block: { type?: string; tool_use_id?: string }) =>
            block.type === 'tool_result' && block.tool_use_id === toolId,
        );
      const stats = answers ? statsFromResult(message.toolUseResult) : {};
      if (Object.keys(stats).length) return stats;
    }
  } catch {
    return notified;
  } finally {
    lines.close();
    stream.destroy();
  }
  return notified;
}
