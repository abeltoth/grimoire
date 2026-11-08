import type { TurnTokens } from './tokens';

/**
 * The agent hub's contract (ADR-006): chats with any agent, in terms that
 * aren't specific to one. Each agent's adapter maps its own messages onto
 * these types.
 */

export type AgentId = string;
/** The agent's own session ID, so terminal tools see the same chat. */
export type ChatId = string;

/** What an agent supports beyond chatting. Features that need one show only for agents that have it. */
/**
 * What an agent can do beyond chatting; "compact" sums a chat up to free its
 * context, and "sign-in" switches the account every chat uses.
 */
export type AgentCapability = 'rename' | 'fork' | 'undo' | 'compact' | 'sign-in';

export interface AgentInfo {
  id: AgentId;
  name: string;
  capabilities: AgentCapability[];
}

/** How freely the agent may act: ask first, accept edits, plan only, or allow everything. */
export type ApprovalMode = 'ask' | 'accept-edits' | 'plan' | 'allow-all';

/** How hard the model thinks before it answers, from least to most. */
export const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

/** The level a model runs at when asked for one it doesn't take: the highest it takes below it. */
export function fitEffort(
  level: EffortLevel | undefined,
  levels: readonly EffortLevel[],
): EffortLevel | undefined {
  if (!level || !levels.length) return undefined;
  const asked = EFFORT_LEVELS.indexOf(level);
  return [...levels].reverse().find((taken) => EFFORT_LEVELS.indexOf(taken) <= asked) ?? levels[0];
}

export interface ChatSettings {
  /** The project folder the agent works in. */
  cwd: string;
  /** The agent's model ID; the agent's default when left out. */
  model?: string;
  /** The model's effort; what your agent's own settings give when left out. */
  effort?: EffortLevel;
  /**
   * Auto: the agent picks the model and effort for the chat's first entry,
   * whatever is set here. Once the chat has begun, `model` and `effort` say
   * what it picked; picking another model ends Auto.
   */
  autoModel?: boolean;
  mode?: ApprovalMode;
  /**
   * Works in a worktree of its own, on a branch of its own, so chats on one
   * repository don't change each other's files. For a new chat the folder
   * is the one its worktree is made from; once begun, it's the worktree.
   */
  worktree?: boolean;
  /**
   * The MCP servers turned off for this chat, by name: they don't start for
   * it, nor take room in its context. Those off in every chat are in
   * Grimoire's settings.
   */
  mcpOff?: string[];
}

/** Settings for a new chat; the folder defaults to your home folder. */
export type NewChatSettings = Omit<ChatSettings, 'cwd'> & { cwd?: string };

/** What a second model's chat comes from: a chat that has begun, or a new chapter's settings. */
export type ParallelFrom =
  { chatId: ChatId } | { agent: AgentId; settings: NewChatSettings; title?: string };

/**
 * The settings you can change once a chat has begun. Its MCP servers change
 * from its next turn: the agent's process starts again, continuing the chat.
 */
export type SettingsChange = Pick<ChatSettings, 'model' | 'mode' | 'effort' | 'mcpOff'>;

/** A model an agent offers. */
export interface AgentModel {
  /** What ChatSettings.model takes. */
  id: string;
  name: string;
  description?: string;
  /** The effort levels it takes, least first; missing when it has none. */
  efforts?: EffortLevel[];
  /** The effort it runs at when a chat names none, as your agent's own settings give it; missing when they don't say. */
  effort?: EffortLevel;
}

export interface AgentModels {
  models: AgentModel[];
  /** The model a chat gets when its settings name none. */
  default?: string;
}

/** How much of one of a plan's limits is used: its five-hour session or its week. */
export interface UsageWindow {
  span: 'session' | 'week';
  /** For a week kept for one model, the model's name, such as "Opus". */
  model?: string;
  /** The share of the limit used, in percent; null when the agent doesn't say. */
  used: number | null;
  /** When the limit starts afresh, in ms since the epoch. */
  resetsAt: number | null;
}

