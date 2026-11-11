import { TestBed } from '@angular/core/testing';
import { type DiagramLook, Diagrams, diagramLook } from './diagrams';

const look: DiagramLook = { font: 'serif', size: '16px', dark: false };

describe('diagramLook', () => {
  it('reads the book’s look where the diagram is, as Mermaid takes it', () => {
    const where = document.createElement('div');
    where.style.setProperty('--ink', 'rgb(16, 32, 48)');
    where.style.setProperty('--page', 'rgb(250, 245, 230)');
    where.style.setProperty('--font', 'Garamond');
    where.style.setProperty('--size', '15px');
    document.body.append(where);
    try {
      expect(diagramLook(where)).toMatchObject({
        ink: '#102030',
        page: '#faf5e6',
        font: 'Garamond',
        size: '15px',
        dark: false,
      });
      where.style.setProperty('--page', 'rgb(20, 20, 30)');
      expect(diagramLook(where).dark).toBe(true);
    } finally {
      where.remove();
    }
  });
});

describe('Diagrams', () => {
  it('says why Mermaid couldn’t read a diagram, in its first line', async () => {
    const drawn = await TestBed.inject(Diagrams).draw('not a diagram at all', look);
    expect(drawn).toEqual({ problem: expect.any(String) });
    expect((drawn as { problem: string }).problem).not.toContain('\n');
  });

  it('keeps a diagram drawn in a look, so showing it again doesn’t wait', () => {
    const diagrams = TestBed.inject(Diagrams);
    const first = diagrams.draw('graph TD\n  A --> B', look);
    expect(diagrams.draw('graph TD\n  A --> B', look)).toBe(first);
    expect(diagrams.draw('graph TD\n  A --> B', { ...look, dark: true })).not.toBe(first);
  });
});
