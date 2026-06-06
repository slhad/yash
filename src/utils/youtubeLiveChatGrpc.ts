import { Buffer } from 'node:buffer';

const utf8Decoder = new TextDecoder();

export interface YouTubeLiveChatGrpcRequest {
  part: string[];
  liveChatId: string;
  maxResults: number;
  pageToken?: string;
}

export interface YouTubeLiveChatGrpcItem {
  id?: string;
  snippet?: {
    publishedAt?: string;
    displayMessage?: string;
    type?: string;
  };
  authorDetails?: {
    channelId?: string;
    displayName?: string;
  };
}

export interface YouTubeLiveChatGrpcResponse {
  nextPageToken?: string;
  offlineAt?: string;
  items?: YouTubeLiveChatGrpcItem[];
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value >>> 0;
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining);
  return bytes;
}

function encodeTag(fieldNumber: number, wireType: number): number[] {
  return encodeVarint((fieldNumber << 3) | wireType);
}

function encodeStringField(fieldNumber: number, value: string | undefined, bytes: number[]): void {
  if (value === undefined) return;
  const encoded = Buffer.from(value, 'utf8');
  bytes.push(...encodeTag(fieldNumber, 2), ...encodeVarint(encoded.length), ...encoded);
}

function encodeUint32Field(fieldNumber: number, value: number | undefined, bytes: number[]): void {
  if (value === undefined) return;
  bytes.push(...encodeTag(fieldNumber, 0), ...encodeVarint(value));
}

function encodeMessageField(fieldNumber: number, payload: Uint8Array, bytes: number[]): void {
  bytes.push(...encodeTag(fieldNumber, 2), ...encodeVarint(payload.length), ...payload);
}

function decodeVarint(buffer: Uint8Array, offset: number): { value: number; offset: number } {
  let value = 0;
  let shift = 0;
  let cursor = offset;

  while (cursor < buffer.length) {
    const byte = buffer[cursor];
    if (byte === undefined) {
      throw new Error('Unexpected end of buffer while decoding varint');
    }
    cursor += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: cursor };
    shift += 7;
  }

  throw new Error('Unexpected end of buffer while decoding varint');
}

function decodeLengthDelimited(
  buffer: Uint8Array,
  offset: number,
): { value: Uint8Array; offset: number } {
  const length = decodeVarint(buffer, offset);
  const end = length.offset + length.value;
  if (end > buffer.length) {
    throw new Error('Unexpected end of buffer while decoding length-delimited field');
  }
  return { value: buffer.subarray(length.offset, end), offset: end };
}

function decodeString(buffer: Uint8Array, offset: number): { value: string; offset: number } {
  const decoded = decodeLengthDelimited(buffer, offset);
  return { value: utf8Decoder.decode(decoded.value), offset: decoded.offset };
}

function skipField(buffer: Uint8Array, offset: number, wireType: number): number {
  switch (wireType) {
    case 0:
      return decodeVarint(buffer, offset).offset;
    case 1:
      return offset + 8;
    case 2:
      return decodeLengthDelimited(buffer, offset).offset;
    case 5:
      return offset + 4;
    default:
      throw new Error(`Unsupported protobuf wire type: ${wireType}`);
  }
}

function decodeAuthorDetails(buffer: Uint8Array): YouTubeLiveChatGrpcItem['authorDetails'] {
  const authorDetails: NonNullable<YouTubeLiveChatGrpcItem['authorDetails']> = {};
  let offset = 0;

  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x7;

    switch (fieldNumber) {
      case 10101: {
        const field = decodeString(buffer, offset);
        authorDetails.channelId = field.value;
        offset = field.offset;
        break;
      }
      case 103: {
        const field = decodeString(buffer, offset);
        authorDetails.displayName = field.value;
        offset = field.offset;
        break;
      }
      default:
        offset = skipField(buffer, offset, wireType);
    }
  }

  return authorDetails;
}

