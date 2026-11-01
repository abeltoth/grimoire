import { describe, expect, it } from 'vitest';
import { MessageQueue } from './message-queue';

describe('MessageQueue', () => {
  it('yields what was pushed before and after it was read, until it ends', async () => {
    const queue = new MessageQueue<string>();
    queue.push('a');
    const read = (async () => {
      const items: string[] = [];
      for await (const item of queue) items.push(item);
      return items;
    })();
    await Promise.resolve();
    queue.push('b');
    queue.end();
    await expect(read).resolves.toEqual(['a', 'b']);
    expect(() => queue.push('c')).toThrow('ended');
  });
});
