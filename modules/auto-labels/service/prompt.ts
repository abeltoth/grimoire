import type { Entry } from '@grimoire/contract';

/** What a chat is asked to be labelled with. */
export interface Wanted {
  title: boolean;
  summary: boolean;
  /** The tags it may be given; none asks for no tags. */
  tags: readonly string[];
}

/** What the model labelled a chat with, each as it's kept. */
export interface Labels {
  title?: string;
  summary?: string;
  tags: string[];
}

/** The longest stretch of a chat the model reads. */
const CHAT_CHARS = 4_000;
/** The longest any one message reads, so the latest few fit. */
const MESSAGE_CHARS = 800;
/** How many of the latest messages it reads, besides your first. */
const LATEST = 6;
const MAX_TITLE = 80;
const MAX_SUMMARY = 300;
/** The most tags given to a chat at once. */
const MAX_TAGS = 3;

/** The prompt that asks for the labels wanted, and nothing else. */
export function labelPrompt(wanted: Wanted): string {
  const fields = [
    wanted.title &&
      '- "title": a specific title of 3 to 7 words naming what the chat is about, in sentence case, without quotes or a full stop.',
    wanted.summary &&
      '- "summary": one sentence of at most 20 words saying what was asked and what was done.',
    wanted.tags.length &&
      `- "tags": the tags from this list that clearly fit the chat, at most ${MAX_TAGS}; an empty list when none does. The list: ${wanted.tags.join(', ')}.`,
  ].filter(Boolean);
  return `You label a chat between a person and an AI agent, so they can find it again later. Read the chat that follows and answer with only a JSON object with these fields:
${fields.join('\n')}`;
}

/** Text cut short to `max` characters, with an ellipsis when it was. */
function cut(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** A message as the model reads it: who wrote it, and its text. */
function lineOf(entry: Entry): string | undefined {
  if (entry.kind === 'user') return entry.text.trim() && `You: ${cut(entry.text, MESSAGE_CHARS)}`;
  if (entry.kind !== 'agent') return undefined;
  const text = entry.blocks
    .flatMap((block) => (block.kind === 'text' ? [block.text] : []))
    .join('\n');
  return text.trim() && `Agent: ${cut(text, MESSAGE_CHARS)}`;
}

/** The chat as the model reads it: its title, your first message and the latest few, cut short. */
export function chatText(title: string, entries: readonly Entry[]): string {
  const lines = entries.map(lineOf).filter((line): line is string => !!line);
  const first = entries.findIndex((entry) => entry.kind === 'user' && entry.text.trim());
  const firstLine = first >= 0 ? lineOf(entries[first]!) : undefined;
  const latest = lines.slice(-LATEST).filter((line) => line !== firstLine);
  const parts = [
    title.trim() && `Title so far: ${title.trim()}`,
    firstLine && `First message:\n${firstLine}`,
    latest.length && `Latest messages:\n${latest.join('\n')}`,
  ].filter(Boolean);
  return cut(parts.join('\n\n'), CHAT_CHARS);
}

/** The first JSON value of a kind in an answer, whatever is written around it; undefined when there's none. */
function jsonIn(answer: string, open: '{' | '['): unknown {
  const close = open === '{' ? '}' : ']';
  const start = answer.indexOf(open);
  const end = answer.lastIndexOf(close);
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(answer.slice(start, end + 1)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The labels in the model's answer, only those wanted: a title and summary
 * trimmed and cut short, and tags from the list, as the list writes them.
 */
export function readLabels(answer: string, wanted: Wanted): Labels {
  const json = jsonIn(answer, '{') as Record<string, unknown> | undefined;
  if (!json || typeof json !== 'object') return { tags: [] };
  const text = (value: unknown, max: number) =>
    typeof value === 'string' && value.trim() ? cut(value, max) : undefined;
  const title = wanted.title ? text(json['title'], MAX_TITLE) : undefined;
  const summary = wanted.summary ? text(json['summary'], MAX_SUMMARY) : undefined;
  const listed = new Map(wanted.tags.map((tag) => [tag.toLowerCase(), tag]));
  const given = Array.isArray(json['tags']) ? json['tags'] : [];
  const tags = [
    ...new Set(
      given.flatMap((tag) => {
        const kept = typeof tag === 'string' ? listed.get(tag.trim().toLowerCase()) : undefined;
        return kept ? [kept] : [];
      }),
    ),
  ].slice(0, MAX_TAGS);
  return { ...(title ? { title } : {}), ...(summary ? { summary } : {}), tags };
}

/** The prompt that asks for tags to sort chats by, from their titles. */
export const SUGGEST_PROMPT = `You read the titles of a person's chats with an AI agent, one a line, and suggest tags that would sort them into useful groups, such as by kind of work or by topic. Suggest 5 to 12 tags, each one or two lowercase words. Answer with only a JSON array of strings.`;

/** The most titles read to suggest tags from. */
const MAX_TITLES = 300;

/** The titles as the model reads them, newest first, at most a few hundred. */
export function titlesText(titles: readonly string[]): string {
  return cut(
    titles
      .map((title) => title.trim())
      .filter(Boolean)
      .slice(0, MAX_TITLES)
      .join('\n'),
    CHAT_CHARS * 4,
  );
}

/** The tags in the model's answer: trimmed, lowercase, each once, at most a dozen. */
export function readSuggestions(answer: string): string[] {
  const json = jsonIn(answer, '[');
  if (!Array.isArray(json)) return [];
  const tags = json.flatMap((tag) =>
    typeof tag === 'string' && tag.trim() ? [cut(tag.toLowerCase(), 40)] : [],
  );
  return [...new Set(tags)].slice(0, 12);
}
