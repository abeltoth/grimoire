import type { ChatId } from '@grimoire/contract';

/** A mark on a chat: the page's top corner pins it, the bottom one stars it. */
export type Mark = 'pin' | 'star';

/** Every chat's pins and tags, by chat; a chat with none is left out (ADR-009: Grimoire's own data). */
export interface PinsAndTags {
  pins: Record<ChatId, Mark[]>;
  /** Each chat's tags, in the order you added them. */
  tags: Record<ChatId, string[]>;
}

declare module '@grimoire/contract' {
  interface CommandMap {
    /** Every chat's pins and tags. */
    'history.pinsAndTags': { request: Record<string, never>; response: PinsAndTags };
    /** Pins or stars a chat, or takes that back. */
    'history.pin': { request: { chatId: ChatId; mark: Mark; on: boolean }; response: void };
    /** Sets a chat's tags: trimmed, without blanks, and each once whatever its case. */
    'history.tag': { request: { chatId: ChatId; tags: string[] }; response: void };
    /** Your tag list, in your order. */
    'history.tagList': { request: Record<string, never>; response: string[] };
    /** Sets your tag list: trimmed, without blanks, and each once whatever its case. */
    'history.setTagList': { request: { tags: string[] }; response: void };
    /**
     * Names a tag anew, whatever its case, on every chat and in your tag
     * list; a chat or list that has both becomes one tag.
     */
    'history.renameTag': { request: { from: string; to: string }; response: void };
  }
}

declare module '@grimoire/contract' {
  interface EventMap {
    /** A chat's marks changed: the ones it has now. */
    'history.pins': { chatId: ChatId; pins: Mark[] };
    /** A chat's tags changed: the ones it has now, in order. */
    'history.tags': { chatId: ChatId; tags: string[] };
    /** Your tag list changed: the tags it has now, in order. */
    'history.tagListChanged': { tags: string[] };
  }
}
