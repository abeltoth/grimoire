import { Component, computed, inject } from '@angular/core';
import type { AgentId, AgentModel } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Settings } from '@ui/app/core/settings';

/** An agent's models to pick for quick jobs, the one it recommends among them. */
interface QuickChoice {
  agent: AgentId;
  name: string;
  models: readonly AgentModel[];
  recommended?: string;
  recommendedName?: string;
  picked?: string;
}

/**
 * The model each agent does Grimoire's quick jobs on, such as picking a
 * chat's model on Auto: the one the agent recommends until you pick
 * another. Picking the recommended one again follows the agent's choice.
 */
@Component({
  selector: 'gr-quick-model-settings',
  templateUrl: './quick-model-settings.html',
  styleUrls: ['./general-settings.css', './settings-sections.css'],
})
export class QuickModelSettings {
  private readonly settings = inject(Settings);
  private readonly catalog = inject(AgentCatalog);

  protected readonly choices = computed((): QuickChoice[] =>
    this.catalog
      .agents()
      .filter((agent) => agent.capabilities.includes('ask'))
      .map((agent) => {
        const listed = this.catalog.models()[agent.id];
        const recommended = listed?.quick;
        const listedModels = listed?.models ?? [];
        const models =
          recommended && !listedModels.some((model) => model.id === recommended)
            ? [...listedModels, { id: recommended, name: recommended }]
            : listedModels;
        return {
          agent: agent.id,
          name: agent.name,
          models,
          recommended,
          recommendedName: models.find((model) => model.id === recommended)?.name,
          picked: this.settings.all().quickModels[agent.id] ?? recommended,
        };
      }),
  );

  protected pick(choice: QuickChoice, model: string): void {
    const { [choice.agent]: _, ...others } = this.settings.all().quickModels;
    void this.settings.set({
      quickModels: model === choice.recommended ? others : { ...others, [choice.agent]: model },
    });
  }
}
