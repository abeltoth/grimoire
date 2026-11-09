import type { EffortLevel } from '@grimoire/contract';

/** The effort levels, as the settings card and the page header name them. */
export const EFFORTS: readonly { level: EffortLevel; label: string; detail: string }[] = [
  { level: 'low', label: 'Low', detail: 'Quick, with little thinking' },
  { level: 'medium', label: 'Medium', detail: 'Balanced thinking and speed' },
  { level: 'high', label: 'High', detail: 'Thorough thinking' },
  { level: 'xhigh', label: 'Extra high', detail: 'Deeper than high, short of max' },
  { level: 'max', label: 'Max', detail: 'The deepest thinking, and the most usage' },
];

/** "Extra high effort", or "Default effort" when the level isn't known. */
export function effortName(level: EffortLevel | undefined): string {
  const label = EFFORTS.find((e) => e.level === level)?.label;
  return label ? `${label} effort` : 'Default effort';
}
