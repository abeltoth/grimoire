import type {
  AgentCommand,
  AgentId,
  AgentInfo,
  AgentModels,
  AgentSignIn,
  ChatId,
  ChatStatus,
  ChatSummary,
  ContextUsage,
  Editor,
  FollowUp,
  OpenChat,
  PlanStep,
  PromptCache,
  QueuedEntry,
  RecentFolders,
  SubagentRun,
  SubagentState,
} from './agents';
import type { Answer, Approval, ApprovalDecision } from './approvals';
import type { ChatSettings, NewChatSettings, ParallelFrom, SettingsChange } from './chat-settings';
import type { Attachment, Entry } from './entries';

/**
 * The agent hub's commands and events (ADR-007), which every window uses
 * to run and follow chats.
 */

declare module './commands' {
  interface CommandMap {
    'agents.list': { request: Record<string, never>; response: AgentInfo[] };
    'agents.models': { request: { agent: AgentId }; response: AgentModels };
    /** The agent's commands and skills in a folder; your home folder when there's none. */
    'agents.commands': { request: { agent: AgentId; cwd?: string }; response: AgentCommand[] };
    /** Who the agent is signed in as, and any sign-in under way. */
    'agents.account': { request: { agent: AgentId }; response: AgentSignIn };
    /**
     * Signs the agent in to another account, in the browser, for every chat:
     * open chats move to it from their next message. Settles once the
     * sign-in ends; rejects, saying why, when it fails or is cancelled.
     */
    'agents.signIn': { request: { agent: AgentId; email: string }; response: AgentSignIn };
    /** The code the sign-in page shows when it doesn't return to the agent by itself. */
    'agents.signInCode': { request: { agent: AgentId; code: string }; response: void };
    /** Stops a sign-in under way; the agent stays signed in as before. */
    'agents.cancelSignIn': { request: { agent: AgentId }; response: void };
    /** The folders your chats with any agent ran in. */
    'agents.folders': { request: Record<string, never>; response: RecentFolders };
    /** The agent's chats, most recent first, optionally only those in one folder. */
    'agents.chats': { request: { agent: AgentId; cwd?: string }; response: ChatSummary[] };
    /** The open chats, in chat tab order, remembered across restarts. */
    'agents.openChats': { request: Record<string, never>; response: OpenChat[] };
    /** Opens a chat: loads its transcript, and later messages continue it. */
    'agents.open': {
      request: { agent: AgentId; chatId: ChatId; settings: ChatSettings };
      response: OpenChat;
    };
    /**
     * Starts a new chat with a first message. It can't edit files when
     * another open chat edits its project.
     */
    'agents.start': {
      request: {
        agent: AgentId;
        settings: NewChatSettings;
        text: string;
        attachments?: Attachment[];
        title?: string;
      };
      response: OpenChat;
    };
    /** Renames a chat, with the agent, so the agent's own tools show the new title too. */
    'agents.rename': { request: { chatId: ChatId; title: string }; response: void };
    /** Sends a message; while a turn runs, it's queued and goes when the turn ends. */
    'agents.send': {
      request: { chatId: ChatId; text: string; attachments?: Attachment[] };
      response: void;
    };
    /** Changes a chat's model or permission; a running chat takes it from its next request. */
    'agents.configure': { request: { chatId: ChatId; change: SettingsChange }; response: void };
    /**
     * Restores the files to how they were before one of your messages, while
     * the chat is idle and edits its project. The edits of that entry and
     * those after it are withdrawn.
     */
    'agents.undo': { request: { chatId: ChatId; entryId: string }; response: void };
    /**
     * Copies a chat, up to the end of the turn one of your messages began,
     * into a new chat: a variant, such as "Context meter (a)". It opens as a
     * chat, and the original stays as it was.
     */
    'agents.fork': { request: { chatId: ChatId; entryId: string }; response: OpenChat };
    /**
     * Sends one entry to a second model too, in a chat of its own, in the
     * same folder: while the first edits the project, the second only reads.
     * From a chat that has begun, the second is a copy of it, and the message
     * goes to both. From a new chat's settings, the second starts afresh;
     * start the first with agents.start, before this.
     */
    'agents.parallel': {
      request: { from: ParallelFrom; model: string; text: string; attachments?: Attachment[] };
      response: OpenChat;
    };
    /**
     * Takes one of the separate tasks offered, by its place among them: it
     * goes from the chat, and what a new chat for it begins with comes
     * back. The new chat works where this one does, with its model, effort,
     * permission and MCP servers.
     */
    'agents.takeFollowUp': {
      request: { chatId: ChatId; index: number };
      response: { agent: AgentId; settings: NewChatSettings; prompt: string };
    };
    /** Takes a message out of the queue; false when it had already gone. */
    'agents.unqueue': { request: { chatId: ChatId; id: string }; response: boolean };
    /**
     * Stops the running turn. The queued messages are withdrawn, not sent,
     * and come back in the response.
     */
    'agents.interrupt': { request: { chatId: ChatId }; response: QueuedEntry[] };
    'agents.decide': {
      request: { approvalId: string; decision: ApprovalDecision };
      response: void;
    };
    /** Answers an approval's questions, one answer per question, in order. */
    'agents.answer': { request: { approvalId: string; answers: Answer[] }; response: void };
    /**
     * What a subagent did: a subagent the agent handed a task to with one of
     * its tool calls, working in a transcript of its own. Its task is the
     * tool call's input, and its last reply the call's result. No entries
     * when the agent keeps no record of it. The chat must be open.
     */
    'agents.subagent': { request: { chatId: ChatId; toolId: string }; response: SubagentRun };
    /**
     * Makes the chat the one that edits its project: the chat that edited it
     * only reads from now on.
     */
    'agents.takeOver': { request: { chatId: ChatId }; response: void };
    /**
     * Closes an open chat and stops its agent process. The chat itself
     * stays with the agent. When it edited its project, the chat on it
     * opened first after it edits from now on.
     */
    'agents.close': { request: { chatId: ChatId }; response: void };
  }
}

