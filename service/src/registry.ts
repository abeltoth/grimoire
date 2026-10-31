import type { CommandName, CommandRequest, CommandResponse } from '@grimoire/contract';

export type CommandHandler<K extends CommandName> = (
  request: CommandRequest<K>,
) => CommandResponse<K> | Promise<CommandResponse<K>>;

export class UnknownCommandError extends Error {
  constructor(readonly command: string) {
    super(`Unknown command: ${command}`);
  }
}

/** Where the core and each module register the commands they handle. */
export class CommandRegistry {
  private readonly handlers = new Map<string, (request: unknown) => unknown>();

  register<K extends CommandName>(command: K, handler: CommandHandler<K>): void {
    if (this.handlers.has(command)) {
      throw new Error(`Command already registered: ${command}`);
    }
    this.handlers.set(command, handler as (request: unknown) => unknown);
  }

  async dispatch(command: string, request: unknown): Promise<unknown> {
    const handler = this.handlers.get(command);
    if (!handler) throw new UnknownCommandError(command);
    return handler(request);
  }
}
