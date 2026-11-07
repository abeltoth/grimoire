import type * as Monaco from 'monaco-editor';

/** The editor's look, from the theme's --gr-editor-* tokens, as code-editor.css hands them on. */
export interface BookLook {
  theme: Monaco.editor.IStandaloneThemeData;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
}

/**
 * The VS Code editor in the book's colours: the page's paper and ink, and
 * the colours the book marks code with, read from the theme where the
 * editor is, so it follows a theme you change.
 */
export function bookLook(where: Element): BookLook {
  const styles = getComputedStyle(where);
  const token = (name: string) => styles.getPropertyValue(`--${name}`).trim();
  const colour = (name: string) => hex(where, token(name));
  const ink = (name: string) => colour(name)?.slice(1, 7);
  const all: { token: string; foreground: string | undefined; fontStyle?: string }[] = [
    { token: '', foreground: ink('ink') },
    { token: 'keyword', foreground: ink('keyword') },
    { token: 'string', foreground: ink('string') },
    { token: 'regexp', foreground: ink('string') },
    { token: 'comment', foreground: ink('comment'), fontStyle: 'italic' },
    { token: 'type', foreground: ink('type') },
    { token: 'type.identifier', foreground: ink('type') },
    { token: 'number', foreground: ink('number') },
    { token: 'tag', foreground: ink('keyword') },
    { token: 'attribute.name', foreground: ink('type') },
    { token: 'attribute.value', foreground: ink('string') },
    { token: 'delimiter', foreground: ink('punctuation') },
  ];
  // A token the theme doesn't set keeps the editor's own colour.
  const rules: Monaco.editor.ITokenThemeRule[] = all.filter(
    (rule) => rule.foreground !== undefined,
  );
  const colours: Record<string, string | undefined> = {
    'editor.background': colour('page'),
    'editor.foreground': colour('ink'),
    'editorGutter.background': colour('page'),
    'editorLineNumber.foreground': colour('line-number'),
    'editorLineNumber.activeForeground': colour('line-number-current'),
    'editor.lineHighlightBackground': colour('current-line'),
    'editor.lineHighlightBorder': colour('current-line'),
    'editor.selectionBackground': colour('selection'),
    'editorCursor.foreground': colour('cursor'),
    'editorIndentGuide.background1': colour('guide'),
    'editorWhitespace.foreground': colour('guide'),
    'editorWidget.background': colour('widget'),
    'editorWidget.border': colour('widget-rule'),
    'input.background': colour('page'),
    focusBorder: colour('widget-rule'),
    'scrollbarSlider.background': colour('scrollbar'),
    'scrollbarSlider.hoverBackground': colour('scrollbar'),
    'scrollbar.shadow': colour('page'),
    'diffEditor.insertedTextBackground': colour('inserted'),
    'diffEditor.insertedLineBackground': colour('inserted-line'),
    'diffEditor.removedTextBackground': colour('removed'),
    'diffEditor.removedLineBackground': colour('removed-line'),
    'diffEditor.diagonalFill': colour('guide'),
  };
  return {
    theme: {
      base: 'vs',
      inherit: true,
      rules,
      colors: Object.fromEntries(
        Object.entries(colours).filter((entry): entry is [string, string] => !!entry[1]),
      ),
    },
    fontFamily: token('font'),
    fontSize: parseFloat(token('size')) || 13,
    lineHeight: parseFloat(token('line')) || 20,
  };
}

/** A CSS colour as the editor takes it, #rrggbb or #rrggbbaa; undefined when it can't be read. */
function hex(where: Element, value: string): string | undefined {
  if (!value) return undefined;
  const probe = document.createElement('span');
  probe.style.color = value;
  where.append(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  const parts = /rgba?\(([^)]+)\)/
    .exec(computed)?.[1]
    ?.split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (!parts || parts.length < 3 || parts.some((part) => Number.isNaN(part))) return undefined;
  const [r, g, b, a = 1] = parts as [number, number, number, number?];
  const byte = (n: number) =>
    Math.round(Math.min(255, Math.max(0, n)))
      .toString(16)
      .padStart(2, '0');
  return `#${byte(r)}${byte(g)}${byte(b)}${a < 1 ? byte(a * 255) : ''}`;
}
