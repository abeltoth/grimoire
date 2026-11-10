import type { ChatId } from './agents';

/**
 * What the agent waits on you for: a tool to allow, or questions to answer.
 */

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
