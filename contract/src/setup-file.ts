/** A file an agent reads, such as a setup file or a memory, opened to read or change in place. */
export interface SetupFile {
  path: string;
  text: string;
  exists: boolean;
  /** When it last changed, in ms since the epoch; 0 while it doesn't exist. */
  changedAt: number;
  /** Whether it may be changed here: not the managed settings, nor a plugin's own files. */
  editable: boolean;
}
