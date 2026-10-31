/**
 * Checks that the UI styles only through design tokens (ADR-007): outside
 * src/design-system, CSS and inline styles may not contain literal colours,
 * timings, lengths or font names, and every var(--gr-*) must be defined
 * by the theme.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

export const uiSrc = path.resolve(import.meta.dirname, '../src');
export const designSystem = path.join(uiSrc, 'design-system');
export const themeFile = path.join(designSystem, 'themes', 'grimoire.css');

export function filesUnder(dir: string, extensions: string[]): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && extensions.includes(path.extname(entry.name)))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** `property: value` pairs inside the rule blocks of a stylesheet. */
export function cssDeclarations(css: string): Array<[string, string]> {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...withoutComments.matchAll(/\{([^{}]*)\}/g)].flatMap((block) => inlineDeclarations(block[1]!));
}

/** `property: value` pairs in a style attribute. */
export function inlineDeclarations(style: string): Array<[string, string]> {
  return style
    .split(';')
    .map((part) => [part.slice(0, part.indexOf(':')).trim().toLowerCase(), part.slice(part.indexOf(':') + 1).trim()])
    .filter((pair): pair is [string, string] => pair[0] !== '' && pair[1] !== '');
}

/** What's literal in one declaration's value; empty when it uses only tokens. */
export function literalsIn(property: string, value: string): string[] {
  const rest = value.replace(/var\(\s*--[\w-]+\s*\)/g, '');
  const found: string[] = [];
  if (/#[0-9a-f]{3,8}\b/i.test(rest) || /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i.test(rest)) {
    found.push('colour');
  }
  if (/(^|[\s(,])-?\d*\.?\d+m?s\b/.test(rest)) found.push('timing');
  for (const match of rest.matchAll(/(^|[\s(,])-?(\d*\.?\d+)(px|em|rem|ch|vh|vw|vmin|vmax|pt)\b/g)) {
    const amount = Number(match[2]);
    // 0 and 1px hairlines are structural, not design decisions.
    if (amount !== 0 && !(amount === 1 && match[3] === 'px')) found.push(`length ${match[2]}${match[3]}`);
  }
  if (property === 'font-family' && !['', 'inherit'].includes(rest.trim())) found.push('font');
  return found;
}

export function definedTokens(): Set<string> {
  return new Set([...readFileSync(themeFile, 'utf8').matchAll(/(--gr-[\w-]+)\s*:/g)].map((m) => m[1]!));
}

export function usedTokens(source: string): string[] {
  // A name ending in "-" is built at runtime, e.g. var(--gr-drawing-${name}).
  return [...source.matchAll(/var\(\s*(--gr-[\w-]+)/g)].map((m) => m[1]!).filter((name) => !name.endsWith('-'));
}
