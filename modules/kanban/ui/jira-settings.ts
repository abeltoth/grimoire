import { Component, inject } from '@angular/core';
import { DEFAULT_JIRA_QUERY, type GrimoireSettings } from '@grimoire/contract';
import { Settings } from '@ui/app/core/settings';
import { Wording } from '@ui/app/core/wording';

/**
 * Jira's settings, on the Settings page: whether your issues show on the
 * Kanban board and chats offer to link or create one, the query that
 * picks the issues, and the project and type a new issue for a chat
 * begins with. Each is kept as soon as it's picked or written.
 */
@Component({
  selector: 'gr-jira-settings',
  templateUrl: './jira-settings.html',
  styleUrl: './jira-settings.css',
})
export class JiraSettings {
  protected readonly settings = inject(Settings);
  protected readonly wording = inject(Wording);

  protected set(change: Partial<GrimoireSettings>): void {
    void this.settings.set(change);
  }

  /** Keeps the Jira query written; emptied, it's the one the board began with. */
  protected setQuery(field: HTMLTextAreaElement): void {
    const query = field.value.trim() || DEFAULT_JIRA_QUERY;
    field.value = query;
    if (query !== this.settings.all().jiraQuery) this.set({ jiraQuery: query });
  }

  /** Keeps the project's key written, in capitals; emptied, a new issue goes where most of the board's are. */
  protected setProject(field: HTMLInputElement): void {
    const project = field.value.trim().toUpperCase();
    if (project && !/^[A-Z][A-Z0-9_]*$/.test(project)) {
      field.value = this.settings.all().jiraProject;
      return;
    }
    field.value = project;
    if (project !== this.settings.all().jiraProject) this.set({ jiraProject: project });
  }

  /** Keeps the issue type written; emptied, it's Task. */
  protected setIssueType(field: HTMLInputElement): void {
    const type = field.value.trim() || 'Task';
    field.value = type;
    if (type !== this.settings.all().jiraIssueType) this.set({ jiraIssueType: type });
  }
}
