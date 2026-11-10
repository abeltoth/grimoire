import {
  Component,
  type PendingTasks,
  type WritableSignal,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import type { Attachment, GrimoireBridge } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { readPicture } from './pictures';

type Shown =
  | { kind: 'plate'; attachment: Attachment; number: string; src: string; caption: string }
  | { kind: 'ref'; attachment: Attachment; number: number; name: string; file: string };

/**
 * What's sent with a message: pictures as numbered plates with captions, and
 * files as numbered references. On the next page each has a cross that
 * takes it off.
 */
@Component({
  selector: 'gr-attachments',
  imports: [Icon],
  templateUrl: './attachments.html',
  styleUrl: './attachments.css',
})
export class Attachments {
  private readonly catalog = inject(AgentCatalog);

  readonly attachments = input.required<readonly Attachment[]>();
  /** The chat's folder: files inside it are named from it. */
  readonly cwd = input<string>();
  readonly removable = input(false, { transform: booleanAttribute });
  readonly removed = output<Attachment>();

  protected readonly shown = computed(() => {
    let plates = 0;
    let refs = 0;
    return this.attachments().map((attachment): Shown => {
      if (attachment.kind === 'picture')
        return {
          kind: 'plate',
          attachment,
          number: roman(++plates),
          src: `data:${attachment.mediaType};base64,${attachment.data}`,
          caption: attachment.caption ?? 'Picture',
        };
      return {
        kind: 'ref',
        attachment,
        number: ++refs,
        name: relativeTo(this.cwd(), attachment.path) ?? this.catalog.folderName(attachment.path),
        file: attachment.path.split(/[\\/]/).at(-1) ?? attachment.path,
      };
    });
  });
}

/**
 * What goes with a message as you pick, paste and drop it: files as
 * references, pictures as plates, each file once.
 */
export class Enclosing {
  constructor(
    private readonly attachments: WritableSignal<readonly Attachment[]>,
    private readonly bridge: GrimoireBridge,
    private readonly pending: PendingTasks,
  ) {}

  /** Asks for files with the system's picker. */
  async attach(): Promise<void> {
    const paths = await this.bridge.chooseFiles().catch(() => []);
    this.add(paths.map((path): Attachment => ({ kind: 'file', path })));
  }

  /** A pasted picture comes in as a plate; anything else pastes as usual. */
  paste(event: ClipboardEvent): void {
    const pictures = [...(event.clipboardData?.files ?? [])].filter((file) =>
      file.type.startsWith('image/'),
    );
    if (!pictures.length) return;
    event.preventDefault();
    for (const picture of pictures) this.addPicture(picture, `Screenshot, pasted at ${now()}`);
  }

  /** Files dropped on the page come in as references; pictures from elsewhere, as plates. */
  drop(event: DragEvent): void {
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!files.length) return;
    event.preventDefault();
    for (const file of files) {
      const path = this.bridge.pathOf(file);
      if (path) this.add([{ kind: 'file', path }]);
      else if (file.type.startsWith('image/'))
        this.addPicture(file, `Picture, dropped at ${now()}`);
    }
  }

  /** Adds to what goes with the message; a file already there isn't added twice. */
  add(added: readonly Attachment[]): void {
    this.attachments.update((all) => [
      ...all,
      ...added.filter(
        (attachment) =>
          attachment.kind !== 'file' ||
          !all.some((kept) => kept.kind === 'file' && kept.path === attachment.path),
      ),
    ]);
  }

  private addPicture(file: Blob, caption: string): void {
    this.pending.run(async () => {
      const picture = await readPicture(file);
      this.add([{ kind: 'picture', ...picture, caption }]);
    });
  }
}

function now(): string {
  return new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** A path inside the folder, from the folder, with forward slashes; undefined when it's outside. */
function relativeTo(cwd: string | undefined, file: string): string | undefined {
  if (!cwd) return undefined;
  const slashed = (path: string) => path.replaceAll('\\', '/').replace(/\/$/, '');
  const folder = slashed(cwd);
  const path = slashed(file);
  // Windows paths don't care about case.
  const caseless = /^[a-z]:/i.test(folder);
  const inside = caseless
    ? path.toLowerCase().startsWith(`${folder.toLowerCase()}/`)
    : path.startsWith(`${folder}/`);
  return inside ? path.slice(folder.length + 1) : undefined;
}

function roman(n: number): string {
  const numerals: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let rest = n;
  let written = '';
  for (const [value, numeral] of numerals) {
    while (rest >= value) {
      written += numeral;
      rest -= value;
    }
  }
  return written;
}