/** A plan limit as it was read at one moment. */
export interface UsageReading extends UsageWindow {
  /** When it was read, in ms since the epoch. */
  at: number;
  /** The email of the account it was read for; absent for readings kept before Grimoire noted it. */
  account?: string;
}

/**
 * Usage credits: money a month's use may cost, as Claude Code's /usage
 * shows them. On Pro and Max they pay for use past the plan's limits; on a
 * Team or Enterprise plan they can be the allowance your organization gives
 * you each month.
 */
export interface UsageCredits {
  /** Spent this month, in the currency's minor units (cents for USD); null when the agent doesn't say. */
  spent: number | null;
  /** The month's limit, in the same units; null when there's no limit. */
  limit: number | null;
  /** The ISO 4217 code, such as "USD". */
  currency: string;
  /** The share of the limit spent, in percent; null when there's no limit or the agent doesn't say. */
  used: number | null;
  /** When the month starts afresh, in ms since the epoch: the first of next month, as /usage counts it. */
  resetsAt: number;
}

/** The agent's subscription, and how much of its limits is used. */
export interface PlanUsage {
  /** The subscription, such as "pro", "max", "team" or "enterprise"; null when there's none, as with an API key. */
  plan: string | null;
  /** Empty when the plan's limits don't apply. */
  windows: UsageWindow[];
  /** While usage credits are turned on. */
  credits?: UsageCredits;
  /** The email of the account the limits are of, when the agent says. */
  account?: string;
  /** When it was read, in ms since the epoch. */
  at: number;
}

/** The account an agent is signed in with. */
export interface AgentAccount {
  email: string;
  /** The subscription, such as "pro" or "max"; null when the agent doesn't say. */
  plan: string | null;
  /** When the sign-in runs out unless it's renewed, in ms since the epoch; null when the agent doesn't say. */
  expiresAt: number | null;
}

/** A sign-in waiting for you in the browser. */
export interface PendingSignIn {
  /** The account being signed in to. */
  email: string;
  /** The sign-in page, to open by hand when the browser didn't open by itself; null until the agent gives it. */
  url: string | null;
}

/** Who an agent is signed in as, and any sign-in under way. */
export interface AgentSignIn {
  agent: AgentId;
  /** Null while it's signed out. */
  account: AgentAccount | null;
  pending: PendingSignIn | null;
}

/** The folders your chats ran in, most recent first, and your home folder. */
export interface RecentFolders {
  home: string;
  recent: string[];
}

/** A chat as the agent lists it, open or not. */
export interface ChatSummary {
  id: ChatId;
  agent: AgentId;
  title: string;
  cwd?: string;
  /** ms since the epoch. */
  updatedAt: number;
  /** Which of its dog-ears are folded. */
  dogEars: DogEar[];
  /** Your tags for it, in the order you added them. */
  tags: string[];
}

/** What a live chat is doing. Idle chats aren't running a turn. */
export type ChatStatus = 'idle' | 'thinking' | 'writing' | 'waiting';

/** One entry in a transcript. */
export type Entry = UserEntry | AgentEntry;

export interface UserEntry {
  kind: 'user';
  id: string;
  text: string;
  /** Pictures and files sent with it. */
  enclosures?: Enclosure[];
  /** When it was written, in ms since the epoch, when known. */
  at?: number;
  /** How long the turn it began took, in ms, once that turn has ended and when known. */
  took?: number;
  /** What the turn it began spent, so far while it runs, when the agent says. */
  tokens?: TurnTokens;
  /** The hooks that ran on the turn it began, in the order they began, while the chat is live. */
  hooks?: HookRun[];
  /**
   * The worktree's setup, run before the turn it began, while the chat is
   * live: on a new chat's first entry, or on the first sent after the
   * setup that ran as the chat reopened.
   */
  setup?: HookRun;
}

/**
 * A hook the agent ran, such as your command after each edit, and how it
 * went. A worktree's setup is told the same way, its event "WorktreeSetup".
 */
