import { Component, computed, inject } from '@angular/core';
import { GRIMOIRE_BRIDGE } from '../core/bridge';
import { ShellRegistry } from './shell-registry';
import { ShortcutPipe } from './shortcut';

/**
 * The thumb index: tabs cut into the right-hand page block, one per
 * registered page, and the gilt Index tab at the bottom.
 */
@Component({
  selector: 'gr-thumb-index',
  imports: [ShortcutPipe],
  templateUrl: './thumb-index.html',
  styleUrl: './thumb-index.css',
  host: { role: 'navigation', 'aria-label': 'Thumb index' },
})
export class ThumbIndex {
  protected readonly registry = inject(ShellRegistry);
  protected readonly platform = inject(GRIMOIRE_BRIDGE).platform;
  protected readonly index = computed(() => this.registry.commands.get('shell.index'));
}
