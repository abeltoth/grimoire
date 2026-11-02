import type { AgentId, NewChatSettings } from './agents';

/** A chapter's settings saved under a name, to begin chapters with (ADR-009: Grimoire's own data). */
export interface Preset {
  name: string;
  agent: AgentId;
  settings: NewChatSettings;
}

declare module './commands' {
  interface CommandMap {
    /** The saved presets, in the order they were first saved. */
    'presets.list': { request: Record<string, never>; response: Preset[] };
    /** Saves a preset; one with the same name, whatever its case, is replaced. Returns them all. */
    'presets.save': { request: Preset; response: Preset[] };
  }
}
