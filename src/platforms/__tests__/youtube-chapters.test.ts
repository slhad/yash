import { describe, test, expect } from 'bun:test';

function formatChapterTimestamp(positionInSeconds: number): string {
  const h = Math.floor(positionInSeconds / 3600);
  const min = Math.floor((positionInSeconds % 3600) / 60);
  const sec = positionInSeconds % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

function formatChapterLine(positionInSeconds: number, description: string): string {
  return `${formatChapterTimestamp(positionInSeconds)} - ${description}`;
}

function formatChapterBlock(
  markers: Array<{ positionInSeconds: number; description: string }>,
): string {
  if (markers.length === 0) return '';
  return markers
    .slice()
    .sort((a, b) => a.positionInSeconds - b.positionInSeconds)
    .map((m) => formatChapterLine(m.positionInSeconds, m.description))
    .join('\n');
}

describe('chapter timestamp formatting', () => {
  test('0 seconds formats as 00:00:00', () => {
    expect(formatChapterTimestamp(0)).toBe('00:00:00');
  });

  test('65 seconds formats as 00:01:05', () => {
    expect(formatChapterTimestamp(65)).toBe('00:01:05');
  });

  test('3661 seconds formats as 01:01:01', () => {
    expect(formatChapterTimestamp(3661)).toBe('01:01:01');
  });

  test('single marker line includes dash separator', () => {
    expect(formatChapterLine(0, 'start')).toBe('00:00:00 - start');
  });

  test('65-second marker includes dash separator', () => {
    expect(formatChapterLine(65, 'Chapter')).toBe('00:01:05 - Chapter');
  });

  test('3661-second marker includes dash separator', () => {
    expect(formatChapterLine(3661, 'Late')).toBe('01:01:01 - Late');
  });

  test('multiple markers are sorted by position', () => {
    const markers = [
      { positionInSeconds: 3661, description: 'Late' },
      { positionInSeconds: 0, description: 'start' },
      { positionInSeconds: 65, description: 'Chapter' },
    ];
    const result = formatChapterBlock(markers);
    expect(result).toBe('00:00:00 - start\n00:01:05 - Chapter\n01:01:01 - Late');
  });

  test('empty markers returns empty string', () => {
    expect(formatChapterBlock([])).toBe('');
  });

  test('hours are always zero-padded', () => {
    expect(formatChapterTimestamp(7200)).toBe('02:00:00');
  });
});
