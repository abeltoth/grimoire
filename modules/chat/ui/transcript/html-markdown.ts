/** Elements whose content is never shown: code, styles and embedded pages. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'template',
  'noscript',
  'svg',
  'math',
  'head',
]);

/** Elements that stand as blocks of their own. */
const BLOCKS = [
  'p',
  'div',
  'section',
  'article',
  'header',
  'footer',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'table',
  'pre',
  'blockquote',
  'hr',
];
const BLOCK_SET = new Set(BLOCKS);
const BLOCK_SELECTOR = BLOCKS.join(',');

/** Links that open in your browser; any other keeps only its text. */
const SAFE_HREF = /^(https?:|mailto:)/i;

function nameOf(element: Element): string {
  return element.localName.toLowerCase();
}

/** Text as markdown would read it: its own marks escaped. */
function escape(text: string): string {
  return text.replace(/[\\`*_[\]<>#|~]/g, '\\$&');
}

/** Wraps text in a mark, keeping the spaces around it outside. */
function wrap(mark: string, text: string): string {
  const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
  return core ? `${lead}${mark}${core}${mark}${trail}` : text;
}

/** A backtick fence longer than any run of backticks in the text. */
function fence(text: string, least: number): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  return '`'.repeat(Math.max(least, longest + 1));
}

/** A node's text within a line; a line break comes out as `\n`. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE)
    return escape((node.textContent ?? '').replace(/\s+/g, ' '));
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as Element;
  const name = nameOf(element);
  if (DROPPED.has(name)) return '';
  const inner = () => [...element.childNodes].map(inline).join('');
  switch (name) {
    case 'br':
      return '\n';
    case 'strong':
    case 'b':
      return wrap('**', inner());
    case 'em':
    case 'i':
      return wrap('*', inner());
    case 'del':
    case 's':
      return wrap('~~', inner());
    case 'code': {
      const code = (element.textContent ?? '').replace(/\s+/g, ' ');
      const marks = fence(code, 1);
      return code.trim() ? `${marks}${code}${marks}` : '';
    }
    case 'a': {
      const text = inner();
      const href = element.getAttribute('href')?.trim() ?? '';
      if (!SAFE_HREF.test(href) || !text.trim()) return text;
      return `[${text.trim()}](<${href.replace(/[<>\s]/g, encodeURIComponent)}>)`;
    }
    case 'img': {
      const alt = element.getAttribute('alt')?.trim();
      return escape(alt ? `[image: ${alt}]` : '[image]');
    }
    default:
      return BLOCK_SET.has(name) || name === 'li' || name === 'td' || name === 'th'
        ? ` ${inner()} `
        : inner();
  }
}

/** Inline text set on one line, as in a heading or a table's cell. */
function oneLine(node: Node): string {
  return inline(node).replace(/\s+/g, ' ').trim();
}

/** Inline text as a paragraph, its line breaks kept. */
function paragraph(node: Node): string {
  return inline(node)
    .split('\n')
    .map((line) => line.replace(/ +/g, ' ').trim())
    .filter(Boolean)
    .join('  \n');
}

function list(element: Element, ordered: boolean): string {
  const items = [...element.children].filter((child) => nameOf(child) === 'li');
  return items
    .map((item, index) => {
      const marker = ordered ? `${index + 1}.` : '-';
      const indent = ' '.repeat(marker.length + 1);
      const lines = blocks(item).join('\n').split('\n');
      return `${marker} ${lines.map((line, i) => (i && line ? indent + line : line)).join('\n')}`;
    })
    .join('\n');
}

function table(element: HTMLTableElement): string {
  const rows = [...element.rows].map((row) =>
    [...row.cells].map((cell) => oneLine(cell).replaceAll('\n', ' ')),
  );
  if (!rows.length) return '';
  const width = Math.max(...rows.map((row) => row.length));
  const line = (cells: string[]) =>
    `| ${Array.from({ length: width }, (_, i) => cells[i] ?? '').join(' | ')} |`;
  const [head, ...body] = rows;
  return [line(head!), line(Array(width).fill('---')), ...body.map(line)].join('\n');
}

/** A block element as markdown, or undefined for an element read as text. */
function block(element: Element): string[] | undefined {
  const name = nameOf(element);
  if (/^h[1-6]$/.test(name)) {
    const text = oneLine(element);
    return text ? [`${'#'.repeat(Number(name[1]))} ${text}`] : [];
  }
  switch (name) {
    case 'p': {
      const text = paragraph(element);
      return text ? [text] : [];
    }
    case 'ul':
    case 'ol':
      return [list(element, name === 'ol')];
    case 'table':
      return [table(element as HTMLTableElement)];
    case 'pre': {
      const code = (element.textContent ?? '').replace(/\n$/, '');
      const marks = fence(code, 3);
      return [`${marks}\n${code}\n${marks}`];
    }
    case 'blockquote':
      return [
        blocks(element)
          .join('\n\n')
          .split('\n')
          .map((line) => (line ? `> ${line}` : '>'))
          .join('\n'),
      ];
    case 'hr':
      return ['---'];
    default:
      return BLOCK_SET.has(name) || element.querySelector(BLOCK_SELECTOR)
        ? blocks(element)
        : undefined;
  }
}

/** An element's children as blocks; text between blocks becomes a paragraph. */
function blocks(parent: Element): string[] {
  const out: string[] = [];
  let run: Node[] = [];
  const flush = () => {
    const holder = parent.ownerDocument.createElement('span');
    holder.append(...run.map((node) => node.cloneNode(true)));
    const text = paragraph(holder);
    if (text) out.push(text);
    run = [];
  };
  for (const node of [...parent.childNodes]) {
    const own =
      node.nodeType === Node.ELEMENT_NODE && !DROPPED.has(nameOf(node as Element))
        ? block(node as Element)
        : undefined;
    if (own) {
      flush();
      out.push(...own.filter(Boolean));
    } else run.push(node);
  }
  flush();
  return out;
}

/**
 * HTML as markdown, to show through the markdown view. It's parsed into an
 * inert document, where nothing runs or loads, and only its text and a few
 * plain elements come out: never its attributes, styles, scripts or images.
 */
export function htmlToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, 'text/html');
  return blocks(document.body).join('\n\n');
}

/** HTML broken onto lines after its blocks, to read as source. */
export function htmlSource(html: string): string {
  return html
    .replace(
      /(<\/(?:p|div|h[1-6]|li|ul|ol|tr|thead|tbody|tfoot|table|blockquote|pre|section)>|<br\s*\/?>)(?!\r?\n)/gi,
      '$1\n',
    )
    .trim();
}
