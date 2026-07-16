export type WebPlatform = 'youtube' | 'twitch' | 'kick';
export type ComposerPosition = 'bottom' | 'top' | 'hide';

type StatusInfo = {
  streamStatus?: string;
  viewerCount?: number;
  streamStartTime?: string | null;
};

type Marker = {
  createdAt?: string | number | Date;
  description?: string;
  positionInSeconds?: number;
};

type MarkerResult = { platform?: string; markers?: Marker[]; error?: string };
type ActivityEvent = { ts: number; platform: string; type: string; message: string };

const PLATFORMS: WebPlatform[] = ['youtube', 'twitch', 'kick'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

const PLATFORM_LABELS: Record<WebPlatform, string> = {
  youtube: 'YouTube',
  twitch: 'Twitch',
  kick: 'Kick',
};

function isPlatform(value: string): value is WebPlatform {
  return PLATFORMS.includes(value as WebPlatform);
}

function formatElapsed(isoStart: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function formatPosition(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function platformIcon(platform: WebPlatform): HTMLImageElement {
  const image = document.createElement('img');
  image.className = 'platform-icon';
  image.src = `/api/status-icons/${platform}`;
  image.alt = PLATFORM_LABELS[platform];
  image.width = 18;
  image.height = 18;
  return image;
}

function createStateDot(platform: WebPlatform, live: boolean): HTMLSpanElement {
  const dot = document.createElement('span');
  dot.className = `platform-state-dot ${live ? 'is-live' : 'is-offline'}`;
  dot.dataset.platformState = platform;
  dot.setAttribute('aria-hidden', 'true');
  return dot;
}

function updateStateTargets(statuses: Record<string, StatusInfo>): void {
  for (const platform of PLATFORMS) {
    const live = statuses[platform]?.streamStatus === 'ONLINE';
    for (const target of document.querySelectorAll<HTMLElement>(
      `[data-platform-state="${platform}"]`,
    )) {
      target.classList.toggle('is-live', live);
      target.classList.toggle('is-offline', !live);
    }
  }
}

function renderStatuses(container: HTMLElement, payload: unknown): void {
  if (!isRecord(payload)) return;
  container.replaceChildren();
  const statuses = payload as Record<string, unknown>;
  const normalizedStatuses: Record<string, StatusInfo> = {};
  for (const platform of PLATFORMS) {
    const candidate = statuses[platform];
    const info: StatusInfo = isRecord(candidate)
      ? {
          streamStatus:
            typeof candidate.streamStatus === 'string' ? candidate.streamStatus : undefined,
          viewerCount:
            typeof candidate.viewerCount === 'number' ? candidate.viewerCount : undefined,
          streamStartTime:
            typeof candidate.streamStartTime === 'string' ? candidate.streamStartTime : undefined,
        }
      : {};
    normalizedStatuses[platform] = info;
    const live = info.streamStatus === 'ONLINE';
    const chip = document.createElement('span');
    chip.className = `platform-state ${live ? 'is-live' : 'is-offline'}`;
    chip.title = `${PLATFORM_LABELS[platform]} ${live ? 'online' : 'offline'}`;
    chip.setAttribute('aria-label', chip.title);
    chip.append(platformIcon(platform), createStateDot(platform, live));

    const detail = document.createElement('span');
    detail.className = 'platform-state-detail';
    if (live && typeof info.streamStartTime === 'string') {
      detail.textContent = formatElapsed(info.streamStartTime);
    }
    if (live && typeof info.viewerCount === 'number' && Number.isFinite(info.viewerCount)) {
      detail.textContent += `${detail.textContent ? ' · ' : ''}${info.viewerCount}`;
      detail.title = `${info.viewerCount} viewers`;
    }
    chip.appendChild(detail);
    container.appendChild(chip);
  }
  updateStateTargets(normalizedStatuses);
}

function newestMarker(payload: unknown): { platform: WebPlatform; marker: Marker } | null {
  if (!Array.isArray(payload)) return null;
  let newest: { platform: WebPlatform; marker: Marker; time: number } | null = null;
  for (const candidate of payload) {
    if (!isRecord(candidate)) continue;
    const result = candidate as MarkerResult;
    if (!result.platform || !isPlatform(result.platform) || !Array.isArray(result.markers)) {
      continue;
    }
    for (const candidateMarker of result.markers) {
      if (!isRecord(candidateMarker)) continue;
      const createdAt = candidateMarker.createdAt;
      if (typeof createdAt !== 'string' && typeof createdAt !== 'number') continue;
      const time = new Date(createdAt).getTime();
      if (!Number.isFinite(time)) continue;
      const marker: Marker = {
        createdAt,
        description:
          typeof candidateMarker.description === 'string' ? candidateMarker.description : undefined,
        positionInSeconds:
          typeof candidateMarker.positionInSeconds === 'number' &&
          Number.isFinite(candidateMarker.positionInSeconds)
            ? candidateMarker.positionInSeconds
            : undefined,
      };
      if (!newest || time > newest.time) newest = { platform: result.platform, marker, time };
    }
  }
  return newest ? { platform: newest.platform, marker: newest.marker } : null;
}

function renderMarker(container: HTMLElement, payload: unknown): void {
  container.replaceChildren();
  const latest = newestMarker(payload);
  if (!latest) {
    const hasError =
      Array.isArray(payload) && payload.some((result) => isRecord(result) && result.error);
    container.textContent = hasError ? 'Latest marker unavailable' : 'No stream markers yet';
    container.title = container.textContent;
    return;
  }

  container.appendChild(platformIcon(latest.platform));
  const description = document.createElement('strong');
  description.textContent = latest.marker.description?.trim() || 'Stream marker';
  container.appendChild(description);

  const detail = document.createElement('span');
  detail.className = 'marker-detail';
  const parts: string[] = [];
  if (typeof latest.marker.positionInSeconds === 'number') {
    parts.push(formatPosition(latest.marker.positionInSeconds));
  }
  if (latest.marker.createdAt) {
    const created = new Date(latest.marker.createdAt);
    if (Number.isFinite(created.getTime()))
      parts.push(created.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  }
  detail.textContent = parts.join(' · ');
  container.appendChild(detail);
  container.title = `${PLATFORM_LABELS[latest.platform]} marker: ${description.textContent}${detail.textContent ? `, ${detail.textContent}` : ''}`;
}

function renderActivity(container: HTMLElement, payload: unknown): void {
  const events = Array.isArray(payload)
    ? payload.filter(
        (event): event is ActivityEvent =>
          isRecord(event) &&
          typeof event.ts === 'number' &&
          Number.isFinite(event.ts) &&
          typeof event.platform === 'string' &&
          isPlatform(event.platform) &&
          typeof event.type === 'string' &&
          typeof event.message === 'string',
      )
    : [];
  container.replaceChildren();
  if (events.length === 0) {
    container.textContent = 'No recent activity';
    return;
  }
  for (const [index, event] of events.slice(-5).entries()) {
    if (index > 0) {
      const separator = document.createElement('span');
      separator.className = 'activity-separator';
      separator.textContent = '│';
      container.appendChild(separator);
    }
    const item = document.createElement('span');
    item.className = `activity-item activity-${isPlatform(event.platform) ? event.platform : 'unknown'}`;
    item.textContent = event.message;
    item.title = `${event.platform} ${event.type}`;
    container.appendChild(item);
  }
}

export function startPagePoll(
  task: (signal: AbortSignal) => Promise<void>,
  intervalMs: number | (() => number),
  signal: AbortSignal,
  shouldRun: () => boolean = () => true,
): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async (): Promise<void> => {
    if (signal.aborted) return;
    if (shouldRun()) await task(signal).catch(() => {});
    const nextInterval = typeof intervalMs === 'function' ? intervalMs() : intervalMs;
    if (!signal.aborted) timer = setTimeout(() => void run(), Math.max(0, nextInterval));
  };
  signal.addEventListener('abort', () => timer && clearTimeout(timer), { once: true });
  void run();
}

export function setupWebChatHeader(options: {
  getComposerPosition: () => ComposerPosition;
  toggleComposer: () => void;
  signal: AbortSignal;
}): void {
  const header = document.getElementById('chat-header');
  const toggle = header?.querySelector<HTMLElement>('.header-summary');
  const marker = document.getElementById('latest-marker');
  const statuses = document.getElementById('platform-statuses');
  const activity = document.getElementById('activity-bar');
  if (!header || !toggle || !marker || !statuses || !activity) return;

  for (const image of document.querySelectorAll<HTMLImageElement>('[data-platform-icon]')) {
    const platform = image.dataset.platformIcon;
    if (platform && isPlatform(platform)) image.src = `/api/status-icons/${platform}`;
  }

  const syncExpanded = (): void => {
    toggle.setAttribute('aria-expanded', String(options.getComposerPosition() !== 'hide'));
  };
  const activate = (event: Event): void => {
    const target = event.target;
    if (target instanceof Element && target.closest('button, select, textarea, input, a')) return;
    options.toggleComposer();
    syncExpanded();
  };
  header.addEventListener('click', activate);
  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(event);
    }
  });
  syncExpanded();

  startPagePoll(
    async (signal) => {
      const [statusResult, markerResult, activityResult] = await Promise.allSettled([
        fetch('/api/status', { signal }),
        fetch('/api/stream/markers?limit=1', { signal }),
        fetch('/api/activity/recent?limit=5', { signal }),
      ]);
      if (statusResult.status === 'fulfilled' && statusResult.value.ok) {
        renderStatuses(statuses, await readJson(statusResult.value));
      }
      if (markerResult.status === 'fulfilled' && markerResult.value.ok) {
        const data = await readJson(markerResult.value);
        renderMarker(marker, isRecord(data) ? data.markers : []);
      } else if (!signal.aborted) {
        renderMarker(marker, [{ error: 'request failed' }]);
      }
      if (activityResult.status === 'fulfilled' && activityResult.value.ok) {
        const data = await readJson(activityResult.value);
        renderActivity(activity, isRecord(data) ? data.events : []);
      }
    },
    3_000,
    options.signal,
  );
}
