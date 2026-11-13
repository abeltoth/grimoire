// Loaded on first use, so Shiki stays out of the first bundle; each
// language is its own chunk, loaded when a listing first needs it.
import { createHighlighterCore, type HighlighterCore, type ThemeRegistration } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { bundledLanguages } from 'shiki/langs';

export const THEME = 'grimoire';

/** The design's code colours: keywords in rubric, strings in verdigris, types in lapis. */
const theme: ThemeRegistration = {
  name: THEME,
  type: 'light',
  colors: {
    'editor.foreground': 'var(--gr-code-text)',
    'editor.background': 'transparent',
  },
  tokenColors: [
    {
      scope: ['keyword', 'storage', 'variable.language', 'constant.language'],
      settings: { foreground: 'var(--gr-code-keyword)' },
    },
    {
      scope: ['keyword.operator', 'punctuation', 'meta.brace'],
      settings: { foreground: 'var(--gr-code-text)' },
    },
    {
      scope: ['string', 'string.template', 'punctuation.definition.string'],
      settings: { foreground: 'var(--gr-code-string)' },
    },
    {
      scope: ['comment', 'punctuation.definition.comment'],
      settings: { foreground: 'var(--gr-code-comment)', fontStyle: 'italic' },
    },
    {
      scope: [
        'entity.name.type',
        'entity.name.class',
        'entity.other.inherited-class',
        'support.type',
        'support.class',
      ],
      settings: { foreground: 'var(--gr-code-type)' },
    },
  ],
};

export function createHighlighter(): Promise<HighlighterCore> {
  return createHighlighterCore({
    themes: [theme],
    langs: [],
    // Skips the few patterns JavaScript regexes can't run, instead of failing.
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  });
}

/** Loads a language by its name or alias; false when Shiki doesn't know it. */
export async function loadLanguage(highlighter: HighlighterCore, lang: string): Promise<boolean> {
  const language = bundledLanguages[lang as keyof typeof bundledLanguages];
  if (!language) return false;
  await highlighter.loadLanguage(language);
  return true;
}
