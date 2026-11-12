import { inputText } from './tool-input';

describe('inputText', () => {
  it('writes a tool input a line each, text as it is and anything else as JSON', () => {
    const input = { url: 'https://x.dev', prompt: 'Say "hi"\nthen go', retries: 2, tags: ['a'] };
    expect(inputText(input)).toBe(
      'url: https://x.dev\nprompt: Say "hi"\nthen go\nretries: 2\ntags: ["a"]',
    );
  });

  it('writes nothing for an input that is not an object', () => {
    expect(inputText(undefined)).toBe('');
    expect(inputText('ls')).toBe('');
  });
});
