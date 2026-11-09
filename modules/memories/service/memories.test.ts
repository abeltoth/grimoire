import { homedir } from 'node:os';
import type { AgentMemories } from '@grimoire/contract';
import { afterEach, describe, expect, it } from 'vitest';
import { Memories, type MemorySource } from './memories';

const kept = (cwd: string): AgentMemories => ({
  cwd,
  folder: 'C:/mem',
  index: { path: 'C:/mem/MEMORY.md', exists: false },
  enabled: true,
  memories: [],
  problems: [],
  elsewhere: [],
  at: 1,
});

let memories: Memories | undefined;
afterEach(() => memories?.dispose());

describe('Memories', () => {
  it('asks the agent for the memories it keeps in a folder, your home folder when none is given', async () => {
    const asked: string[] = [];
    const source: MemorySource = {
      read: async (cwd) => {
        asked.push(cwd);
        return kept(cwd);
      },
    };
    memories = new Memories(new Map([['fake', source]]), () => {});
    expect(await memories.list('fake', 'C:/work')).toMatchObject({ cwd: 'C:/work', folder: 'C:/mem' });
    expect(await memories.list('fake')).toMatchObject({ cwd: homedir() });
    expect(asked).toEqual(['C:/work', homedir()]);
  });

  it('has none for an agent that keeps none', async () => {
    memories = new Memories(new Map(), () => {});
    expect(await memories.list('plain', 'C:/work')).toBeNull();
  });
});
