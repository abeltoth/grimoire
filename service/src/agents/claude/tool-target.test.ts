import { describe, expect, it } from 'vitest';
import { targetOf } from './tool-target';

describe('targetOf', () => {
  it('names the file, command, pattern or address a tool ran on', () => {
    expect(targetOf('Read', { file_path: 'C:\\repo\\package.json' })).toBe(
      'C:\\repo\\package.json',
    );
    expect(targetOf('Bash', { command: 'npm test' })).toBe('npm test');
    expect(targetOf('Grep', { pattern: 'TODO' })).toBe('TODO');
    expect(targetOf('WebFetch', { url: 'https://example.com' })).toBe('https://example.com');
  });

  it('keeps a long command to its first line, cut short', () => {
    expect(targetOf('Bash', { command: '  cd app\nnpm test' })).toBe('cd app');
    const long = targetOf('Bash', { command: 'x'.repeat(300) });
    expect(long).toHaveLength(200);
    expect(long!.endsWith('…')).toBe(true);
  });

  it('has none for a tool it does not know, or an input without the field', () => {
    expect(targetOf('mcp__jira__getIssue', { id: 'A-1' })).toBeUndefined();
    expect(targetOf('Read', {})).toBeUndefined();
    expect(targetOf('Read', null)).toBeUndefined();
    expect(targetOf('Bash', { command: '   ' })).toBeUndefined();
  });
});
