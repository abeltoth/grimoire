import { Component, inject, input } from '@angular/core';
import { ChatActions } from '@ui/app/core/chat-actions';
import { Wording } from '@ui/app/core/wording';
import { Icon } from '@ui/design-system/icon';

/**
 * A slip under a chat's last reply while its process is outdated: what
 * changed, such as an MCP server added, and a Restart to take it in or a
 * dismiss to keep the process as it is.
 */
@Component({
  selector: 'gr-restart-notice',
  imports: [Icon],
  templateUrl: './restart-notice.html',
  styleUrl: './restart-notice.css',
})
export class RestartNotice {
  readonly chatId = input.required<string>();
  /** What changed, in a few words. */
  readonly outdated = input.required<string>();
  protected readonly actions = inject(ChatActions);
  protected readonly wording = inject(Wording);
}
