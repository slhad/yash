export const SETTINGS_VIEWER_MODES = ['per-platform', 'cumulative', 'both'] as const;
export const SETTINGS_MESSAGE_POSITIONS = ['top', 'bottom', 'hide'] as const;
export const SETTINGS_WIDTH_OPTIONS = ['25%', '30%', '35%', '40%', '45%', '50%'] as const;
export const SETTINGS_ACTIVITY_MODES = ['permanent', 'timed'] as const;
export const SETTINGS_LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'none'] as const;

export interface TuiSettingsDraftInput {
  demo: boolean;
  titleVisible: boolean;
  viewersVisible: boolean;
  viewersMode: string;
  platformIconsVisible: boolean;
  platformIconsYoutubeSizePx: string;
  platformIconsTwitchSizePx: string;
  platformIconsKickSizePx: string;
  memoryStatusVisible: boolean;
  memoryStatusGreenMaxMb: string;
  memoryStatusOrangeMinMb: string;
  memoryStatusRedMinMb: string;
  memoryTelemetryEnabled?: boolean;
  memoryTelemetryIntervalMinutes?: string;
  messagesPosition: string;
  chatTimestampsVisible: boolean;
  tuiEmotesScale: string;
  chatMaxHistorySize: string;
  eventsVisible: boolean;
  eventsTail: string;
  eventsWidth: string;
  logsVisible: boolean;
  logsLevel?: string;
  logsHeight: string;
  logsTail: string;
  youtubeShowViewers: boolean;
  twitchShowViewers: boolean;
  kickShowViewers: boolean;
  activityVisible: boolean;
  activityMode: string;
  activityTimeout: string;
}

export interface TuiSettingsValues {
  demo: boolean;
  titleVisible: boolean;
  viewersVisible: boolean;
  viewersMode: (typeof SETTINGS_VIEWER_MODES)[number];
  platformIconsVisible: boolean;
  platformIconsYoutubeSizePx: number;
  platformIconsTwitchSizePx: number;
  platformIconsKickSizePx: number;
  memoryStatusVisible: boolean;
  memoryStatusGreenMaxMb: number;
  memoryStatusOrangeMinMb: number;
  memoryStatusRedMinMb: number;
  memoryTelemetryEnabled: boolean;
  memoryTelemetryIntervalMinutes: number;
  messagesPosition: (typeof SETTINGS_MESSAGE_POSITIONS)[number];
  chatTimestampsVisible: boolean;
  tuiEmotesScale: number;
  chatMaxHistorySize: number;
  eventsVisible: boolean;
  eventsTail: number;
  eventsWidth: (typeof SETTINGS_WIDTH_OPTIONS)[number];
  logsVisible: boolean;
  logsLevel: (typeof SETTINGS_LOG_LEVELS)[number];
  logsHeight: number;
  logsTail: number;
  youtubeShowViewers: boolean;
  twitchShowViewers: boolean;
  kickShowViewers: boolean;
  activityVisible: boolean;
  activityMode: (typeof SETTINGS_ACTIVITY_MODES)[number];
  activityTimeout: number;
}

export interface TuiSettingsEntry {
  key: string;
  value: boolean | number | string;
}

function parsePositiveInt(raw: string, label: string, errors: string[]): number | null {
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    errors.push(`${label} must be a positive integer.`);
    return null;
  }
  return parsed;
}

