import type { AgentId, NewChatSettings } from './agents';

/** A chat's settings saved under a name, to begin chats with (ADR-009: Grimoire's own data). */
export interface Preset {
  name: string;
  agent: AgentId;
  settings: NewChatSettings;
  /** The first entry a chat begun with it has written in, ready to send or change. */
  prompt?: string;
}

declare module './commands' {
  interface CommandMap {
    /** The saved presets, in the order they were first saved. */
    'presets.list': { request: Record<string, never>; response: Preset[] };
    /**
     * Saves a preset; one with the same name, whatever its case, is replaced,
     * keeping its first entry unless one is given ("" for none). Returns them all.
     */
    'presets.save': { request: Preset; response: Preset[] };
    /** Gives a preset another name, which no other preset has. Returns them all. */
    'presets.rename': { request: { from: string; to: string }; response: Preset[] };
    /** Returns the presets left. */
    'presets.remove': { request: { name: string }; response: Preset[] };
  }
}
