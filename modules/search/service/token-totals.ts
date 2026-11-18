import {
  type AgentId,
  type ChatId,
  type TokenCounts,
  type TokenSource,
  type TokenTotal,
  type TokenTotals,
  addTokens,
  sumTokens,
} from '@grimoire/contract';

/** A turn's tokens for one model, as the totals read them, with its chat's details. */
export type TurnRow = {
  id: ChatId;
  at: number;
  model: string;
  subagent: number;
  input: number;
  cacheWritten: number;
  cacheWrittenLong: number;
  cacheRead: number;
  output: number;
  /** What each kind cost, in US dollars; null where the model's prices aren't known. */
  costInput: number | null;
  costCacheWritten: number | null;
  costCacheWrittenLong: number | null;
  costCacheRead: number | null;
  costOutput: number | null;
  /** The skill or subagent they were spent under; null for the chat's own. */
  sourceKind: TokenSource['kind'] | null;
  sourceName: string | null;
  agent: AgentId;
  title: string;
  cwd: string | null;
};

/** The most chats the totals list. */
const MAX_CHATS = 100;

/** Where turns' tokens went and what they cost: in all, by day, hour, model, folder, chat and skill or subagent. */
export function totalsOf(
  since: number,
  rows: readonly TurnRow[],
): Omit<TokenTotals, 'tools' | 'skills'> {
  const days = new Map<string, TurnRow[]>();
  const hours = new Map<number, TurnRow[]>();
  const models = new Map<string, TurnRow[]>();
  const folders = new Map<string, TurnRow[]>();
  const chats = new Map<ChatId, TurnRow[]>();
  const sources = new Map<string, TurnRow[]>();
  const about = new Map<ChatId, { agent: AgentId; title: string; cwd: string | null }>();
  for (const row of rows) {
    add(days, dayOf(row.at), row);
    add(hours, hourOf(row.at), row);
    add(models, `${row.subagent ? 'subagent' : 'chat'} ${row.model}`, row);
    if (row.cwd) add(folders, row.cwd, row);
    add(chats, row.id, row);
    if (row.sourceKind && row.sourceName) add(sources, `${row.sourceKind} ${row.sourceName}`, row);
    about.set(row.id, row);
  }
  return {
    since,
    total: totalOf(rows),
    unpriced: rows.reduce((sum, row) => sum + (row.costInput === null ? sumTokens(row) : 0), 0),
    chatCount: chats.size,
    days: [...days].map(([day, group]) => ({ day, ...totalOf(group) })),
    hours: [...hours].map(([hour, group]) => ({ hour, ...totalOf(group) })),
    models: costliest(
      [...models].map(([key, group]) => {
        const [kind, ...model] = key.split(' ');
        return { model: model.join(' '), subagent: kind === 'subagent', ...totalOf(group) };
      }),
    ),
    folders: costliest([...folders].map(([cwd, group]) => ({ cwd, ...totalOf(group) }))),
    sources: costliest(
      [...sources].map(([key, group]) => {
        const [kind, ...name] = key.split(' ');
        return { kind: kind as TokenSource['kind'], name: name.join(' '), ...totalOf(group) };
      }),
    ),
    chats: costliest(
      [...chats].map(([id, group]) => {
        const chat = about.get(id)!;
        return {
          id,
          agent: chat.agent,
          title: chat.title,
          ...(chat.cwd ? { cwd: chat.cwd } : {}),
          ...totalOf(group),
        };
      }),
    ).slice(0, MAX_CHATS),
  };
}

function add<K>(groups: Map<K, TurnRow[]>, key: K, row: TurnRow): void {
  const group = groups.get(key);
  if (group) group.push(row);
  else groups.set(key, [row]);
}

/** Totals, the costliest first. */
function costliest<T extends TokenTotal>(totals: T[]): T[] {
  return totals.sort((a, b) => b.dollars - a.dollars);
}

/** What a turn's tokens cost, each kind apart; nothing where the model's prices aren't known. */
function costOf(row: TurnRow): TokenCounts {
  return {
    input: row.costInput ?? 0,
    cacheWritten: row.costCacheWritten ?? 0,
    cacheWrittenLong: row.costCacheWrittenLong ?? 0,
    cacheRead: row.costCacheRead ?? 0,
    output: row.costOutput ?? 0,
  };
}

/** Turns' tokens and costs added up; only those are kept, whatever else the rows came with. */
function totalOf(rows: readonly TurnRow[]): TokenTotal {
  const { input, cacheWritten, cacheWrittenLong, cacheRead, output } = addTokens(rows);
  const cost = addTokens(rows.map(costOf));
  return {
    input,
    cacheWritten,
    cacheWrittenLong,
    cacheRead,
    output,
    cost,
    dollars: sumTokens(cost),
  };
}

/** The local day a time falls on, as YYYY-MM-DD. */
function dayOf(at: number): string {
  const date = new Date(at);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

/** The start of the local hour a time falls in, in ms since the epoch. */
function hourOf(at: number): number {
  const date = new Date(at);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}
