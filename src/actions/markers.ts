import type { StreamMarker } from '../platforms/base';
import { registry } from './registry';
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

export const markerCreateAction: YashActionDefinition = {
  id: 'marker.create',
  title: 'Create Stream Marker',
  description: 'Place a marker at the current live position on one or all connected platforms.',
  domain: 'marker',
  ipcEnabled: true,
  readOnly: false,
  safety: 'safe',
  visibility: 'public',
  args: {
    text: { type: 'string', required: false, maxLength: 200 },
    platform: { type: 'enum', required: false, values: [...PLATFORM_VALUES] },
  },
  examples: [
    { args: { text: 'Intro' }, description: 'Create a marker labelled "Intro" on all platforms' },
    { args: { text: 'Boss fight', platform: 'twitch' }, description: 'Create a marker on Twitch only' },
  ],
  async invoke(args, ctx): Promise<ActionResult> {
    const text = args.text as string | undefined;
    const platform = (args.platform as PlatformArg | undefined) ?? 'all';

    const matching = Object.entries(ctx.providers).filter(([name]) =>
      matchesPlatform(name, platform),
    );

    const settlements = await Promise.allSettled(
      matching.map(async ([name, provider]) => {
        if (typeof provider.createMarker !== 'function') {
          return { name, marker: null as StreamMarker | null };
        }
        const marker = await provider.createMarker(text);
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
        } else {
          warnings.push(`${name}: marker not created (stream may not be live or platform unsupported)`);
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

    const allMarkers: Array<{ platform: string; title: string; timestamp: string }> = [];
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
          output.push(`[markers] ${name}: ${title} @ ${ts}`);
          allMarkers.push({ platform: name, title, timestamp: ts });
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

registry.registerAction(markerCreateAction);
registry.registerAction(markersListAction);
