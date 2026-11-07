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
import { type Chapter, Chats, type Setting, type SettingsPick } from '@ui/app/core/chats';
import { EFFORTS } from '@ui/app/core/efforts';
import { MODES } from '@ui/app/core/modes';
import { Presets } from '@ui/app/core/presets';
import { Wording } from '@ui/app/core/wording';

const RECENT_FOLDERS = 3;

/**
 * One card for all of a chapter's settings, opened from its running head
 * or its ribbon. A blank chapter takes any of them; once the chapter has
 * begun, its agent and folder stay. Esc or a click elsewhere closes it.
 * Its presets set several at once, and "Save these settings as a preset…"
 * names the chapter's settings in place.
 */
@Component({
  selector: 'gr-settings-card',
  imports: [Icon],
  templateUrl: './settings-card.html',
  styleUrls: ['./settings-card.css', './settings-card-presets.css'],
  host: {
    role: 'dialog',
    'aria-labelledby': 'gr-settings-card-heading',
    '[style.--caret.px]': 'caret()',
    '(document:pointerdown)': 'pointerDown($event)',
  },
})
export class SettingsCard {
  readonly chapter = input.required<Chapter>();
  /** The setting it opened on. */
  readonly on = input.required<Setting>();
  /** What the caret points at: the setting in the running head. */
  readonly anchor = input<HTMLElement>();

  protected readonly chats = inject(Chats);
  protected readonly presets = inject(Presets);
  protected readonly wording = inject(Wording);
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly injector = inject(Injector);
  private readonly nameField = viewChild<ElementRef<HTMLInputElement>>('presetName');
  private readonly saveButton = viewChild<ElementRef<HTMLButtonElement>>('saveButton');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly modes = MODES;
  protected readonly caret = signal(0);

  protected readonly begun = computed(() => this.chapter().status !== 'blank');
  /** The preset the chapter is on, if any. */
  protected readonly preset = computed(() => this.presets.of(this.chapter()));
  /** Whether a preset is being named; never on a chapter you've just opened the card for. */
  protected readonly naming = linkedSignal({
    source: () => this.chapter().id,
    computation: () => false,
  });
  protected readonly agentName = computed(() => this.chats.agentName(this.chapter().agent));
  protected readonly models = computed(() => this.chats.models()[this.chapter().agent]);
  /** On Auto, before the first entry: the model and effort are still to be picked. */
  protected readonly auto = computed(() => !this.begun() && !!this.chapter().settings.autoModel);
  /** On Auto, once begun: the model was picked for the first entry. */
  protected readonly autoPicked = computed(
    () => this.begun() && !!this.chapter().settings.autoModel,
  );
  protected readonly selectedModel = computed(() =>
    this.auto() ? undefined : (this.chapter().settings.model ?? this.models()?.default),
  );
  protected readonly modelName = computed(() =>
    this.auto()
      ? 'Auto'
      : this.chats.modelName(this.chapter().agent, this.chapter().settings.model),
  );
  /** The levels the chapter's model takes, and the one it runs at. */
  protected readonly effort = computed(() => {
    const { levels, level } = this.chats.effortOf(this.chapter().agent, this.chapter().settings);
    return { efforts: EFFORTS.filter((e) => levels.includes(e.level)), level };
  });
  protected readonly folder = computed(
    () => this.chapter().settings.cwd ?? this.chats.folders().home,
  );
  /** The chapter's folder first, then the others used last. */
  protected readonly folders = computed(() => {
    const current = this.folder();
    const others = this.chats.folders().recent.filter((cwd) => cwd !== current);
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
    void this.chats.configure(this.chapter().id, pick);
  }

  protected usePreset(preset: Preset): void {
    if (this.presets.fits(preset, this.chapter())) void this.presets.use(preset, this.chapter());
  }

  /** Saves the settings under the name written; an empty name saves nothing. */
  protected savePreset(field: HTMLInputElement): void {
    this.naming.set(false);
    void this.presets.save(this.chapter(), field.value);
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
    this.chats.closeSettings();
  }
}
