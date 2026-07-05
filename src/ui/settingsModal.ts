import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  ScrollBoxRenderable,
  TextAttributes,
  TextRenderable,
} from '@opentui/core';
import type { ChatMessage } from '../platforms/base';
import { parseLoggerLevelName } from '../utils/logger';
import {
  DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
  DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
  DEFAULT_MEMORY_STATUS_RED_MIN_MB,
  DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
} from '../utils/memoryStatus';
import {
  DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
  getPlatformStatusIconPlatformSizeSettingKey,
  PLATFORM_STATUS_ICON_SETTING_KEY,
} from '../utils/platformStatusIcons';
import {
  buildTuiSettingsEntries,
  SETTINGS_ACTIVITY_MODES,
  SETTINGS_LOG_LEVELS,
  SETTINGS_MESSAGE_POSITIONS,
  SETTINGS_VIEWER_MODES,
  SETTINGS_WIDTH_OPTIONS,
  validateTuiSettingsDraft,
} from '../utils/tuiSettings';
import type { ChatLine } from './tuiChatLines';

export type SettingsModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

type SettingsStoreLike = {
  get(key: string, fallback?: any): any;
};

type SettingsModalUiNodes = {
  renderer: CliRenderer;
  inputEl: InputRenderable;
};

export type SettingsModalContext = {
  uiNodes: SettingsModalUiNodes | null;
  hasBlockingModal: () => boolean;
  getActiveSettingsModal: () => SettingsModalState | null;
  setActiveSettingsModal: (modal: SettingsModalState | null) => void;
  settings: SettingsStoreLike;
  defaultTuiEmoteScalePercent: number;
  lastMessages: ChatLine[];
  lastRawMessages: ChatMessage[];
  updateUI: (messages: ChatLine[]) => void;
  createIndentedInputRow: (
    renderer: CliRenderer,
    input: InputRenderable,
    indent?: string,
  ) => BoxRenderable;
  persistSettingEntries: (entries: Array<{ key: string; value: unknown }>) => Promise<string[]>;
  transformMessage: (msg: ChatMessage) => ChatLine;
  reloadTuiFfzEmotes: (reason: string) => Promise<void>;
};

