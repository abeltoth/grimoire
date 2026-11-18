import { describe, expect, it } from 'vitest';
import { type AgentTool, AgentTools } from './tools';

const tool = (name: string): AgentTool => ({
  name,
  description: 'Does a thing',
  prompt: 'You have a tool',
  input: {},
  run: () => 'Done',
});

describe('AgentTools', () => {
  it('keeps the tools in the order the modules give them, each name once', () => {
    const tools = new AgentTools();
    tools.register(tool('b'));
    tools.register(tool('a'));
    expect(tools.all().map((known) => known.name)).toEqual(['b', 'a']);
    expect(() => tools.register(tool('a'))).toThrow('Tool already registered: a');
  });

  it('leaves out a tool while it is not enabled', () => {
    const tools = new AgentTools();
    let on = false;
    tools.register({ ...tool('a'), enabled: () => on });
    tools.register(tool('b'));
    expect(tools.all().map((known) => known.name)).toEqual(['b']);
    on = true;
    expect(tools.all().map((known) => known.name)).toEqual(['a', 'b']);
  });
});
