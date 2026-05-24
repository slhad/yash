import { describe, expect, test } from 'bun:test';
import { markerCreateAction, markersEditAction, markersListAction } from '../src/actions/markers';

describe('marker actions', () => {
  test('marker.create skips Kick when it has no marker support', async () => {
    const result = await markerCreateAction.invoke(
      { text: 'Intro', platform: 'all' },
      {
        chatService: {} as never,
        providers: {
          youtube: {
            createMarker: async () => ({
              id: 'yt_1',
              createdAt: new Date(),
              description: 'Intro',
              positionInSeconds: 12,
              platform: 'youtube',
            }),
          },
          kick: {
            createMarker: async () => null,
          },
        } as never,
      },
    );

    expect(result.output).toEqual(['[marker] youtube: Intro @ 00:12']);
    expect(result.warnings).toBeUndefined();
  });

  test('markers.list includes YouTube selection IDs in output', async () => {
    const createdAt = new Date();
    const result = await markersListAction.invoke(
      { platform: 'youtube' },
      {
        chatService: {} as never,
        providers: {
          youtube: {
            getMarkers: async () => [
              {
                id: 'yt_1',
                createdAt,
                description: 'Intro',
                positionInSeconds: 65,
                platform: 'youtube',
              },
            ],
            getPersistedMarkerSelectionId: () => 3,
          },
        } as never,
      },
    );

    expect(result.output).toEqual(['[markers] youtube #3: Intro @ 01:05']);
    expect(result.data).toEqual({
      markers: [{ platform: 'youtube', selectionId: 3, title: 'Intro', timestamp: '01:05' }],
    });
  });

  test('markers.edit updates a persisted marker by selection ID', async () => {
    const createdAt = new Date();
    const result = await markersEditAction.invoke(
      { selectionId: 2, text: 'Boss fight', timestamp: 3723 },
      {
        chatService: {} as never,
        providers: {
          youtube: {
            getPersistedMarkerBySelectionId: () => ({
              id: 'yt_2',
              createdAt,
              description: 'Old',
              positionInSeconds: 60,
              platform: 'youtube',
            }),
            updatePersistedMarkerBySelectionId: async () => ({
              id: 'yt_2',
              createdAt,
              description: 'Boss fight',
              positionInSeconds: 3723,
              platform: 'youtube',
            }),
            getPersistedMarkerSelectionId: () => 2,
          },
        } as never,
      },
    );

    expect(result.output).toEqual(['[markers] youtube #2: Boss fight @ 1:02:03']);
    expect(result.data).toEqual({
      marker: { platform: 'youtube', selectionId: 2, title: 'Boss fight', timestamp: '1:02:03' },
    });
  });
});
