import type { ThemeName } from '@grimoire/contract';

/** A ready-made theme, to choose in Settings. */
export interface ThemeChoice {
  name: ThemeName | 'auto';
  label: string;
  /** What it looks like, in a few words. */
  note: string;
}

/** The ready-made themes in the order they are offered; "auto" follows the system's light or dark. */
export const THEME_CHOICES: readonly ThemeChoice[] = [
  { name: 'grimoire', label: 'Grimoire', note: 'The book as drawn' },
  { name: 'night', label: 'Night', note: 'Dark paper, cream ink' },
  { name: 'sepia', label: 'Sepia', note: 'Aged paper, brown ink' },
  { name: 'contrast', label: 'High contrast', note: 'Black on white' },
  { name: 'auto', label: 'Automatic', note: 'Night after dark, else Grimoire' },
];

/** The theme files, each read as text when asked for. */
export const THEME_FILES: Record<ThemeName, () => Promise<string>> = {
  grimoire: () =>
    import('@ui/design-system/themes/grimoire.css', { with: { loader: 'text' } }).then(
      (file) => file.default,
    ),
  night: () =>
    import('@ui/design-system/themes/night.css', { with: { loader: 'text' } }).then(
      (file) => file.default,
    ),
  sepia: () =>
    import('@ui/design-system/themes/sepia.css', { with: { loader: 'text' } }).then(
      (file) => file.default,
    ),
  contrast: () =>
    import('@ui/design-system/themes/contrast.css', { with: { loader: 'text' } }).then(
      (file) => file.default,
    ),
};

/** The tokens a theme file sets, by name; for a theme over the book as drawn, only those it changes. */
export function tokenValues(css: string): Record<string, string> {
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const values: Record<string, string> = {};
  for (const match of body.matchAll(/^\s*(--gr-[a-z0-9-]+)\s*:\s*(.+?);\s*$/gm)) {
    values[match[1]!] = match[2]!;
  }
  return values;
}

/** One of the theme's tokens, as the theme draws it. */
export interface Token {
  name: string;
  value: string;
  /** What the theme says about it, when it says something. */
  note?: string;
}

/** The tokens under one of the theme's headings, such as "Paper" or "Chat: composer". */
export interface TokenGroup {
  title: string;
  tokens: Token[];
}

/** The tokens Settings puts first: the book's main colours, and the size of its text. */
export const MAIN_TOKENS: readonly { name: string; label: string; plainLabel?: string }[] = [
  { name: '--gr-desk', label: 'Desk', plainLabel: 'Background' },
  { name: '--gr-cover', label: 'Cover' },
  { name: '--gr-page', label: 'Paper' },
  { name: '--gr-ink', label: 'Ink' },
  { name: '--gr-ink-soft', label: 'Soft ink' },
  { name: '--gr-rubric', label: 'Rubric', plainLabel: 'Red' },
  { name: '--gr-pen', label: 'Pen', plainLabel: 'Your writing' },
  { name: '--gr-lapis', label: 'Lapis', plainLabel: 'Links' },
  { name: '--gr-gilt', label: 'Gilt', plainLabel: 'Gold' },
];

export const TEXT_SIZE = '--gr-size-text';
/** How small and large the text may be set, in px. */
export const TEXT_SIZES = { min: 13, max: 24 } as const;

export const TEXT_FONT = '--gr-font-text';

/** A face to set the text in; the book's own when it changes nothing. */
export interface TextFont {
  name: 'book' | 'sans' | 'serif' | 'mono';
  label: string;
  plainLabel?: string;
  /** What it sets --gr-font-text to: faces the system has, so none need loading. */
  value: string | null;
}

