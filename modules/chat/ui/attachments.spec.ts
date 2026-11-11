import { type PendingTasks, signal } from '@angular/core';
import type { Attachment } from '@grimoire/contract';
import { fakeBridge, picture, render, withFiles, write } from '@ui/testing/app-testing';
import { Enclosing } from './attachments';

describe('attachments', () => {
  it('attaches files, and pasted or dropped pictures, and sends them with the message', async () => {
    const { bridge, calls } = fakeBridge({
      chooseFiles: vi.fn(async () => ['C:/work/grimoire/src/app/ribbon.ts', 'D:/notes.txt']),
      pathOf: vi.fn((file: File) =>
        file.name === 'README.md' ? 'C:/work/grimoire/README.md' : '',
      ),
    });
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');

    el.querySelector<HTMLButtonElement>('[aria-label="Attach files or a screenshot"]')!.click();
    await fixture.whenStable();
    expect(texts('gr-composer .ref code')).toEqual(['src/app/ribbon.ts', 'D:/notes.txt']);
    expect(texts('gr-composer .ref figcaption span')).toEqual([
      'Ref. 1. Attached file',
      'Ref. 2. Attached file',
    ]);

    const field = el.querySelector<HTMLTextAreaElement>('#gr-next-message')!;
    field.dispatchEvent(withFiles('paste', [picture('shot.png')]));
    await fixture.whenStable();
    field.dispatchEvent(
      withFiles('drop', [new File(['# Grimoire'], 'README.md'), picture('photo.png')]),
    );
    await fixture.whenStable();
    expect(texts('gr-composer .ref code')).toEqual([
      'src/app/ribbon.ts',
      'D:/notes.txt',
      'README.md',
    ]);
    expect(texts('gr-composer .plate figcaption span')).toEqual([
      expect.stringMatching(/^Plate I\. Screenshot, pasted at .+$/),
      expect.stringMatching(/^Plate II\. Picture, dropped at .+$/),
    ]);
    expect(el.querySelector('gr-composer .plate img')!.getAttribute('src')).toBe(
      'data:image/png;base64,AQID',
    );

    el.querySelector<HTMLButtonElement>('[aria-label="Remove notes.txt"]')!.click();
    el.querySelector<HTMLButtonElement>('[aria-label="Remove plate II"]')!.click();
    await fixture.whenStable();
    await write(fixture, el, 'Why is this blurry?');
    expect(calls.filter((c) => c.command === 'agents.send').at(-1)!.request).toEqual({
      chatId: 'chat-1',
      text: 'Why is this blurry?',
      attachments: [
        { kind: 'file', path: 'C:/work/grimoire/src/app/ribbon.ts' },
        {
          kind: 'picture',
          mediaType: 'image/png',
          data: 'AQID',
          caption: expect.stringMatching(/^Screenshot, pasted at /),
        },
        { kind: 'file', path: 'C:/work/grimoire/README.md' },
      ],
    });
    expect(el.querySelector('gr-composer gr-attachments')).toBeNull();
  });

  it('shows what went with a message, on its page and while it waits', async () => {
    const { bridge, emit } = fakeBridge();
    const { fixture, el, texts } = await render(bridge);
    await write(fixture, el, 'First');
    emit('agents.entry', {
      chatId: 'chat-1',
      entry: {
        kind: 'user',
        id: 'u2',
        text: '',
        attachments: [
          { kind: 'picture', mediaType: 'image/png', data: 'AQID' },
          { kind: 'file', path: 'src/app/ribbon.ts' },
        ],
      },
    });
    emit('agents.queued', {
      chatId: 'chat-1',
      queued: [
        {
          id: 'q1',
          text: 'And this.',
          attachments: [{ kind: 'file', path: 'C:/work/grimoire/notes.txt' }],
        },
      ],
    });
    await fixture.whenStable();
    expect(texts('.you p')).toEqual(['First']);
    expect(texts('.you .plate figcaption span')).toEqual(['Plate I. Picture']);
    expect(texts('.you .ref code')).toEqual(['src/app/ribbon.ts']);
    expect(el.querySelector('.you .x')).toBeNull();
    expect(texts('.queued-text')).toEqual(['And this. + 1 attached']);

    [...el.querySelectorAll<HTMLButtonElement>('.queued button')]
      .find((b) => b.textContent!.trim() === 'Edit')!
      .click();
    await fixture.whenStable();
    expect(el.querySelector<HTMLTextAreaElement>('#gr-next-message')!.value).toBe('And this.');
    expect(texts('gr-composer .ref code')).toEqual(['notes.txt']);
  });
});

describe('Enclosing', () => {
  const enclosing = (paths: Record<string, string> = {}) => {
    const attachments = signal<readonly Attachment[]>([]);
    const { bridge } = fakeBridge({ pathOf: (file: File) => paths[file.name] ?? '' });
    return { attachments, enclosing: new Enclosing(attachments, bridge, {} as PendingTasks) };
  };

  it('adds each file once', () => {
    const { attachments, enclosing: files } = enclosing();
    files.add([{ kind: 'file', path: 'C:/a.txt' }]);
    files.add([
      { kind: 'file', path: 'C:/a.txt' },
      { kind: 'file', path: 'C:/b.txt' },
    ]);
    expect(attachments()).toEqual([
      { kind: 'file', path: 'C:/a.txt' },
      { kind: 'file', path: 'C:/b.txt' },
    ]);
  });

  it('takes files dropped from the disk by their path, and leaves anything else', () => {
    const { attachments, enclosing: files } = enclosing({ 'a.txt': 'C:/a.txt' });
    const dropped = [new File([''], 'a.txt'), new File([''], 'b.bin')];
    const event = {
      dataTransfer: { files: dropped },
      preventDefault: vi.fn(),
    } as unknown as DragEvent;
    files.drop(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(attachments()).toEqual([{ kind: 'file', path: 'C:/a.txt' }]);
  });

  it('pastes anything but a picture as usual', () => {
    const { enclosing: files } = enclosing();
    const event = {
      clipboardData: { files: [] },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    files.paste(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
