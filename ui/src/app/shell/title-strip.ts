import { Component, ElementRef, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { Icon } from '../../design-system/icon';
import { Profiles } from '../core/profiles';
import { Wording } from '../core/wording';
import { Facing } from './facing';
import { WindowControls } from './window-controls';

/**
 * The strip above the book: the profile's name in the middle, which opens
 * a menu of the profiles to switch to, and drawn window controls on
 * Windows. On a Mac the system draws its own buttons in the left corner.
 * The strip drags the window. A refused switch says why under the name.
 */
@Component({
  selector: 'gr-title-strip',
  imports: [Icon, WindowControls],
  templateUrl: './title-strip.html',
  styleUrl: './title-strip.css',
  host: {
    role: 'banner',
    '(document:click)': 'closeOutside($event)',
    '(document:keydown.escape)': 'close()',
  },
})
export class TitleStrip {
  protected readonly profiles = inject(Profiles);
  protected readonly wording = inject(Wording);
  private readonly facing = inject(Facing);
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

  /** Turns the facing page to the Colophon's profiles. */
  protected manage(): void {
    this.open.set(false);
    this.facing.openThumb('colophon');
    afterNextRender(
      () => document.getElementById('gr-colophon-profiles')?.scrollIntoView?.({ block: 'start' }),
      { injector: this.injector },
    );
  }
}
