import { describe, expect, test } from 'bun:test';
import {
  formatMessageInputValue,
  getMessageTargetPrefix,
  getNextAutocompleteCycleIndex,
  parseMessageInputBody,
} from '../src/utils/tuiMessageInput';

describe('tuiMessageInput helpers', () => {
  test('builds target prefix', () => {
    expect(getMessageTargetPrefix('all')).toBe('all > ');
    expect(getMessageTargetPrefix('twitch')).toBe('twitch > ');
  });

  test('formats plain message input with target prefix', () => {
    expect(formatMessageInputValue('kick', 'hello')).toBe('kick > hello');
  });

  test('keeps empty body as empty input value', () => {
    expect(formatMessageInputValue('youtube', '')).toBe('');
  });

  test('parses body from prefixed value', () => {
    expect(parseMessageInputBody('twitch > hello world', 'twitch')).toBe('hello world');
  });

  test('returns raw value when prefix is missing', () => {
    expect(parseMessageInputBody('hello world', 'all')).toBe('hello world');
  });

  test('starts forward autocomplete cycling at the first match', () => {
    expect(getNextAutocompleteCycleIndex(-1, 3, 1)).toBe(0);
  });

  test('starts reverse autocomplete cycling at the last match', () => {
    expect(getNextAutocompleteCycleIndex(-1, 3, -1)).toBe(2);
  });

  test('wraps autocomplete cycling in both directions', () => {
    expect(getNextAutocompleteCycleIndex(2, 3, 1)).toBe(0);
    expect(getNextAutocompleteCycleIndex(0, 3, -1)).toBe(2);
  });

  test('keeps empty autocomplete cycles inactive', () => {
    expect(getNextAutocompleteCycleIndex(-1, 0, 1)).toBe(-1);
  });
});
