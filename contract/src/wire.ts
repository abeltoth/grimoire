/** Line-delimited JSON framing, shared by the app and the service. */

/** Longest line accepted before the connection is treated as broken. */
export const MAX_LINE_LENGTH = 64 * 1024 * 1024;

export function encodeMessage(message: unknown): string {
  return JSON.stringify(message) + '\n';
}

export class LineDecoder {
  private buffer = '';

  /** Returns the complete messages in `chunk`, keeping any partial line. */
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const messages: unknown[] = [];
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim() !== '') messages.push(JSON.parse(line));
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_LINE_LENGTH) {
      throw new Error(`Message longer than ${MAX_LINE_LENGTH} characters`);
    }
    return messages;
  }
}