export interface HookRun {
  id: string;
  /** As the agent names it, such as "PostToolUse:Edit"; a worktree's setup, by its command. */
  name: string;
  /** What it ran on, such as "PostToolUse". */
  event: string;
  /** The tool it ran for, on a tool's events, such as "Edit". */
  tool?: string;
  /** Blocked when it stopped what it ran on; failed when it broke without stopping it. */
  outcome: 'running' | 'passed' | 'failed' | 'blocked' | 'cancelled';
  /** What it printed, when it printed anything. */
  output?: string;
  /** How long it took, in ms, once it ended and when known. */
  took?: number;
  /** When it began, in ms since the epoch, when known. */
  at?: number;
}

/** Something sent with an entry: a picture, shown as a plate, or a file, as a reference. */
export type Enclosure = PictureEnclosure | FileEnclosure;

export interface PictureEnclosure {
  kind: 'picture';
  /** Such as "image/png". */
  mediaType: string;
  /** The picture, base64-encoded. */
  data: string;
  /** How it came in, such as "Screenshot, pasted at 22:18"; missing when read back from the agent. */
  caption?: string;
}

/** A file the agent reads with the entry. */
export interface FileEnclosure {
  kind: 'file';
  /** Absolute, or relative to the chat's folder. */
  path: string;
}

export interface AgentEntry {
  kind: 'agent';
  id: string;
  blocks: Block[];
  /** When it was written, in ms since the epoch, when known. */
  at?: number;
  /** The model that wrote it, such as claude-opus-5-5, when the agent says. */
  model?: string;
}

export type Block = TextBlock | ThinkingBlock | ToolBlock;

export interface TextBlock {
  kind: 'text';
  text: string;
}

export interface ThinkingBlock {
  kind: 'thinking';
  text: string;
}

/** A tool the agent called, such as reading a file or running a command. */
export interface ToolBlock {
  kind: 'tool';
  id: string;
  tool: string;
  input: unknown;
  /** The skill it runs, when the tool is the one that runs skills. */
  skill?: string;
  /** Missing while the tool runs. */
  result?: ToolResult;
}

export interface ToolResult {
  text: string;
  isError: boolean;
}

/** The agent wants to use a tool and waits for your decision. */
export interface Approval {
  id: string;
  chatId: ChatId;
  tool: string;
  input: unknown;
  /** When the agent asked, in ms since the epoch. */
  at?: number;
  /** The agent's own description of the request, when it gives one. */
  title?: string;
  /** What Always allow would allow from now on; missing when the agent doesn't offer it. */
  alwaysAllow?: AlwaysAllow;
  /**
   * When set, the agent asks you these questions instead of asking to use a
   * tool. Answer them with agents.answer.
   */
  questions?: Question[];
}

export interface AlwaysAllow {
  /** The rule, such as the command `git push`; missing when it covers the whole tool. */
  rule?: string;
  /** Where it applies: this chat, this project, or every project. */
  scope: 'chat' | 'project' | 'everywhere';
}

/** A question the agent asks before it continues, with options to tick. */
export interface Question {
  question: string;
  /** A short label for the question, such as "Library". */
  header?: string;
  options: QuestionOption[];
  /** Whether you may tick more than one option. */
  multiSelect: boolean;
}

export interface QuestionOption {
  label: string;
  description?: string;
  /** The agent recommends this option. */
  recommended?: boolean;
}

/** Your answer to one question: the options you ticked, and anything in your own words. */
export interface Answer {
  chosen: string[];
  ownWords?: string;
}

export type ApprovalDecision = 'allow-once' | 'allow-always' | 'deny';

/** How much of the agent's context window a chat fills, in tokens. */
export interface ContextUsage {
  used: number;
  limit: number;
}

/**
 * The prompt cache a chat's last reply left. Until it runs out, continuing
 * reads the chat's context from the cache; after, it reads it all again.
 */
export interface PromptCache {
  /** The tokens the chat's context holds: what continuing re-reads once the cache has run out. */
  tokens: number;
  /** When the cache runs out, in ms since the epoch. */
  until: number;
}

/** Where a helper is with its task: still at it, done, failed, or stopped before it was done. */
export type HelperState = 'working' | 'done' | 'failed' | 'stopped';

