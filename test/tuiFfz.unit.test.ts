import { describe, expect, test } from 'bun:test';

import {
  buildTuiFfzMessageParts,
  buildTuiFfzUploadSequences,
  getTuiFfzPlaceholderCell,
  imageIdToColorHex,
  parsePngDimensions,
  supportsTuiFfzClientTerm,
} from '../src/utils/tuiFfz';

const SAMPLE_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x03, 0x08, 0x06, 0x00, 0x00, 0x00,
]);

describe('tui ffz helpers', () => {
  test('maps image ids into the placeholder foreground color space', () => {
    expect(imageIdToColorHex(42)).toBe('#00002a');
    expect(imageIdToColorHex(0x123456)).toBe('#123456');
  });

  test('parses png dimensions from IHDR bytes', () => {
    expect(parsePngDimensions(SAMPLE_PNG)).toEqual({ width: 2, height: 3 });
  });

  test('builds twitch message parts with unicode placeholders for uploaded emotes', () => {
    expect(
      buildTuiFfzMessageParts(
        'twitch',
        'hello OMEGALUL ok',
        'white',
        { OMEGALUL: { name: 'OMEGALUL', url: 'https://cdn.ffz/omega.png' } },
        { OMEGALUL: 42 },
      ),
    ).toEqual([
      { content: 'hello ', fg: 'white' },
      { content: getTuiFfzPlaceholderCell(), fg: '#00002a' },
      { content: ' ok', fg: 'white' },
    ]);
  });

  test('keeps non-twitch lines as plain text', () => {
    expect(
      buildTuiFfzMessageParts(
        'youtube',
        'OMEGALUL stays text',
        'white',
        { OMEGALUL: { name: 'OMEGALUL', url: 'https://cdn.ffz/omega.png' } },
        { OMEGALUL: 42 },
      ),
    ).toEqual([{ content: 'OMEGALUL stays text', fg: 'white' }]);
  });

  test('falls back to token text when the image is not uploaded yet', () => {
    expect(
      buildTuiFfzMessageParts(
        'twitch',
        'OMEGALUL',
        'white',
        { OMEGALUL: { name: 'OMEGALUL', url: 'https://cdn.ffz/omega.png' } },
        {},
      ),
    ).toEqual([{ content: 'OMEGALUL', fg: 'white' }]);
  });

  test('builds tmux passthrough upload sequences', () => {
    const sequences = buildTuiFfzUploadSequences({
      imageId: 42,
      pngBytes: SAMPLE_PNG,
      width: 2,
      height: 3,
      passthrough: 'tmux',
    });

    expect(sequences).toHaveLength(1);
    expect(sequences[0]).toContain('tmux;');
    expect(sequences[0]).toContain('a=T,q=2,f=100,U=1,s=2,v=3,c=1,r=1,i=42,');
  });

  test('only enables terminal placeholders on ghostty/kitty clients', () => {
    expect(supportsTuiFfzClientTerm('xterm-ghostty')).toBe(true);
    expect(supportsTuiFfzClientTerm('xterm-kitty')).toBe(true);
    expect(supportsTuiFfzClientTerm('tmux-256color')).toBe(false);
    expect(supportsTuiFfzClientTerm(null)).toBe(false);
  });
});
