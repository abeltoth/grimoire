import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { claudeHome } from './config-dir';
import type { ApiBlock, ClaudeMessage } from './messages';
import { chatFolder } from './subagent-stats';

/** What a saved reply was made under, as Claude Code notes it. */
export type Attribution = Pick<ClaudeMessage, 'attributionSkill' | 'attributionAgent'>;

/** What the SDK leaves out of the saved messages it reads, read from a saved chat's files instead. */
export interface SavedExtras {
  /** The structured results of the file tools, by tool call. */
  results: Map<string, unknown>;
  /** What each reply was made under, by its API message ID. */
  attributions: Map<string, Attribution>;
}

/**
 * What the SDK leaves out of a saved chat's messages, its subagents' runs
 * included, read from its files: only the lines that could hold some parsed.
 */
export async function savedExtras(chatId: string, home = claudeHome()): Promise<SavedExtras> {
  const extras: SavedExtras = { results: new Map(), attributions: new Map() };
  const folder = await chatFolder(chatId, home);
  if (!folder) return extras;
  const runs = path.join(folder, chatId, 'subagents');
  const names = await readdir(runs).catch(() => [] as string[]);
  const files = [
    path.join(folder, `${chatId}.jsonl`),
    ...names.filter((name) => name.endsWith('.jsonl')).map((name) => path.join(runs, name)),
  ];
  for (const file of files) await readExtras(file, extras);
  return extras;
}

/** The structured results of a saved chat's file tools, its subagents' runs included, by tool call. */
export async function savedFileResults(
  chatId: string,
  home = claudeHome(),
): Promise<Map<string, unknown>> {
  return (await savedExtras(chatId, home)).results;
}

/** Adds what one saved file holds. */
async function readExtras(file: string, extras: SavedExtras): Promise<void> {
  const stream = createReadStream(file, 'utf8');
  stream.on('error', () => {});
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.includes('"attribution')) addAttribution(line, extras.attributions);
      if (!line.includes('"toolUseResult"')) continue;
      if (!line.includes('"structuredPatch"') && !line.includes('"new_source"')) continue;
      const message = JSON.parse(line) as { toolUseResult?: unknown; message?: unknown };
      const id = toolIdOf(message.message);
      if (id) extras.results.set(id, message.toolUseResult);
    }
  } catch {
    return;
  } finally {
    lines.close();
    stream.destroy();
  }
}

function addAttribution(line: string, attributions: Map<string, Attribution>): void {
  const { attributionSkill, attributionAgent, message } = JSON.parse(line) as Attribution & {
    message?: { id?: string };
  };
  if (!message?.id || !(attributionSkill || attributionAgent)) return;
  attributions.set(message.id, {
    ...(attributionSkill ? { attributionSkill } : {}),
    ...(attributionAgent ? { attributionAgent } : {}),
  });
}

/** A saved message with the structured result of the tool call it answers, as a live one has it. */
export function withSavedResult<T extends ClaudeMessage>(
  message: T,
  results: ReadonlyMap<string, unknown>,
): T {
  if (message.type !== 'user' || message.tool_use_result !== undefined) return message;
  const id = toolIdOf(message.message);
  return id && results.has(id) ? { ...message, tool_use_result: results.get(id) } : message;
}

/** A saved reply with what it was made under, as Claude Code noted it. */
export function withSavedAttribution<T extends ClaudeMessage>(
  message: T,
  attributions: ReadonlyMap<string, Attribution>,
): T {
  if (message.type !== 'assistant') return message;
  const id = (message.message as { id?: string } | undefined)?.id;
  const attribution = id ? attributions.get(id) : undefined;
  return attribution ? { ...message, ...attribution } : message;
}

/** The tool call a message answers. */
function toolIdOf(message: unknown): string | undefined {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  return (content as ApiBlock[]).find((block) => block.type === 'tool_result')?.tool_use_id;
}