/** What a helper did, and where it is with its task. */
export interface HelperRun {
  /** Its replies and tools; its task, the tool call's input, left out. */
  entries: Entry[];
  /** Missing while the agent hasn't said. */
  state?: HelperState;
}

/** One step of the agent's plan for the chat, which it keeps up to date as it works. */
export interface PlanStep {
  text: string;
  status: 'pending' | 'active' | 'done';
  /** What the agent says while it works on it, such as "Running the tests". */
  activeText?: string;
}

/** A message you sent while a turn ran: it waits until the turn ends. */
export interface QueuedEntry {
  id: string;
  text: string;
  enclosures?: Enclosure[];
}

/** One of an agent's commands or skills, used by writing "/name" at the start of an entry. */
export interface AgentCommand {
  name: string;
  description: string;
  /** What it takes after its name, such as "<file>". */
  argumentHint?: string;
  kind: 'command' | 'skill';
}

/**
 * A separate task the agent offers after a reply, as a card: clicking it
 * opens a new chat with its prompt written in, not sent.
 */
export interface FollowUp {
  /** A few words naming the task. */
  title: string;
  /** The new chat's first entry, written in for you to send. */
  prompt: string;
}

/** A dog-ear on a chapter's page: the top corner pins it, the bottom one stars it. */
export type DogEar = 'pin' | 'star';

/** A chat the hub has open: its transcript so far and what it's doing. */
export interface OpenChat {
  id: ChatId;
  agent: AgentId;
  /** Empty until the agent names the chat. */
  title: string;
  settings: ChatSettings;
  status: ChatStatus;
  entries: Entry[];
  approvals: Approval[];
  /** Messages waiting for the turn to end, in the order they go. */
  queued: QueuedEntry[];
  /** Missing until the agent reports it. */
  context?: ContextUsage;
  /** What its last reply left in the prompt cache; missing until it has replied. */
  cache?: PromptCache;
  /** The agent's plan; empty until it makes one. */
  plan: PlanStep[];
  /** Your entries whose file changes were undone; their edits show as withdrawn. */
  withdrawn: string[];
  /** The dog-ears folded down on the chapter. */
  dogEars: DogEar[];
  /** Your tags for it, in the order you added them. */
  tags: string[];
  /**
   * Your entries copied from the chat this one was forked from. The agent
   * keeps no file checkpoints for them, so they can't be undone.
   */
  copied: string[];
  /** What the agent suggests you send next, while the chat is idle with nothing queued. */
  suggestion?: string;
  /** The separate tasks the agent offered after its last reply, until a turn begins. */
  followUps?: FollowUp[];
  /**
   * The worktree's setup, run in the background as the chat reopened in a
   * worktree that had to be put back: until it ends, messages wait for it.
   * Your next entry takes it.
   */
  setup?: HookRun;
}

