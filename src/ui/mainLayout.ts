import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  TextRenderable,
} from '@opentui/core';
import type { MessageTarget } from '../utils/tuiMessageInput';
import type { ChatLine } from './tuiChatLines';

export interface UINodes {
  renderer: CliRenderer;
  mainBox: BoxRenderable;
  titleText: TextRenderable;
  subtitleText: TextRenderable;
  platformTexts: Map<string, TextRenderable>;
  memoryText: TextRenderable;
  obsText: TextRenderable;
  demoText: TextRenderable;
  totalViewersText: TextRenderable;
  activityBar: BoxRenderable;
  activityBarText: TextRenderable;
  chatScroll: ScrollBoxRenderable;
  sidebarBox: BoxRenderable;
  sidebarScroll: ScrollBoxRenderable;
  composeTargetText: TextRenderable;
  inputEl: InputRenderable;
  autocompleteHint: TextRenderable;
}

type SettingsReader = {
  get(key: string, fallback?: unknown): unknown;
};

type PlatformProviderLike = {
  getStatus(): { authenticated: boolean; streamStatus: string };
  getViewerCount(): number;
  getStreamStartTime(): Date | null;
};

type MemoryStatusNodeState = { visible: boolean; content: string; fg: string };

export type MainLayoutContext = {
  renderer: CliRenderer;
  previousUiNodes: UINodes | null;
  messages: ChatLine[];
  settings: SettingsReader;
  platforms: string[];
  providers: Record<string, PlatformProviderLike>;
  obsConnected: boolean;
  demoVisible: boolean;
  selectedMessageTarget: MessageTarget;
  boolSetting: (value: unknown, fallback: boolean) => boolean;
  numSetting: (value: unknown, fallback: number) => number;
  formatElapsed: (start: Date) => string;
  buildPlatformStatusContent: (
    platform: string,
    status: { authenticated: boolean; streamStatus: string },
    viewers: string,
  ) => string | unknown;
  getPlatformStatusColor: (status: { authenticated: boolean; streamStatus: string }) => string;
  getTuiMemoryStatusNodeState: () => MemoryStatusNodeState;
  openMemoryStatusModal: () => void;
  openActivityModal: () => void;
  onActivityBarMouseOver: () => void;
  onActivityBarMouseOut: () => void;
  updateActivityBarText: (node: TextRenderable) => void;
  activityBarShouldBeVisible: () => boolean;
  renderChatLine: (renderer: CliRenderer, msg: ChatLine) => TextRenderable | BoxRenderable;
  fillSidebar: (
    renderer: CliRenderer,
    scroll: ScrollBoxRenderable,
    eventsVisible: boolean,
    logsVisible: boolean,
    eventsTail: number,
    logsTail: number,
  ) => void;
  getMessageTargetColor: (target: MessageTarget) => string;
};

