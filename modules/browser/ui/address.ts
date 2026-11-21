/** Where text typed in the address field that isn't an address is searched for. */
export const SEARCH = 'https://www.google.com/search?q=';

/** A host and maybe a port and path, such as "pinterest.com" or "en.wikipedia.org/wiki/Ink". */
const BARE = /^[\w-]+(\.[\w-]+)*\.[a-z][a-z-]+(:\d+)?([/?#]\S*)?$/i;
const LOCAL = /^(localhost|127\.0\.0\.1)(:\d+)?([/?#]\S*)?$/i;

/** What text typed in the address field loads: the address, a bare one on https, or a Google search; null for none. */
export function addressOf(text: string): string | null {
  const typed = text.trim();
  if (!typed) return null;
  if (/^https?:\/\//i.test(typed)) return typed;
  if (LOCAL.test(typed)) return `http://${typed}`;
  if (BARE.test(typed)) return `https://${typed}`;
  return SEARCH + encodeURIComponent(typed);
}

/** What a tab is called: its page's title, or its address's host while it has none. */
export function tabLabel(tab: { url: string; title: string }): string {
  if (tab.title) return tab.title;
  try {
    return new URL(tab.url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}
