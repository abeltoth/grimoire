import { htmlToMarkdown } from './html-markdown';

/** A field of a tool's input that is text: a short one sits in a grid, a long one in a block of its own. */
export type TextField =
  | { name: string; kind: 'short' | 'text' | 'markdown' | 'json'; value: string }
  | { name: string; kind: 'html'; value: string; preview: string };

/** A field of a tool's input: text, a list of objects read item by item, or an object read field by field. */
export type ToolField =
  | TextField
  | { name: string; kind: 'list'; items: ToolField[][] }
  | { name: string; kind: 'group'; fields: ToolField[] };

/** How deep objects inside objects are read field by field; deeper ones read as JSON. */
const DEPTH = 3;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function fieldOf(name: string, value: unknown, format: string, depth: number): ToolField {
  if (typeof value !== 'string') {
    const json = JSON.stringify(value) ?? String(value);
    if (json.length <= SHORT) return { name, kind: 'short', value: json };
    if (depth < DEPTH && Array.isArray(value) && value.length && value.every(isRecord))
      return { name, kind: 'list', items: value.map((item) => fieldsOf(item, format, depth + 1)) };
    if (depth < DEPTH && isRecord(value))
      return { name, kind: 'group', fields: fieldsOf(value, format, depth + 1) };
    return { name, kind: 'json', value: JSON.stringify(value, null, 2) };
  }
  if (value.length <= SHORT && !/\n/.test(value)) return { name, kind: 'short', value };
  if (HTML_FORMATS.test(format) || (!MARKDOWN_FORMATS.test(format) && LOOKS_HTML.test(value)))
    return { name, kind: 'html', value, preview: htmlToMarkdown(value) };
  if (MARKDOWN_FORMATS.test(format) || LOOKS_MARKDOWN.test(value))
    return { name, kind: 'markdown', value };
  return { name, kind: 'text', value };
}

/** An object's fields, its own format said or else the one around it. */
function fieldsOf(record: Record<string, unknown>, around: string, depth: number): ToolField[] {
  const format = formatOf(record) || around;
  const fields = Object.entries(record).map(([name, value]) => fieldOf(name, value, format, depth));
  return [
    ...fields.filter((field) => field.kind === 'short'),
    ...fields.filter((field) => field.kind !== 'short'),
  ];
}

/** A tool's input as fields to read: the short ones first, in order, then the long ones. */
export function inputFields(input: unknown): ToolField[] {
  return isRecord(input) ? fieldsOf(input, '', 0) : [];
}
