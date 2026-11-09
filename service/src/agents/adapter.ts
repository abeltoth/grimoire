import type {
  AgentAccount,
  AgentCommand,
  AgentInfo,
  AgentModels,
  AgentSetup,
  Answer,
  Approval,
  ApprovalDecision,
  ChatId,
  ChatSettings,
  ChatStatus,
  ChatSummary,
  ContextUsage,
  PromptCache,
  Attachment,
  Entry,
  FollowUp,
  SubagentRun,
  SubagentState,
  HookRun,
  PlanStep,
  SettingsChange,
  TokenUse,
} from '@grimoire/contract';

/** A chat as the agent lists it; its pins and tags are Grimoire's (ADR-009). */
export type SavedChat = Omit<ChatSummary, 'pins' | 'tags'>;

/** One agent, such as Claude Code. The hub reaches agents only through this (ADR-006). */
export interface AgentAdapter {
  readonly info: AgentInfo;
  /** The agent's chats, most recent first. */
  listChats(cwd?: string): Promise<SavedChat[]>;
  /** A saved chat: its transcript, and the plan as the agent last left it. */
  history(chatId: ChatId, cwd: string): Promise<ChatHistory>;
  /**
   * Copies a chat, up to the end of the turn your message `entryId` began,
   * into a new chat with this title; returns the new chat's ID.
   * Agents that can't fork leave it out.
   */
  fork?(chatId: ChatId, cwd: string, entryId: string, title: string): Promise<ChatId>;
  /** Gives a saved chat a new title. Agents that can't rename chats leave it out. */
  rename?(chatId: ChatId, cwd: string, title: string): Promise<void>;
  /**
   * A saved subagent's run: what the subagent the chat's tool call `toolId`
   * started did, your task left out, and where it is with it. No entries
   * when there's no record of it. Agents without subagents leave it out.
   */
  subagent?(chatId: ChatId, cwd: string, toolId: string): Promise<SubagentRun>;
  /** The chat's title; empty until the agent names it. */
  title(chatId: ChatId, cwd: string): Promise<string>;
  models(): Promise<AgentModels>;
  /**
   * The model and effort for a new chat on Auto, picked for its first
   * entry; undefined when the agent can't say. Agents that can't pick leave it out.
   */
  pickModel?(text: string): Promise<Pick<ChatSettings, 'model' | 'effort'> | undefined>;
  /** The commands and skills you can use in a folder. Agents without them leave it out. */
  commands?(cwd: string): Promise<AgentCommand[]>;
  /** Who the agent is signed in as; null while it's signed out. Agents that can't switch accounts leave it out. */
  account?(): Promise<AgentAccount | null>;
  /**
   * Signs the agent in to the account with this email, in the browser, for
   * every process it starts from then on; `page` gets the sign-in page's
   * address. Agents that can't switch accounts leave it out.
   */
  signIn?(email: string, page: (url: string) => void): SignInRun;
  /** What the agent loads in a folder, and where each piece comes from. Agents that can't say leave it out. */
  setup?(cwd: string): Promise<AgentSetup>;
  /**
   * Starts the agent's process for a chat: a new chat under the given ID,
   * or, with `resume`, an existing one. Messages go in through send().
   * A new chat can be given its title; a resumed one keeps its own.
   */
  run(
    chatId: ChatId,
    settings: ChatSettings,
    resume: boolean,
    events: ChatEvents,
    title?: string,
  ): LiveChat;
  /**
   * Starts a new chat with its first message, when the agent picks the
   * chat's ID itself, as it does on a spare process (ADR-010). `bind` gets
   * the ID before any event. Without this, the hub picks the ID and calls run().
   */
  start?(
    settings: ChatSettings,
    text: string,
    id: string,
    bind: (chatId: ChatId) => ChatEvents,
    title?: string,
    attachments?: Attachment[],
  ): Promise<LiveChat>;
  /** Keeps a spare process started, so the next new chat opens at once (ADR-010). */
  warm?(): void;
  /** Stops any spare process, for when the service stops. */
  dispose?(): void;
}

/** A sign-in under way. */
export interface SignInRun {
  /** Settles once signed in; rejects, saying why, when the sign-in fails or is cancelled. */
  done: Promise<void>;
  /** Passes on the code the sign-in page shows when it doesn't return by itself. */
  code(code: string): void;
  cancel(): void;
}

export interface ChatHistory {
  entries: Entry[];
  plan: PlanStep[];
  /** What the last reply left in the prompt cache, when the agent records it. */
  cache?: PromptCache;
  /** The separate tasks the agent offered in the chat's last turn, when it did. */
  followUps?: FollowUp[];
}

/** A chat whose agent process is running. */
export interface LiveChat {
  /**
   * Sends your message, with any pictures and files; `id` is its entry's ID,
   * which the agent keeps so undo() can find it.
   */
  send(text: string, id: string, attachments?: Attachment[]): void;
  /** Stops the running turn; the chat stays live. */
  interrupt(): Promise<void>;
  /** Changes the model or permission; the agent takes it from its next request. */
  configure(change: SettingsChange): Promise<void>;
  /**
   * Restores the files to how they were before your message with this ID.
   * Rejects, saying why, when the agent can't. Agents without undo leave it out.
   */
  undo?(entryId: string): Promise<void>;
  /** Stops the agent process. */
  close(): void;
}

/** What a live chat reports to the hub. */
export interface ChatEvents {
  status(status: Exclude<ChatStatus, 'idle' | 'waiting'>): void;
  /** A new or changed entry, complete. */
  entry(entry: Entry): void;
  /** Text streamed into a block of an entry the hub already has. */
  text(entryId: string, block: number, text: string): void;
  /** A new or changed entry in the run of the subagent the tool call `toolId` started, complete. */
  subagentEntry(toolId: string, entry: Entry): void;
  /** The subagent the tool call `toolId` started began, or ended its task. */
  subagentState(toolId: string, state: SubagentState): void;
  /** Asks for a decision. `signal` aborts when the agent stops waiting for it. */
  approval(request: ApprovalRequest, signal: AbortSignal): Promise<Verdict>;
  /**
   * While another chat edits the project, why this one can't edit files,
   * as the agent is told when it tries to (ADR-011); undefined while it's
   * the chat that edits. Asked at each tool call, as it changes while the
   * chat runs.
   */
  readOnly(): string | undefined;
  /** The agent named or renamed the chat. */
  title(title: string): void;
  /** How much of the context window the chat now fills. */
  context(usage: ContextUsage): void;
  /** A turn ended, leaving this in the prompt cache. */
  cache(cache: PromptCache): void;
  /** The agent changed its plan. */
  plan(plan: PlanStep[]): void;
  /** What the running turn has spent so far, by model, its subagents' included. */
  tokens(uses: TokenUse[]): void;
  /** The hooks that ran on the running turn so far, and any begun before it that still run. */
  hooks(runs: HookRun[]): void;
  turnEnded(error?: string): void;
  /** After a turn ended, what the agent suggests you send next. */
  suggestion(text: string): void;
  /** After a turn ended, the separate tasks the agent offered in it, each of which a new chat could take on. */
  followUps(followUps: FollowUp[]): void;
  /** The agent process ended, on close() or by itself. */
  closed(error?: string): void;
}

export type ApprovalRequest = Omit<Approval, 'chatId'>;

/** Your decision on an approval: allow or deny, or the answers to its questions. */
export type Verdict = ApprovalDecision | { answers: Answer[] };
