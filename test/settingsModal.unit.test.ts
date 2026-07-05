import { describe, expect, test } from 'bun:test';
import { cycleSettingsOption } from '../src/ui/settingsModal';

describe('cycleSettingsOption', () => {
  test('cycles forward and backward through settings enum values', () => {
    const options = ['top', 'bottom', 'hide'] as const;

    expect(cycleSettingsOption('top', options, 1)).toBe('bottom');
    expect(cycleSettingsOption('top', options, -1)).toBe('hide');
    expect(cycleSettingsOption('hide', options, 1)).toBe('top');
  });

  test('falls back to the first option when current value is unknown', () => {
    expect(cycleSettingsOption('unknown', ['a', 'b'] as const, 1)).toBe('b');
  });
});