export function validateTuiSettingsDraft(draft: TuiSettingsDraftInput): {
  values: TuiSettingsValues | null;
  errors: string[];
} {
  const errors: string[] = [];
  const tuiEmotesScale = parsePositiveInt(draft.tuiEmotesScale, 'tui.emotes.scale', errors);
  const chatMaxHistorySize = parsePositiveInt(
    draft.chatMaxHistorySize,
    'chat.maxHistorySize',
    errors,
  );
  const platformIconsYoutubeSizePx = parsePositiveInt(
    draft.platformIconsYoutubeSizePx,
    'status.platformIcons.youtube.sizePx',
    errors,
  );
  const platformIconsTwitchSizePx = parsePositiveInt(
    draft.platformIconsTwitchSizePx,
    'status.platformIcons.twitch.sizePx',
    errors,
  );
  const platformIconsKickSizePx = parsePositiveInt(
    draft.platformIconsKickSizePx,
    'status.platformIcons.kick.sizePx',
    errors,
  );
  const memoryStatusGreenMaxMb = parsePositiveInt(
    draft.memoryStatusGreenMaxMb,
    'memory.status.greenMaxMb',
    errors,
  );
  const memoryStatusOrangeMinMb = parsePositiveInt(
    draft.memoryStatusOrangeMinMb,
    'memory.status.orangeMinMb',
    errors,
  );
  const memoryStatusRedMinMb = parsePositiveInt(
    draft.memoryStatusRedMinMb,
    'memory.status.redMinMb',
    errors,
  );
  const memoryTelemetryIntervalMinutes = parsePositiveInt(
    draft.memoryTelemetryIntervalMinutes ?? '15',
    'memory.telemetry.intervalMinutes',
    errors,
  );
  const eventsTail = parsePositiveInt(draft.eventsTail, 'events.tail', errors);
  const logsHeight = parsePositiveInt(draft.logsHeight, 'logs.height', errors);
  const logsTail = parsePositiveInt(draft.logsTail, 'logs.tail', errors);
  const activityTimeout = parsePositiveInt(draft.activityTimeout, 'activity.timeout', errors);

  if (
    !SETTINGS_VIEWER_MODES.includes(draft.viewersMode as (typeof SETTINGS_VIEWER_MODES)[number])
  ) {
    errors.push(`viewers.mode must be one of: ${SETTINGS_VIEWER_MODES.join(', ')}`);
  }
  if (
    !SETTINGS_MESSAGE_POSITIONS.includes(
      draft.messagesPosition as (typeof SETTINGS_MESSAGE_POSITIONS)[number],
    )
  ) {
    errors.push(`messages.position must be one of: ${SETTINGS_MESSAGE_POSITIONS.join(', ')}`);
  }
  if (
    !SETTINGS_WIDTH_OPTIONS.includes(draft.eventsWidth as (typeof SETTINGS_WIDTH_OPTIONS)[number])
  ) {
    errors.push(`events.width must be one of: ${SETTINGS_WIDTH_OPTIONS.join(', ')}`);
  }
  const logsLevel = draft.logsLevel ?? 'info';
  if (!SETTINGS_LOG_LEVELS.includes(logsLevel as (typeof SETTINGS_LOG_LEVELS)[number])) {
    errors.push(`logs.level must be one of: ${SETTINGS_LOG_LEVELS.join(', ')}`);
  }
  if (
    !SETTINGS_ACTIVITY_MODES.includes(
      draft.activityMode as (typeof SETTINGS_ACTIVITY_MODES)[number],
    )
  ) {
    errors.push(`activity.mode must be one of: ${SETTINGS_ACTIVITY_MODES.join(', ')}`);
  }
  if (
    memoryStatusGreenMaxMb !== null &&
    memoryStatusOrangeMinMb !== null &&
    memoryStatusGreenMaxMb >= memoryStatusOrangeMinMb
  ) {
    errors.push('memory.status.greenMaxMb must be lower than memory.status.orangeMinMb.');
  }
  if (
    memoryStatusOrangeMinMb !== null &&
    memoryStatusRedMinMb !== null &&
    memoryStatusOrangeMinMb >= memoryStatusRedMinMb
  ) {
    errors.push('memory.status.orangeMinMb must be lower than memory.status.redMinMb.');
  }

  if (errors.length > 0) {
    return { values: null, errors };
  }

  return {
    values: {
      demo: draft.demo,
      titleVisible: draft.titleVisible,
      viewersVisible: draft.viewersVisible,
      viewersMode: draft.viewersMode as (typeof SETTINGS_VIEWER_MODES)[number],
      platformIconsVisible: draft.platformIconsVisible,
      platformIconsYoutubeSizePx: platformIconsYoutubeSizePx as number,
      platformIconsTwitchSizePx: platformIconsTwitchSizePx as number,
      platformIconsKickSizePx: platformIconsKickSizePx as number,
      memoryStatusVisible: draft.memoryStatusVisible,
      memoryStatusGreenMaxMb: memoryStatusGreenMaxMb as number,
      memoryStatusOrangeMinMb: memoryStatusOrangeMinMb as number,
      memoryStatusRedMinMb: memoryStatusRedMinMb as number,
      memoryTelemetryEnabled: draft.memoryTelemetryEnabled ?? false,
      memoryTelemetryIntervalMinutes: memoryTelemetryIntervalMinutes as number,
      messagesPosition: draft.messagesPosition as (typeof SETTINGS_MESSAGE_POSITIONS)[number],
      chatTimestampsVisible: draft.chatTimestampsVisible,
      tuiEmotesScale: tuiEmotesScale as number,
      chatMaxHistorySize: chatMaxHistorySize as number,
      eventsVisible: draft.eventsVisible,
      eventsTail: eventsTail as number,
      eventsWidth: draft.eventsWidth as (typeof SETTINGS_WIDTH_OPTIONS)[number],
      logsVisible: draft.logsVisible,
      logsLevel: logsLevel as (typeof SETTINGS_LOG_LEVELS)[number],
      logsHeight: logsHeight as number,
      logsTail: logsTail as number,
      youtubeShowViewers: draft.youtubeShowViewers,
      twitchShowViewers: draft.twitchShowViewers,
      kickShowViewers: draft.kickShowViewers,
      activityVisible: draft.activityVisible,
      activityMode: draft.activityMode as (typeof SETTINGS_ACTIVITY_MODES)[number],
      activityTimeout: activityTimeout as number,
    },
    errors,
  };
}

