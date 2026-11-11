import { readPicture } from './pictures';

describe('readPicture', () => {
  it('reads a picture small enough to send as it is, base64-encoded', async () => {
    const file = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });
    expect(await readPicture(file)).toEqual({ mediaType: 'image/png', data: 'iVBORw==' });
  });
});
