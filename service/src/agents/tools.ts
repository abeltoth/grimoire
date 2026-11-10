import type { AgentId, ChatId } from '@grimoire/contract';
import type { z } from 'zod';

/** The chat a tool is called in. */
export interface ToolChat {
  chatId: ChatId;
  agent: AgentId;
  /** The folder the chat works in. */
  cwd: string;
}

/**
 * A tool a module gives the agent in every chat (ADR-011). It's agent-neutral, so each adapter
 * serves it its own way: what `run` returns the agent reads as the answer, and what it throws as
 * the tool's error.
 */
export interface AgentTool<Input extends z.ZodRawShape = z.ZodRawShape> {
  /** Its name on Grimoire's tool server. */
  readonly name: string;
  /** What the agent reads of it beside its input. */
  readonly description: string;
  /** What the agent is told of it in its system prompt. */
  readonly prompt: string;
  readonly input: Input;
  /** `chat` is unknown while the process the tool is in waits for a chat to claim it. */
  run(args: z.infer<z.ZodObject<Input>>, chat: ToolChat | undefined): string | Promise<string>;
}

/** The tools the modules give the agents, which each agent's process gets as it starts. */
export class AgentTools {
  private readonly tools: AgentTool[] = [];

  register(tool: AgentTool): void {
    if (this.tools.some((known) => known.name === tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.push(tool);
  }

  all(): readonly AgentTool[] {
    return this.tools;
  }
}
