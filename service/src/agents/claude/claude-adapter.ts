import { randomUUID } from 'node:crypto';
import type {
  PermissionMode,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentInfo,
  ApprovalMode,
  ChatId,
  ChatSettings,
  ChatSummary,
  Entry,
} from '@grimoire/contract';
import type { AgentAdapter, ChatEvents, LiveChat } from '../adapter';
import { MessageQueue } from './message-queue';
import { ClaudeTranscript } from './transcript';

// Loaded on first use: it's large, and the service starts without it.
const sdk = () => import('@anthropic-ai/claude-agent-sdk');

const MODES: Record<ApprovalMode, PermissionMode> = {
  ask: 'default',
  'accept-edits': 'acceptEdits',
  plan: 'plan',
  'allow-all': 'bypassPermissions',
};

/**
 * Claude Code through the Agent SDK (ADR-005), signed in with the user's
 * own Claude login. One Claude Code process per live chat (ADR-010).
 */
export class ClaudeAdapter implements AgentAdapter {
  readonly info: AgentInfo = {
    id: 'claude-code',
    name: 'Claude Code',
    capabilities: ['rename', 'fork', 'undo', 'tags'],
  };

  async listChats(cwd?: string): Promise<ChatSummary[]> {
    const { listSessions } = await sdk();
    const sessions = await listSessions(cwd ? { dir: cwd } : undefined);
    return sessions
      .map((session) => ({
        id: session.sessionId,
        agent: this.info.id,
        title: session.customTitle ?? session.summary,
        ...(session.cwd ? { cwd: session.cwd } : {}),
        updatedAt: session.lastModified,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async transcript(chatId: ChatId, cwd: string): Promise<Entry[]> {
    const { getSessionMessages } = await sdk();
    const transcript = new ClaudeTranscript(false);
    for (const message of await getSessionMessages(chatId, { dir: cwd })) transcript.apply(message);
    return transcript.entries;
  }

  run(chatId: ChatId, settings: ChatSettings, resume: boolean, events: ChatEvents): LiveChat {
    const input = new MessageQueue<SDKUserMessage>();
    const transcript = new ClaudeTranscript(true, events);

    const started: Promise<Query> = sdk().then(({ query }) =>
      query({
        prompt: input,
        options: {
          cwd: settings.cwd,
          ...(settings.model ? { model: settings.model } : {}),
          permissionMode: MODES[settings.mode ?? 'ask'],
          includePartialMessages: true,
          ...(resume ? { resume: chatId } : { sessionId: chatId }),
          canUseTool: async (tool, toolInput, { signal, suggestions, title, toolUseID }) => {
            const decision = await events.approval(
              {
                id: toolUseID ?? randomUUID(),
                tool,
                input: toolInput,
                ...(title ? { title } : {}),
                canAlwaysAllow: (suggestions?.length ?? 0) > 0,
              },
              signal,
            );
            if (decision === 'deny')
              return { behavior: 'deny', message: 'The user declined this.' };
            return {
              behavior: 'allow',
              updatedInput: toolInput,
              ...(decision === 'allow-always' && suggestions
                ? { updatedPermissions: suggestions }
                : {}),
            };
          },
        },
      }),
    );

    void (async () => {
      try {
        for await (const message of await started) {
          transcript.apply(message);
          if (message.type === 'result') events.turnEnded(resultError(message));
        }
        events.closed();
      } catch (error) {
        events.closed(error instanceof Error ? error.message : String(error));
      }
    })();

    return {
      send: (text) =>
        input.push({
          type: 'user',
          message: { role: 'user', content: text },
          parent_tool_use_id: null,
        }),
      interrupt: async () => {
        await (await started).interrupt();
      },
      close: () => {
        input.end();
        void started.then((live) => live.close());
      },
    };
  }
}

function resultError(result: Extract<SDKMessage, { type: 'result' }>): string | undefined {
  if (result.subtype === 'success') return result.is_error ? result.result : undefined;
  return result.errors.join('\n') || result.subtype;
}
