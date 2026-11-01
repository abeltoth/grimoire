import { Component, computed, inject } from '@angular/core';
import { Chats } from '../core/chats';

/** The Outline's heading, until the Outline itself is built (phase 7). */
@Component({
  selector: 'gr-outline-placeholder',
  template: `
    <h2>The outline of this chapter</h2>
    <p>{{ agent() }}’s plan, kept up to date as it works</p>
  `,
  styleUrl: './outline-placeholder.css',
})
export class OutlinePlaceholder {
  private readonly chapters = inject(Chats);
  protected readonly agent = computed(() =>
    this.chapters.agentName(this.chapters.current()?.agent ?? 'claude-code'),
  );
}
