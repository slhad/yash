import type { StreamMarker } from '../platforms/base';

export interface MarkerCreationSummaryEntry {
  platform: string;
  marker: Pick<StreamMarker, 'id' | 'positionInSeconds'> | null;
  error?: string;
}

function summarizeMarkerFailure(platform: string, error?: string): string {
  if (error) {
    const normalized = error.toLowerCase();
    if (
      normalized.includes('not live') ||
      normalized.includes('stream needs to be live') ||
      normalized.includes('streamnotliveerror')
    ) {
      return '○';
    }

    return 'error';
  }

  if (platform === 'kick') {
    return '✗';
  }

  return '✗';
}

export function formatMarkerCreationSummary(entries: MarkerCreationSummaryEntry[]): string {
  return entries
    .filter((entry) => !(entry.platform === 'kick' && entry.marker === null && !entry.error))
    .map((entry) => {
      if (entry.marker) {
        return `${entry.platform}: ✓ ${entry.marker.positionInSeconds}s`;
      }

      return `${entry.platform}: ${summarizeMarkerFailure(entry.platform, entry.error)}`;
    })
    .join(' | ');
}
