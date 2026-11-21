import { describe, expect, it } from 'vitest';
import { keyEffect } from './browser-keys';

const ctrl = (key: string, held: Partial<{ shift: boolean; alt: boolean }> = {}) => ({
  key,
  ctrl: true,
  meta: false,
  shift: false,
  alt: false,
  ...held,
});
const shortcuts = ['Mod+K', 'Mod+N', 'Mod+W', 'Mod+=', 'Mod+-', 'Mod+0'];

describe('keyEffect', () => {
  it('gives the browser its own keys, even where Grimoire has a shortcut of them', () => {
    expect(keyEffect(ctrl('w'), shortcuts, 'windows')).toEqual({
      kind: 'action',
      action: 'close-tab',
    });
    expect(keyEffect(ctrl('t'), shortcuts, 'windows')).toEqual({
      kind: 'action',
      action: 'new-tab',
    });
    expect(keyEffect(ctrl('='), shortcuts, 'windows')).toEqual({ kind: 'zoom', by: 1 });
    expect(keyEffect(ctrl('+', { shift: true }), shortcuts, 'windows')).toEqual({
      kind: 'zoom',
      by: 1,
    });
    expect(keyEffect(ctrl('0'), shortcuts, 'windows')).toEqual({ kind: 'zoom', by: 0 });
    expect(
      keyEffect({ ...ctrl('ArrowLeft', { alt: true }), ctrl: false }, shortcuts, 'windows'),
    ).toEqual({
      kind: 'move',
      move: 'back',
    });
    expect(keyEffect({ ...ctrl('F5'), ctrl: false }, shortcuts, 'windows')).toEqual({
      kind: 'move',
      move: 'reload',
    });
  });

  it('passes Grimoire’s other shortcuts back to Grimoire', () => {
    expect(keyEffect(ctrl('k'), shortcuts, 'windows')).toEqual({ kind: 'grimoire' });
    expect(keyEffect(ctrl('n'), shortcuts, 'windows')).toEqual({ kind: 'grimoire' });
  });

  it('leaves every other key to the page', () => {
    expect(keyEffect(ctrl('c'), shortcuts, 'windows')).toBeNull();
    expect(keyEffect({ ...ctrl('a'), ctrl: false }, shortcuts, 'windows')).toBeNull();
  });

  it('takes ⌘ as Mod on a Mac', () => {
    const press = { key: 'k', ctrl: false, meta: true, shift: false, alt: false };
    expect(keyEffect(press, shortcuts, 'mac')).toEqual({ kind: 'grimoire' });
    expect(keyEffect(press, shortcuts, 'windows')).toBeNull();
  });
});
