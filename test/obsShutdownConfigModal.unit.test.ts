import { describe, expect, test } from 'bun:test';
import {
  buildObsShutdownDraftFromInputValues,
  makeObsShutdownToggleRow,
} from '../src/ui/obsShutdownConfigModal';

describe('buildObsShutdownDraftFromInputValues', () => {
  test('combines input values with the current stopStream toggle', () => {
    expect(
      buildObsShutdownDraftFromInputValues(
        {
          scene: '[PS] End',
          delay: '30',
          message: 'Ending in {remaining}',
          chatInterval: '10',
          source: '[TXT] Countdown',
          sourceText: '{remaining}',
          hideSources: 'Camera A, Camera B',
          muteSources: 'Mic/Aux',
          finalCountdownAt: '5',
        },
        false,
      ),
    ).toEqual({
      scene: '[PS] End',
      delay: '30',
      message: 'Ending in {remaining}',
      chatInterval: '10',
      stopStream: false,
      source: '[TXT] Countdown',
      sourceText: '{remaining}',
      hideSources: 'Camera A, Camera B',
      muteSources: 'Mic/Aux',
      finalCountdownAt: '5',
    });
  });
});

describe('makeObsShutdownToggleRow', () => {
  test('renders focused and unfocused toggle labels', () => {
    expect(makeObsShutdownToggleRow('stopStream', true, true)).toBe('▶ stopStream: ON');
    expect(makeObsShutdownToggleRow('stopStream', false, false)).toBe('  stopStream: OFF');
  });
});
