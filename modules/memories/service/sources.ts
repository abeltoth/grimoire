import type { AgentId } from '@grimoire/contract';
import { claudeMemories } from './claude';
import type { MemorySource } from './memories';

/** Each agent's, by its ID; an agent without one keeps no memories. */
export const MEMORY_SOURCES: ReadonlyMap<AgentId, MemorySource> = new Map([['claude-code', claudeMemories]]);
