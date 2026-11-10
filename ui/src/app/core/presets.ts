import { Injectable, inject } from '@angular/core';
import type { AgentId, NewChatSettings, Preset } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';
import { type Chat } from './chat';
import { ChatList } from './chat-list';
import { AgentCatalog } from './agent-catalog';
import { ChatActions } from './chat-actions';
import { modeName } from './modes';
import { PresetList } from './preset-list';

/**
 * Settings saved under a name (ADR-009: Grimoire's own data). A chat is
 * on a preset while its settings are the preset's; change one and it's on
 * none.
 */
@Injectable({ providedIn: 'root' })
export class Presets {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chatList = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  private readonly actions = inject(ChatActions);
  private readonly list = inject(PresetList);

  readonly all = this.list.all;

  load(): Promise<void> {
    return this.list.load();
  }

  /** Saves the chat's settings under a name, spelled out: its folder, model, effort and permission. */
  async save(chat: Chat, name: string): Promise<void> {
    const named = name.trim();
    if (!named) return;
    const preset: Preset = {
      name: named,
      agent: chat.agent,
      settings: this.spelledOut(chat.agent, chat.settings),
    };
    try {
      this.all.set(await this.bridge.invoke('presets.save', preset));
    } catch (error) {
      this.chatList.fail(chat.id, error);
    }
  }

  /** The preset the chat's settings are, if any. */
  of(chat: Chat): Preset | undefined {
    const settings = this.spelledOut(chat.agent, chat.settings);
    return this.all().find(
      (preset) =>
        preset.agent === chat.agent &&
        same(this.spelledOut(preset.agent, preset.settings), settings),
    );
  }

  /** Whether a chat can take the preset: once it has begun, its agent and folder stay. */
  fits(preset: Preset, chat: Chat): boolean {
    if (chat.status === 'blank') return true;
    const folder = (settings: NewChatSettings) => settings.cwd ?? this.catalog.folders().home;
    return preset.agent === chat.agent && folder(preset.settings) === folder(chat.settings);
  }

  /** Gives the chat the preset's settings. */
  use(preset: Preset, chat: Chat): Promise<void> {
    if (chat.status === 'blank') {
      this.actions.setUp(chat.id, preset.agent, preset.settings, preset.prompt);
      return Promise.resolve();
    }
    const { model, effort, mode } = this.spelledOut(preset.agent, preset.settings);
    return this.actions.configure(chat.id, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(mode ? { mode } : {}),
    });
  }

  /** What the preset begins with, in a few words: "Claude Code · Plan only". */
  describe(preset: Preset): string {
    return `${this.catalog.agentName(preset.agent)} · ${modeName(preset.settings.mode)}`;
  }

  /**
   * Settings with the defaults written in: your home folder, the agent's
   * default model, the effort it runs at when known, Ask first.
   */
  private spelledOut(agent: AgentId, settings: NewChatSettings): NewChatSettings {
    const cwd = settings.cwd ?? this.catalog.folders().home;
    // On Auto, the model and effort are picked for the first message.
    if (settings.autoModel)
      return { ...(cwd ? { cwd } : {}), autoModel: true, mode: settings.mode ?? 'ask' };
    const model = settings.model ?? this.catalog.models()[agent]?.default;
    const { level: effort } = this.catalog.effortOf(agent, {
      ...settings,
      ...(model ? { model } : {}),
    });
    return {
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      mode: settings.mode ?? 'ask',
    };
  }
}

function same(a: NewChatSettings, b: NewChatSettings): boolean {
  return (
    a.cwd === b.cwd &&
    !!a.autoModel === !!b.autoModel &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.mode === b.mode
  );
}
