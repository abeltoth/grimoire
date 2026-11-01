import { formatShortcut } from './shortcut';

describe('formatShortcut', () => {
  it('uses symbols on a Mac', () => {
    expect(formatShortcut('Mod+K', 'mac', 'keys')).toBe('⌘K');
    expect(formatShortcut('Mod+Shift+N', 'mac', 'text')).toBe('⌘⇧N');
    expect(formatShortcut('Mod+K', 'mac', 'spoken')).toBe('Command K');
  });

  it('spells the keys out elsewhere', () => {
    expect(formatShortcut('Mod+K', 'windows', 'keys')).toBe('Ctrl K');
    expect(formatShortcut('Mod+N', 'windows', 'text')).toBe('Ctrl+N');
    expect(formatShortcut('Mod+Shift+N', 'linux', 'text')).toBe('Ctrl+Shift+N');
    expect(formatShortcut('Mod+K', 'windows', 'spoken')).toBe('Control K');
  });
});
