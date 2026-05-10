import { describe, expect, test } from 'bun:test';
import {
  deserializeYouTubeLiveChatResponse,
  serializeYouTubeLiveChatRequest,
  serializeYouTubeLiveChatResponse,
} from '../src/utils/youtubeLiveChatGrpc';

// ---------------------------------------------------------------------------
// serializeYouTubeLiveChatRequest
// ---------------------------------------------------------------------------

describe('serializeYouTubeLiveChatRequest', () => {
  test('returns a Buffer instance', () => {
    const buf = serializeYouTubeLiveChatRequest({
      liveChatId: 'abc',
      maxResults: 200,
      part: ['snippet'],
    });
    expect(buf).toBeInstanceOf(Buffer);
  });

  test('returns a non-empty Buffer for a fully-populated request', () => {
    const buf = serializeYouTubeLiveChatRequest({
      liveChatId: 'live-chat-id-123',
      maxResults: 200,
      pageToken: 'token-xyz',
      part: ['snippet', 'authorDetails'],
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('empty part array still produces a Buffer', () => {
    const buf = serializeYouTubeLiveChatRequest({
      liveChatId: 'some-id',
      maxResults: 50,
      part: [],
    });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(0);
  });

  test('Buffer with pageToken is different from (and longer than) Buffer without', () => {
    const base = {
      liveChatId: 'live-chat-id',
      maxResults: 200,
      part: ['snippet'],
    };
    const withoutToken = serializeYouTubeLiveChatRequest(base);
    const withToken = serializeYouTubeLiveChatRequest({ ...base, pageToken: 'some-page-token' });

    expect(withToken.length).toBeGreaterThan(withoutToken.length);
    expect(withToken.equals(withoutToken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// serializeYouTubeLiveChatResponse + deserializeYouTubeLiveChatResponse
// ---------------------------------------------------------------------------

describe('serializeYouTubeLiveChatResponse + deserializeYouTubeLiveChatResponse round-trip', () => {
  function roundTrip(response: Parameters<typeof serializeYouTubeLiveChatResponse>[0]) {
    return deserializeYouTubeLiveChatResponse(serializeYouTubeLiveChatResponse(response));
  }

  test('empty response {} → serialize → deserialize → {}', () => {
    expect(roundTrip({})).toEqual({});
  });

  test('response with nextPageToken only is preserved', () => {
    const result = roundTrip({ nextPageToken: 'next-token-abc' });
    expect(result.nextPageToken).toBe('next-token-abc');
    expect(result.offlineAt).toBeUndefined();
    expect(result.items).toBeUndefined();
  });

  test('response with offlineAt only is preserved', () => {
    const result = roundTrip({ offlineAt: '2024-01-15T10:30:00Z' });
    expect(result.offlineAt).toBe('2024-01-15T10:30:00Z');
    expect(result.nextPageToken).toBeUndefined();
    expect(result.items).toBeUndefined();
  });

  test('response with one item (id + snippet + authorDetails) preserves all fields', () => {
    const result = roundTrip({
      items: [
        {
          id: 'item-id-1',
          snippet: {
            publishedAt: '2024-01-15T10:00:00Z',
            displayMessage: 'Hello world!',
            type: 'textMessageEvent',
          },
          authorDetails: {
            channelId: 'UC-channel-123',
            displayName: 'TestUser',
          },
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    const item = result.items![0]!;
    expect(item.id).toBe('item-id-1');
    expect(item.snippet?.publishedAt).toBe('2024-01-15T10:00:00Z');
    expect(item.snippet?.displayMessage).toBe('Hello world!');
    expect(item.snippet?.type).toBe('textMessageEvent');
    expect(item.authorDetails?.channelId).toBe('UC-channel-123');
    expect(item.authorDetails?.displayName).toBe('TestUser');
  });

  test('response with multiple items preserves all items in order', () => {
    const result = roundTrip({
      items: [
        { id: 'item-1', snippet: { displayMessage: 'First' } },
        { id: 'item-2', snippet: { displayMessage: 'Second' } },
        { id: 'item-3', snippet: { displayMessage: 'Third' } },
      ],
    });

    expect(result.items).toHaveLength(3);
    expect(result.items![0]!.id).toBe('item-1');
    expect(result.items![0]!.snippet?.displayMessage).toBe('First');
    expect(result.items![1]!.id).toBe('item-2');
    expect(result.items![1]!.snippet?.displayMessage).toBe('Second');
    expect(result.items![2]!.id).toBe('item-3');
    expect(result.items![2]!.snippet?.displayMessage).toBe('Third');
  });

  test('snippet fields publishedAt, displayMessage, type are each preserved', () => {
    const result = roundTrip({
      items: [
        {
          snippet: {
            publishedAt: '2024-06-01T08:00:00Z',
            displayMessage: 'Some message text',
            type: 'superChatEvent',
          },
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    const snippet = result.items![0]!.snippet!;
    expect(snippet.publishedAt).toBe('2024-06-01T08:00:00Z');
    expect(snippet.displayMessage).toBe('Some message text');
    expect(snippet.type).toBe('superChatEvent');
  });

  test('authorDetails fields channelId and displayName are each preserved', () => {
    const result = roundTrip({
      items: [
        {
          authorDetails: {
            channelId: 'UC-abc-def-123',
            displayName: 'Channel Name Here',
          },
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    const authorDetails = result.items![0]!.authorDetails!;
    expect(authorDetails.channelId).toBe('UC-abc-def-123');
    expect(authorDetails.displayName).toBe('Channel Name Here');
  });

  test('item with only id (no snippet/authorDetails) round-trips correctly', () => {
    const result = roundTrip({ items: [{ id: 'only-id-item' }] });

    expect(result.items).toHaveLength(1);
    expect(result.items![0]!.id).toBe('only-id-item');
  });

  test('full response with nextPageToken + multiple items preserves all fields', () => {
    const result = roundTrip({
      nextPageToken: 'full-next-token',
      offlineAt: '2024-12-31T23:59:59Z',
      items: [
        {
          id: 'msg-1',
          snippet: {
            publishedAt: '2024-12-31T20:00:00Z',
            displayMessage: 'First message',
            type: 'textMessageEvent',
          },
          authorDetails: {
            channelId: 'UC-user-1',
            displayName: 'User One',
          },
        },
        {
          id: 'msg-2',
          snippet: {
            publishedAt: '2024-12-31T20:01:00Z',
            displayMessage: 'Second message',
            type: 'textMessageEvent',
          },
          authorDetails: {
            channelId: 'UC-user-2',
            displayName: 'User Two',
          },
        },
      ],
    });

    expect(result.nextPageToken).toBe('full-next-token');
    expect(result.offlineAt).toBe('2024-12-31T23:59:59Z');
    expect(result.items).toHaveLength(2);

    expect(result.items![0]!.id).toBe('msg-1');
    expect(result.items![0]!.snippet?.displayMessage).toBe('First message');
    expect(result.items![0]!.authorDetails?.displayName).toBe('User One');

    expect(result.items![1]!.id).toBe('msg-2');
    expect(result.items![1]!.snippet?.displayMessage).toBe('Second message');
    expect(result.items![1]!.authorDetails?.displayName).toBe('User Two');
  });
});

// ---------------------------------------------------------------------------
// deserializeYouTubeLiveChatResponse edge cases
// ---------------------------------------------------------------------------

describe('deserializeYouTubeLiveChatResponse edge cases', () => {
  test('empty Buffer returns {}', () => {
    const result = deserializeYouTubeLiveChatResponse(Buffer.alloc(0));
    expect(result).toEqual({});
  });

  test('unknown field numbers in buffer are skipped gracefully without throwing', () => {
    // Encode a varint field: field 999, wire type 0 (varint), value 42
    // tag = (999 << 3) | 0 = 7992
    // varint(7992): low 7 bits = 0x38 with continuation → 0xb8, then 0x3e
    // value 42 as varint: 0x2a
    const unknownField = Buffer.from([0xb8, 0x3e, 0x2a]);
    expect(() => deserializeYouTubeLiveChatResponse(unknownField)).not.toThrow();
    const result = deserializeYouTubeLiveChatResponse(unknownField);
    expect(result).toEqual({});
  });

  test('unknown length-delimited field is skipped gracefully without throwing', () => {
    // field 888, wire type 2 (length-delimited), length 3, payload [0x01, 0x02, 0x03]
    // tag = (888 << 3) | 2 = 7106
    // varint(7106): low 7 bits = 0x42 with continuation → 0xc2, then 0x37
    // length varint: 0x03, payload: 0x01, 0x02, 0x03
    const unknownLDField = Buffer.from([0xc2, 0x37, 0x03, 0x01, 0x02, 0x03]);
    expect(() => deserializeYouTubeLiveChatResponse(unknownLDField)).not.toThrow();
    const result = deserializeYouTubeLiveChatResponse(unknownLDField);
    expect(result).toEqual({});
  });
});
