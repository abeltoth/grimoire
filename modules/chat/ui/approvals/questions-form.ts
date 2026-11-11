import { Component, computed, input, linkedSignal, output } from '@angular/core';
import type { Answer, Approval } from '@grimoire/contract';
import { Icon } from '@ui/design-system/icon';

const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

/**
 * The agent's clarifying questions as a printed form: tick an option, or
 * several where it asks for any, and add your own words.
 */
@Component({
  selector: 'gr-questions-form',
  imports: [Icon],
  templateUrl: './questions-form.html',
  styleUrl: './questions-form.css',
})
export class QuestionsForm {
  readonly approval = input.required<Approval>();
  readonly agentName = input.required<string>();
  readonly answered = output<Answer[]>();

  protected readonly questions = computed(() => this.approval().questions ?? []);
  protected readonly headId = computed(() => `gr-questions-${this.approval().id}`);
  protected readonly chosen = linkedSignal<readonly (readonly string[])[]>(() =>
    this.questions().map(() => []),
  );
  protected readonly ownWords = linkedSignal<readonly string[]>(() =>
    this.questions().map(() => ''),
  );

  protected numeral(index: number): string {
    return NUMERALS[index] ?? String(index + 1);
  }

  /** The name that groups a question's options. */
  protected group(index: number): string {
    return `${this.headId()}-${index}`;
  }

  protected isChosen(index: number, label: string): boolean {
    return this.chosen()[index]?.includes(label) ?? false;
  }

  /** A click flips the option; a radio can't untick natively, so a single choice is handled here. */
  protected toggle(index: number, label: string, many: boolean, input: HTMLInputElement): void {
    const on = !this.isChosen(index, label);
    input.checked = on;
    this.chosen.update((all) =>
      all.map((chosen, i) => {
        if (i !== index) return chosen;
        if (!many) return on ? [label] : [];
        return on ? [...chosen, label] : chosen.filter((l) => l !== label);
      }),
    );
  }

  protected write(index: number, text: string): void {
    this.ownWords.update((all) => all.map((words, i) => (i === index ? text : words)));
  }

  protected send(event: Event): void {
    event.preventDefault();
    this.answered.emit(
      this.questions().map((_, i) => {
        const ownWords = this.ownWords()[i]!.trim();
        return { chosen: [...this.chosen()[i]!], ...(ownWords ? { ownWords } : {}) };
      }),
    );
  }
}
