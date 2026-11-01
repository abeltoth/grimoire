import { Lexer, type Token, type Tokens } from 'marked';

/**
 * A reply's markdown as the transcript sets it. The last leaf block is
 * marked `end`: the quill and Stop go there while the agent writes.
 */
export type Block =
  | { kind: 'paragraph'; inline: Inline[]; end?: true }
  /** Text in a tight list item: no paragraph around it. */
  | { kind: 'plain'; inline: Inline[]; end?: true }
  | { kind: 'heading'; level: number; inline: Inline[]; end?: true }
  | { kind: 'list'; ordered: boolean; start: number; items: Block[][] }
  /** A code listing. `listing` counts the reply's listings from 0. */
  | { kind: 'code'; code: string; lang: string; open: boolean; listing: number; end?: true }
  | { kind: 'quote'; blocks: Block[] }
  | { kind: 'table'; head: Inline[][]; rows: Inline[][][]; end?: true }
  | { kind: 'rule'; end?: true }
  | { kind: 'raw'; text: string; end?: true };

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong' | 'em' | 'del'; inline: Inline[] }
  | { kind: 'code'; text: string }
  | { kind: 'link'; href: string; inline: Inline[] }
  | { kind: 'break' };

export interface Markdown {
  blocks: Block[];
  /** How many code listings it has. */
  listings: number;
}

const cache = new Map<string, Markdown>();
const CACHE_SIZE = 500;

/**
 * Parses a reply. While it's still being written, half-finished markdown
 * is closed first so it reads as it will once finished (ADR: Grimoire
 * handles half-finished markdown itself).
 */
export function parseMarkdown(text: string, writing: boolean): Markdown {
  const key = `${writing ? 'w' : 'd'}${text}`;
  const cached = cache.get(key);
  if (cached) return cached;

  let listings = 0;
  const tokens = Lexer.lex(writing ? closeUnfinished(text) : text, { gfm: true });
  const blocks = toBlocks(tokens, () => listings++);
  markEnd(blocks);
  const markdown = { blocks, listings };

  cache.set(key, markdown);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return markdown;
}

/** Closes inline code and bold left open at the end of a half-written reply. */
export function closeUnfinished(text: string): string {
  // An open code fence already reads as code to the end.
  if (openFence(text)) return text;
  const tail = text.slice(text.lastIndexOf('\n\n') + 1);
  const ticks = tail.match(/`+/g)?.filter((run) => run.length === 1).length ?? 0;
  if (ticks % 2 === 1) return text + '`';
  const stars = tail.replace(/`[^`]*`/g, '').match(/\*\*/g)?.length ?? 0;
  if (stars % 2 === 0) return text;
  // Bold just opened, with nothing in it yet, waits; otherwise it's closed.
  return /\*\*\s*$/.test(text) ? text.replace(/\*\*\s*$/, '') : text + '**';
}

/** Whether the text ends inside a fenced code block. */
function openFence(text: string): boolean {
  let fence: string | undefined;
  for (const line of text.split('\n')) {
    const match = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!match) continue;
    if (!fence) fence = match[1];
    else if (
      match[1]![0] === fence[0] &&
      match[1]!.length >= fence.length &&
      !line.trim().slice(match[1]!.length)
    )
      fence = undefined;
  }
  return fence !== undefined;
}

function toBlocks(tokens: Token[], nextListing: () => number): Block[] {
  return tokens.flatMap((token): Block[] => {
    switch (token.type) {
      case 'space':
        return [];
      case 'paragraph':
        return [{ kind: 'paragraph', inline: toInline((token as Tokens.Paragraph).tokens) }];
      case 'text': {
        const text = token as Tokens.Text;
        return [
          {
            kind: 'plain',
            inline: text.tokens ? toInline(text.tokens) : [{ kind: 'text', text: text.text }],
          },
        ];
      }
      case 'heading': {
        const heading = token as Tokens.Heading;
        return [{ kind: 'heading', level: heading.depth, inline: toInline(heading.tokens) }];
      }
      case 'list': {
        const list = token as Tokens.List;
        return [
          {
            kind: 'list',
            ordered: list.ordered,
            start: typeof list.start === 'number' ? list.start : 1,
            items: list.items.map((item) => toBlocks(item.tokens, nextListing)),
          },
        ];
      }
      case 'code': {
        const code = token as Tokens.Code;
        return [
          {
            kind: 'code',
            code: code.text,
            lang: (code.lang ?? '').trim().split(/\s/)[0]!,
            open: openFence(code.raw),
            listing: nextListing(),
          },
        ];
      }
      case 'blockquote':
        return [
          { kind: 'quote', blocks: toBlocks((token as Tokens.Blockquote).tokens, nextListing) },
        ];
      case 'table': {
        const table = token as Tokens.Table;
        return [
          {
            kind: 'table',
            head: table.header.map((cell) => toInline(cell.tokens)),
            rows: table.rows.map((row) => row.map((cell) => toInline(cell.tokens))),
          },
        ];
      }
      case 'hr':
        return [{ kind: 'rule' }];
      default:
        return [{ kind: 'raw', text: 'text' in token ? String(token.text) : token.raw }];
    }
  });
}

function toInline(tokens: Token[] = []): Inline[] {
  return tokens.flatMap((token): Inline[] => {
    switch (token.type) {
      case 'strong':
      case 'em':
      case 'del':
        return [{ kind: token.type, inline: toInline((token as Tokens.Strong).tokens) }];
      case 'codespan':
        return [{ kind: 'code', text: (token as Tokens.Codespan).text }];
      case 'link': {
        const link = token as Tokens.Link;
        return [{ kind: 'link', href: link.href, inline: toInline(link.tokens) }];
      }
      case 'image': {
        const image = token as Tokens.Image;
        return [{ kind: 'link', href: image.href, inline: [{ kind: 'text', text: image.text }] }];
      }
      case 'br':
        return [{ kind: 'break' }];
      case 'checkbox':
        return [{ kind: 'text', text: (token as Tokens.Checkbox).checked ? '☑ ' : '☐ ' }];
      case 'text': {
        const text = token as Tokens.Text;
        return text.tokens ? toInline(text.tokens) : [{ kind: 'text', text: text.text }];
      }
      default:
        // Escapes, inline HTML and anything else read as their text.
        return [{ kind: 'text', text: 'text' in token ? String(token.text) : token.raw }];
    }
  });
}

/** Marks the block where the reply's last words are. */
function markEnd(blocks: Block[]): void {
  const last = blocks.at(-1);
  if (!last) return;
  if (last.kind === 'list') markEnd(last.items.at(-1) ?? []);
  else if (last.kind === 'quote') markEnd(last.blocks);
  else last.end = true;
}
