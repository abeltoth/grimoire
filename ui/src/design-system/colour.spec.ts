import { hex } from './colour';

describe('hex', () => {
  let where: HTMLElement;
  beforeEach(() => {
    where = document.createElement('div');
    document.body.append(where);
  });
  afterEach(() => {
    where.remove();
  });

  it('writes a colour as #rrggbb, with its alpha when it has one', () => {
    expect(hex(where, 'rgb(250, 245, 230)')).toBe('#faf5e6');
    expect(hex(where, 'rgba(0, 0, 0, 0.5)')).toBe('#00000080');
    expect(where.childElementCount).toBe(0);
  });

  it('gives nothing for no colour', () => {
    expect(hex(where, '')).toBeUndefined();
  });
});
