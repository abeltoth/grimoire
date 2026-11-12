/** A page a web search found. */
export interface WebSource {
  title: string;
  url: string;
}

/** A web search's result, read apart: what was asked, the pages found, and what the agent made of them. */
export interface WebSearch {
  query: string;
  sources: WebSource[];
  summary: string;
}

const HEADER = /^Web search results for query: "(.*)"\s*$/;
const LINKS = /^Links: (\[.*\])\s*$/;

// Claude Code's word to the agent to cite the sources, which isn't part of the result.
const REMINDER = /^REMINDER: /;

/**
 * Reads Claude Code's WebSearch result: its query line, a JSON line of
 * links for each search it ran, and the summary. Undefined for text of
 * any other shape, which shows as it came.
 */
export function parseWebSearch(text: string): WebSearch | undefined {
  const lines = text.split(/\r?\n/);
  const query = HEADER.exec(lines[0] ?? '')?.[1];
  if (query === undefined) return undefined;
  const sources = new Map<string, WebSource>();
  const rest: string[] = [];
  for (const line of lines.slice(1)) {
    const links = LINKS.exec(line)?.[1];
    if (links === undefined) {
      if (!REMINDER.test(line)) rest.push(line);
      continue;
    }
    const found = sourcesOf(links);
    if (!found) return undefined;
    for (const source of found) if (!sources.has(source.url)) sources.set(source.url, source);
  }
  return { query, sources: [...sources.values()], summary: rest.join('\n').trim() };
}

function sourcesOf(json: string): WebSource[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  return parsed.flatMap((link: { title?: unknown; url?: unknown }) =>
    typeof link?.url === 'string'
      ? [
          {
            url: link.url,
            title: typeof link.title === 'string' && link.title ? link.title : link.url,
          },
        ]
      : [],
  );
}
