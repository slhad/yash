import { describe, expect, test } from 'bun:test';
import { buildTargetedStreamMetadataUpdate } from '../src/utils/streamMetadata';

describe('buildTargetedStreamMetadataUpdate', () => {
  test('preserves unrelated provider fields during twitch-only updates', () => {
    const savedStream = {
      title: 'Mmmmhaaaa',
      tags: ['developer', 'code'],
      twitchGame: 'Software and Game Development',
      game: 'TestoDev',
      youtubeCategory: 'Gaming',
      kickCategory: 'Software Development',
      description: 'ho god',
    };

    const { changed, merged } = buildTargetedStreamMetadataUpdate(savedStream, ['twitch'], {
      title: 'Mmmmhaaaa check',
      tags: ['developer', 'code'],
      game: undefined,
      youtubeCategory: undefined,
      twitchGame: 'Software and Game Development',
      kickCategory: undefined,
      description: undefined,
      notification: undefined,
    });

    expect(changed).toEqual({
      title: 'Mmmmhaaaa check',
    });
    expect(merged).toEqual({
      title: 'Mmmmhaaaa check',
      tags: ['developer', 'code'],
      twitchGame: 'Software and Game Development',
      game: 'TestoDev',
      youtubeCategory: 'Gaming',
      kickCategory: 'Software Development',
      description: 'ho god',
    });
  });

  test('allows clearing a selected provider field intentionally', () => {
    const savedStream = {
      title: 'Mmmmhaaaa',
      twitchGame: 'Software and Game Development',
      notification: 'Go live',
    };

    const { changed, merged } = buildTargetedStreamMetadataUpdate(savedStream, ['twitch'], {
      title: 'Mmmmhaaaa',
      tags: undefined,
      twitchGame: undefined,
      notification: undefined,
    });

    expect(changed).toEqual({
      tags: undefined,
      twitchGame: undefined,
      notification: undefined,
    });
    expect(merged).toEqual({
      title: 'Mmmmhaaaa',
      tags: undefined,
      twitchGame: undefined,
      notification: undefined,
    });
  });
});
