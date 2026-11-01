/** An async iterable you push into: the input stream of a live query. */
export class MessageQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = [];
  private waiting: ((result: IteratorResult<T>) => void) | undefined;
  private ended = false;

  push(item: T): void {
    if (this.ended) throw new Error('The queue has ended');
    if (this.waiting) {
      this.waiting({ value: item, done: false });
      this.waiting = undefined;
    } else {
      this.items.push(item);
    }
  }

  end(): void {
    this.ended = true;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length) return Promise.resolve({ value: this.items.shift()!, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiting = resolve));
      },
    };
  }
}
