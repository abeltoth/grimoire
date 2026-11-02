import type { ApprovalMode } from '@grimoire/contract';

/** The permission modes, as the settings card, the running head and presets name them. */
export const MODES: readonly { mode: ApprovalMode; label: string; detail: string }[] = [
  { mode: 'ask', label: 'Ask first', detail: 'Asks before edits and commands' },
  { mode: 'accept-edits', label: 'Accept edits', detail: 'Edits files, asks before commands' },
  { mode: 'plan', label: 'Plan only', detail: 'Reads and plans, changes nothing' },
  { mode: 'allow-all', label: 'Full access', detail: 'Edits and runs without asking' },
];

export function modeName(mode: ApprovalMode | undefined): string {
  const named = mode ?? 'ask';
  return MODES.find((m) => m.mode === named)?.label ?? named;
}
