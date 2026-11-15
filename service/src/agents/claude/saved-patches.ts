import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { claudeHome } from './config-dir';
import type { ApiBlock, ClaudeMessage } from './messages';
import { chatFolder } from './subagent-stats';

/**
 * The structured results of a saved chat's file tools, by tool call: the SDK
 * leaves them out of the saved messages it reads, so they're read from the
 * chat's file, only the lines that could hold one parsed.
 */
export async function savedFileResults(
  chatId: string,
  home = claudeHome(),
): Promise<Map<string, unknown>> {
  const results = new Map<string, unknown>();
  const folder = await chatFolder(chatId, home);
  if (!folder) return results;
  const stream = createReadStream(path.join(folder, `${chatId}.jsonl`), 'utf8');
  stream.on('error', () => {});
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.includes('"toolUseResult"')) continue;
      if (!line.includes('"structuredPatch"') && !line.includes('"new_source"')) continue;
      const message = JSON.parse(line) as { toolUseResult?: unknown; message?: unknown };
      const id = toolIdOf(message.message);
      if (id) results.set(id, message.toolUseResult);
    }
  } catch {
    return results;
  } finally {
    lines.close();
    stream.destroy();
  }
  return results;
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

/** The tool call a message answers. */
function toolIdOf(message: unknown): string | undefined {
  const content = (message as { content?: unknown } | undefined)?.content;
  if (!Array.isArray(content)) return undefined;
  return (content as ApiBlock[]).find((block) => block.type === 'tool_result')?.tool_use_id;
}
