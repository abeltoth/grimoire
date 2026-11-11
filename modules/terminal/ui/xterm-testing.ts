/** Stands in for the font loading, media queries and resize observing a sheet needs, which the test page lacks. */
export function useTestScreen(): void {
  beforeAll(() => {
    Object.defineProperty(document, 'fonts', {
      value: { load: async () => [] },
      configurable: true,
    });
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    }));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
  });
  afterAll(() => {
    delete (document as { fonts?: unknown }).fonts;
    vi.unstubAllGlobals();
  });
}
