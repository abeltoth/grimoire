import {
  Component,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  type AgentId,
  type AgentInfo,
  type AgentSetup,
  SETUP_SECTIONS,
  type SetupFile,
  type SetupItem,
  type SetupSection,
  type SetupSource,
} from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { Chats } from '@ui/app/core/chats';
import { type Shortcut, ShortcutPipe, matchesShortcut } from '@ui/app/shell/shortcut';

/** A file of the setup, open to read or change. */
interface Editing {
  agent: AgentId;
  cwd: string | undefined;
  file: SetupFile;
  source: SetupSource;
  /** Whose it is, such as "Yours" or a plugin's name. */
  from: string;
}

/** Why a file can only be read here, by whose it is. */
const READ_ONLY: Partial<Record<SetupSource, string>> = {
  managed: 'Your organization’s settings, only to read here.',
  plugin:
    'It comes with its plugin, which would put it back when it updates, so it’s only to read here.',
};

const SAVE: Shortcut = 'Mod+S';

/** An agent that can say what it loads, and what it said. */
interface Told {
  agent: AgentInfo;
  setup: AgentSetup;
}

const SECTION_NAMES: Record<SetupSection, string> = {
  memory: 'Memory',
  skills: 'Skills',
  agents: 'Subagents',
  commands: 'Commands',
  hooks: 'Hooks',
  mcpServers: 'MCP servers',
  plugins: 'Plugins',
  permissions: 'Permissions',
};

const SOURCE_NAMES: Record<SetupSource, string> = {
  user: 'Yours',
  project: 'Project',
  local: 'Yours, here',
  managed: 'Managed',
  plugin: 'Plugin',
  account: 'Claude account',
  'built-in': 'Built in',
};

/**
 * The Front matter: everything an agent loads when it works in a folder,
 * the open chapter's until you pick another, and where each piece comes
 * from: memory, skills, subagents, commands, hooks, MCP servers, plugins
 * and permission rules, each with what it costs the context.
 */
