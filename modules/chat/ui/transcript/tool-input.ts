import { htmlToMarkdown } from './html-markdown';

/** A field of a tool's input: a short one sits in a grid, a long one in a block of its own. */
export type ToolField =
  | { name: string; kind: 'short' | 'text' | 'markdown' | 'json'; value: string }
  | { name: string; kind: 'html'; value: string; preview: string };

/** The longest value that sits on one line of the grid. */
const SHORT = 80;

/** Fields that tell what format a tool's other text is in. */
const FORMAT_FIELDS = ['contentFormat', 'format', 'representation', 'bodyFormat'];

const HTML_FORMATS = /^(html|storage|xhtml)$/i;
const MARKDOWN_FORMATS = /^(markdown|md)$/i;

/** Whether text starts with a tag and closes one: HTML, though its format isn't said. */
const LOOKS_HTML = /^\s*<[a-z][\s\S]*<\/[a-z][\w:-]*>/i;

/** Whether text has a heading, a list or a fence on a line of its own. */
const LOOKS_MARKDOWN = /^(#{1,6} |[-*+] |\d+\. |```)/m;

function formatOf(input: Record<string, unknown>): string {
  for (const name of FORMAT_FIELDS) {
    const value = input[name];
    if (typeof value === 'string') return value;
  }
  return '';
}

function fieldOf(name: string, value: unknown, format: string): ToolField {
  if (typeof value !== 'string') {
    const json = JSON.stringify(value) ?? String(value);
    return json.length <= SHORT
      ? { name, kind: 'short', value: json }
      : { name, kind: 'json', value: JSON.stringify(value, null, 2) };
  }
  if (value.length <= SHORT && !/\n/.test(value)) return { name, kind: 'short', value };
  if (HTML_FORMATS.test(format) || (!MARKDOWN_FORMATS.test(format) && LOOKS_HTML.test(value)))
    return { name, kind: 'html', value, preview: htmlToMarkdown(value) };
  if (MARKDOWN_FORMATS.test(format) || LOOKS_MARKDOWN.test(value))
    return { name, kind: 'markdown', value };
  return { name, kind: 'text', value };
}

/** A tool's input as fields to read: the short ones first, in order, then the long ones. */
export function inputFields(input: unknown): ToolField[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
  const record = input as Record<string, unknown>;
  const format = formatOf(record);
  const fields = Object.entries(record).map(([name, value]) => fieldOf(name, value, format));
  return [
    ...fields.filter((field) => field.kind === 'short'),
    ...fields.filter((field) => field.kind !== 'short'),
  ];
}
