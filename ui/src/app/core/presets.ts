import { Injectable, inject } from '@angular/core';
import type { AgentId, NewChatSettings, Preset } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from './bridge';
import { type Chapter, Chats } from './chats';
import { modeName } from './modes';
import { PresetList } from './preset-list';

/**
 * Settings saved under a name (ADR-009: Grimoire's own data). A chapter is
 * on a preset while its settings are the preset's; change one and it's on
 * none.
 */
@Injectable({ providedIn: 'root' })
export class Presets {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly chats = inject(Chats);
  private readonly list = inject(PresetList);

  readonly all = this.list.all;

  load(): Promise<void> {
    return this.list.load();
  }

  /** Saves the chapter's settings under a name, spelled out: its folder, model, effort and permission. */
  async save(chapter: Chapter, name: string): Promise<void> {
    const named = name.trim();
    if (!named) return;
    const preset: Preset = {
      name: named,
      agent: chapter.agent,
      settings: this.spelledOut(chapter.agent, chapter.settings),
    };
    try {
      this.all.set(await this.bridge.invoke('presets.save', preset));
    } catch (error) {
      this.chats.fail(chapter.id, error);
    }
  }

  /** The preset the chapter's settings are, if any. */
  of(chapter: Chapter): Preset | undefined {
    const settings = this.spelledOut(chapter.agent, chapter.settings);
    return this.all().find(
      (preset) =>
        preset.agent === chapter.agent && same(this.spelledOut(preset.agent, preset.settings), settings),
    );
  }

  /** Whether a chapter can take the preset: once it has begun, its agent and folder stay. */
  fits(preset: Preset, chapter: Chapter): boolean {
    if (chapter.status === 'blank') return true;
    const folder = (settings: NewChatSettings) => settings.cwd ?? this.chats.folders().home;
    return preset.agent === chapter.agent && folder(preset.settings) === folder(chapter.settings);
  }

  /** Gives the chapter the preset's settings. */
  use(preset: Preset, chapter: Chapter): Promise<void> {
    if (chapter.status === 'blank') {
      this.chats.setUp(chapter.id, preset.agent, preset.settings, preset.prompt);
      return Promise.resolve();
    }
    const { model, effort, mode } = this.spelledOut(preset.agent, preset.settings);
    return this.chats.configure(chapter.id, {
      ...(model ? { model } : {}),
      ...(effort ? { effort } : {}),
      ...(mode ? { mode } : {}),
    });
  }

  /** What the preset begins with, in a few words: "Claude Code · Plan only". */
  describe(preset: Preset): string {
    return `${this.chats.agentName(preset.agent)} · ${modeName(preset.settings.mode)}`;
  }

  /**
   * Settings with the defaults written in: your home folder, the agent's
   * default model, the effort it runs at when known, Ask first.
   */
  private spelledOut(agent: AgentId, settings: NewChatSettings): NewChatSettings {
    const cwd = settings.cwd ?? this.chats.folders().home;
    // On Auto, the model and effort are picked for the first entry.
    if (settings.autoModel)
      return { ...(cwd ? { cwd } : {}), autoModel: true, mode: settings.mode ?? 'ask' };
    const model = settings.model ?? this.chats.models()[agent]?.default;
    const { level: effort } = this.chats.effortOf(agent, { ...settings, ...(model ? { model } : {}) });
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
    a.mode === b.mode &&
    !!a.worktree === !!b.worktree
  );
}
