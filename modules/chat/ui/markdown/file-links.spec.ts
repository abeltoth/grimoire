import { fileOfCode, fileOfLink } from './file-links';

describe('file-links', () => {
  it('takes a link to a file, with its line, and leaves a web page alone', () => {
    expect(fileOfLink('src/app.ts')).toEqual({ path: 'src/app.ts' });
    expect(fileOfLink('src/app.ts#L42')).toEqual({ path: 'src/app.ts', line: 42 });
    expect(fileOfLink('src/app.ts#L42-L50')).toEqual({ path: 'src/app.ts', line: 42 });
    expect(fileOfLink('app.ts:7')).toEqual({ path: 'app.ts', line: 7 });
    expect(fileOfLink('C:/work/my%20app/main.ts:3')).toEqual({
      path: 'C:/work/my app/main.ts',
      line: 3,
    });
    expect(fileOfLink('file:///C:/work/main.ts')).toEqual({ path: 'C:/work/main.ts' });
    expect(fileOfLink('file:///home/me/main.ts')).toEqual({ path: '/home/me/main.ts' });
    expect(fileOfLink('https://example.com/a.ts')).toBeUndefined();
    expect(fileOfLink('mailto:me@example.com')).toBeUndefined();
    expect(fileOfLink('#top')).toBeUndefined();
  });

  it('takes code that names a file by its path or with a line, not a bare name', () => {
    expect(fileOfCode('src/app.ts:42')).toEqual({ path: 'src/app.ts', line: 42 });
    expect(fileOfCode('src/app.ts')).toEqual({ path: 'src/app.ts' });
    expect(fileOfCode('main.ts:9-12')).toEqual({ path: 'main.ts', line: 9 });
    expect(fileOfCode('C:\\work\\main.ts')).toEqual({ path: 'C:\\work\\main.ts' });
    expect(fileOfCode('package.json')).toBeUndefined();
    expect(fileOfCode('v1.2')).toBeUndefined();
    expect(fileOfCode('list.map(fn)')).toBeUndefined();
    expect(fileOfCode('npm run check')).toBeUndefined();
  });
});
