import { BrowserWindow } from 'electron';
import type { EventPayload, Profiles } from '@grimoire/contract';
import { ActiveProfile } from './active-profile';
import type { ServiceClient } from './service-client';
import { type LaunchOptions, ensureService } from './service-launcher';

/**
 * The background service, reached once and again after it closes. Its
 * events go to every window, and another profile put in use opens the
 * windows on that profile's chats.
 */
export class Service {
  private client: Promise<ServiceClient> | undefined;
  /** The profile in use: when another is put in use, the windows open on its chats. */
  private readonly activeProfile = new ActiveProfile();

  constructor(
    private readonly options: LaunchOptions,
    private readonly profileChanged: () => void,
    private readonly ensure: typeof ensureService = ensureService,
  ) {}

  get(): Promise<ServiceClient> {
    this.client ??= this.ensure(this.options).then(
      (client) => {
        client.on('close', () => (this.client = undefined));
        client.on('event', (name, payload) => {
          for (const win of BrowserWindow.getAllWindows())
            win.webContents.send('grimoire:event', name, payload);
          if (name !== 'profiles.changed') return;
          const { profiles } = payload as EventPayload<'profiles.changed'>;
          if (this.activeProfile.changedTo(profiles.active)) this.profileChanged();
        });
        client
          .request('profiles.list', {})
          .then((profiles) => {
            if (this.activeProfile.changedTo((profiles as Profiles).active)) this.profileChanged();
          })
          .catch((error: unknown) => console.error(error));
        return client;
      },
      (error: unknown) => {
        this.client = undefined;
        throw error;
      },
    );
    return this.client;
  }

  /** Stops the service, as smoke tests and captures do once they're done. */
  async stop(): Promise<void> {
    const client = await this.get();
    const closed = new Promise<void>((resolve) => client.once('close', resolve));
    client.shutdown();
    await closed;
  }
}
