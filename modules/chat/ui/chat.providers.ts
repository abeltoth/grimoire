import type { EnvironmentProviders } from '@angular/core';
import { provideShellEntries } from '@ui/app/shell/shell-registry';
import { ChapterPage } from './chapter-page';

/** The chat module (ADR-008): it fills the left page with the open chapter. */
export function provideChat(): EnvironmentProviders {
  return provideShellEntries((shell) => shell.chapterPage.set(ChapterPage));
}
