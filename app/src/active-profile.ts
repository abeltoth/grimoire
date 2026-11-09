/**
 * Which profile is in use, as the service tells it, so the windows open
 * on another one's chats only when another one is put in use: not
 * when one is made, renamed or deleted.
 */
export class ActiveProfile {
  private known: string | undefined;

  /** Whether the profile in use is another than the one known; the first one told is no change. */
  changedTo(active: string): boolean {
    const changed = this.known !== undefined && this.known !== active;
    this.known = active;
    return changed;
  }
}