export function initMainLayout(ctx: MainLayoutContext): UINodes {
  const { renderer, previousUiNodes } = ctx;

  if (previousUiNodes) {
    try {
      renderer.root.remove(previousUiNodes.mainBox.id);
    } catch {}
  }

  const titleVisible = ctx.boolSetting(ctx.settings.get('title.visible', false), false);
  const viewersVisible = ctx.boolSetting(ctx.settings.get('viewers.visible', true), true);
  const viewersMode = (ctx.settings.get('viewers.mode', 'per-platform') ??
    'per-platform') as string;
  const eventsVisible = ctx.boolSetting(ctx.settings.get('events.visible', true), true);
  const logsVisible = ctx.boolSetting(ctx.settings.get('logs.visible', true), true);
  const sidebarWidth = (ctx.settings.get('events.width', '30%') ?? '30%') as string;
  const logsTail = ctx.numSetting(ctx.settings.get('logs.tail', 20), 20);
  const eventsTail = ctx.numSetting(ctx.settings.get('events.tail', 15), 15);
  const messagesPosition = (ctx.settings.get('messages.position', 'bottom') ?? 'bottom') as string;

  const mainBox = new BoxRenderable(renderer, {
    id: 'yash-root',
    width: '100%',
    height: '100%',
    flexDirection: 'column',
  });

  const titleText = new TextRenderable(renderer, {
    content: 'YASH - Yet Another Streamer Helper',
    attributes: TextAttributes.BOLD,
    fg: 'cyan',
  });
  titleText.visible = titleVisible;

  const subtitleText = new TextRenderable(renderer, {
    content: 'Unified platform management for YouTube, Twitch, and Kick',
    fg: 'gray',
  });
  subtitleText.visible = titleVisible;

  mainBox.add(titleText);
  mainBox.add(subtitleText);

  const platformRow = new BoxRenderable(renderer, { flexDirection: 'row' });
  platformRow.add(new TextRenderable(renderer, { content: 'Status  ', fg: 'gray' }));

  const platformTexts = new Map<string, TextRenderable>();
  let totalViewers = 0;
  for (const platform of ctx.platforms) {
    const provider = ctx.providers[platform];
    if (!provider) continue;
    const status = provider.getStatus();
    const viewerCount = provider.getViewerCount();
    totalViewers += viewerCount;
    const showViewers = ctx.settings.get(`platforms.${platform}.showViewers`, true) !== false;
    const isOnline = status.streamStatus === 'ONLINE';
    const startTime = provider.getStreamStartTime();
    const elapsed = isOnline && startTime ? ctx.formatElapsed(startTime) : null;
    const viewers =
      isOnline && showViewers && viewersVisible
        ? elapsed
          ? ` (${elapsed}/${viewerCount})`
          : ` (${viewerCount})`
        : '';
    const t = new TextRenderable(renderer, {
      content: ctx.buildPlatformStatusContent(platform, status, viewers) as string,
      fg: ctx.getPlatformStatusColor(status),
    });
    platformTexts.set(platform, t);
    platformRow.add(t);
  }

  const totalViewersText = new TextRenderable(renderer, {
    content: `Total viewers: ${totalViewers}  `,
    fg: 'cyan',
  });
  totalViewersText.visible =
    viewersVisible && (viewersMode === 'cumulative' || viewersMode === 'both');
  platformRow.add(totalViewersText);

  const initialMemoryState = ctx.getTuiMemoryStatusNodeState();
  const memoryText = new TextRenderable(renderer, {
    content: initialMemoryState.content,
    fg: initialMemoryState.fg,
  });
  memoryText.visible = initialMemoryState.visible;
  memoryText.onMouseDown = (e) => {
    if (e.button === 0) ctx.openMemoryStatusModal();
  };
  platformRow.add(memoryText);

  const obsText = new TextRenderable(renderer, {
    content: `OBS: ${ctx.obsConnected ? '✓' : '✗'}  `,
    fg: ctx.obsConnected ? 'green' : 'gray',
  });
  platformRow.add(obsText);

  const demoText = new TextRenderable(renderer, {
    content: '[DEMO MODE]',
    fg: 'yellow',
    attributes: TextAttributes.BOLD,
  });
  demoText.visible = ctx.demoVisible;
  platformRow.add(demoText);

  const activityBarLabel = new TextRenderable(renderer, {
    content: 'Activity  ',
    fg: 'gray',
  });
  const activityBarText = new TextRenderable(renderer, {
    content: '',
    fg: 'white',
  });
  const activityBar = new BoxRenderable(renderer, {
    flexDirection: 'row',
    width: '100%',
  });
  activityBar.add(activityBarLabel);
  activityBar.add(activityBarText);
  activityBar.onMouseDown = () => ctx.openActivityModal();
  activityBarLabel.onMouseDown = () => ctx.openActivityModal();
  activityBarText.onMouseDown = () => ctx.openActivityModal();
  activityBar.onMouseOver = () => ctx.onActivityBarMouseOver();
  activityBar.onMouseOut = () => ctx.onActivityBarMouseOut();
  ctx.updateActivityBarText(activityBarText);
  activityBar.visible = ctx.activityBarShouldBeVisible();

  const contentRow = new BoxRenderable(renderer, {
    flexDirection: 'row',
    width: '100%',
    flexGrow: 1,
    marginTop: 1,
  });

  const chatScroll = new ScrollBoxRenderable(renderer, {
    height: '100%',
    stickyScroll: true,
    stickyStart: 'bottom',
  });
  for (const msg of ctx.messages) {
    chatScroll.add(ctx.renderChatLine(renderer, msg));
  }

  const chatBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: true,
    padding: 1,
    flexGrow: 1,
    title: ' Chat ',
  });
  chatBox.add(chatScroll);
  contentRow.add(chatBox);

  const sidebarScroll = new ScrollBoxRenderable(renderer, {
    height: '100%',
    stickyScroll: true,
    stickyStart: 'bottom',
  });
  ctx.fillSidebar(renderer, sidebarScroll, eventsVisible, logsVisible, eventsTail, logsTail);

  const sidebarBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: ['top', 'right', 'bottom'],
    padding: 1,
    width: sidebarWidth as `${number}%`,
    flexDirection: 'column',
    title: ' Events & Logs ',
  });
  sidebarBox.add(sidebarScroll);
  sidebarBox.visible = eventsVisible || logsVisible;
  contentRow.add(sidebarBox);

  const inputEl =
    previousUiNodes?.inputEl ??
    new InputRenderable(renderer, {
      placeholder: 'type a message…',
      width: '90%',
    });
  (inputEl as unknown as { fg: string }).fg = 'white';

  const inputBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: ['left', 'right', 'bottom'],
    padding: 1,
    width: '100%',
    flexDirection: 'column',
    gap: 1,
  });
  const inputRow = new BoxRenderable(renderer, { flexDirection: 'row', width: '100%' });
  const composeTargetText =
    previousUiNodes?.composeTargetText ??
    new TextRenderable(renderer, {
      content: `${ctx.selectedMessageTarget} > `,
      fg: ctx.getMessageTargetColor(ctx.selectedMessageTarget),
    });
  inputRow.add(composeTargetText);
  inputRow.add(inputEl);
  inputBox.add(inputRow);

  const autocompleteHint =
    previousUiNodes?.autocompleteHint ?? new TextRenderable(renderer, { content: '', fg: 'gray' });
  autocompleteHint.visible = false;
  inputBox.add(autocompleteHint);

  if (messagesPosition === 'top') {
    mainBox.add(contentRow);
    mainBox.add(activityBar);
    mainBox.add(platformRow);
  } else {
    mainBox.add(platformRow);
    mainBox.add(activityBar);
    mainBox.add(contentRow);
  }
  if (messagesPosition !== 'hide') {
    mainBox.add(inputBox);
  }

  renderer.root.add(mainBox);

  return {
    renderer,
    mainBox,
    titleText,
    subtitleText,
    platformTexts,
    memoryText,
    obsText,
    demoText,
    totalViewersText,
    activityBar,
    activityBarText,
    chatScroll,
    sidebarBox,
    sidebarScroll,
    composeTargetText,
    inputEl,
    autocompleteHint,
  };
}