declare module './events' {
  interface EventMap {
    'agents.status': { chatId: ChatId; status: ChatStatus };
    /** An agent's sign-in changed: it began, its page is known, or it ended. */
    'agents.account': AgentSignIn;
    /** A new or changed entry, complete. */
    'agents.entry': { chatId: ChatId; entry: Entry };
    /** A new or changed entry in the run of a subagent the chat's tool call `toolId` started, complete. */
    'agents.subagentEntry': { chatId: ChatId; toolId: string; entry: Entry };
    /** A subagent the chat's tool call `toolId` started began, or ended its task. */
    'agents.subagentState': { chatId: ChatId; toolId: string; state: SubagentState };
    /** Text streamed into a block of an entry since the last event, batched. */
    'agents.text': { chatId: ChatId; entryId: string; block: number; text: string };
    'agents.approval': { approval: Approval };
    /** An approval was decided, or dropped because the turn stopped. */
    'agents.approvalSettled': { chatId: ChatId; approvalId: string };
    'agents.turnEnded': { chatId: ChatId; error?: string };
    'agents.title': { chatId: ChatId; title: string };
    /** The queue changed: the messages now waiting for the turn to end. */
    'agents.queued': { chatId: ChatId; queued: QueuedEntry[] };
    /** How much of the context window the chat now fills. */
    'agents.context': { chatId: ChatId; context: ContextUsage };
    /** A turn ended, leaving this in the prompt cache. */
    'agents.cache': { chatId: ChatId; cache: PromptCache };
    /** The chat's settings changed. */
    'agents.settings': { chatId: ChatId; settings: ChatSettings };
    /** The agent changed its plan. */
    'agents.plan': { chatId: ChatId; plan: PlanStep[] };
    /** Edits were undone: your messages whose file changes are now withdrawn. */
    'agents.withdrawn': { chatId: ChatId; withdrawn: string[] };
    /** The agent suggested what you might send next; null once it no longer stands. */
    'agents.suggestion': { chatId: ChatId; suggestion: string | null };
    /** The agent offered separate tasks after its reply; null once none stands. */
    'agents.followUps': { chatId: ChatId; followUps: FollowUp[] | null };
    /** Another chat now edits the chat's project, so it only reads; null once it's the one that edits. */
    'agents.readOnly': { chatId: ChatId; readOnly: Editor | null };
  }
}
