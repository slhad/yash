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
      return 'not live';
    }

    return 'error';
  }

  if (platform === 'kick') {
    return 'unsupported';
  }

  return 'unavailable';
}

export function formatMarkerCreationSummary(entries: MarkerCreationSummaryEntry[]): string {
  return entries
    .map((entry) => {
      if (entry.marker) {
        return `${entry.platform}: ✓ ${entry.marker.positionInSeconds}s`;
      }

      return `${entry.platform}: ${summarizeMarkerFailure(entry.platform, entry.error)}`;
    })
    .join(' | ');
}
