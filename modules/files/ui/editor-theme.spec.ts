import { editorLook } from './editor-theme';

describe('editorLook', () => {
  let where: HTMLElement;
  beforeEach(() => {
    where = document.createElement('div');
    document.body.append(where);
  });
  afterEach(() => {
    where.remove();
  });

  it('draws the editor in the theme’s colours, its face and its size', () => {
    where.style.setProperty('--ink', 'rgb(17, 34, 51)');
    where.style.setProperty('--page', 'rgb(250, 245, 230)');
    where.style.setProperty('--comment', 'rgb(128, 128, 128)');
    where.style.setProperty('--font', 'Iosevka');
    where.style.setProperty('--size', '14px');
    const look = editorLook(where);
    expect(look.theme.rules).toEqual([
      { token: '', foreground: '112233' },
      { token: 'comment', foreground: '808080', fontStyle: 'italic' },
    ]);
    expect(look.theme.colors).toEqual({
      'editor.background': '#faf5e6',
      'editor.foreground': '#112233',
      'editorGutter.background': '#faf5e6',
      'input.background': '#faf5e6',
      'scrollbar.shadow': '#faf5e6',
    });
    expect(look).toMatchObject({ fontFamily: 'Iosevka', fontSize: 14, lineHeight: 20 });
  });

  it('keeps the editor’s own colours and size where the theme sets none', () => {
    const look = editorLook(where);
    expect(look.theme.rules).toEqual([]);
    expect(look.theme.colors).toEqual({});
    expect(look).toMatchObject({ fontSize: 13, lineHeight: 20 });
  });
});
