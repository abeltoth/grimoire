import {
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import type { ApprovalMode } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { type Chapter, Chats, type Setting, type SettingsPick } from '@ui/app/core/chats';

/** The permission modes, as the card and the running head name them. */
export const MODES: readonly { mode: ApprovalMode; label: string; detail: string }[] = [
  { mode: 'ask', label: 'Ask first', detail: 'Asks before edits and commands' },
  { mode: 'accept-edits', label: 'Accept edits', detail: 'Edits files, asks before commands' },
  { mode: 'plan', label: 'Plan only', detail: 'Reads and plans, changes nothing' },
  { mode: 'allow-all', label: 'Full access', detail: 'Edits and runs without asking' },
];

const RECENT_FOLDERS = 3;

/**
 * One card for all of a chapter's settings, opened from its running head
 * or its ribbon. A blank chapter takes any of them; once the chapter has
 * begun, its agent and folder stay. Esc or a click elsewhere closes it.
 */
@Component({
  selector: 'gr-settings-card',
  imports: [Icon],
  templateUrl: './settings-card.html',
  styleUrl: './settings-card.css',
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
  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  protected readonly modes = MODES;
  protected readonly caret = signal(0);

  protected readonly begun = computed(() => this.chapter().status !== 'blank');
  protected readonly agentName = computed(() => this.chats.agentName(this.chapter().agent));
  protected readonly models = computed(() => this.chats.models()[this.chapter().agent]);
  protected readonly selectedModel = computed(
    () => this.chapter().settings.model ?? this.models()?.default,
  );
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