@Component({
  selector: 'gr-front-matter-page',
  imports: [ShortcutPipe],
  host: { '[class.editing]': 'editing() !== null' },
  templateUrl: './front-matter-page.html',
  styleUrl: './front-matter-page.css',
})
export class FrontMatterPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  private readonly pending = inject(PendingTasks);
  private readonly platform = this.bridge.platform;

  protected readonly sections = SETUP_SECTIONS;

  /** The folder you picked; the open chapter's until you pick one. */
  private readonly picked = signal<string | undefined>(undefined);
  protected readonly cwd = computed(() => this.picked() ?? this.chats.current()?.settings.cwd);

  /** What the agents told; undefined until they've answered. */
  protected readonly told = signal<Told[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);
  /** The last read asked for, so an earlier answer arriving late is dropped. */
  private asked = 0;
  /** Why a file couldn't be opened. */
  protected readonly trouble = signal<string | null>(null);

  protected readonly save = SAVE;
  /** The file open to read or change; null while the list shows. */
  protected readonly editing = signal<Editing | null>(null);
  /** The file's text as you're changing it. */
  protected readonly draft = signal('');
  protected readonly changed = computed(() => {
    const edit = this.editing();
    return !!edit && this.draft() !== edit.file.text;
  });
  protected readonly saving = signal(false);
  /** What came of the last save, or why the list can't be shown yet. */
  protected readonly note = signal<{ text: string; alert?: boolean } | null>(null);
  /** Whether a file was saved, so the list is read again on the way back to it. */
  private saved = false;

  constructor() {
    // Read once the agents are known, and again for another folder.
    effect(() => {
      const cwd = this.cwd();
      if (this.chats.agents().length) untracked(() => void this.read(cwd));
    });
  }

  protected async read(cwd = this.cwd()): Promise<void> {
    const ask = ++this.asked;
    this.reading.set(true);
    const done = this.pending.add();
    this.failed.set(null);
    try {
      const agents = this.chats.agents();
      const answers = await Promise.all(
        agents.map((agent) =>
          this.bridge.invoke('agents.setup', { agent: agent.id, ...(cwd ? { cwd } : {}) }),
        ),
      );
      if (ask !== this.asked) return;
      this.told.set(
        agents.flatMap((agent, i) => {
          const setup = answers[i];
          return setup ? [{ agent, setup }] : [];
        }),
      );
    } catch (error) {
      if (ask === this.asked) this.failed.set(message(error));
    } finally {
      if (ask === this.asked) this.reading.set(false);
      done();
    }
  }

  /** Opens a file of the setup to read or change, in place of the list. */
  protected async open(
    agent: AgentInfo,
    item: { path?: string; source: SetupSource; plugin?: string },
  ): Promise<void> {
    if (!item.path) return;
    const cwd = this.cwd();
    const done = this.pending.add();
    this.trouble.set(null);
    try {
      const file = await this.bridge.invoke('agents.openSetupFile', {
        agent: agent.id,
        ...(cwd ? { cwd } : {}),
        path: item.path,
      });
      this.editing.set({ agent: agent.id, cwd, file, source: item.source, from: this.from(item) });
      this.draft.set(file.text);
      this.note.set(null);
    } catch (error) {
      this.trouble.set(`It couldn’t be opened: ${message(error)}`);
    } finally {
      done();
    }
  }

  protected async write(): Promise<void> {
    const edit = this.editing();
    if (!edit?.file.editable || this.saving()) return;
    this.saving.set(true);
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('agents.saveSetupFile', {
        agent: edit.agent,
        ...(edit.cwd ? { cwd: edit.cwd } : {}),
        path: edit.file.path,
        text: this.draft(),
        changedAt: edit.file.changedAt,
      });
      this.editing.set({ ...edit, file });
      this.saved = true;
      this.note.set({ text: 'Saved. Chats begun from now on load it.' });
    } catch (error) {
      this.note.set({ text: message(error), alert: true });
    } finally {
      this.saving.set(false);
      done();
    }
  }

  protected discard(): void {
    const edit = this.editing();
    if (edit) this.draft.set(edit.file.text);
    this.note.set(null);
  }

  /** Back to the list, unless there are changes to save or discard first; read again after a save. */
  protected close(): void {
    if (this.changed()) {
      this.note.set({ text: 'Save your changes, or discard them, first.', alert: true });
      return;
    }
    this.editing.set(null);
    this.note.set(null);
    if (this.saved) {
      this.saved = false;
      void this.read();
    }
  }

  /** Ctrl+S saves; Esc turns back to the list, not away from the Front matter. */
  protected key(event: KeyboardEvent): void {
    if (matchesShortcut(event, SAVE, this.platform)) {
      event.preventDefault();
      void this.write();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.close();
    }
  }

  /** Why the open file can only be read here; null when it can be changed. */
  protected readOnly(edit: Editing): string | null {
    return edit.file.editable ? null : (READ_ONLY[edit.source] ?? 'It’s only to read here.');
  }

  protected async pickFolder(): Promise<void> {
    const folder = await this.bridge.chooseFolder();
    if (folder) this.picked.set(folder);
  }

  protected name(section: SetupSection): string {
    return SECTION_NAMES[section];
  }

  /** Where it comes from: the plugin that brings it, or whose it is. */
  protected from(item: { source: SetupSource; plugin?: string }): string {
    return item.plugin ?? SOURCE_NAMES[item.source];
  }

  /** What the items cost the context in all, such as "6,481 tokens"; empty when the agent didn't say. */
  protected cost(items: readonly SetupItem[]): string {
    const tokens = items.reduce((sum, item) => sum + (item.tokens ?? 0), 0);
    return tokens ? this.tokens(tokens) : '';
  }

  protected tokens(count: number | undefined): string {
    return count ? `${count.toLocaleString()} ${count === 1 ? 'token' : 'tokens'}` : '';
  }

  protected time(at: number): string {
    return new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
