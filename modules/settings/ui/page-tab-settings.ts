import { Component, computed, inject } from '@angular/core';
import { SETTINGS_TAB } from '@grimoire/contract';
import { Wording } from '@ui/app/core/wording';
import { PageTabOrder } from '@ui/app/shell/page/page-tab-order';
import { Icon } from '@ui/design-system/icon';

/**
 * The page tabs, on the Settings page: each can be moved up or down the
 * fore-edge, or hidden from it and shown again. Settings can't be hidden,
 * since it's where hidden tabs are shown again.
 */
@Component({
  selector: 'gr-page-tab-settings',
  imports: [Icon],
  templateUrl: './page-tab-settings.html',
  styleUrls: ['./page-tab-settings.css', './settings-sections.css'],
})
export class PageTabSettings {
  protected readonly order = inject(PageTabOrder);
  protected readonly wording = inject(Wording);
  protected readonly settingsTab = SETTINGS_TAB;
  protected readonly settingsLabel = computed(() => {
    const tab = this.order.all().find((entry) => entry.id === SETTINGS_TAB);
    return tab ? this.wording.label(tab) : 'Settings';
  });
}
