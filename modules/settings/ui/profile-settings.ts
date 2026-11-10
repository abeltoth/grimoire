import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { PERSONAL_PROFILE, type Profile } from '@grimoire/contract';
import { AgentCatalog } from '@ui/app/core/agent-catalog';
import { Profiles } from '@ui/app/core/profiles';
import { Wording } from '@ui/app/core/wording';

/**
 * The Settings page's profiles: each with its Claude folder, to make,
 * rename, switch to or delete.
 */
@Component({
  selector: 'gr-profile-settings',
  templateUrl: './profile-settings.html',
  styleUrls: ['./profile-settings.css', './settings-sections.css'],
})
export class ProfileSettings {
  protected readonly catalog = inject(AgentCatalog);
  protected readonly wording = inject(Wording);
  protected readonly profiles = inject(Profiles);
  private readonly injector = inject(Injector);
  private readonly profileField = viewChild<ElementRef<HTMLInputElement>>('profileField');
  private readonly newProfileField = viewChild<ElementRef<HTMLInputElement>>('newProfileField');

  /** While a new profile's name is being written. */
  protected readonly creating = signal(false);
  /** The profile just made, which asks to be signed in. */
  protected readonly made = signal<string | null>(null);
  /** The profile being renamed, by ID. */
  protected readonly renamingProfile = signal<string | null>(null);
  /** The profile asked about before it's deleted, by ID. */
  protected readonly deleting = signal<string | null>(null);
  /** The profile just deleted, and where its Claude folder stays. */
  protected readonly deleted = signal<{ name: string; folder: string } | null>(null);
  /** The profile whose folder's path was copied, by ID. */
  protected readonly copiedFolder = signal<string | null>(null);

  /** Claude Code's usual place, ~/.claude, where Personal leaves it. */
  private readonly usualFolder = computed(() => {
    const home = this.catalog.folders().home;
    if (!home) return '';
    return `${home}${home.includes('\\') ? '\\' : '/'}.claude`;
  });

  /** The profile's Claude folder in full. */
  protected folderOf(profile: Profile): string {
    return profile.claudeFolder ?? this.usualFolder();
  }

  /** Whether the profile can be deleted: not Personal, nor the one in use. */
  protected deletable(profile: Profile): boolean {
    return profile.id !== PERSONAL_PROFILE && profile.id !== this.profiles.list().active;
  }

  /** Why a profile can't be deleted, shown on its Delete. */
  protected whyKept(profile: Profile): string | null {
    if (profile.id === PERSONAL_PROFILE) {
      return this.wording.say(
        'This volume uses Claude Code’s usual place, and stays',
        'This profile uses Claude Code’s usual place, and stays',
      );
    }
    if (profile.id === this.profiles.list().active) {
      return this.wording.say(
        'Open another volume to delete this one',
        'Switch to another profile to delete this one',
      );
    }
    return null;
  }

  protected async copyFolder(profile: Profile): Promise<void> {
    await navigator.clipboard.writeText(this.folderOf(profile));
    this.copiedFolder.set(profile.id);
  }

  protected startCreating(): void {
    this.creating.set(true);
    afterNextRender(() => this.newProfileField()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  /** Makes the profile named, once; Enter and leaving the field both end it. */
  protected async create(name: string): Promise<void> {
    if (!this.creating()) return;
    this.creating.set(false);
    if (!name.trim()) return;
    const profile = await this.profiles.create(name);
    if (profile) this.made.set(profile.id);
  }

  protected startRenamingProfile(id: string): void {
    this.deleting.set(null);
    this.renamingProfile.set(id);
    afterNextRender(
      () => {
        const field = this.profileField()?.nativeElement;
        field?.focus();
        field?.select();
      },
      { injector: this.injector },
    );
  }

  /** Keeps the name written, once; Enter and leaving the field both end the renaming. */
  protected renameProfile(profile: Profile, to: string): void {
    if (this.renamingProfile() !== profile.id) return;
    this.renamingProfile.set(null);
    if (to.trim() && to.trim() !== profile.name) void this.profiles.rename(profile.id, to);
  }

  protected async deleteProfile(profile: Profile): Promise<void> {
    this.deleting.set(null);
    const folder = this.folderOf(profile);
    if (await this.profiles.remove(profile.id)) this.deleted.set({ name: profile.name, folder });
  }
}
