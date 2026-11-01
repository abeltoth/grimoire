import { Injectable, computed, signal } from '@angular/core';

export type ChapterStatus = 'writing' | 'thinking' | 'waiting' | 'idle' | 'blank';

export interface OpenChapter {
  id: string;
  title: string;
  agent: string;
  status: ChapterStatus;
  /** Approvals waiting for your seal. */
  approvals: number;
}

// The chapters from the design's screen 1.
const MOCK_CHAPTERS: OpenChapter[] = [
  {
    id: 'context-meter',
    title: 'Context meter',
    agent: 'Claude Code',
    status: 'writing',
    approvals: 0,
  },
  {
    id: 'flaky-login-test',
    title: 'Fix flaky login test',
    agent: 'Codex',
    status: 'waiting',
    approvals: 1,
  },
  {
    id: 'storage-migrations',
    title: 'Refactor storage migrations',
    agent: 'Gemini CLI',
    status: 'thinking',
    approvals: 0,
  },
  {
    id: 'morning-summary',
    title: 'Morning repo summary',
    agent: 'Claude Code',
    status: 'idle',
    approvals: 0,
  },
];

/** The chapters open as ribbons. Mock data until phase 6 reads them from the service. */
@Injectable({ providedIn: 'root' })
export class OpenChapters {
  readonly all = signal<readonly OpenChapter[]>(MOCK_CHAPTERS);
  readonly currentId = signal(MOCK_CHAPTERS[0]!.id);
  readonly current = computed(() => this.all().find((chapter) => chapter.id === this.currentId()));

  open(id: string): void {
    this.currentId.set(id);
  }
}
