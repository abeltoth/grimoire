import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { pictureAt } from './pictures';

describe('pictureAt', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'grimoire-pictures-'));
  writeFileSync(path.join(folder, 'shot.PNG'), Buffer.from([1, 2, 3]));
  writeFileSync(path.join(folder, 'notes.txt'), 'notes');
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  it('reads a picture file, by its full path or from the chat folder', () => {
    const picture = { mediaType: 'image/png', data: 'AQID' };
    expect(pictureAt(path.join(folder, 'shot.PNG'))).toEqual(picture);
    expect(pictureAt('shot.PNG', folder)).toEqual(picture);
  });

  it('reads nothing that is not a picture, or not there', () => {
    expect(pictureAt(path.join(folder, 'notes.txt'))).toBeNull();
    expect(pictureAt(path.join(folder, 'gone.png'))).toBeNull();
  });
});
