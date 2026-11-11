import { THEME, createHighlighter, loadLanguage } from './shiki';

describe('shiki', () => {
  it('loads a language Shiki knows, by name or alias, and colours it in the design’s tokens', async () => {
    const highlighter = await createHighlighter();
    expect(await loadLanguage(highlighter, 'typescript')).toBe(true);
    expect(await loadLanguage(highlighter, 'ts')).toBe(true);
    const [line] = highlighter.codeToTokensBase('return 1;', { lang: 'ts', theme: THEME });
    expect(line![0]).toMatchObject({ content: 'return', color: 'var(--gr-code-keyword)' });
  });

  it('says when it doesn’t know a language', async () => {
    expect(await loadLanguage(await createHighlighter(), 'not-a-language')).toBe(false);
  });
});
