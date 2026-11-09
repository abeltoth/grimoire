import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  afterRenderEffect,
  inject,
  input,
  output,
} from '@angular/core';
import type { EventPayload, TerminalInfo } from '@grimoire/contract';
import type { FitAddon } from '@xterm/addon-fit';
import type { ITheme, Terminal } from '@xterm/xterm';
import { GRIMOIRE_BRIDGE } from '@ui/app/core/bridge';
import { forWindow } from './keys';

/** How the theme draws a terminal, read from its tokens through terminal-sheet.css. */
interface Look {
  theme: ITheme;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  minimumContrastRatio: number;
}

function lookOf(element: Element): Look {
  const style = getComputedStyle(element);
  const token = (name: string) => style.getPropertyValue(`--${name}`).trim();
  const number = (name: string, fallback: number) => {
    const value = parseFloat(token(name));
    return Number.isFinite(value) ? value : fallback;
  };
  const colours = [
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'bright-black',
    'bright-red',
    'bright-green',
    'bright-yellow',
    'bright-blue',
    'bright-magenta',
    'bright-cyan',
    'bright-white',
  ] as const;
  const theme: ITheme = {
    background: token('paper'),
    foreground: token('ink'),
    cursor: token('cursor'),
    cursorAccent: token('cursor-ink'),
    selectionBackground: token('selection'),
    selectionInactiveBackground: token('selection-inactive'),
    scrollbarSliderBackground: token('scrollbar'),
    scrollbarSliderHoverBackground: token('scrollbar-hover'),
    scrollbarSliderActiveBackground: token('scrollbar-hover'),
  };
  for (const colour of colours) {
    const key = colour.replace(/-(\w)/, (_, letter: string) =>
      letter.toUpperCase(),
    ) as keyof ITheme;
    (theme as Record<string, string>)[key] = token(colour);
  }
  return {
    theme,
    fontFamily: token('font'),
    fontSize: number('size', 13),
    lineHeight: number('leading', 1.2),
    minimumContrastRatio: number('min-contrast', 1),
  };
}

/**
 * One shell's sheet in the Terminal, drawn with xterm.js. It draws what
 * the service kept of the shell's screen, then follows its output. xterm.js
 * is loaded only once a sheet is first shown, so it doesn't slow the start.
 */
@Component({
  selector: 'gr-terminal-sheet',
  template: '',
  styleUrl: './terminal-sheet.css',
  // xterm.js builds its own elements, which the stylesheet has to reach.
  encapsulation: ViewEncapsulation.None,
  host: { '[class.shown]': 'shown()' },
})
export class TerminalSheet {
  readonly terminal = input.required<TerminalInfo>();
  /** Only the shown sheet is drawn, sized and focused. */
  readonly shown = input(false);
  /** The size it fits, in cells. */
  readonly fitted = output<{ cols: number; rows: number }>();

  private readonly bridge = inject(GRIMOIRE_BRIDGE);
  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private term?: Terminal;
  private fit?: FitAddon;
  private started = false;
  private destroyed = false;
  private readonly stops: Array<() => void> = [];
  private fitFrame = 0;

  constructor() {
    afterRenderEffect(() => {
      if (!this.shown()) return;
      if (!this.started) void this.start();
      else this.refit(true);
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      cancelAnimationFrame(this.fitFrame);
      for (const stop of this.stops) stop();
      this.term?.dispose();
    });
  }

  private async start(): Promise<void> {
    this.started = true;
    const { id, windowsBuild } = this.terminal();
    const look = lookOf(this.host);

    // Output that comes while the screen is read is kept, and written after
    // it unless the screen already has it.
    let drawn: number | undefined;
    const early: Array<EventPayload<'terminal.output'>> = [];
    const write = (output: EventPayload<'terminal.output'>) => {
      if (drawn !== undefined && output.seq <= drawn) return;
      this.term?.write(output.data);
      drawn = output.seq;
    };
    this.stops.push(
      this.bridge.on('terminal.output', (output) => {
        if (output.id !== id) return;
        if (drawn === undefined) early.push(output);
        else write(output);
      }),
    );

    const [{ Terminal }, { FitAddon }, screen] = await Promise.all([
      import('@xterm/xterm'),
      import('@xterm/addon-fit'),
      this.bridge.invoke('terminal.screen', { id }).catch(() => null),
      // The cell size is measured from the face, so it has to be loaded first.
      document.fonts.load(`${look.fontSize}px ${look.fontFamily}`).catch(() => []),
    ]);
    if (this.destroyed) return;

    const term = new Terminal({
      ...look,
      cols: screen?.cols ?? 80,
      rows: screen?.rows ?? 24,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorInactiveStyle: 'outline',
      scrollback: 5000,
      allowProposedApi: true,
      ...(windowsBuild
        ? { windowsPty: { backend: 'conpty' as const, buildNumber: windowsBuild } }
        : {}),
    });
    this.term = term;
    if (screen) term.write(screen.data);
    drawn = screen?.seq ?? 0;
    for (const output of early) write(output);

    this.fit = new FitAddon();
    term.loadAddon(this.fit);
    term.attachCustomKeyEventHandler(
      (event) => !forWindow(event, term.hasSelection(), this.bridge.platform),
    );
    term.onData((data) => void this.bridge.invoke('terminal.write', { id, data }).catch(() => {}));
    term.onResize(({ cols, rows }) => {
      void this.bridge.invoke('terminal.resize', { id, cols, rows }).catch(() => {});
      this.fitted.emit({ cols, rows });
    });
    term.open(this.host);

    const observer = new ResizeObserver(() => this.refit(false));
    observer.observe(this.host);
    this.stops.push(() => observer.disconnect());
    this.refit(this.shown());
  }

  /** Fits the screen to the sheet on the next frame, while it's shown. */
  private refit(focus: boolean): void {
    cancelAnimationFrame(this.fitFrame);
    this.fitFrame = requestAnimationFrame(() => {
      if (!this.term || !this.shown() || !this.host.offsetWidth || !this.host.offsetHeight) return;
      this.fit?.fit();
      if (focus) this.term.focus();
    });
  }
}
