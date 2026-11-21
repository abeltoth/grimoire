import { describe, expect, it, vi } from 'vitest';
import { type MenuActions, menuItems } from './browser-menu';

function actions(): MenuActions {
  return {
    canGoBack: true,
    canGoForward: false,
    back: vi.fn(),
    forward: vi.fn(),
    reload: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
    copyImage: vi.fn(),
    saveImage: vi.fn(),
    copyText: vi.fn(),
    openInNewTab: vi.fn(),
  };
}
const nowhere = {
  x: 10,
  y: 20,
  linkURL: '',
  srcURL: '',
  mediaType: 'none' as const,
  isEditable: false,
  selectionText: '',
  editFlags: { canCopy: false, canPaste: false } as never,
};
const labels = (items: ReturnType<typeof menuItems>) =>
  items.map((item) => (item.type === 'separator' ? '—' : item.label));

describe('menuItems', () => {
  it('offers only the page’s moves on a blank spot, Forward greyed when there’s nowhere to go', () => {
    const items = menuItems(nowhere, actions());
    expect(labels(items)).toEqual(['Back', 'Forward', 'Reload']);
    expect(items[1]!.enabled).toBe(false);
  });

  it('offers a linked picture’s link and picture, and does what each says', () => {
    const page = actions();
    const items = menuItems(
      {
        ...nowhere,
        linkURL: 'https://pin.it/a',
        srcURL: 'https://i.pinimg.com/a.jpg',
        mediaType: 'image',
      },
      page,
    );
    expect(labels(items)).toEqual([
      'Open link in new tab',
      'Copy link address',
      '—',
      'Copy image',
      'Save image as…',
      '—',
      'Back',
      'Forward',
      'Reload',
    ]);
    const click = (label: string) =>
      (items.find((item) => item.label === label)!.click as () => void)();
    click('Open link in new tab');
    click('Copy image');
    click('Save image as…');
    expect(page.openInNewTab).toHaveBeenCalledWith('https://pin.it/a');
    expect(page.copyImage).toHaveBeenCalledWith(10, 20);
    expect(page.saveImage).toHaveBeenCalledWith('https://i.pinimg.com/a.jpg');
  });

  it('offers Copy for selected text and Paste in a field', () => {
    const items = menuItems(
      {
        ...nowhere,
        selectionText: 'ink',
        isEditable: true,
        editFlags: { canCopy: true, canPaste: true } as never,
      },
      actions(),
    );
    expect(labels(items).slice(0, 2)).toEqual(['Copy', 'Paste']);
  });
});
