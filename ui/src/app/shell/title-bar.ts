import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Icon } from '../../design-system/icon';
import { Profiles } from '../core/profiles';
import { Wording } from '../core/wording';
import { RightPageState } from './right-page-state';
import { WindowControls } from './window-controls';

/**
 * The strip above the book: the profile's name in the middle, which opens
 * a menu of the profiles to switch to, and drawn window controls on
 * Windows. On a Mac the system draws its own buttons in the left corner.
 * The strip drags the window. A refused switch says why under the name.
 */
@Component({
  selector: 'gr-title-bar',
  imports: [Icon, WindowControls],
  templateUrl: './title-bar.html',
  styleUrl: './title-bar.css',
  host: {
    role: 'banner',
    '(document:click)': 'closeOutside($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class TitleBar {
  protected readonly profiles = inject(Profiles);
  protected readonly wording = inject(Wording);
  private readonly rightPage = inject(RightPageState);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** Whether the menu of profiles is open. */
  protected readonly open = signal(false);

  protected readonly name = computed(() => this.profiles.active()?.name ?? '');
  protected readonly label = computed(() =>
    this.wording.say(
      `Volume: ${this.name()}. Open another volume`,
      `Profile: ${this.name()}. Switch profile`,
    ),
  );

  protected toggle(): void {
    this.open.update((open) => !open);
  }

  protected close(): void {
    this.open.set(false);
  }

  protected closeOutside(event: Event): void {
    if (!this.host.contains(event.target as Node)) this.open.set(false);
  }

  /** Switches to the profile picked; a refusal shows under the name. */
  protected async pick(id: string): Promise<void> {
    this.open.set(false);
    await this.profiles.switch(id);
  }

  /** Turns the right page to the profiles in Settings. */
  protected manage(): void {
    this.open.set(false);
    this.rightPage.openPageTab('settings');
    afterNextRender(
      () => document.getElementById('gr-settings-profiles')?.scrollIntoView?.({ block: 'start' }),
      { injector: this.injector },
    );
  }
}
