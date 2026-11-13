import { Component, inject } from '@angular/core';
import { Wording } from '@ui/app/core/wording';
import { GeneralSettings } from './general-settings';
import { PresetSettings } from './preset-settings';
import { ProfileSettings } from './profile-settings';
import { QuickModelSettings } from './quick-model-settings';
import { ThemeEditor } from './theme-editor';

/**
 * The Settings page: how the book is made. Its settings are written out as
 * words to pick, the picked one underlined, and each is kept by the
 * service as soon as it's picked; among them, the account the agent signs
 * in as. Below them, the model each agent does Grimoire's quick jobs on;
 * then the presets, each with the first message its chats begin with, to
 * rename or remove; then the theme. The MCP servers your agents load in
 * your home folder, and those turned off, can be turned off or on in every
 * chat. The Jira query picks the issues on the Kanban board. Last, the
 * profiles: each with its Claude folder, to make, rename, switch to or
 * delete.
 */
@Component({
  selector: 'gr-settings-page',
  imports: [GeneralSettings, QuickModelSettings, PresetSettings, ThemeEditor, ProfileSettings],
  templateUrl: './settings-page.html',
  styleUrls: ['./settings-sections.css', './settings-page.css'],
})
export class SettingsPage {
  protected readonly wording = inject(Wording);
}
