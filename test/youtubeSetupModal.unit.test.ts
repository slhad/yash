import { describe, expect, test } from 'bun:test';
import { buildYouTubeSetupConfig } from '../src/ui/youtubeSetupModal';

const allEnabledState = {
  defaultPlaylist: true,
  subjectPlaylist: true,
  chaptering: true,
  clearMarkersOnNewStream: true,
  tags: true,
  description: true,
  subjectTitle: true,
  defaultMarkerAtStart: true,
  markerSyncDelay: true,
};

describe('buildYouTubeSetupConfig', () => {
  test('trims user-entered fields and parses marker delay', () => {
    expect(
      buildYouTubeSetupConfig({
        state: allEnabledState,
        playlistId: 'playlist-1',
        playlistTitle: '  Weekly Streams  ',
        defaultMarkerMessage: '  Intro  ',
        markerDelay: ' -5 ',
      }),
    ).toEqual({
      defaultPlaylist: { enabled: true, playlistId: 'playlist-1', playlistTitle: 'Weekly Streams' },
      subjectPlaylist: { enabled: true },
      chaptering: { enabled: true },
      clearMarkersOnNewStream: { enabled: true },
      tags: { enabled: true },
      description: { enabled: true },
      subjectTitle: { enabled: true },
      defaultMarkerAtStart: { enabled: true, message: 'Intro' },
      markerSyncDelay: { enabled: true, offsetSeconds: -5 },
    });
  });

  test('uses defaults for blank marker message and invalid delay', () => {
    expect(
      buildYouTubeSetupConfig({
        state: { ...allEnabledState, defaultPlaylist: false, markerSyncDelay: false },
        playlistId: '',
        playlistTitle: '  ',
        defaultMarkerMessage: '  ',
        markerDelay: 'not-a-number',
      }),
    ).toMatchObject({
      defaultPlaylist: { enabled: false, playlistId: '', playlistTitle: '' },
      defaultMarkerAtStart: { enabled: true, message: 'start' },
      markerSyncDelay: { enabled: false, offsetSeconds: 0 },
    });
  });
});
