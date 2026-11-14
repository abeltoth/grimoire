import { Component, inject, input } from '@angular/core';
import { ChatActions } from '@ui/app/core/chat-actions';
import { Wording } from '@ui/app/core/wording';

/**
 * A line in a chat's page header while its process is outdated: what
 * changed, such as a new MCP server, and a Restart to take it in or a
 * Dismiss to keep the process as it is.
 */
@Component({
  selector: 'gr-restart-notice',
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
