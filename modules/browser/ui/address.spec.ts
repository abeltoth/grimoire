import { SEARCH, addressOf, tabLabel } from './address';

describe('addressOf', () => {
  it('loads an address as typed', () => {
    expect(addressOf(' https://gemini.google.com/app ')).toBe('https://gemini.google.com/app');
    expect(addressOf('http://example.com')).toBe('http://example.com');
  });

  it('loads a bare host on https, and this computer’s on http', () => {
    expect(addressOf('pinterest.com')).toBe('https://pinterest.com');
    expect(addressOf('en.wikipedia.org/wiki/Ink')).toBe('https://en.wikipedia.org/wiki/Ink');
    expect(addressOf('localhost:4200')).toBe('http://localhost:4200');
  });

  it('searches Google for anything else', () => {
    expect(addressOf('red ink recipe')).toBe(`${SEARCH}red%20ink%20recipe`);
    expect(addressOf('gemini')).toBe(`${SEARCH}gemini`);
    expect(addressOf('   ')).toBeNull();
  });
});

describe('tabLabel', () => {
  it('is the page’s title, or its host until it has one', () => {
    expect(tabLabel({ url: 'https://www.pinterest.com/x', title: 'Pins' })).toBe('Pins');
    expect(tabLabel({ url: 'https://www.pinterest.com/x', title: '' })).toBe('pinterest.com');
    expect(tabLabel({ url: '', title: '' })).toBe('');
  });
});
