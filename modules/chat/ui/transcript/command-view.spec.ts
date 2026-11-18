import { TestBed } from '@angular/core/testing';
import { CommandView } from './command-view';

describe('CommandView', () => {
  async function view(command: string, shell: 'bash' | 'powershell' = 'bash') {
    const fixture = TestBed.createComponent(CommandView);
    fixture.componentRef.setInput('command', command);
    fixture.componentRef.setInput('shell', shell);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const texts = (selector: string) =>
      [...el.querySelectorAll(selector)].map((node) => node.textContent!.trim());
    return { fixture, el, texts };
  }

  it('sets the command a line each, a $ before its first', async () => {
    const { el, texts } = await view('npm test \\\n  --watch=false');
    expect(texts('.code')).toEqual(['npm test \\', '--watch=false']);
    expect(texts('.prompt')).toEqual(['$', '']);
    expect(el.querySelector('.fold')).toBeNull();
    expect(el.querySelector('.parts')!.classList).not.toContain('folded');
  });

  it('sets a heredoc apart under what reads it', async () => {
    const { texts } = await view("cd /repo && python - <<'EOF'\nprint(1)\n\nprint(2)\nEOF");
    expect(texts('.part:not(.script) .code')).toEqual(["cd /repo && python - <<'EOF'"]);
    expect(texts('.script .label')).toEqual(['python']);
    expect(texts('.script .code')).toEqual(['print(1)', '', 'print(2)']);
    expect(texts('.prompt').filter(Boolean)).toEqual(['$']);
  });

  it('folds a long command until you ask for all of it', async () => {
    const body = Array.from({ length: 15 }, (_, i) => `print(${i})`).join('\n');
    const { fixture, el, texts } = await view(`python - <<'EOF'\n${body}\nEOF`);
    expect(el.querySelector('.parts')!.classList).toContain('folded');
    expect(texts('.fold')).toEqual(['Show all 17 lines']);

    el.querySelector<HTMLButtonElement>('.fold')!.click();
    await fixture.whenStable();
    expect(el.querySelector('.parts')!.classList).not.toContain('folded');
    expect(texts('.fold')).toEqual(['Show less']);
  });
});
