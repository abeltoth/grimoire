import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron';

/** What the right-click menu does to the page it's on. */
export interface MenuActions {
  canGoBack: boolean;
  canGoForward: boolean;
  back(): void;
  forward(): void;
  reload(): void;
  copy(): void;
  paste(): void;
  copyImage(x: number, y: number): void;
  saveImage(url: string): void;
  copyText(text: string): void;
  openInNewTab(url: string): void;
}

const separator: MenuItemConstructorOptions = { type: 'separator' };

/** The right-click menu for where you clicked on a page: its link, its picture, the text, then the page. */
export function menuItems(
  params: Pick<
    ContextMenuParams,
    'x' | 'y' | 'linkURL' | 'srcURL' | 'mediaType' | 'isEditable' | 'selectionText' | 'editFlags'
  >,
  actions: MenuActions,
): MenuItemConstructorOptions[] {
  const groups: MenuItemConstructorOptions[][] = [];
  if (params.linkURL)
    groups.push([
      { label: 'Open link in new tab', click: () => actions.openInNewTab(params.linkURL) },
      { label: 'Copy link address', click: () => actions.copyText(params.linkURL) },
    ]);
  if (params.mediaType === 'image' && params.srcURL)
    groups.push([
      { label: 'Copy image', click: () => actions.copyImage(params.x, params.y) },
      { label: 'Save image as…', click: () => actions.saveImage(params.srcURL) },
    ]);
  const text: MenuItemConstructorOptions[] = [];
  if (params.selectionText && params.editFlags.canCopy)
    text.push({ label: 'Copy', click: () => actions.copy() });
  if (params.isEditable && params.editFlags.canPaste)
    text.push({ label: 'Paste', click: () => actions.paste() });
  if (text.length) groups.push(text);
  groups.push([
    { label: 'Back', enabled: actions.canGoBack, click: () => actions.back() },
    { label: 'Forward', enabled: actions.canGoForward, click: () => actions.forward() },
    { label: 'Reload', click: () => actions.reload() },
  ]);
  return groups.flatMap((group, index) => (index ? [separator, ...group] : group));
}