export function buildTuiSettingsEntries(values: TuiSettingsValues): TuiSettingsEntry[] {
  return [
    { key: 'demo', value: values.demo },
    { key: 'title.visible', value: values.titleVisible },
    { key: 'viewers.visible', value: values.viewersVisible },
    { key: 'viewers.mode', value: values.viewersMode },
    { key: 'status.platformIcons.visible', value: values.platformIconsVisible },
    { key: 'status.platformIcons.youtube.sizePx', value: values.platformIconsYoutubeSizePx },
    { key: 'status.platformIcons.twitch.sizePx', value: values.platformIconsTwitchSizePx },
    { key: 'status.platformIcons.kick.sizePx', value: values.platformIconsKickSizePx },
    { key: 'memory.status.visible', value: values.memoryStatusVisible },
    { key: 'memory.status.greenMaxMb', value: values.memoryStatusGreenMaxMb },
    { key: 'memory.status.orangeMinMb', value: values.memoryStatusOrangeMinMb },
    { key: 'memory.status.redMinMb', value: values.memoryStatusRedMinMb },
    { key: 'memory.telemetry.enabled', value: values.memoryTelemetryEnabled },
    {
      key: 'memory.telemetry.intervalMinutes',
      value: values.memoryTelemetryIntervalMinutes,
    },
    { key: 'messages.position', value: values.messagesPosition },
    { key: 'chat.timestamps.visible', value: values.chatTimestampsVisible },
    { key: 'tui.emotes.scale', value: values.tuiEmotesScale },
    { key: 'chat.maxHistorySize', value: values.chatMaxHistorySize },
    { key: 'events.visible', value: values.eventsVisible },
    { key: 'events.tail', value: values.eventsTail },
    { key: 'events.width', value: values.eventsWidth },
    { key: 'logs.visible', value: values.logsVisible },
    { key: 'logs.level', value: values.logsLevel },
    { key: 'logs.height', value: values.logsHeight },
    { key: 'logs.tail', value: values.logsTail },
    { key: 'platforms.youtube.showViewers', value: values.youtubeShowViewers },
    { key: 'platforms.twitch.showViewers', value: values.twitchShowViewers },
    { key: 'platforms.kick.showViewers', value: values.kickShowViewers },
    { key: 'activity.visible', value: values.activityVisible },
    { key: 'activity.mode', value: values.activityMode },
    { key: 'activity.timeout', value: values.activityTimeout },
  ];
}
