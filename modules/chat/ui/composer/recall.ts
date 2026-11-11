/**
 * Your sent messages, brought back to the empty page one at a time: Up
 * brings back your last one, and again the one before; Down goes the
 * other way, back to an empty page. Once you change what came back, the
 * keys move the caret again.
 */
export class Recall {
  /** Which of your messages came back, counted back from the last, and its text. */
  private recalled: { back: number; text: string } | null = null;

  /** Forgets what came back, as for another chat. */
  reset(): void {
    this.recalled = null;
  }

  /**
   * What Up (1) or Down (-1) does on the page as it is: whether it takes
   * the key, and what it writes on the page instead, if anything.
   */
  step(
    step: 1 | -1,
    sent: readonly string[],
    value: string,
    caret: number,
  ): { took: boolean; write?: string } {
    const recalled = value !== '' && value === this.recalled?.text ? this.recalled : null;
    if (value !== '' && !recalled) return { took: false };
    // In a message of several lines, only from its first line up or its last line down.
    if (recalled && step === 1 && value.lastIndexOf('\n', caret - 1) !== -1) return { took: false };
    if (recalled && step === -1 && value.indexOf('\n', caret) !== -1) return { took: false };
    const back = (recalled?.back ?? 0) + step;
    if (back < 1) {
      if (!recalled) return { took: false };
      this.recalled = null;
      return { took: true, write: '' };
    }
    const text = sent[sent.length - back];
    // Already at your first message: Up stays on it.
    if (text === undefined) return { took: !!recalled };
    this.recalled = { back, text };
    return { took: true, write: text };
  }
}
