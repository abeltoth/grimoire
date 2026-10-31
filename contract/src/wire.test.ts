import { describe, expect, it } from 'vitest';
import { LineDecoder, encodeMessage } from './wire';

describe('LineDecoder', () => {
  it('returns each complete line as a message', () => {
    const decoder = new LineDecoder();
    const out = decoder.push(encodeMessage({ a: 1 }) + encodeMessage({ b: 2 }));
    expect(out).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it('keeps a partial line until the rest arrives', () => {
    const decoder = new LineDecoder();
    const line = encodeMessage({ text: 'hello' });
    expect(decoder.push(line.slice(0, 5))).toEqual([]);
    expect(decoder.push(line.slice(5))).toEqual([{ text: 'hello' }]);
  });

  it('keeps newlines inside strings intact', () => {
    const decoder = new LineDecoder();
    expect(decoder.push(encodeMessage({ text: 'a\nb' }))).toEqual([{ text: 'a\nb' }]);
  });
});
