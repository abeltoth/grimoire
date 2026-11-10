import { Injectable, inject } from '@angular/core';
import { AgentCatalog } from './agent-catalog';
import { ChatActions } from './chat-actions';
import { ChatList } from './chat-list';
import { NewChats } from './new-chats';

export type { Chat, Setting, SettingsPick } from './chat';

/** The open chats, their agents and what you do in them, in one place while callers move to the four parts. */
@Injectable({ providedIn: 'root' })
export class Chats {
  // The list first, so the service is asked for things in the order it was before the split.
  private readonly list = inject(ChatList);
  private readonly catalog = inject(AgentCatalog);
  private readonly newChats = inject(NewChats);
  private readonly actions = inject(ChatActions);

  readonly popout = this.list.popout;
  readonly settingsCard = this.list.settingsCard;
  readonly all = this.list.all;
  readonly currentId = this.list.currentId;
  readonly current = this.list.current;
  readonly besideId = this.list.besideId;
  readonly beside = this.list.beside;
  readonly openSettings = this.list.openSettings.bind(this.list);
  readonly closeSettings = this.list.closeSettings.bind(this.list);
  readonly newChat = this.list.newChat.bind(this.list);
  readonly newBeside = this.list.newBeside.bind(this.list);
  readonly putBeside = this.list.putBeside.bind(this.list);
  readonly setAside = this.list.setAside.bind(this.list);
  readonly open = this.list.open.bind(this.list);
  readonly adopt = this.list.adopt.bind(this.list);
  readonly has = this.list.has.bind(this.list);
  readonly close = this.list.close.bind(this.list);
  readonly popOut = this.list.popOut.bind(this.list);
  readonly openChat = this.list.openChat.bind(this.list);
  readonly fail = this.list.fail.bind(this.list);

  readonly agents = this.catalog.agents;
  readonly models = this.catalog.models;
  readonly folders = this.catalog.folders;
  readonly can = this.catalog.can.bind(this.catalog);
  readonly agentName = this.catalog.agentName.bind(this.catalog);
  readonly modelName = this.catalog.modelName.bind(this.catalog);
  readonly modelLabel = this.catalog.modelLabel.bind(this.catalog);
  readonly effortOf = this.catalog.effortOf.bind(this.catalog);
  readonly folderName = this.catalog.folderName.bind(this.catalog);
  readonly loadFolders = this.catalog.loadFolders.bind(this.catalog);
  readonly pastChats = this.catalog.pastChats.bind(this.catalog);

  readonly startOf = this.newChats.startOf.bind(this.newChats);
  readonly onBegun = this.newChats.onBegun.bind(this.newChats);

  readonly configure = this.actions.configure.bind(this.actions);
  readonly setUp = this.actions.setUp.bind(this.actions);
  readonly takeFollowUp = this.actions.takeFollowUp.bind(this.actions);
  readonly send = this.actions.send.bind(this.actions);
  readonly sendParallel = this.actions.sendParallel.bind(this.actions);
  readonly interrupt = this.actions.interrupt.bind(this.actions);
  readonly undo = this.actions.undo.bind(this.actions);
  readonly fork = this.actions.fork.bind(this.actions);
  readonly rename = this.actions.rename.bind(this.actions);
  readonly unqueue = this.actions.unqueue.bind(this.actions);
  readonly takeOver = this.actions.takeOver.bind(this.actions);
  readonly decide = this.actions.decide.bind(this.actions);
  readonly answer = this.actions.answer.bind(this.actions);
}
