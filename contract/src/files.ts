/** One entry of a folder on the Files page. */
export interface FolderEntry {
  name: string;
  /** From the folder the page shows, with forward slashes. */
  path: string;
  kind: 'folder' | 'file';
  /** Git ignores it, as it does build output: it's shown faint. */
  ignored?: boolean;
}

/** A folder's entries, folders first. */
export interface FolderList {
  /** The folder the page shows: the repository's top folder, or the chapter's folder outside one. */
  root: string;
  entries: FolderEntry[];
}

/** A file opened on the Files page. */
export interface OpenFile {
  /** From the folder the page shows, or in full for a file outside it, with forward slashes. */
  path: string;
  /** Its text; empty when it can't be shown. */
  text: string;
  /** When it last changed, in ms since the epoch. */
  changedAt: number;
  /** Why it isn't shown: it isn't text, or it's too large to edit here. */
  unshown?: 'binary' | 'large';
  /**
   * Its text as last committed, when it has changed since: null for a file
   * that's new. Missing when it hasn't changed, or outside a repository.
   */
  committed?: string | null;
}

declare module './commands' {
  interface CommandMap {
    /** A folder's entries; the top of the folder the page shows when `path` is empty. */
    'files.list': { request: { cwd: string; path: string }; response: FolderList };
    /** The files whose paths have all the words in them, best first, up to 50; those git ignores are left out. */
    'files.find': { request: { cwd: string; query: string }; response: string[] };
    /**
     * Opens a file to view and edit, and watches it until it's closed: one
     * in the folder, from it, or any file written in full.
     */
    'files.open': { request: { cwd: string; path: string }; response: OpenFile };
    /** Saves a file, unless it changed on disk since it was opened. */
    'files.save': {
      request: { cwd: string; path: string; text: string; changedAt: number };
      response: OpenFile;
    };
    /** Stops watching a file the page closed. */
    'files.close': { request: { cwd: string; path: string }; response: void };
  }
}

declare module './events' {
  interface EventMap {
    /** A file open on the Files page changed on disk; `root` is the folder the page shows. */
    'files.changed': { root: string; path: string };
  }
}
