import { describe, expect, test } from 'bun:test';
import { parseMarkerTimestampInput } from '../src/ui/markerEditModal';

describe('parseMarkerTimestampInput', () => {
  test('accepts non-negative integer timestamp input', () => {
    expect(parseMarkerTimestampInput('0')).toBe(0);
    expect(parseMarkerTimestampInput(' 123 ')).toBe(123);
  });

  test('rejects negative and non-numeric timestamp input', () => {
    expect(parseMarkerTimestampInput('-1')).toBeNull();
    expect(parseMarkerTimestampInput('abc')).toBeNull();
    expect(parseMarkerTimestampInput('')).toBeNull();
  });
});
