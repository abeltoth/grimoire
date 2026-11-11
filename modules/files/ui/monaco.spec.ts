import { type MonacoApi, languageOf } from './monaco';

describe('languageOf', () => {
  const monaco = {
    languages: {
      getLanguages: () => [
        { id: 'typescript', extensions: ['.ts'] },
        { id: 'typescript-declaration', extensions: ['.d.ts'] },
        { id: 'dockerfile', extensions: ['.dockerfile'], filenames: ['Dockerfile'] },
      ],
    },
  } as unknown as MonacoApi;

  it('knows a file by its whole name before its extension, in any case', () => {
    expect(languageOf(monaco, 'C:/work/app/dockerfile')).toBe('dockerfile');
  });

  it('takes the longest extension a file ends with', () => {
    expect(languageOf(monaco, 'src/app.ts')).toBe('typescript');
    expect(languageOf(monaco, 'src/types.D.TS')).toBe('typescript-declaration');
  });

  it('calls a file it doesn’t know plain text', () => {
    expect(languageOf(monaco, 'notes.txt')).toBe('plaintext');
  });
});