function decodeSnippet(buffer: Uint8Array): YouTubeLiveChatGrpcItem['snippet'] {
  const snippet: NonNullable<YouTubeLiveChatGrpcItem['snippet']> = {};
  let offset = 0;

  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x7;

    switch (fieldNumber) {
      case 4: {
        const field = decodeString(buffer, offset);
        snippet.publishedAt = field.value;
        offset = field.offset;
        break;
      }
      case 16: {
        const field = decodeString(buffer, offset);
        snippet.displayMessage = field.value;
        offset = field.offset;
        break;
      }
      case 18: {
        const field = decodeString(buffer, offset);
        snippet.type = field.value;
        offset = field.offset;
        break;
      }
      default:
        offset = skipField(buffer, offset, wireType);
    }
  }

  return snippet;
}

function decodeItem(buffer: Uint8Array): YouTubeLiveChatGrpcItem {
  const item: YouTubeLiveChatGrpcItem = {};
  let offset = 0;

  while (offset < buffer.length) {
    const tag = decodeVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x7;

    switch (fieldNumber) {
      case 101: {
        const field = decodeString(buffer, offset);
        item.id = field.value;
        offset = field.offset;
        break;
      }
      case 2: {
        const field = decodeLengthDelimited(buffer, offset);
        item.snippet = decodeSnippet(field.value);
        offset = field.offset;
        break;
      }
      case 3: {
        const field = decodeLengthDelimited(buffer, offset);
        item.authorDetails = decodeAuthorDetails(field.value);
        offset = field.offset;
        break;
      }
      default:
        offset = skipField(buffer, offset, wireType);
    }
  }

  return item;
}

export function serializeYouTubeLiveChatRequest(request: YouTubeLiveChatGrpcRequest): Buffer {
  const bytes: number[] = [];
  encodeStringField(1, request.liveChatId, bytes);
  encodeUint32Field(98, request.maxResults, bytes);
  encodeStringField(99, request.pageToken, bytes);
  for (const part of request.part) {
    encodeStringField(100, part, bytes);
  }
  return Buffer.from(bytes);
}

export function deserializeYouTubeLiveChatResponse(buffer: Buffer): YouTubeLiveChatGrpcResponse {
  const response: YouTubeLiveChatGrpcResponse = {};
  let offset = 0;
  const bytes = new Uint8Array(buffer);

  while (offset < bytes.length) {
    const tag = decodeVarint(bytes, offset);
    offset = tag.offset;
    const fieldNumber = tag.value >>> 3;
    const wireType = tag.value & 0x7;

    switch (fieldNumber) {
      case 2: {
        const field = decodeString(bytes, offset);
        response.offlineAt = field.value;
        offset = field.offset;
        break;
      }
      case 100602: {
        const field = decodeString(bytes, offset);
        response.nextPageToken = field.value;
        offset = field.offset;
        break;
      }
      case 1007: {
        const field = decodeLengthDelimited(bytes, offset);
        response.items ??= [];
        response.items.push(decodeItem(field.value));
        offset = field.offset;
        break;
      }
      default:
        offset = skipField(bytes, offset, wireType);
    }
  }

  return response;
}

export function serializeYouTubeLiveChatResponse(response: YouTubeLiveChatGrpcResponse): Buffer {
  const bytes: number[] = [];
  encodeStringField(2, response.offlineAt, bytes);
  encodeStringField(100602, response.nextPageToken, bytes);
  if (response.items) {
    for (const item of response.items) {
      const itemBytes: number[] = [];
      encodeStringField(101, item.id, itemBytes);
      if (item.snippet) {
        const snippetBytes: number[] = [];
        encodeStringField(4, item.snippet.publishedAt, snippetBytes);
        encodeStringField(16, item.snippet.displayMessage, snippetBytes);
        encodeStringField(18, item.snippet.type, snippetBytes);
        encodeMessageField(2, Uint8Array.from(snippetBytes), itemBytes);
      }
      if (item.authorDetails) {
        const authorBytes: number[] = [];
        encodeStringField(10101, item.authorDetails.channelId, authorBytes);
        encodeStringField(103, item.authorDetails.displayName, authorBytes);
        encodeMessageField(3, Uint8Array.from(authorBytes), itemBytes);
      }
      encodeMessageField(1007, Uint8Array.from(itemBytes), bytes);
    }
  }
  return Buffer.from(bytes);
}
