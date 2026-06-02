import { describe, expect, test } from 'bun:test';
import { buildTuiSettingsEntries, validateTuiSettingsDraft } from '../src/utils/tuiSettings';

describe('validateTuiSettingsDraft', () => {
  test('accepts a valid settings draft', () => {
    const result = validateTuiSettingsDraft({
      demo: true,
      titleVisible: false,
      viewersVisible: true,
      viewersMode: 'both',
      platformIconsVisible: true,
      platformIconsYoutubeSizePx: '24',
      platformIconsTwitchSizePx: '24',
      platformIconsKickSizePx: '24',
      memoryStatusVisible: true,
      memoryStatusGreenMaxMb: '500',
      memoryStatusOrangeMinMb: '2048',
      memoryStatusRedMinMb: '5120',
      messagesPosition: 'top',
      chatTimestampsVisible: true,
      tuiEmotesScale: '150',
      chatMaxHistorySize: '1500',
      eventsVisible: true,
      eventsTail: '30',
      eventsWidth: '35%',
      logsVisible: true,
      logsHeight: '18',
      logsTail: '40',
      youtubeShowViewers: true,
      twitchShowViewers: false,
      kickShowViewers: true,
      activityVisible: true,
      activityMode: 'timed',
      activityTimeout: '15',
    });

    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({
      demo: true,
      titleVisible: false,
      viewersVisible: true,
      viewersMode: 'both',
      platformIconsVisible: true,
      platformIconsYoutubeSizePx: 24,
      platformIconsTwitchSizePx: 24,
      platformIconsKickSizePx: 24,
      memoryStatusVisible: true,
      memoryStatusGreenMaxMb: 500,
      memoryStatusOrangeMinMb: 2048,
      memoryStatusRedMinMb: 5120,
      messagesPosition: 'top',
      chatTimestampsVisible: true,
      tuiEmotesScale: 150,
      chatMaxHistorySize: 1500,
      eventsVisible: true,
      eventsTail: 30,
      eventsWidth: '35%',
      logsVisible: true,
      logsHeight: 18,
      logsTail: 40,
      youtubeShowViewers: true,
      twitchShowViewers: false,
      kickShowViewers: true,
      activityVisible: true,
      activityMode: 'timed',
      activityTimeout: 15,
    });
  });

  test('rejects invalid numbers and enum values', () => {
    const result = validateTuiSettingsDraft({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'sideways',
      platformIconsVisible: false,
      platformIconsYoutubeSizePx: '0',
      platformIconsTwitchSizePx: '0',
      platformIconsKickSizePx: '0',
      memoryStatusVisible: false,
      memoryStatusGreenMaxMb: '3000',
      memoryStatusOrangeMinMb: '2000',
      memoryStatusRedMinMb: '1500',
      messagesPosition: 'middle',
      chatTimestampsVisible: false,
      tuiEmotesScale: '0',
      chatMaxHistorySize: '0',
      eventsVisible: false,
      eventsTail: '-2',
      eventsWidth: '80%',
      logsVisible: true,
      logsHeight: 'abc',
      logsTail: '0',
      youtubeShowViewers: true,
      twitchShowViewers: true,
      kickShowViewers: true,
      activityVisible: false,
      activityMode: 'blinking',
      activityTimeout: '0',
    });

    expect(result.values).toBeNull();
    expect(result.errors).toContain('tui.emotes.scale must be a positive integer.');
    expect(result.errors).toContain('chat.maxHistorySize must be a positive integer.');
    expect(result.errors).toContain(
      'status.platformIcons.youtube.sizePx must be a positive integer.',
    );
    expect(result.errors).toContain(
      'status.platformIcons.twitch.sizePx must be a positive integer.',
    );
    expect(result.errors).toContain('status.platformIcons.kick.sizePx must be a positive integer.');
    expect(result.errors).toContain('events.tail must be a positive integer.');
    expect(result.errors).toContain('logs.height must be a positive integer.');
    expect(result.errors).toContain('logs.tail must be a positive integer.');
    expect(result.errors).toContain('viewers.mode must be one of: per-platform, cumulative, both');
    expect(result.errors).toContain('messages.position must be one of: top, bottom, hide');
    expect(result.errors).toContain('events.width must be one of: 25%, 30%, 35%, 40%, 45%, 50%');
    expect(result.errors).toContain('activity.timeout must be a positive integer.');
    expect(result.errors).toContain('activity.mode must be one of: permanent, timed');
    expect(result.errors).toContain(
      'memory.status.greenMaxMb must be lower than memory.status.orangeMinMb.',
    );
    expect(result.errors).toContain(
      'memory.status.orangeMinMb must be lower than memory.status.redMinMb.',
    );
  });

  test('rejects activityTimeout: negative integer', () => {
    const result = validateTuiSettingsDraft({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'both',
      platformIconsVisible: false,
      platformIconsYoutubeSizePx: '24',
      platformIconsTwitchSizePx: '24',
      platformIconsKickSizePx: '24',
      memoryStatusVisible: true,
      memoryStatusGreenMaxMb: '500',
      memoryStatusOrangeMinMb: '2048',
      memoryStatusRedMinMb: '5120',
      messagesPosition: 'top',
      chatTimestampsVisible: false,
      tuiEmotesScale: '100',
      chatMaxHistorySize: '100',
      eventsVisible: false,
      eventsTail: '10',
      eventsWidth: '30%',
      logsVisible: false,
      logsHeight: '10',
      logsTail: '10',
      youtubeShowViewers: false,
      twitchShowViewers: false,
      kickShowViewers: false,
      activityVisible: true,
      activityMode: 'timed',
      activityTimeout: '-5',
    });

    expect(result.values).toBeNull();
    expect(result.errors).toContain('activity.timeout must be a positive integer.');
  });

  test('rejects activityTimeout: non-numeric string', () => {
    const result = validateTuiSettingsDraft({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'both',
      platformIconsVisible: false,
      platformIconsYoutubeSizePx: '24',
      platformIconsTwitchSizePx: '24',
      platformIconsKickSizePx: '24',
      memoryStatusVisible: true,
      memoryStatusGreenMaxMb: '500',
      memoryStatusOrangeMinMb: '2048',
      memoryStatusRedMinMb: '5120',
      messagesPosition: 'top',
      chatTimestampsVisible: false,
      tuiEmotesScale: '100',
      chatMaxHistorySize: '100',
      eventsVisible: false,
      eventsTail: '10',
      eventsWidth: '30%',
      logsVisible: false,
      logsHeight: '10',
      logsTail: '10',
      youtubeShowViewers: false,
      twitchShowViewers: false,
      kickShowViewers: false,
      activityVisible: true,
      activityMode: 'timed',
      activityTimeout: 'abc',
    });

    expect(result.values).toBeNull();
    expect(result.errors).toContain('activity.timeout must be a positive integer.');
  });

  test('accepts activityMode: permanent and activityVisible: false', () => {
    const result = validateTuiSettingsDraft({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'both',
      platformIconsVisible: false,
      platformIconsYoutubeSizePx: '24',
      platformIconsTwitchSizePx: '24',
      platformIconsKickSizePx: '24',
      memoryStatusVisible: false,
      memoryStatusGreenMaxMb: '500',
      memoryStatusOrangeMinMb: '2048',
      memoryStatusRedMinMb: '5120',
      messagesPosition: 'top',
      chatTimestampsVisible: false,
      tuiEmotesScale: '100',
      chatMaxHistorySize: '100',
      eventsVisible: false,
      eventsTail: '10',
      eventsWidth: '30%',
      logsVisible: false,
      logsHeight: '10',
      logsTail: '10',
      youtubeShowViewers: false,
      twitchShowViewers: false,
      kickShowViewers: false,
      activityVisible: false,
      activityMode: 'permanent',
      activityTimeout: '10',
    });

    expect(result.errors).toEqual([]);
    expect(result.values).not.toBeNull();
    expect(result.values?.activityMode).toBe('permanent');
    expect(result.values?.activityVisible).toBe(false);
  });

  test('accepts activityTimeout: 1 (minimum valid value)', () => {
    const result = validateTuiSettingsDraft({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'both',
      platformIconsVisible: false,
      platformIconsYoutubeSizePx: '24',
      platformIconsTwitchSizePx: '24',
      platformIconsKickSizePx: '24',
      memoryStatusVisible: true,
      memoryStatusGreenMaxMb: '500',
      memoryStatusOrangeMinMb: '2048',
      memoryStatusRedMinMb: '5120',
      messagesPosition: 'top',
      chatTimestampsVisible: false,
      tuiEmotesScale: '100',
      chatMaxHistorySize: '100',
      eventsVisible: false,
      eventsTail: '10',
      eventsWidth: '30%',
      logsVisible: false,
      logsHeight: '10',
      logsTail: '10',
      youtubeShowViewers: false,
      twitchShowViewers: false,
      kickShowViewers: false,
      activityVisible: true,
      activityMode: 'timed',
      activityTimeout: '1',
    });

    expect(result.errors).toEqual([]);
    expect(result.values).not.toBeNull();
    expect(result.values?.activityTimeout).toBe(1);
  });
});

