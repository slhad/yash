import { describe, expect, test } from 'bun:test';
import {
  ACTIVITY_MAX_VISIBLE,
  type ActivityEvent,
  activityPlatformColor,
  toActivityChatterMessage,
  updateActivityBarText,
} from '../src/ui/activityMemoryModals';

describe('activity memory modal helpers', () => {
  test('maps platform colors with gray fallback', () => {
    expect(activityPlatformColor('twitch')).toBe('#9146FF');
    expect(activityPlatformColor('youtube')).toBe('#FF0000');
    expect(activityPlatformColor('kick')).toBe('#53FC18');
    expect(activityPlatformColor('other')).toBe('gray');
  });

  test('converts activity events with chatter identity to chat messages', () => {
    const event: ActivityEvent = {
      ts: 123,
      platform: 'youtube',
      type: 'member',
      message: 'New member',
      userId: 'channel-1',
      username: 'Viewer',
    };

    expect(toActivityChatterMessage(event)).toEqual({
      id: 'activity_youtube_channel-1_123',
      platform: 'youtube',
      userId: 'channel-1',
      username: 'Viewer',
      message: 'New member',
      timestamp: 123,
    });
  });

  test('does not convert anonymous activity events to chat messages', () => {
    expect(
      toActivityChatterMessage({
        ts: 123,
        platform: 'kick',
        type: 'follow',
        message: 'Someone followed',
      }),
    ).toBeNull();
  });

  test('updates empty activity bar text', () => {
    const node = { content: '', fg: '' } as any;

    updateActivityBarText(node, {
      mode: 'all',
      activityEvents: [],
      timedVisibleEvents: [],
    });

    expect(node.content).toBe('No events yet');
    expect(node.fg).toBe('gray');
  });

  test('uses timed events when mode is timed', () => {
    const node = { content: '', fg: '' } as any;

    updateActivityBarText(node, {
      mode: 'timed',
      activityEvents: [{ ts: 1, platform: 'youtube', type: 'sub', message: 'older event' }],
      timedVisibleEvents: [{ ts: 2, platform: 'twitch', type: 'sub', message: 'visible event' }],
    });

    expect(node.fg).toBe('white');
    expect(node.content).toBeTruthy();
    expect(String(node.content)).not.toContain('older event');
  });

  test('limits visible activity events to the configured maximum', () => {
    expect(ACTIVITY_MAX_VISIBLE).toBe(5);
  });
});
