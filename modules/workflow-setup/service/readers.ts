import type { AgentId } from '@grimoire/contract';
import { claudeSetup } from './claude';
import type { SetupReader } from './setup';

/** Each agent's, by its ID; an agent without one can't say what it loads. */
export const SETUP_READERS: ReadonlyMap<AgentId, SetupReader> = new Map([['claude-code', claudeSetup]]);