declare module './commands' {
  interface CommandMap {
    'agents.list': { request: Record<string, never>; response: AgentInfo[] };
    'agents.models': { request: { agent: AgentId }; response: AgentModels };
    /** The agent's commands and skills in a folder; your home folder when there's none. */
    'agents.commands': { request: { agent: AgentId; cwd?: string }; response: AgentCommand[] };
    /** The agent's subscription limits and how much of them is used; null when it has none. */
    'agents.usage': { request: { agent: AgentId }; response: PlanUsage | null };
    /** Each reading of the agent's plan limits kept since a time, oldest first: those of the account signed in now. */
    'agents.usageHistory': { request: { agent: AgentId; since: number }; response: UsageReading[] };
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
    /** The chats open as chapters, in ribbon order, remembered across restarts. */
    'agents.openChats': { request: Record<string, never>; response: OpenChat[] };
    /** Opens a chat: loads its transcript, and later messages continue it. */
    'agents.open': {
      request: { agent: AgentId; chatId: ChatId; settings: ChatSettings };
      response: OpenChat;
    };
    /**
     * Starts a new chat with a first message. In a worktree of its own, the
     * repository's setup runs first; the agent's turn starts once it ended.
     */
    'agents.start': {
      request: {
        agent: AgentId;
        settings: NewChatSettings;
        text: string;
        enclosures?: Enclosure[];
        title?: string;
        /**
         * The window's own name for the page the chat starts on, which the
         * worktree's setup reports to: the chat has no ID until it begins.
         */
        page?: string;
      };
      response: OpenChat;
    };
    /** Renames a chat, with the agent, so the agent's own tools show the new title too. */
    'agents.rename': { request: { chatId: ChatId; title: string }; response: void };
    /** Sends a message; while a turn runs, it's queued and goes when the turn ends. */
    'agents.send': {
      request: { chatId: ChatId; text: string; enclosures?: Enclosure[] };
      response: void;
    };
    /** Changes a chat's model or permission; a running chat takes it from its next request. */
    'agents.configure': { request: { chatId: ChatId; change: SettingsChange }; response: void };
    /**
     * Restores the files to how they were before one of your entries, while
     * the chat is idle. The edits of that entry and those after it are withdrawn.
     */
    'agents.undo': { request: { chatId: ChatId; entryId: string }; response: void };
    /**
     * Copies a chat, up to the end of the turn one of your entries began,
     * into a new chat: a variant, such as "Context meter (a)". It opens as a
     * chapter, and the original stays as it was.
     */
    'agents.fork': { request: { chatId: ChatId; entryId: string }; response: OpenChat };
    /**
     * Sends one entry to a second model too, in a chat of its own, which
     * works in a worktree of its own when the folder is in a git
     * repository. From a chat that has begun, the second is a copy of it,
     * and the entry goes to both. From a new chapter's settings, the second
     * starts afresh; start the first with agents.start, before this.
     */
    'agents.parallel': {
      request: { from: ParallelFrom; model: string; text: string; enclosures?: Enclosure[] };
      response: OpenChat;
    };
    /** Folds a chat's dog-ear down, or unfolds it: pins or stars the chat, or takes that back. */
    'agents.dogEar': {
      request: { chatId: ChatId; dogEar: DogEar; folded: boolean };
      response: void;
    };
    /** Sets a chat's tags, in the order you added them. */
    'agents.tag': { request: { chatId: ChatId; tags: string[] }; response: void };
    /**
     * Takes one of the separate tasks offered, by its place among them: it
     * goes from the chat, and what a new chapter for it begins with comes
     * back. The new chat works where this one does, with its model, effort,
     * permission and MCP servers; a chat in a worktree of its own gives the
     * folder that worktree was made from, and a worktree of its own too.
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
     * What a helper did: a subagent the agent handed a task to with one of
     * its tool calls, working in a transcript of its own. Its task is the
     * tool call's input, and its last reply the call's result. No entries
     * when the agent keeps no record of it. The chat must be open.
     */
    'agents.helper': { request: { chatId: ChatId; toolId: string }; response: HelperRun };
    /**
     * Closes a chat's chapter and stops its agent process. The chat itself
     * stays with the agent.
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
    /** A new or changed entry in the run of a helper the chat's tool call `toolId` started, complete. */
    'agents.helperEntry': { chatId: ChatId; toolId: string; entry: Entry };
    /** A helper the chat's tool call `toolId` started began, or ended its task. */
    'agents.helperState': { chatId: ChatId; toolId: string; state: HelperState };
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
    /** A chat's dog-ears changed: the ones now folded down. */
    'agents.dogEars': { chatId: ChatId; dogEars: DogEar[] };
    'agents.tags': { chatId: ChatId; tags: string[] };
    /** Edits were undone: your entries whose file changes are now withdrawn. */
    'agents.withdrawn': { chatId: ChatId; withdrawn: string[] };
    /** The agent suggested what you might send next; null once it no longer stands. */
    'agents.suggestion': { chatId: ChatId; suggestion: string | null };
    /** The agent offered separate tasks after its reply; null once none stands. */
    'agents.followUps': { chatId: ChatId; followUps: FollowUp[] | null };
    /**
     * A worktree's setup began, printed something, or ended: a new chat's,
     * on the page its agents.start named; a reopened chat's, by its ID, and
     * null once your next entry took it.
     */
    'agents.worktreeSetup': { page: string; run: HookRun } | { chatId: ChatId; run: HookRun | null };
  }
}