function boolSetting(value: unknown, def: boolean): boolean {
  if (value === null || value === undefined) return def;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function numSetting(value: unknown, def: number): number {
  if (value === null || value === undefined) return def;
  if (typeof value === 'number') return value;
  return parseInt(String(value), 10) || def;
}

export function cycleSettingsOption<T extends string>(
  current: string,
  options: readonly T[],
  direction: 1 | -1,
): T {
  const currentIndex = Math.max(0, options.indexOf(current as T));
  const nextIndex = (currentIndex + direction + options.length) % options.length;
  return options[nextIndex] ?? options[0] ?? (current as T);
}

export function openSettingsModal(ctx: SettingsModalContext): void {
  if (!ctx.uiNodes || ctx.getActiveSettingsModal() || ctx.hasBlockingModal()) return;
  const { renderer } = ctx.uiNodes;
  const {
    settings,
    defaultTuiEmoteScalePercent,
    lastMessages,
    lastRawMessages,
    updateUI,
    createIndentedInputRow,
    persistSettingEntries,
    transformMessage,
    reloadTuiFfzEmotes,
  } = ctx;

  const draft = {
    demo: boolSetting(settings.get('demo', false), false),
    titleVisible: boolSetting(settings.get('title.visible', false), false),
    viewersVisible: boolSetting(settings.get('viewers.visible', true), true),
    viewersMode: String(settings.get('viewers.mode', 'per-platform') ?? 'per-platform'),
    platformIconsVisible: boolSetting(settings.get(PLATFORM_STATUS_ICON_SETTING_KEY, false), false),
    platformIconsYoutubeSizePx: String(
      numSetting(
        settings.get(
          getPlatformStatusIconPlatformSizeSettingKey('youtube'),
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
        ),
        DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
      ),
    ),
    platformIconsTwitchSizePx: String(
      numSetting(
        settings.get(
          getPlatformStatusIconPlatformSizeSettingKey('twitch'),
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
        ),
        DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
      ),
    ),
    platformIconsKickSizePx: String(
      numSetting(
        settings.get(
          getPlatformStatusIconPlatformSizeSettingKey('kick'),
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
        ),
        DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
      ),
    ),
    memoryStatusVisible: boolSetting(settings.get('memory.status.visible', false), false),
    memoryStatusGreenMaxMb: String(
      numSetting(
        settings.get('memory.status.greenMaxMb', DEFAULT_MEMORY_STATUS_GREEN_MAX_MB),
        DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
      ),
    ),
    memoryStatusOrangeMinMb: String(
      numSetting(
        settings.get('memory.status.orangeMinMb', DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB),
        DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
      ),
    ),
    memoryStatusRedMinMb: String(
      numSetting(
        settings.get('memory.status.redMinMb', DEFAULT_MEMORY_STATUS_RED_MIN_MB),
        DEFAULT_MEMORY_STATUS_RED_MIN_MB,
      ),
    ),
    memoryTelemetryEnabled: boolSetting(settings.get('memory.telemetry.enabled', false), false),
    memoryTelemetryIntervalMinutes: String(
      numSetting(
        settings.get('memory.telemetry.intervalMinutes', DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES),
        DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
      ),
    ),
    messagesPosition: String(settings.get('messages.position', 'bottom') ?? 'bottom'),
    chatTimestampsVisible: boolSetting(settings.get('chat.timestamps.visible', true), true),
    tuiEmotesScale: String(
      numSetting(
        settings.get('tui.emotes.scale', defaultTuiEmoteScalePercent),
        defaultTuiEmoteScalePercent,
      ),
    ),
    chatMaxHistorySize: String(numSetting(settings.get('chat.maxHistorySize', 1000), 1000)),
    eventsVisible: boolSetting(settings.get('events.visible', true), true),
    eventsTail: String(numSetting(settings.get('events.tail', 15), 15)),
    eventsWidth: String(settings.get('events.width', '30%') ?? '30%'),
    logsVisible: boolSetting(settings.get('logs.visible', true), true),
    logsLevel: parseLoggerLevelName(settings.get('logs.level', 'info')),
    logsHeight: String(numSetting(settings.get('logs.height', 15), 15)),
    logsTail: String(numSetting(settings.get('logs.tail', 20), 20)),
    youtubeShowViewers: boolSetting(settings.get('platforms.youtube.showViewers', true), true),
    twitchShowViewers: boolSetting(settings.get('platforms.twitch.showViewers', true), true),
    kickShowViewers: boolSetting(settings.get('platforms.kick.showViewers', true), true),
    activityVisible: boolSetting(settings.get('activity.visible', true), true),
    activityMode: String(settings.get('activity.mode', 'permanent') ?? 'permanent'),
    activityTimeout: String(numSetting(settings.get('activity.timeout', 10), 10)),
  };
  const initialSettingsResult = validateTuiSettingsDraft(draft);
  const initialEntries = initialSettingsResult.values
    ? buildTuiSettingsEntries(initialSettingsResult.values)
    : [];
  const initialValueByKey = new Map(initialEntries.map((entry) => [entry.key, entry.value]));

  function makeLabel(text: string): TextRenderable {
    return new TextRenderable(renderer, { content: text, fg: 'gray' });
  }

  function makeToggleRow(label: string, value: boolean, focused: boolean): string {
    return `${focused ? '▶' : ' '} ${label}: ${value ? 'ON' : 'OFF'}`;
  }

  function makeEnumRow(label: string, value: string, focused: boolean): string {
    return `${focused ? '▶' : ' '} ${label}: ${value}`;
  }

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '4%',
    left: '8%',
    width: '84%',
    height: '90%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 0,
    title: ' Settings ',
  });

  // Scrollable content area — everything below the intro header lives here
  const contentScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
  });
  const contentBox = new BoxRenderable(renderer, {
    flexDirection: 'column',
    gap: 1,
    width: '100%',
  });

  const intro = new TextRenderable(renderer, {
    content:
      ' Tab/Shift+Tab move focus. Space or ◄/► toggles/cycles rows. Enter saves all changes. Esc cancels.',
    fg: 'gray',
  });
  const displayHeading = new TextRenderable(renderer, {
    content: ' Display',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const demoRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const titleVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const viewersVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const viewersModeRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const platformIconsVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const platformIconsYoutubeSizeLabel = makeLabel(
    '  status.platformIcons.youtube.sizePx: YouTube logo size override in pixels',
  );
  const platformIconsYoutubeSizeInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX),
    width: '100%',
  });
  const platformIconsYoutubeSizeInputRow = createIndentedInputRow(
    renderer,
    platformIconsYoutubeSizeInput,
    '    ',
  );
  platformIconsYoutubeSizeInput.value = draft.platformIconsYoutubeSizePx;
  const platformIconsTwitchSizeLabel = makeLabel(
    '  status.platformIcons.twitch.sizePx: Twitch logo size override in pixels',
  );
  const platformIconsTwitchSizeInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX),
    width: '100%',
  });
  const platformIconsTwitchSizeInputRow = createIndentedInputRow(
    renderer,
    platformIconsTwitchSizeInput,
    '    ',
  );
  platformIconsTwitchSizeInput.value = draft.platformIconsTwitchSizePx;
  const platformIconsKickSizeLabel = makeLabel(
    '  status.platformIcons.kick.sizePx: Kick logo size override in pixels',
  );
  const platformIconsKickSizeInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX),
    width: '100%',
  });
  const platformIconsKickSizeInputRow = createIndentedInputRow(
    renderer,
    platformIconsKickSizeInput,
    '    ',
  );
  platformIconsKickSizeInput.value = draft.platformIconsKickSizePx;
  const memoryStatusVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const memoryStatusGreenMaxMbLabel = makeLabel(
    '  memory.status.greenMaxMb: green at or below this RSS threshold in MB',
  );
  const memoryStatusGreenMaxMbInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_STATUS_GREEN_MAX_MB),
    width: '100%',
  });
  const memoryStatusGreenMaxMbInputRow = createIndentedInputRow(
    renderer,
    memoryStatusGreenMaxMbInput,
    '    ',
  );
  memoryStatusGreenMaxMbInput.value = draft.memoryStatusGreenMaxMb;
  const memoryStatusOrangeMinMbLabel = makeLabel(
    '  memory.status.orangeMinMb: orange at or above this RSS threshold in MB',
  );
  const memoryStatusOrangeMinMbInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB),
    width: '100%',
  });
  const memoryStatusOrangeMinMbInputRow = createIndentedInputRow(
    renderer,
    memoryStatusOrangeMinMbInput,
    '    ',
  );
  memoryStatusOrangeMinMbInput.value = draft.memoryStatusOrangeMinMb;
  const memoryStatusRedMinMbLabel = makeLabel(
    '  memory.status.redMinMb: red at or above this RSS threshold in MB',
  );
  const memoryStatusRedMinMbInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_STATUS_RED_MIN_MB),
    width: '100%',
  });
  const memoryStatusRedMinMbInputRow = createIndentedInputRow(
    renderer,
    memoryStatusRedMinMbInput,
    '    ',
  );
  memoryStatusRedMinMbInput.value = draft.memoryStatusRedMinMb;
  const memoryTelemetryEnabledRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const memoryTelemetryIntervalMinutesLabel = makeLabel(
    '  memory.telemetry.intervalMinutes: write RSS telemetry to YASH_DATA_DIR/logs every N minutes',
  );
  const memoryTelemetryIntervalMinutesInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES),
    width: '100%',
  });
  const memoryTelemetryIntervalMinutesInputRow = createIndentedInputRow(
    renderer,
    memoryTelemetryIntervalMinutesInput,
    '    ',
  );
  memoryTelemetryIntervalMinutesInput.value = draft.memoryTelemetryIntervalMinutes;
  const messagesPositionRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const chatTimestampsRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const tuiEmotesScaleLabel = makeLabel(
    '  tui.emotes.scale: percent size for inline TUI emotes (100 = normal, 150 = larger)',
  );
  const tuiEmotesScaleInput = new InputRenderable(renderer, {
    placeholder: '100',
    width: '100%',
  });
  const tuiEmotesScaleInputRow = createIndentedInputRow(renderer, tuiEmotesScaleInput, '    ');
  tuiEmotesScaleInput.value = draft.tuiEmotesScale;
  const historySizeLabel = makeLabel('  chat.maxHistorySize: keep the last N chat lines in memory');
  const historySizeInput = new InputRenderable(renderer, {
    placeholder: '1000',
    width: '100%',
  });
  const historySizeInputRow = createIndentedInputRow(renderer, historySizeInput, '    ');
  historySizeInput.value = draft.chatMaxHistorySize;

  const sidebarHeading = new TextRenderable(renderer, {
    content: ' Sidebar',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const eventsVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const eventsTailLabel = makeLabel('  events.tail: how many event rows to show in the sidebar');
  const eventsTailInput = new InputRenderable(renderer, {
    placeholder: '15',
    width: '100%',
  });
  const eventsTailInputRow = createIndentedInputRow(renderer, eventsTailInput, '    ');
  eventsTailInput.value = draft.eventsTail;
  const eventsWidthRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const logsVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const logsLevelRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const logsHeightLabel = makeLabel(
    '  logs.height: reserved log area height when logs are visible',
  );
  const logsHeightInput = new InputRenderable(renderer, {
    placeholder: '15',
    width: '100%',
  });
  const logsHeightInputRow = createIndentedInputRow(renderer, logsHeightInput, '    ');
  logsHeightInput.value = draft.logsHeight;
  const logsTailLabel = makeLabel('  logs.tail: how many recent log lines to keep visible');
  const logsTailInput = new InputRenderable(renderer, {
    placeholder: '20',
    width: '100%',
  });
  const logsTailInputRow = createIndentedInputRow(renderer, logsTailInput, '    ');
  logsTailInput.value = draft.logsTail;

  const providerHeading = new TextRenderable(renderer, {
    content: ' Per-platform viewers',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const ytViewersRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const twitchViewersRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const kickViewersRow = new TextRenderable(renderer, { content: '', fg: 'white' });

  const activityHeading = new TextRenderable(renderer, {
    content: ' Activity bar',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const activityVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const activityModeRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const activityTimeoutLabel = makeLabel(
    '  activity.timeout: seconds each event stays visible in timed mode',
  );
  const activityTimeoutInput = new InputRenderable(renderer, {
    placeholder: '10',
    width: '100%',
  });
  const activityTimeoutInputRow = createIndentedInputRow(renderer, activityTimeoutInput, '    ');
  activityTimeoutInput.value = draft.activityTimeout;

  // Fixed header
  box.add(intro);
  box.add(new TextRenderable(renderer, { content: '', fg: 'gray' })); // spacer

  // Scrollable content
  contentBox.add(displayHeading);
  contentBox.add(demoRow);
  contentBox.add(titleVisibleRow);
  contentBox.add(viewersVisibleRow);
  contentBox.add(viewersModeRow);
  contentBox.add(platformIconsVisibleRow);
  contentBox.add(platformIconsYoutubeSizeLabel);
  contentBox.add(platformIconsYoutubeSizeInputRow);
  contentBox.add(platformIconsTwitchSizeLabel);
  contentBox.add(platformIconsTwitchSizeInputRow);
  contentBox.add(platformIconsKickSizeLabel);
  contentBox.add(platformIconsKickSizeInputRow);
  contentBox.add(memoryStatusVisibleRow);
  contentBox.add(memoryStatusGreenMaxMbLabel);
  contentBox.add(memoryStatusGreenMaxMbInputRow);
  contentBox.add(memoryStatusOrangeMinMbLabel);
  contentBox.add(memoryStatusOrangeMinMbInputRow);
  contentBox.add(memoryStatusRedMinMbLabel);
  contentBox.add(memoryStatusRedMinMbInputRow);
  contentBox.add(memoryTelemetryEnabledRow);
  contentBox.add(memoryTelemetryIntervalMinutesLabel);
  contentBox.add(memoryTelemetryIntervalMinutesInputRow);
  contentBox.add(messagesPositionRow);
  contentBox.add(chatTimestampsRow);
  contentBox.add(tuiEmotesScaleLabel);
  contentBox.add(tuiEmotesScaleInputRow);
  contentBox.add(historySizeLabel);
  contentBox.add(historySizeInputRow);
  contentBox.add(sidebarHeading);
  contentBox.add(eventsVisibleRow);
  contentBox.add(eventsTailLabel);
  contentBox.add(eventsTailInputRow);
  contentBox.add(eventsWidthRow);
  contentBox.add(logsVisibleRow);
  contentBox.add(logsLevelRow);
  contentBox.add(logsHeightLabel);
  contentBox.add(logsHeightInputRow);
  contentBox.add(logsTailLabel);
  contentBox.add(logsTailInputRow);
  contentBox.add(providerHeading);
  contentBox.add(ytViewersRow);
  contentBox.add(twitchViewersRow);
  contentBox.add(kickViewersRow);
  contentBox.add(activityHeading);
  contentBox.add(activityVisibleRow);
  contentBox.add(activityModeRow);
  contentBox.add(activityTimeoutLabel);
  contentBox.add(activityTimeoutInputRow);
  contentScroll.add(contentBox);
  box.add(contentScroll);
  renderer.root.add(box);

  type SettingsFocusItem =
    | {
        kind: 'toggle';
        node: TextRenderable;
        container: TextRenderable;
        render: (focused: boolean) => void;
        toggle: () => void;
      }
    | {
        kind: 'enum';
        node: TextRenderable;
        container: TextRenderable;
        render: (focused: boolean) => void;
        cycle: (direction: 1 | -1) => void;
      }
    | { kind: 'input'; node: InputRenderable; container: BoxRenderable };

  function scrollCurrentIntoView(): void {
    const current = items[focusIdx];
    if (!current) return;
    contentScroll.scrollChildIntoView(current.container.id);
  }

  const items: SettingsFocusItem[] = [
    {
      kind: 'toggle',
      node: demoRow,
      container: demoRow,
      render: (focused) => {
        demoRow.content = makeToggleRow('demo', draft.demo, focused).concat(
          '  - fake connected providers for local testing',
        );
        demoRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.demo = !draft.demo;
      },
    },
    {
      kind: 'toggle',
      node: titleVisibleRow,
      container: titleVisibleRow,
      render: (focused) => {
        titleVisibleRow.content = makeToggleRow(
          'title.visible',
          draft.titleVisible,
          focused,
        ).concat('  - show or hide the YASH header');
        titleVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.titleVisible = !draft.titleVisible;
      },
    },
    {
      kind: 'toggle',
      node: viewersVisibleRow,
      container: viewersVisibleRow,
      render: (focused) => {
        viewersVisibleRow.content = makeToggleRow(
          'viewers.visible',
          draft.viewersVisible,
          focused,
        ).concat('  - master switch for viewer counters');
        viewersVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.viewersVisible = !draft.viewersVisible;
      },
    },
    {
      kind: 'enum',
      node: viewersModeRow,
      container: viewersModeRow,
      render: (focused) => {
        viewersModeRow.content = makeEnumRow('viewers.mode', draft.viewersMode, focused).concat(
          '  - per platform, total only, or both',
        );
        viewersModeRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.viewersMode = cycleSettingsOption(
          draft.viewersMode,
          SETTINGS_VIEWER_MODES,
          direction,
        );
      },
    },
    {
      kind: 'toggle',
      node: platformIconsVisibleRow,
      container: platformIconsVisibleRow,
      render: (focused) => {
        platformIconsVisibleRow.content = makeToggleRow(
          'status.platformIcons.visible',
          draft.platformIconsVisible,
          focused,
        ).concat('  - swap YOUTUBE/TWITCH/KICK labels for lazily downloaded logos');
        platformIconsVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.platformIconsVisible = !draft.platformIconsVisible;
      },
    },
    {
      kind: 'input',
      node: platformIconsYoutubeSizeInput,
      container: platformIconsYoutubeSizeInputRow,
    },
    {
      kind: 'input',
      node: platformIconsTwitchSizeInput,
      container: platformIconsTwitchSizeInputRow,
    },
    {
      kind: 'input',
      node: platformIconsKickSizeInput,
      container: platformIconsKickSizeInputRow,
    },
    {
      kind: 'toggle',
      node: memoryStatusVisibleRow,
      container: memoryStatusVisibleRow,
      render: (focused) => {
        memoryStatusVisibleRow.content = makeToggleRow(
          'memory.status.visible',
          draft.memoryStatusVisible,
          focused,
        ).concat('  - show current YASH RSS in the status bar');
        memoryStatusVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.memoryStatusVisible = !draft.memoryStatusVisible;
      },
    },
    {
      kind: 'input',
      node: memoryStatusGreenMaxMbInput,
      container: memoryStatusGreenMaxMbInputRow,
    },
    {
      kind: 'input',
      node: memoryStatusOrangeMinMbInput,
      container: memoryStatusOrangeMinMbInputRow,
    },
    {
      kind: 'input',
      node: memoryStatusRedMinMbInput,
      container: memoryStatusRedMinMbInputRow,
    },
    {
      kind: 'toggle',
      node: memoryTelemetryEnabledRow,
      container: memoryTelemetryEnabledRow,
      render: (focused) => {
        memoryTelemetryEnabledRow.content = makeToggleRow(
          'memory.telemetry.enabled',
          draft.memoryTelemetryEnabled,
          focused,
        ).concat('  - append detailed memory telemetry JSONL under YASH_DATA_DIR/logs');
        memoryTelemetryEnabledRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.memoryTelemetryEnabled = !draft.memoryTelemetryEnabled;
      },
    },
    {
      kind: 'input',
      node: memoryTelemetryIntervalMinutesInput,
      container: memoryTelemetryIntervalMinutesInputRow,
    },
    {
      kind: 'enum',
      node: messagesPositionRow,
      container: messagesPositionRow,
      render: (focused) => {
        messagesPositionRow.content = makeEnumRow(
          'messages.position',
          draft.messagesPosition,
          focused,
        ).concat('  - place the message box above, below, or hide it');
        messagesPositionRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.messagesPosition = cycleSettingsOption(
          draft.messagesPosition,
          SETTINGS_MESSAGE_POSITIONS,
          direction,
        );
      },
    },
    {
      kind: 'toggle',
      node: chatTimestampsRow,
      container: chatTimestampsRow,
      render: (focused) => {
        chatTimestampsRow.content = makeToggleRow(
          'chat.timestamps.visible',
          draft.chatTimestampsVisible,
          focused,
        ).concat('  - prefix chat lines with their timestamp');
        chatTimestampsRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.chatTimestampsVisible = !draft.chatTimestampsVisible;
      },
    },
    { kind: 'input', node: tuiEmotesScaleInput, container: tuiEmotesScaleInputRow },
    { kind: 'input', node: historySizeInput, container: historySizeInputRow },
    {
      kind: 'toggle',
      node: eventsVisibleRow,
      container: eventsVisibleRow,
      render: (focused) => {
        eventsVisibleRow.content = makeToggleRow(
          'events.visible',
          draft.eventsVisible,
          focused,
        ).concat('  - show or hide event activity in the sidebar');
        eventsVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.eventsVisible = !draft.eventsVisible;
      },
    },
    { kind: 'input', node: eventsTailInput, container: eventsTailInputRow },
    {
      kind: 'enum',
      node: eventsWidthRow,
      container: eventsWidthRow,
      render: (focused) => {
        eventsWidthRow.content = makeEnumRow('events.width', draft.eventsWidth, focused).concat(
          '  - choose how wide the right sidebar should be',
        );
        eventsWidthRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.eventsWidth = cycleSettingsOption(
          draft.eventsWidth,
          SETTINGS_WIDTH_OPTIONS,
          direction,
        );
      },
    },
    {
      kind: 'toggle',
      node: logsVisibleRow,
      container: logsVisibleRow,
      render: (focused) => {
        logsVisibleRow.content = makeToggleRow('logs.visible', draft.logsVisible, focused).concat(
          '  - show or hide application logs in the sidebar',
        );
        logsVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.logsVisible = !draft.logsVisible;
      },
    },
    {
      kind: 'enum',
      node: logsLevelRow,
      container: logsLevelRow,
      render: (focused) => {
        logsLevelRow.content = makeEnumRow('logs.level', draft.logsLevel, focused).concat(
          '  - choose the minimum application log level kept and shown',
        );
        logsLevelRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.logsLevel = cycleSettingsOption(draft.logsLevel, SETTINGS_LOG_LEVELS, direction);
      },
    },
    { kind: 'input', node: logsHeightInput, container: logsHeightInputRow },
    { kind: 'input', node: logsTailInput, container: logsTailInputRow },
    {
      kind: 'toggle',
      node: ytViewersRow,
      container: ytViewersRow,
      render: (focused) => {
        ytViewersRow.content = makeToggleRow(
          'platforms.youtube.showViewers',
          draft.youtubeShowViewers,
          focused,
        ).concat('  - allow YouTube viewers in the status bar');
        ytViewersRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.youtubeShowViewers = !draft.youtubeShowViewers;
      },
    },
    {
      kind: 'toggle',
      node: twitchViewersRow,
      container: twitchViewersRow,
      render: (focused) => {
        twitchViewersRow.content = makeToggleRow(
          'platforms.twitch.showViewers',
          draft.twitchShowViewers,
          focused,
        ).concat('  - allow Twitch viewers in the status bar');
        twitchViewersRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.twitchShowViewers = !draft.twitchShowViewers;
      },
    },
    {
      kind: 'toggle',
      node: kickViewersRow,
      container: kickViewersRow,
      render: (focused) => {
        kickViewersRow.content = makeToggleRow(
          'platforms.kick.showViewers',
          draft.kickShowViewers,
          focused,
        ).concat('  - allow Kick viewers in the status bar');
        kickViewersRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.kickShowViewers = !draft.kickShowViewers;
      },
    },
    {
      kind: 'toggle',
      node: activityVisibleRow,
      container: activityVisibleRow,
      render: (focused) => {
        activityVisibleRow.content = makeToggleRow(
          'activity.visible',
          draft.activityVisible,
          focused,
        ).concat('  - show or hide the activity bar row (follows, subs, cheers, raids)');
        activityVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.activityVisible = !draft.activityVisible;
      },
    },
    {
      kind: 'enum',
      node: activityModeRow,
      container: activityModeRow,
      render: (focused) => {
        activityModeRow.content = makeEnumRow('activity.mode', draft.activityMode, focused).concat(
          '  - permanent: events stay until cleared; timed: each event expires after timeout',
        );
        activityModeRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.activityMode = cycleSettingsOption(
          draft.activityMode,
          SETTINGS_ACTIVITY_MODES,
          direction,
        );
      },
    },
    { kind: 'input', node: activityTimeoutInput, container: activityTimeoutInputRow },
  ];

  let focusIdx = 0;
  ctx.setActiveSettingsModal({ box, focusIndex: 0 });

  function blurCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') current.node.blur();
    else current.render(false);
  }

  function focusCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') current.node.focus();
    else current.render(true);
    scrollCurrentIntoView();
  }

  function renderRows(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.kind === 'input') continue;
      item.render(i === focusIdx);
    }
  }

  renderRows();
  focusCurrent();

  async function saveAndClose(): Promise<void> {
    const result = validateTuiSettingsDraft({
      ...draft,
      platformIconsYoutubeSizePx: platformIconsYoutubeSizeInput.value,
      platformIconsTwitchSizePx: platformIconsTwitchSizeInput.value,
      platformIconsKickSizePx: platformIconsKickSizeInput.value,
      memoryStatusGreenMaxMb: memoryStatusGreenMaxMbInput.value,
      memoryStatusOrangeMinMb: memoryStatusOrangeMinMbInput.value,
      memoryStatusRedMinMb: memoryStatusRedMinMbInput.value,
      memoryTelemetryIntervalMinutes: memoryTelemetryIntervalMinutesInput.value,
      tuiEmotesScale: tuiEmotesScaleInput.value,
      chatMaxHistorySize: historySizeInput.value,
      eventsTail: eventsTailInput.value,
      logsHeight: logsHeightInput.value,
      logsTail: logsTailInput.value,
      activityTimeout: activityTimeoutInput.value,
    });
    if (!result.values) {
      for (const error of result.errors) {
        lastMessages.push(`[settings] ${error}`);
      }
      updateUI(lastMessages);
      return;
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveSettingsModal(null);
    ctx.uiNodes?.inputEl.focus();

    try {
      const changedEntries = buildTuiSettingsEntries(result.values).filter(
        (entry) => !Object.is(initialValueByKey.get(entry.key), entry.value),
      );
      const changedKeys = await persistSettingEntries(changedEntries);
      if (changedKeys.length === 0) {
        lastMessages.push('[settings] No changes.');
      } else {
        lastMessages.push(`[settings] Updated: ${changedKeys.join(', ')}`);
        if (changedKeys.includes('chat.timestamps.visible')) {
          lastMessages.length = 0;
          for (const raw of lastRawMessages) lastMessages.push(transformMessage(raw));
        }
        if (changedKeys.includes('tui.emotes.scale')) {
          void reloadTuiFfzEmotes('tui-emote-scale-change');
        }
      }
    } catch (err) {
      lastMessages.push(`[settings] Error: ${String(err)}`);
    }
    updateUI(lastMessages);
  }

  function cancelAndClose(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveSettingsModal(null);
    ctx.uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    const activeSettingsModal = ctx.getActiveSettingsModal();
    if (!activeSettingsModal) return false;
    const current = items[focusIdx];
    if (!current) return false;

    if (sequence === '\t' || sequence === '\x1b[Z') {
      blurCurrent();
      const direction = sequence === '\t' ? 1 : -1;
      focusIdx = (focusIdx + direction + items.length) % items.length;
      const activeSettingsModal = ctx.getActiveSettingsModal();
      if (activeSettingsModal) activeSettingsModal.focusIndex = focusIdx;
      focusCurrent();
      return true;
    }

    if (
      sequence === ' ' ||
      (current.kind === 'enum' && (sequence === '\x1b[C' || sequence === '\x1b[D')) ||
      (current.kind === 'toggle' && (sequence === '\x1b[C' || sequence === '\x1b[D'))
    ) {
      if (current.kind === 'toggle') {
        current.toggle();
        current.render(true);
        return true;
      }
      if (current.kind === 'enum') {
        current.cycle(sequence === '\x1b[D' ? -1 : 1);
        current.render(true);
        return true;
      }
    }

    if (sequence === '\r' || sequence === '\n') {
      saveAndClose();
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      cancelAndClose();
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && ctx.getActiveSettingsModal()) cancelAndClose();
  };
  for (const input of [
    platformIconsYoutubeSizeInput,
    platformIconsTwitchSizeInput,
    platformIconsKickSizeInput,
    memoryStatusGreenMaxMbInput,
    memoryStatusOrangeMinMbInput,
    memoryStatusRedMinMbInput,
    memoryTelemetryIntervalMinutesInput,
    historySizeInput,
    eventsTailInput,
    logsHeightInput,
    logsTailInput,
    activityTimeoutInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}
