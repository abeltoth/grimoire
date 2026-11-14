import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  afterRenderEffect,
  computed,
  inject,
  input,
  linkedSignal,
  signal,
  viewChild,
} from '@angular/core';
import type { Preset } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { type Chat, type Setting, type SettingsPick } from '@ui/app/core/chat';
import { ChatList } from '@ui/app/core/chat-list';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { ChatActions } from '@ui/app/core/chat-actions';
import { EFFORTS } from '@ui/app/core/efforts';
import { MODES } from '@ui/app/core/modes';
import { Presets } from '@ui/app/core/presets';
import { Wording } from '@ui/app/core/wording';
import { McpPicker } from './mcp-picker';

const RECENT_FOLDERS = 3;

/**
 * One card for all of a chat's settings, opened from its page header
 * or its chat tab. A blank chat takes any of them; once the chat has
 * begun, its agent and folder stay. Esc or a click elsewhere closes it.
 * Its presets set several at once, and "Save these settings as a preset…"
 * names the chat's settings in place. Its folder's MCP servers are
 * summed up in a line under the columns, opening their list.
 */
@Component({
  selector: 'gr-settings-card',
  imports: [Icon, McpPicker],
  templateUrl: './settings-card.html',
  styleUrls: ['./settings-card.css', './settings-card-choices.css', './settings-card-presets.css'],
  host: {
    role: 'dialog',
    'aria-labelledby': 'gr-settings-card-heading',
    '[style.--caret.px]': 'caret()',
    '(document:pointerdown)': 'pointerDown($event)',
  },
})
export class SettingsCard {
  readonly chat = input.required<Chat>();
  /** The setting it opened on. */
  readonly on = input.required<Setting>();
  /** What the caret points at: the setting in the page header. */
  readonly anchor = input<HTMLElement>();

  protected readonly list = inject(ChatList);
  protected readonly catalog = inject(AgentCatalog);
  protected readonly actions = inject(ChatActions);
  protected readonly presets = inject(Presets);
  protected readonly wording = inject(Wording);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly injector = inject(Injector);
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('presetName');
  private readonly saveButton = viewChild<ElementRef<HTMLButtonElement>>('saveButton');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly modes = MODES;
  protected readonly caret = signal(0);

  protected readonly begun = computed(() => this.chat().status !== 'blank');
  /** The preset the chat is on, if any. */
  protected readonly preset = computed(() => this.presets.of(this.chat()));
  /** Whether a preset is being named; never on a chat you've just opened the card for. */
  protected readonly naming = linkedSignal({
    source: () => this.chat().id,
    computation: () => false,
  });
  protected readonly agentName = computed(() => this.catalog.agentName(this.chat().agent));
  protected readonly models = computed(() => this.catalog.models()[this.chat().agent]);
  /** On Auto, before the first message: the model and effort are still to be picked. */
  protected readonly auto = computed(() => !this.begun() && !!this.chat().settings.autoModel);
  /** On Auto, once begun: the model was picked for the first message. */
  protected readonly autoPicked = computed(() => this.begun() && !!this.chat().settings.autoModel);
  protected readonly selectedModel = computed(() =>
    this.auto() ? undefined : (this.chat().settings.model ?? this.models()?.default),
  );
  protected readonly modelName = computed(() =>
    this.auto() ? 'Auto' : this.catalog.modelName(this.chat().agent, this.chat().settings.model),
  );
  /** The levels the chat's model takes, and the one it runs at. */
  protected readonly effort = computed(() => {
    const { levels, level } = this.catalog.effortOf(this.chat().agent, this.chat().settings);
    return { efforts: EFFORTS.filter((e) => levels.includes(e.level)), level };
  });
  protected readonly folder = computed(
    () => this.chat().settings.cwd ?? this.catalog.folders().home,
  );
  /** The chat's folder first, then the others used last. */
  protected readonly folders = computed(() => {
    const current = this.folder();
    const others = this.catalog.folders().recent.filter((cwd) => cwd !== current);
    return [...(current ? [current] : []), ...others].slice(0, RECENT_FOLDERS);
  });

  constructor() {
    void this.presets.load();
    afterRenderEffect(() => this.nameField()?.nativeElement.focus());
    afterRenderEffect(() => {
      const anchor = this.anchor();
      if (!anchor) return;
      const at = anchor.getBoundingClientRect();
      this.caret.set(at.left + at.width / 2 - this.host.getBoundingClientRect().left);
    });
    afterRenderEffect({
      // Focus moves into the card, onto the setting it opened on.
      write: () => {
        if (this.host.contains(document.activeElement)) return;
        const column = this.host.querySelector(`[data-setting="${this.on()}"]`);
        const target =
          column?.querySelector<HTMLElement>('[aria-checked="true"]:not([aria-disabled])') ??
          column?.querySelector<HTMLElement>('button:not([aria-disabled])');
        target?.focus();
      },
    });
  }

  protected pick(pick: SettingsPick): void {
    void this.actions.configure(this.chat().id, pick);
  }

  protected usePreset(preset: Preset): void {
    if (this.presets.fits(preset, this.chat())) void this.presets.use(preset, this.chat());
  }

  /** Saves the settings under the name written; an empty name saves nothing. */
  protected savePreset(field: HTMLInputElement): void {
    this.naming.set(false);
    void this.presets.save(this.chat(), field.value);
    this.focusSave();
  }

  protected cancelNaming(event: Event): void {
    // Esc puts the name away; the card stays open.
    event.preventDefault();
    this.naming.set(false);
    this.focusSave();
  }

  private focusSave(): void {
    afterNextRender(() => this.saveButton()?.nativeElement.focus(), { injector: this.injector });
  }

  protected async chooseFolder(): Promise<void> {
    const cwd = await this.bridge.chooseFolder().catch(() => null);
    if (cwd) this.pick({ cwd });
  }

  protected pointerDown(event: PointerEvent): void {
    const target = event.target as Node | null;
    if (!target || this.host.contains(target) || this.anchor()?.contains(target)) return;
    this.list.closeSettings();
  }
}
