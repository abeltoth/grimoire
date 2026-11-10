import { Injectable, inject } from '@angular/core';
import type { AgentId, NewChatSettings, OpenChat } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';
import type { Chat, ChatStart } from './chat';
import { PresetList } from './preset-list';
import { Settings } from './settings';

const DEFAULT_AGENT = 'claude-code';

/** The settings a new chat takes: the ones last picked or begun with. */
export interface LastUsed {
  agent: AgentId;
  settings: NewChatSettings;
}

/**
 * What a new chat begins with, as Settings says: a preset, or the
 * settings last used, so a blank page opens as you'd expect.
 */
@Injectable({ providedIn: 'root' })
export class NewChats {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly settings = inject(Settings);
  private readonly presets = inject(PresetList);
  private nextBlank = 1;
  private lastUsed: LastUsed | null = null;
  /** Told when a blank chat's first message starts it. */
  private readonly begun = new Set<(blankId: string, chat: OpenChat) => void>();

  /** Once the settings and presets that say what a new chat begins with are known. */
  ready(): Promise<unknown> {
    return Promise.all([this.settings.ready, this.presets.ready]);
  }

  /**
   * What a new chat begins with, as Settings says: a preset's
   * settings, or those used last, if they were with the default agent.
   */
  startOf(): { preset?: string } & ChatStart {
    const { newChat, defaultAgent } = this.settings.all();
    if (newChat.from === 'preset') {
      const preset = this.presets.all().find((p) => p.name === newChat.preset);
      if (preset) return { ...preset, preset: preset.name };
    }
    const agent = defaultAgent ?? this.lastUsed?.agent ?? DEFAULT_AGENT;
    return this.lastUsed?.agent === agent ? this.lastUsed : { agent, settings: {} };
  }

  /** A blank chat, with the settings given or what new chats begin with. */
  blank(from?: ChatStart): Chat {
    const start = from ?? this.startOf();
    return {
      id: `blank-${this.nextBlank++}`,
      agent: start.agent,
      title: '',
      settings: start.settings,
      status: 'blank',
      entries: [],
      approvals: [],
      queued: [],
      plan: [],
      withdrawn: [],
      copied: [],
      begunAt: Date.now(),
      ...(start.prompt ? { prompt: start.prompt } : {}),
    };
  }

  /** The settings last used, as the layout kept them, without keeping them again. */
  restored(lastUsed: LastUsed | null): void {
    this.lastUsed = lastUsed;
  }

  /** The settings a new chat takes next; MCP servers turned off for one chat stay with it. */
  remember({ agent, settings: { mcpOff: _, ...settings } }: LastUsed): void {
    const lastUsed = { agent, settings };
    this.lastUsed = lastUsed;
    this.bridge.invoke('layout.set', { lastUsed }).catch(() => {});
  }

  /**
   * Tells `handle` each time a blank chat's first message starts it:
   * its local ID, and the chat it is now. Returns a
   * function that stops telling it.
   */
  onBegun(handle: (blankId: string, chat: OpenChat) => void): () => void {
    this.begun.add(handle);
    return () => this.begun.delete(handle);
  }

  /** A blank chat's first message started it. */
  began(blankId: string, chat: OpenChat): void {
    for (const handle of this.begun) handle(blankId, chat);
  }
}
