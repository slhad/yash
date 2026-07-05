import { describe, expect, test } from 'bun:test';
import {
  formatYouTubePlaylistItem,
  formatYouTubeStreamItem,
  maskStreamKey,
} from '../src/ui/youtubeStreamModals';

describe('maskStreamKey', () => {
  test('masks dashed YouTube stream keys', () => {
    expect(maskStreamKey('abcd-efgh')).toBe('abcd-••••');
    expect(maskStreamKey('abcd-efgh-ijkl')).toBe('abcd-••••-••••');
  });

  test('masks non-dashed stream keys with a visible prefix', () => {
    expect(maskStreamKey('abcdef')).toBe('abcd••••');
  });
});

describe('formatYouTubeStreamItem', () => {
  test('formats stream picker rows with selection marker and masked key', () => {
    const entry = { title: 'Primary Stream', streamKey: 'abcd-efgh-ijkl' };

    expect(formatYouTubeStreamItem(entry, true)).toContain(' ▶ Primary Stream');
    expect(formatYouTubeStreamItem(entry, true)).toContain('abcd-••••-••••');
    expect(formatYouTubeStreamItem(entry, false).startsWith('   Primary Stream')).toBe(true);
  });

  test('truncates long stream titles to the modal column width', () => {
    const row = formatYouTubeStreamItem({ title: 'x'.repeat(50), streamKey: 'abcd-efgh' }, false);

    expect(row).toContain(`${'x'.repeat(36)}  abcd-••••`);
  });
});

describe('formatYouTubePlaylistItem', () => {
  test('formats playlist picker rows', () => {
    expect(formatYouTubePlaylistItem({ id: 'pl1', title: 'Music' }, true)).toBe(' ▶ Music');
    expect(formatYouTubePlaylistItem({ id: 'pl1', title: 'Music' }, false)).toBe('   Music');
  });
});
