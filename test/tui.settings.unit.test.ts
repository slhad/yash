import { describe, expect, test } from 'bun:test';
import { buildTuiSettingsEntries, validateTuiSettingsDraft } from '../src/utils/tuiSettings';

describe('validateTuiSettingsDraft', () => {
  test('accepts a valid settings draft', () => {
    const result = validateTuiSettingsDraft({
      demo: true,
      titleVisible: false,
      viewersVisible: true,
      viewersMode: 'both',
      messagesPosition: 'top',
      chatTimestampsVisible: true,
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
    });

    expect(result.errors).toEqual([]);
    expect(result.values).toEqual({
      demo: true,
      titleVisible: false,
      viewersVisible: true,
      viewersMode: 'both',
      messagesPosition: 'top',
      chatTimestampsVisible: true,
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
    });
  });

  test('rejects invalid numbers and enum values', () => {
    const result = validateTuiSettingsDraft({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'sideways',
      messagesPosition: 'middle',
      chatTimestampsVisible: false,
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
    });

    expect(result.values).toBeNull();
    expect(result.errors).toContain('chat.maxHistorySize must be a positive integer.');
    expect(result.errors).toContain('events.tail must be a positive integer.');
    expect(result.errors).toContain('logs.height must be a positive integer.');
    expect(result.errors).toContain('logs.tail must be a positive integer.');
    expect(result.errors).toContain('viewers.mode must be one of: per-platform, cumulative, both');
    expect(result.errors).toContain('messages.position must be one of: top, bottom, hide');
    expect(result.errors).toContain('events.width must be one of: 25%, 30%, 35%, 40%, 45%, 50%');
  });
});

describe('buildTuiSettingsEntries', () => {
  test('maps validated values to persisted settings keys', () => {
    const entries = buildTuiSettingsEntries({
      demo: false,
      titleVisible: true,
      viewersVisible: true,
      viewersMode: 'per-platform',
      messagesPosition: 'bottom',
      chatTimestampsVisible: true,
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
    });

    expect(entries).toContainEqual({ key: 'messages.position', value: 'bottom' });
    expect(entries).toContainEqual({ key: 'logs.tail', value: 20 });
    expect(entries).toContainEqual({ key: 'platforms.kick.showViewers', value: false });
    expect(entries).toHaveLength(16);
  });
});
