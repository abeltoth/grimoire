import type { AgentId, ChatId, ChatSummary, SubagentRun } from '@grimoire/contract';
import type { ChatHistory } from '../adapter';
import { CacheTracker, type ReplyUsage } from './cache';
import { savedFollowUps } from './follow-ups';
import { sdk } from './probe';
import {
  type ClaudeMessage,
  ClaudeTranscript,
  runBeganWith,
  savedSubagentState,
  subagentAgentId,
  subagentCallIn,
  turnEnd,
  wholeRun,
} from './transcript';

/** The chats Claude Code saved, in a folder or in all of them, most recent first. */
export async function listChats(agent: AgentId, cwd?: string): Promise<ChatSummary[]> {
  const { listSessions } = await sdk();
  const sessions = await listSessions(cwd ? { dir: cwd } : undefined);
  return sessions
    .map((session) => ({
      id: session.sessionId,
      agent,
      title: session.customTitle ?? session.summary,
      ...(session.cwd ? { cwd: session.cwd } : {}),
      updatedAt: session.lastModified,
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** A saved chat as it shows again: its entries, plan, prompt cache and the cards it last offered. */
export async function history(chatId: ChatId, cwd: string): Promise<ChatHistory> {
  const { getSessionMessages, getSubagentMessages, listSubagents } = await sdk();
  const transcript = new ClaudeTranscript(false);
  const cache = new CacheTracker();
  const saved = await savedIn(chatId, cwd);
  const messages = await getSessionMessages(chatId, saved);
  for (const message of messages) {
    const at = timeOf(message);
    transcript.apply(message, at);
    if (message.type === 'assistant' && message.parent_tool_use_id === null && Number.isFinite(at))
      cache.reply((message.message as { usage?: ReplyUsage }).usage, at);
  }
  // Subagents' runs are saved apart; what they spent counts toward the turns they ran in.
  for (const agentId of await listSubagents(chatId, saved)) {
    for (const message of await getSubagentMessages(chatId, agentId, saved))
      transcript.applySubagent(message, timeOf(message));
  }
  // The cards the last turn offered come back from its call of the tool.
  const followUps = savedFollowUps(messages);
  return {
    entries: transcript.entries,
    plan: transcript.plan,
    ...(cache.cache ? { cache: cache.cache } : {}),
    ...(followUps ? { followUps } : {}),
  };
}

/** The run of the subagent a tool call started, found among the chat's saved runs. */
export async function subagent(chatId: ChatId, cwd: string, toolId: string): Promise<SubagentRun> {
  const { getSessionMessages, getSubagentMessages, listSubagents } = await sdk();
  const saved = await savedIn(chatId, cwd);
  const ids = await listSubagents(chatId, saved);
  const runs = new Map<string, Promise<ClaudeMessage[]>>();
  const runOf = (id: string) => {
    if (!runs.has(id)) runs.set(id, getSubagentMessages(chatId, id, saved));
    return runs.get(id)!;
  };
  // The chat made the tool call; a subagent's subagent is started from inside its run.
  let call = subagentCallIn(await getSessionMessages(chatId, saved), toolId);
  for (const id of ids) {
    if (call) break;
    call = subagentCallIn(await runOf(id), toolId);
  }
  // Its result names the run; a result that doesn't, the run that began with its task.
  let agentId = call?.result && subagentAgentId(call.result.text);
  // A message sent to a subagent names it as its recipient.
  if (!agentId && call?.sentTo && ids.includes(call.sentTo)) agentId = call.sentTo;
  if (!agentId && call?.prompt) {
    for (const id of ids) {
      if (runBeganWith(await runOf(id), call.prompt)) {
        agentId = id;
        break;
      }
    }
  }
  if (!agentId)
    return { entries: [], ...(call ? { state: savedSubagentState([], call.result) } : {}) };
  // A message resumed the subagent's run: all of it shows, where it is with what it was sent last.
  if (call?.sentTo) {
    const entries = wholeRun(await runOf(agentId));
    const since = entries.findLastIndex((entry) => entry.kind === 'user') + 1;
    return { entries, state: savedSubagentState(entries.slice(since), call.result) };
  }
  const run = new ClaudeTranscript(false);
  for (const message of await runOf(agentId)) run.applyRun(message);
  // Its task is the tool call's input; what it was sent later isn't yours.
  const entries = run.entries.filter((entry) => entry.kind === 'agent');
  return { entries, state: savedSubagentState(entries, call?.result) };
}

/** A copy of the chat up to the end of the turn one of your messages began; gives the copy's ID. */
export async function fork(
  chatId: ChatId,
  cwd: string,
  entryId: string,
  title: string,
): Promise<ChatId> {
  const { forkSession, getSessionMessages } = await sdk();
  const saved = await savedIn(chatId, cwd);
  const upToMessageId = turnEnd(await getSessionMessages(chatId, saved), entryId);
  const { sessionId } = await forkSession(chatId, {
    ...saved,
    title,
    ...(upToMessageId ? { upToMessageId } : {}),
  });
  return sessionId;
}

export async function rename(chatId: ChatId, cwd: string, title: string): Promise<void> {
  const { renameSession } = await sdk();
  await renameSession(chatId, title, await savedIn(chatId, cwd));
}

/** The chat's title: the one you or Claude Code gave it, else its first prompt's summary. */
export async function title(chatId: ChatId, cwd: string): Promise<string> {
  const { getSessionInfo } = await sdk();
  const info = await getSessionInfo(chatId, await savedIn(chatId, cwd));
  return info?.customTitle ?? info?.summary ?? '';
}

/** The title you or Claude Code gave the chat, without falling back on its first prompt; undefined until it has one. */
export async function generatedTitle(chatId: ChatId, cwd: string): Promise<string | undefined> {
  const { getSessionInfo } = await sdk();
  return (await getSessionInfo(chatId, await savedIn(chatId, cwd)))?.customTitle || undefined;
}

/**
 * Where to look for a saved chat: its folder, or every folder when it was
 * saved under another, as a chat begun in a worktree that now works in
 * its repository's folder is.
 */
async function savedIn(chatId: ChatId, cwd: string): Promise<{ dir?: string }> {
  const { getSessionInfo } = await sdk();
  return (await getSessionInfo(chatId, { dir: cwd })) ? { dir: cwd } : {};
}

/** When a saved message came, in ms since the epoch; Claude Code saves it, though the SDK's type leaves it out. */
function timeOf(message: object): number {
  return Date.parse((message as { timestamp?: string }).timestamp ?? '');
}
