import { ago, tokens } from './cache-words';

describe('cache-words', () => {
  it('says how long ago in words', () => {
    expect(ago(30_000)).toBe('Just now');
    expect(ago(60_000)).toBe('A minute ago');
    expect(ago(20 * 60_000)).toBe('20 minutes ago');
    expect(ago(60 * 60_000)).toBe('An hour ago');
    expect(ago(3 * 60 * 60_000)).toBe('3 hours ago');
    expect(ago(24 * 60 * 60_000)).toBe('A day ago');
    expect(ago(2 * 24 * 60 * 60_000)).toBe('2 days ago');
  });

  it('rounds a count of tokens', () => {
    expect(tokens(850)).toBe('850');
    expect(tokens(283_400)).toBe('283k');
    expect(tokens(1_200_000)).toBe('1.2M');
    expect(tokens(2_000_000)).toBe('2M');
  });
});
