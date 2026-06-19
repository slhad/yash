import { describe, expect, test } from 'bun:test';
import {
  buildStreamTemplateDraft,
  buildTargetedStreamMetadataUpdate,
  sanitizeStreamTemplateCollection,
  sanitizeStreamTemplateDraft,
} from '../src/utils/streamMetadata';

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

  test('force mode includes selected fields even when values match persisted settings', () => {
    const savedStream = {
      title: 'Same title',
      tags: ['alpha'],
      twitchGame: 'Software and Game Development',
      notification: 'Going live',
      game: 'Keep me',
      youtubeCategory: 'Gaming',
    };

    const { changed, merged } = buildTargetedStreamMetadataUpdate(
      savedStream,
      ['twitch'],
      {
        title: 'Same title',
        tags: ['alpha'],
        twitchGame: 'Software and Game Development',
        notification: 'Going live',
        game: undefined,
        youtubeCategory: undefined,
        kickCategory: undefined,
        description: undefined,
      },
      { force: true },
    );

    expect(changed).toEqual({
      title: 'Same title',
      tags: ['alpha'],
      twitchGame: 'Software and Game Development',
      notification: 'Going live',
    });
    expect(merged).toEqual(savedStream);
  });
});

describe('stream template draft helpers', () => {
  test('builds a reusable template snapshot with selected platforms', () => {
    const template = buildStreamTemplateDraft(
      {
        title: 'Template title',
        tags: ['one', 'two'],
        game: 'Subject',
        youtubeCategory: 'Gaming',
        description: 'Desc',
        twitchGame: 'Science & Technology',
        notification: 'We are live',
        kickCategory: 'Coding',
      },
      ['youtube', 'twitch', 'youtube'],
    );

    expect(template).toEqual({
      title: 'Template title',
      tags: ['one', 'two'],
      game: 'Subject',
      youtubeCategory: 'Gaming',
      description: 'Desc',
      twitchGame: 'Science & Technology',
      notification: 'We are live',
      kickCategory: 'Coding',
      selectedPlatforms: ['youtube', 'twitch'],
    });
  });

  test('sanitizes persisted templates and drops invalid values', () => {
    const template = sanitizeStreamTemplateDraft({
      title: 'Template title',
      tags: ['one', 2, ' two '],
      selectedPlatforms: ['youtube', 'bogus', 'kick', 'kick'],
      youtubeCategory: 'Gaming',
      notification: 5,
    });

    expect(template).toEqual({
      title: 'Template title',
      tags: ['one', 'two'],
      selectedPlatforms: ['youtube', 'kick'],
      youtubeCategory: 'Gaming',
    });
  });

  test('sanitizes template collections and keeps only valid named entries', () => {
    const collection = sanitizeStreamTemplateCollection({
      activeName: 'Focus',
      items: {
        Focus: {
          title: 'Focus title',
          selectedPlatforms: ['youtube', 'twitch'],
        },
        '  ': {
          title: 'Ignored',
        },
        Broken: 42,
      },
    });

    expect(collection).toEqual({
      activeName: 'Focus',
      items: {
        Focus: {
          title: 'Focus title',
          selectedPlatforms: ['youtube', 'twitch'],
        },
      },
    });
  });
});