/** The faces the text may be set in, in the order they are offered. */
export const TEXT_FONTS: readonly TextFont[] = [
  { name: 'book', label: 'The book’s', plainLabel: 'Default', value: null },
  {
    name: 'sans',
    label: 'Sans-serif',
    value: "system-ui, 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  },
  { name: 'serif', label: 'Serif', value: "Georgia, Cambria, 'Times New Roman', serif" },
  {
    name: 'mono',
    label: 'Monospace',
    value: "ui-monospace, 'Cascadia Mono', Consolas, Menlo, monospace",
  },
];

/** The face your changes set the text in; null for one of your own. */
export function textFontOf(changes: Readonly<Record<string, string>>): TextFont['name'] | null {
  const value = changes[TEXT_FONT] ?? null;
  return TEXT_FONTS.find((font) => font.value === value)?.name ?? null;
}

/** How closely the pages are set: the space scale, the leading, and the margins, closer or wider. */
export interface Density {
  name: 'compact' | 'normal' | 'roomy';
  label: string;
  /** What it changes; Normal is the book as drawn, and changes nothing. */
  tokens: Readonly<Record<string, string>>;
}

/** The densities, in the order they are offered: about three quarters and five quarters of Normal. */
export const DENSITIES: readonly Density[] = [
  {
    name: 'compact',
    label: 'Compact',
    tokens: {
      '--gr-space-1': '3px',
      '--gr-space-2': '6px',
      '--gr-space-3': '9px',
      '--gr-space-4': '12px',
      '--gr-space-5': '18px',
      '--gr-space-6': '24px',
      '--gr-space-7': '36px',
      '--gr-leading-text': '1.36',
      '--gr-leading-entry': '1.3',
      '--gr-block-gap': '6px',
      '--gr-list-gap': '3px',
      '--gr-col-gap': '21px',
      '--gr-page-margin-outer': '36px',
      '--gr-page-margin-inner': '30px',
    },
  },
  { name: 'normal', label: 'Normal', tokens: {} },
  {
    name: 'roomy',
    label: 'Roomy',
    tokens: {
      '--gr-space-1': '5px',
      '--gr-space-2': '10px',
      '--gr-space-3': '15px',
      '--gr-space-4': '20px',
      '--gr-space-5': '30px',
      '--gr-space-6': '40px',
      '--gr-space-7': '60px',
      '--gr-leading-text': '1.6',
      '--gr-leading-entry': '1.54',
      '--gr-block-gap': '10px',
      '--gr-list-gap': '5px',
      '--gr-col-gap': '35px',
      '--gr-page-margin-outer': '60px',
      '--gr-page-margin-inner': '50px',
    },
  },
];

/** Every token a density sets. */
export const DENSITY_TOKENS: readonly string[] = [
  ...new Set(DENSITIES.flatMap((density) => Object.keys(density.tokens))),
];

/** The density your changes make; null when they set its tokens some other way. */
export function densityOf(changes: Readonly<Record<string, string>>): Density['name'] | null {
  return (
    DENSITIES.find((density) =>
      DENSITY_TOKENS.every((token) => changes[token] === density.tokens[token]),
    )?.name ?? null
  );
}

/** Your changes with a density set in place of the one before; your other changes stay. */
export function withDensity(
  changes: Readonly<Record<string, string>>,
  density: Density,
): Record<string, string> {
  const rest = Object.fromEntries(
    Object.entries(changes).filter(([token]) => !DENSITY_TOKENS.includes(token)),
  );
  return { ...rest, ...density.tokens };
}

/**
 * The theme's tokens under its headings, read from the theme file: a
 * comment after a blank line heads the tokens below it; one right after a
 * token is a note on the next.
 */
export function tokenGroups(css: string): TokenGroup[] {
  const start = css.indexOf(':root');
  const body = css.slice(css.indexOf('{', start) + 1, css.lastIndexOf('}'));
  const groups: TokenGroup[] = [];
  let blank = true;
  let note: string | undefined;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    const comment = /^\/\*\s*(.*?)\s*\*\/$/.exec(line);
    const token = /^(--gr-[a-z0-9-]+)\s*:\s*(.+?);$/.exec(line);
    if (!line) {
      blank = true;
    } else if (comment) {
      if (blank || !groups.length) groups.push({ title: comment[1]!, tokens: [] });
      else note = comment[1]!;
      blank = false;
    } else if (token) {
      const group = groups.at(-1) ?? (groups[0] = { title: 'Tokens', tokens: [] });
      group.tokens.push({ name: token[1]!, value: token[2]!, ...(note ? { note } : {}) });
      note = undefined;
      blank = false;
    }
  }
  return groups.filter((group) => group.tokens.length);
}

/**
 * The groups with the tokens whose name or value holds what you looked
 * up, ignoring case; every group for nothing.
 */
export function lookUpTokens(groups: readonly TokenGroup[], lookUp: string): TokenGroup[] {
  const needle = lookUp.trim().toLowerCase();
  if (!needle) return [...groups];
  return groups
    .map((group) => ({
      ...group,
      tokens: group.title.toLowerCase().includes(needle)
        ? group.tokens
        : group.tokens.filter(
            (token) => token.name.includes(needle) || token.value.toLowerCase().includes(needle),
          ),
    }))
    .filter((group) => group.tokens.length);
}

/** A value as a colour picker takes it, "#rrggbb"; null when it isn't one. */
export function hexOf(value: string): string | null {
  const hex = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(hex)) return hex;
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(hex);
  return short ? `#${short[1]!.repeat(2)}${short[2]!.repeat(2)}${short[3]!.repeat(2)}` : null;
}

/** Whether a value draws a colour, so it can be shown as a swatch. */
export function isColour(value: string): boolean {
  return /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\()/i.test(value.trim());
}

/** A size in px as a number, such as 17 for "17px"; null for any other value. */
export function pxOf(value: string): number | null {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(value.trim());
  return px ? Number(px[1]) : null;
}
