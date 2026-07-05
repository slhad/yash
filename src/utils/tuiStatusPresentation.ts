export type PlatformStatusLike = { authenticated: boolean; streamStatus: string };
export type MemoryInsightTone = 'default' | 'muted' | 'good' | 'warn' | 'danger';

export function formatElapsed(start: Date): string {
  const secs = Math.floor((Date.now() - start.getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`;
}

export function formatPlatformStatusLabel(status: PlatformStatusLike, viewers: string): string {
  if (!status.authenticated) {
    return `✗${viewers}`;
  }
  if (status.streamStatus === 'ONLINE') {
    return `✓${viewers}`;
  }
  if (status.streamStatus === 'OFFLINE') {
    return `○${viewers}`;
  }
  return `${status.streamStatus}${viewers}`;
}

export function getPlatformStatusColor(status: PlatformStatusLike): string {
  if (!status.authenticated) {
    return 'red';
  }
  if (status.streamStatus === 'ONLINE') {
    return 'green';
  }
  if (status.streamStatus === 'OFFLINE') {
    return 'yellow';
  }
  return 'yellow';
}

export function getMemoryInsightToneColor(tone: MemoryInsightTone): string {
  switch (tone) {
    case 'muted':
      return 'gray';
    case 'good':
      return 'green';
    case 'warn':
      return 'yellow';
    case 'danger':
      return 'red';
    default:
      return 'white';
  }
}
