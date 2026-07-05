import { describe, expect, test } from 'bun:test';
import {
  formatElapsed,
  formatPlatformStatusLabel,
  getMemoryInsightToneColor,
  getPlatformStatusColor,
} from '../src/utils/tuiStatusPresentation';

describe('formatElapsed', () => {
  test('formats elapsed time under and over an hour', () => {
    const now = Date.now();
    expect(formatElapsed(new Date(now - 65_000))).toBe('1m5s');
    expect(formatElapsed(new Date(now - 3_723_000))).toBe('1h2m3s');
  });
});

describe('platform status presentation', () => {
  test('formats labels and colors for auth and stream states', () => {
    expect(formatPlatformStatusLabel({ authenticated: false, streamStatus: 'OFFLINE' }, '/0')).toBe(
      '✗/0',
    );
    expect(getPlatformStatusColor({ authenticated: false, streamStatus: 'OFFLINE' })).toBe('red');

    expect(formatPlatformStatusLabel({ authenticated: true, streamStatus: 'ONLINE' }, '/3')).toBe(
      '✓/3',
    );
    expect(getPlatformStatusColor({ authenticated: true, streamStatus: 'ONLINE' })).toBe('green');

    expect(formatPlatformStatusLabel({ authenticated: true, streamStatus: 'OFFLINE' }, '')).toBe(
      '○',
    );
    expect(getPlatformStatusColor({ authenticated: true, streamStatus: 'OFFLINE' })).toBe('yellow');
  });
});

describe('getMemoryInsightToneColor', () => {
  test('maps memory insight tones to TUI colors', () => {
    expect(getMemoryInsightToneColor('default')).toBe('white');
    expect(getMemoryInsightToneColor('muted')).toBe('gray');
    expect(getMemoryInsightToneColor('good')).toBe('green');
    expect(getMemoryInsightToneColor('warn')).toBe('yellow');
    expect(getMemoryInsightToneColor('danger')).toBe('red');
  });
});
