import {
  Component,
  DestroyRef,
  PendingTasks,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
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
import { FileEditor } from '@ui/app/shell/file-editor';

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

/** An agent that can say what it loads, and what it said. */
interface Told {
  agent: AgentInfo;
  setup: AgentSetup;
}

/** What a piece of the setup costs every chat, in tokens, from which it's flagged as heavy. */
export const HEAVY_TOKENS = 2000;

/** How many other folders are offered, the ones worked in last. */
const OTHER_FOLDERS = 8;

/** A folder to compare by: one kind of slash, no slash at the end, in one case. */
const folderKey = (folder: string) => folder.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

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
 * and permission rules, each with what it costs the context, the costliest
 * first and the heavy ones in rubric.
 */
@Component({
  selector: 'gr-front-matter-page',
  imports: [FileEditor],
  host: { '[class.editing]': 'editing() !== null' },
  templateUrl: './front-matter-page.html',
  styleUrl: './front-matter-page.css',
})
export class FrontMatterPage {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  protected readonly chats = inject(Chats);
  private readonly pending = inject(PendingTasks);

  protected readonly sections = SETUP_SECTIONS;

  /** The folder you picked; the open chapter's until you pick one. */
  private readonly picked = signal<string | undefined>(undefined);
  protected readonly cwd = computed(() => this.picked() ?? this.chats.current()?.settings.cwd);

  /** The folders your chats ran in that a setup can be read in, most recent first. */
  private readonly worked = signal<string[]>([]);
  /** The other folders to turn to: the open chapter's, then those worked in last. */
  protected readonly others = computed(() => {
    const home = this.chats.folders().home;
    const seen = new Set([folderKey(this.cwd() ?? home)]);
    return [this.chats.current()?.settings.cwd ?? home, ...this.worked()]
      .filter((folder) => {
        if (!folder || seen.has(folderKey(folder))) return false;
        seen.add(folderKey(folder));
        return true;
      })
      .slice(0, OTHER_FOLDERS);
  });

  /** What the agents told; undefined until they've answered. */
  protected readonly told = signal<Told[] | undefined>(undefined);
  protected readonly reading = signal(false);
  protected readonly failed = signal<string | null>(null);
  /** The last read asked for, so an earlier answer arriving late is dropped. */
  private asked = 0;
  /** Why a file couldn't be opened. */
  protected readonly trouble = signal<string | null>(null);

  /** The file open to read or change; null while the list shows. */
  protected readonly editing = signal<Editing | null>(null);
  private readonly editor = viewChild(FileEditor);
  /** Whether a file was saved or changed, so the list is read again on the way back to it. */
  private stale = false;

  constructor() {
    // Read once the agents are known, and again for another folder.
    effect(() => {
      const cwd = this.cwd();
      if (this.chats.agents().length) untracked(() => void this.read(cwd));
    });

    void this.loadFolders();

    // A file of the setup shown changed, or a new one appeared: read it again.
    const off = this.bridge.on('agents.setupChanged', ({ cwd }) => this.setupChanged(cwd));
    inject(DestroyRef).onDestroy(off);
  }

  private async loadFolders(): Promise<void> {
    const done = this.pending.add();
    try {
      this.worked.set((await this.bridge.invoke('agents.setupFolders', {})) ?? []);
    } catch {
      // Offer none; another folder can still be picked.
    } finally {
      done();
    }
  }

  protected show(folder: string): void {
    this.picked.set(folder);
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
    } catch (error) {
      this.trouble.set(`It couldn’t be opened: ${message(error)}`);
    } finally {
      done();
    }
  }

  /** Writes the open file of the setup over the file as it was opened. */
  protected readonly writeFile = (file: SetupFile, text: string): Promise<SetupFile> => {
    const edit = this.editing()!;
    return this.bridge.invoke('agents.saveSetupFile', {
      agent: edit.agent,
      ...(edit.cwd ? { cwd: edit.cwd } : {}),
      path: file.path,
      text,
      changedAt: file.changedAt,
    });
  };

  /** Keeps the file as saved, and reads the list again on the way back to it. */
  protected saved(file: SetupFile): void {
    const edit = this.editing();
    if (edit) this.editing.set({ ...edit, file });
    this.stale = true;
  }

  /** Back to the list, once the editor has nothing to save; read again after a save. */
  protected close(): void {
    this.editing.set(null);
    if (this.stale) {
      this.stale = false;
      void this.read();
    }
  }

  /**
   * Reads the list again when it shows the folder that changed. While a
   * file is open it's read again on the way back, and the open file is
   * opened again unless you've changed it.
   */
  private setupChanged(cwd: string): void {
    if (!this.told()?.some((one) => one.setup.cwd === cwd)) return;
    const edit = this.editing();
    if (!edit) {
      void this.read();
      return;
    }
    this.stale = true;
    if (!this.editor()?.changed()) void this.reopen(edit);
  }

  /** Opens the file again, as it is on disk now, while you haven't changed it. */
  private async reopen(edit: Editing): Promise<void> {
    const done = this.pending.add();
    try {
      const file = await this.bridge.invoke('agents.openSetupFile', {
        agent: edit.agent,
        ...(edit.cwd ? { cwd: edit.cwd } : {}),
        path: edit.file.path,
      });
      if (this.editing()?.file.path !== file.path || this.editor()?.changed()) return;
      this.editing.set({ ...edit, file });
    } catch {
      // Keep the file as it was opened; saving says if it changed.
    } finally {
      done();
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

  /** A section's pieces, the costliest first; those the agent gave no cost for keep their order, last. */
  protected byCost(items: readonly SetupItem[]): SetupItem[] {
    return [...items].sort((a, b) => (b.tokens ?? -1) - (a.tokens ?? -1));
  }

  protected heavy(item: SetupItem): boolean {
    return (item.tokens ?? 0) >= HEAVY_TOKENS;
  }

  protected readonly heavyTitle = `Heavy: ${HEAVY_TOKENS.toLocaleString()} tokens or more in every chat`;

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
