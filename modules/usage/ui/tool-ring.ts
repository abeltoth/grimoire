import { Component, computed, inject, input, linkedSignal } from '@angular/core';
import type { UsedTool } from '@grimoire/contract';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { tokenCount } from '@ui/app/core/tokens';
import { type AboutRow, UsageAbout } from './about-tip';
import { type Slice, UsagePie } from './pie-chart';
import { BREAKDOWNS, type Breakdown, groupSlices, toolSlices } from './tool-ring-slices';

/** A tool picked to break down: its slices once read, or why they couldn't be. */
interface Picked {
  tool: string;
  breakdown: Breakdown;
  slices?: Slice[];
  error?: string;
}

const ABOUT: AboutRow[] = [{ text: 'Tokens each tool’s results added to the chats’ context.' }];

/**
 * The context the tools' results added to the chats, as a ring of the
 * tools; picking a command, file or address tool turns it into that tool's
 * calls by command, folder or site.
 */
@Component({
  selector: 'gr-usage-tool-ring',
  imports: [UsageAbout, UsagePie],
  templateUrl: './tool-ring.html',
  styleUrls: ['./usage-lists.css', './tool-ring.css'],
})
export class UsageToolRing {
  private readonly bridge = inject(GRIMOIRE_BRIDGE);

  readonly tools = input.required<readonly UsedTool[]>();
  /** The span's start, to read a tool's calls over it. */
  readonly since = input.required<number>();

  protected readonly about = ABOUT;
  protected readonly count = tokenCount;

  protected readonly slices = computed(() => toolSlices(this.tools()));

  /** The tool broken down; none again over another span or another read. */
  protected readonly picked = linkedSignal<unknown, Picked | null>({
    source: () => [this.tools(), this.since()],
    computation: () => null,
  });

  protected async pick(tool: string): Promise<void> {
    const breakdown = BREAKDOWNS.get(tool);
    if (!breakdown) return;
    const picked: Picked = { tool, breakdown };
    this.picked.set(picked);
    let read: Partial<Picked>;
    try {
      const groups = await this.bridge.invoke('search.toolGroups', { since: this.since(), tool });
      read = { slices: groupSlices(tool, groups) };
    } catch (error) {
      read = { error: error instanceof Error ? error.message : String(error) };
    }
    // Only if it's still the one shown.
    if (this.picked() === picked) this.picked.set({ ...picked, ...read });
  }

  protected back(): void {
    this.picked.set(null);
  }
}
