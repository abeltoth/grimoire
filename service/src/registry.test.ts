import { describe, expect, it } from 'vitest';
import { CommandRegistry, UnknownCommandError } from './registry';

describe('CommandRegistry', () => {
  it('runs a command by its handler, from a window or from inside the service', async () => {
    const registry = new CommandRegistry();
    registry.register('core.ping', () => ({ ok: true }) as never);
    expect(await registry.dispatch('core.ping', {})).toEqual({ ok: true });
    expect(await registry.call('core.ping', {} as never)).toEqual({ ok: true });
  });

  it('refuses a second handler for a command', () => {
    const registry = new CommandRegistry();
    registry.register('core.ping', () => ({}) as never);
    expect(() => registry.register('core.ping', () => ({}) as never)).toThrow(
      'Command already registered: core.ping',
    );
  });

  it('answers a command no one handles with an error naming it', async () => {
    const error = await new CommandRegistry().dispatch('nobody.home', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnknownCommandError);
    expect((error as UnknownCommandError).command).toBe('nobody.home');
  });
});
