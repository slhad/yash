import type { StreamMarker } from '../platforms/base';
import { IpcActionError, registry } from './registry';
import type { ActionResult, YashActionDefinition } from './types';

const PLATFORM_VALUES = ['youtube', 'twitch', 'kick', 'all'] as const;
type PlatformArg = (typeof PLATFORM_VALUES)[number];

function formatTimestamp(positionInSeconds: number): string {
  const h = Math.floor(positionInSeconds / 3600);
  const m = Math.floor((positionInSeconds % 3600) / 60);
  const s = positionInSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function matchesPlatform(providerName: string, platform: PlatformArg): boolean {
  return platform === 'all' || providerName === platform;
}

function getPersistedMarkerSelectionId(provider: unknown, markerId: string): number | null {
  if (
    provider &&
    typeof provider === 'object' &&
    'getPersistedMarkerSelectionId' in provider &&
    typeof provider.getPersistedMarkerSelectionId === 'function'
  ) {
    return provider.getPersistedMarkerSelectionId(markerId);
  }
  return null;
}

function getPersistedMarkerBySelectionId(
  provider: unknown,
  selectionId: number,
): StreamMarker | null {
  if (
    provider &&
    typeof provider === 'object' &&
    'getPersistedMarkerBySelectionId' in provider &&
    typeof provider.getPersistedMarkerBySelectionId === 'function'
  ) {
    return provider.getPersistedMarkerBySelectionId(selectionId);
  }
  return null;
}

async function updatePersistedMarkerBySelectionId(
  provider: unknown,
  selectionId: number,
  updates: { description?: string; timestamp?: number },
): Promise<StreamMarker | null> {
  if (
    provider &&
    typeof provider === 'object' &&
    'updatePersistedMarkerBySelectionId' in provider &&
    typeof provider.updatePersistedMarkerBySelectionId === 'function'
  ) {
    return provider.updatePersistedMarkerBySelectionId(selectionId, updates);
  }
  return null;
}

export const markerCreateAction: YashActionDefinition = {
  id: 'marker.create',
  title: 'Create Stream Marker',
  description: 'Place a marker at the current live position on one or all connected platforms.',
  domain: 'marker',
  ipcEnabled: true,
  ipcOutputMode: 'response_and_tui',
  voiceHint: true,
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  args: {
    text: { type: 'string', required: false, maxLength: 200 },
    platform: { type: 'enum', required: false, values: [...PLATFORM_VALUES] },
    timestamp: { type: 'number', required: false, min: 0, max: 86400 },
  },
  examples: [
    { args: { text: 'Intro' }, description: 'Create a marker labelled "Intro" on all platforms' },
    {
      args: { text: 'Boss fight', platform: 'twitch' },
      description: 'Create a marker on Twitch only',
    },
  ],
  async invoke(args, ctx): Promise<ActionResult> {
    const text = args.text as string | undefined;
    const platform = (args.platform as PlatformArg | undefined) ?? 'all';
    const timestamp = args.timestamp as number | undefined;

    const matching = Object.entries(ctx.providers).filter(([name]) =>
      matchesPlatform(name, platform),
    );

    const settlements = await Promise.allSettled(
      matching.map(async ([name, provider]) => {
        if (typeof provider.createMarker !== 'function') {
          return { name, marker: null as StreamMarker | null };
        }
        const marker = await provider.createMarker(text, timestamp);
        return { name, marker };
      }),
    );

    const output: string[] = [];
    const created: Array<{ platform: string; title: string; timestamp: string }> = [];
    const warnings: string[] = [];

    settlements.forEach((result, i) => {
      const platformName = matching[i]![0];
      if (result.status === 'fulfilled') {
        const { name, marker } = result.value;
        if (marker) {
          const ts = formatTimestamp(marker.positionInSeconds);
          const title = marker.description || text || '(untitled)';
          output.push(`[marker] ${name}: ${title} @ ${ts}`);
          created.push({ platform: name, title, timestamp: ts });
        } else if (name === 'kick') {
          return;
        } else {
          warnings.push(
            `${name}: marker not created (stream may not be live or platform unsupported)`,
          );
        }
      } else {
        warnings.push(`${platformName}: ${String(result.reason)}`);
      }
    });

    return {
      output,
      data: { created },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};

export const markersListAction: YashActionDefinition = {
  id: 'markers.list',
  title: 'List Stream Markers',
  description: 'Retrieve past stream markers from one or all connected platforms.',
  domain: 'markers',
  ipcEnabled: true,
  ipcOutputMode: 'response_and_tui',
  voiceHint: true,
  readOnly: true,
  safety: 'safe',
  visibility: 'public',
  args: {
    platform: { type: 'enum', required: false, values: [...PLATFORM_VALUES] },
    limit: { type: 'number', required: false, min: 1, max: 100 },
  },
  examples: [
    { args: {}, description: 'List recent markers from all platforms' },
    { args: { platform: 'youtube', limit: 10 }, description: 'List last 10 YouTube markers' },
  ],
  async invoke(args, ctx): Promise<ActionResult> {
    const platform = (args.platform as PlatformArg | undefined) ?? 'all';
    const limit = args.limit as number | undefined;

    const matching = Object.entries(ctx.providers).filter(([name]) =>
      matchesPlatform(name, platform),
    );

    const allMarkers: Array<{
      platform: string;
      selectionId?: number;
      title: string;
      timestamp: string;
    }> = [];
    const output: string[] = [];
    const warnings: string[] = [];

    for (const [name, provider] of matching) {
      try {
        if (typeof provider.getMarkers !== 'function') {
          continue;
        }
        const markers = await provider.getMarkers(limit !== undefined ? { limit } : undefined);
        for (const marker of markers) {
          const ts = formatTimestamp(marker.positionInSeconds);
          const title = marker.description || '(untitled)';
          const selectionId = getPersistedMarkerSelectionId(provider, marker.id);
          const idPrefix = selectionId === null ? '' : ` #${selectionId}`;
          output.push(`[markers] ${name}${idPrefix}: ${title} @ ${ts}`);
          allMarkers.push({
            platform: name,
            selectionId: selectionId ?? undefined,
            title,
            timestamp: ts,
          });
        }
      } catch (err) {
        warnings.push(`${name}: ${String(err)}`);
      }
    }

    return {
      output,
      data: { markers: allMarkers },
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  },
};

export const markersEditAction: YashActionDefinition = {
  id: 'markers.edit',
  title: 'Edit Persisted Marker',
  description: 'Edit a persisted YouTube chapter marker by selection index.',
  domain: 'markers',
  ipcEnabled: true,
  ipcOutputMode: 'response_and_tui',
  voiceHint: true,
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  args: {
    selectionId: { type: 'number', required: true, min: 1, max: 9999 },
    text: { type: 'string', required: false, maxLength: 200 },
    timestamp: { type: 'number', required: false, min: 0, max: 86400 },
  },
  examples: [
    {
      args: { selectionId: 1, text: 'Intro' },
      description: 'Rename marker #1 to "Intro"',
    },
    {
      args: { selectionId: 2, text: 'Boss fight', timestamp: 3723 },
      description: 'Update both the label and timestamp for marker #2',
    },
  ],
  async invoke(args, ctx): Promise<ActionResult> {
    const selectionId = args.selectionId as number;
    const text = args.text as string | undefined;
    const timestamp = args.timestamp as number | undefined;

    if (text === undefined && timestamp === undefined) {
      throw new IpcActionError('invalid_args', 'markers.edit requires text and/or timestamp');
    }

    const provider = ctx.providers.youtube;
    const existingMarker = getPersistedMarkerBySelectionId(provider, selectionId);
    if (!existingMarker) {
      throw new IpcActionError('invalid_args', `Unknown persisted marker #${selectionId}`);
    }

    const updatedMarker = await updatePersistedMarkerBySelectionId(provider, selectionId, {
      description: text,
      timestamp,
    });
    if (!updatedMarker) {
      throw new IpcActionError(
        'internal_error',
        `Failed to update persisted marker #${selectionId}`,
      );
    }

    const resolvedSelectionId =
      getPersistedMarkerSelectionId(provider, updatedMarker.id) ?? selectionId;
    const title = updatedMarker.description || '(untitled)';
    const ts = formatTimestamp(updatedMarker.positionInSeconds);

    return {
      output: [`[markers] youtube #${resolvedSelectionId}: ${title} @ ${ts}`],
      data: {
        marker: {
          platform: 'youtube',
          selectionId: resolvedSelectionId,
          title,
          timestamp: ts,
        },
      },
    };
  },
};

registry.registerAction(markerCreateAction);
registry.registerAction(markersListAction);
registry.registerAction(markersEditAction);
