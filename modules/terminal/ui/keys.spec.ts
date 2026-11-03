import { forWindow } from './keys';

const key = (key: string, mods: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent('keydown', { key, ...mods });

describe('forWindow', () => {
  it('pastes with Ctrl+V on Windows', () => {
    expect(forWindow(key('v', { ctrlKey: true }), false, 'windows')).toBe(true);
    expect(forWindow(key('V', { ctrlKey: true, shiftKey: true }), false, 'windows')).toBe(true);
  });

  it('copies with Ctrl+C only while text is selected, and with Ctrl+Shift+C', () => {
    expect(forWindow(key('c', { ctrlKey: true }), true, 'windows')).toBe(true);
    expect(forWindow(key('c', { ctrlKey: true }), false, 'windows')).toBe(false);
    expect(forWindow(key('C', { ctrlKey: true, shiftKey: true }), false, 'linux')).toBe(true);
  });

  it('gives the shell every other key', () => {
    expect(forWindow(key('w', { ctrlKey: true }), false, 'windows')).toBe(false);
    expect(forWindow(key('Escape'), false, 'windows')).toBe(false);
    expect(forWindow(key('v', { ctrlKey: true, altKey: true }), false, 'windows')).toBe(false);
  });

  it('keeps nothing from the shell on a Mac, where ⌘C and ⌘V never reach it', () => {
    expect(forWindow(key('v', { ctrlKey: true }), false, 'mac')).toBe(false);
    expect(forWindow(key('c', { ctrlKey: true }), true, 'mac')).toBe(false);
  });
});