describe('buildTuiSettingsEntries', () => {
  test('maps validated values to persisted settings keys', () => {
    const entries = buildTuiSettingsEntries({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'per-platform',
      platformIconsVisible: true,
      platformIconsYoutubeSizePx: 28,
      platformIconsTwitchSizePx: 22,
      platformIconsKickSizePx: 24,
      memoryStatusVisible: true,
      memoryStatusGreenMaxMb: 500,
      memoryStatusOrangeMinMb: 2048,
      memoryStatusRedMinMb: 5120,
      messagesPosition: 'bottom',
      chatTimestampsVisible: true,
      tuiEmotesScale: 125,
      chatMaxHistorySize: 1000,
      eventsVisible: true,
      eventsTail: 15,
      eventsWidth: '30%',
      logsVisible: true,
      logsHeight: 15,
      logsTail: 20,
      youtubeShowViewers: true,
      twitchShowViewers: true,
      kickShowViewers: false,
      activityVisible: true,
      activityMode: 'permanent',
      activityTimeout: 10,
    });

    expect(entries).toContainEqual({ key: 'messages.position', value: 'bottom' });
    expect(entries).toContainEqual({ key: 'status.platformIcons.visible', value: true });
    expect(entries).toContainEqual({ key: 'status.platformIcons.youtube.sizePx', value: 28 });
    expect(entries).toContainEqual({ key: 'status.platformIcons.twitch.sizePx', value: 22 });
    expect(entries).toContainEqual({ key: 'status.platformIcons.kick.sizePx', value: 24 });
    expect(entries).toContainEqual({ key: 'memory.status.visible', value: true });
    expect(entries).toContainEqual({ key: 'memory.status.greenMaxMb', value: 500 });
    expect(entries).toContainEqual({ key: 'memory.status.orangeMinMb', value: 2048 });
    expect(entries).toContainEqual({ key: 'memory.status.redMinMb', value: 5120 });
    expect(entries).toContainEqual({ key: 'tui.emotes.scale', value: 125 });
    expect(entries).toContainEqual({ key: 'logs.tail', value: 20 });
    expect(entries).toContainEqual({ key: 'platforms.kick.showViewers', value: false });
    expect(entries).toContainEqual({ key: 'activity.visible', value: true });
    expect(entries).toContainEqual({ key: 'activity.mode', value: 'permanent' });
    expect(entries).toContainEqual({ key: 'activity.timeout', value: 10 });
    expect(entries).toHaveLength(28);
  });
});
