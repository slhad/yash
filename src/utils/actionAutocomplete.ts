import type { ActionArgAutocompleteSpec } from '../actions/autocomplete';
import type { ActionArgSchema } from '../actions/types';
import { parseLooseActionArgs } from './actionArgs';

type ActionAutocompleteOptions = {
  actionId: string;
  argName: string;
  schema: ActionArgSchema;
  rawInput: string;
  actionIdToken: string;
  tokens: string[];
  currentArgs: Record<string, string>;
  valuePartial: string;
};

type ActionAutocompleteResult = {
  hints: string[];
  completions: string[];
  loading: boolean;
};

type ActionAutocompleteRefreshListener = () => void;

type ActionAutocompleteProviderContext = {
  actionId: string;
  argName: string;
  schema: ActionArgSchema;
  currentArgs: Record<string, string>;
  valuePartial: string;
};

type ActionAutocompleteProvider = (
  ctx: ActionAutocompleteProviderContext,
  spec: ActionArgAutocompleteSpec,
) => Promise<string[]>;

type ObsSceneItem = { sourceName: string };
type ObsSceneList = { scenes: Array<{ sceneName: string }> };

type ActionAutocompleteRuntime = {
  getObsConnectionState: () => boolean;
  getObsCurrentScene: () => Promise<string>;
  getObsSceneList: () => Promise<ObsSceneList>;
  getObsSceneItemList: (sceneName: string) => Promise<ObsSceneItem[]>;
};

type CacheEntry = {
  suggestions: string[];
  expiresAt: number;
};

const providers = new Map<string, ActionAutocompleteProvider>();
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<void>>();
const refreshListeners = new Set<ActionAutocompleteRefreshListener>();

const ACTION_AUTOCOMPLETE_CACHE_MAX_ENTRIES = 100;
const ACTION_AUTOCOMPLETE_CACHE_TTL_MS = 10_000;
const ACTIVITY_TYPE_SUGGESTIONS: Record<string, string[]> = {
  twitch: ['follow', 'sub', 'subscription', 'cheer', 'raid'],
  kick: ['follow', 'sub', 'subscription', 'gift'],
  youtube: ['member', 'subscriber', 'sponsor', 'gift', 'superchat', 'like'],
  all: [
    'follow',
    'sub',
    'subscription',
    'cheer',
    'raid',
    'gift',
    'member',
    'subscriber',
    'sponsor',
    'superchat',
    'like',
  ],
};

const OBS_AUTOCOMPLETE_INVALIDATION_EVENTS = new Set([
  'CurrentProgramSceneChanged',
  'SceneCreated',
  'SceneRemoved',
  'SceneNameChanged',
  'SceneItemCreated',
  'SceneItemRemoved',
  'SceneItemListReindexed',
  'InputCreated',
  'InputRemoved',
  'InputNameChanged',
]);

let runtime: ActionAutocompleteRuntime | null = null;
let cacheGeneration = 0;

type LegacyObsAutocompleteSchema = ActionArgSchema & {
  autocompleteProvider?: 'obs.scenes' | 'obs.sources';
  autocompleteOptions?: {
    allowSceneQualified?: boolean;
    sceneArg?: string;
    valueMode?: 'csv';
  };
};

function getAutocompleteSpec(schema: ActionArgSchema): ActionArgAutocompleteSpec | null {
  if (schema.autocomplete) {
    return schema.autocomplete;
  }

  const legacySchema = schema as LegacyObsAutocompleteSchema;
  if (legacySchema.autocompleteProvider === 'obs.scenes') {
    return {
      type: 'provider',
      providerId: 'obs.scenes',
    };
  }

  if (legacySchema.autocompleteProvider === 'obs.sources') {
    return {
      type: 'provider',
      providerId: 'obs.sceneSources',
      params: {
        includeQualifiedRefs: legacySchema.autocompleteOptions?.allowSceneQualified === true,
        sceneArg: legacySchema.autocompleteOptions?.sceneArg,
        valueMode: legacySchema.autocompleteOptions?.valueMode,
      },
    };
  }

  return null;
}

function normalizeSceneSourceSuggestions(
  sceneName: string,
  items: ObsSceneItem[],
  spec: Extract<ActionArgAutocompleteSpec, { type: 'provider' }>,
): string[] {
  const bare = spec.params?.includeBareNames !== false;
  const qualified = spec.params?.includeQualifiedRefs === true;
  const seen = new Set<string>();
  const suggestions: string[] = [];

  for (const item of items) {
    const sourceName = item.sourceName.trim();
    if (!sourceName) continue;
    if (bare && !seen.has(sourceName)) {
      seen.add(sourceName);
      suggestions.push(sourceName);
    }
    const qualifiedRef = `${sceneName}.${sourceName}`;
    if (qualified && !seen.has(qualifiedRef)) {
      seen.add(qualifiedRef);
      suggestions.push(qualifiedRef);
    }
  }

  return suggestions;
}

function emitRefresh(): void {
  for (const listener of refreshListeners) listener();
}

function pruneAutocompleteCache(): void {
  while (cache.size > ACTION_AUTOCOMPLETE_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    cache.delete(oldestKey);
  }
}

function setCachedSuggestions(cacheKey: string, suggestions: string[], generation: number): void {
  if (generation !== cacheGeneration) return;
  cache.delete(cacheKey);
  cache.set(cacheKey, {
    suggestions,
    expiresAt: Date.now() + ACTION_AUTOCOMPLETE_CACHE_TTL_MS,
  });
  pruneAutocompleteCache();
}

function getCachedSuggestions(cacheKey: string): string[] | null {
  const entry = cache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(cacheKey);
    return null;
  }
  cache.delete(cacheKey);
  cache.set(cacheKey, entry);
  return entry.suggestions;
}

function buildCacheKey(options: ActionAutocompleteOptions): string | null {
  const spec = getAutocompleteSpec(options.schema);
  if (!spec) return null;
  if (spec.type !== 'provider') return null;

  if (spec.providerId === 'obs.scenes') {
    return JSON.stringify({
      provider: spec.providerId,
      arg: options.argName,
    });
  }

  if (spec.providerId === 'activity.types') {
    const platformArg =
      typeof spec.params?.platformArg === 'string' && spec.params.platformArg.length > 0
        ? spec.params.platformArg
        : 'platform';
    return JSON.stringify({
      provider: spec.providerId,
      arg: options.argName,
      platform: options.currentArgs[platformArg]?.trim().toLowerCase() || null,
    });
  }

  if (spec.providerId === 'obs.sceneSources') {
    const sceneArg =
      typeof spec.params?.sceneArg === 'string' && spec.params.sceneArg.length > 0
        ? spec.params.sceneArg
        : 'scene';
    const explicitScene = options.currentArgs[sceneArg]?.trim() || null;
    return JSON.stringify({
      provider: spec.providerId,
      arg: options.argName,
      scene: explicitScene,
      includeQualifiedRefs: spec.params?.includeQualifiedRefs === true,
      includeBareNames: spec.params?.includeBareNames !== false,
      useCurrentSceneByDefault: spec.params?.useCurrentSceneByDefault !== false,
    });
  }

  return null;
}

function filterSuggestions(suggestions: string[], partial: string): string[] {
  if (!partial) return suggestions;
  const partialLower = partial.toLowerCase();
  return suggestions.filter((suggestion) => suggestion.toLowerCase().includes(partialLower));
}

function getValueMode(spec: ActionArgAutocompleteSpec | null): 'default' | 'csv' {
  if (spec?.type !== 'provider') return 'default';
  return spec.params?.valueMode === 'csv' ? 'csv' : 'default';
}

function splitCsvTail(value: string): { prefix: string; partial: string } {
  const lastComma = value.lastIndexOf(',');
  if (lastComma === -1) {
    return { prefix: '', partial: value.trimStart() };
  }
  return {
    prefix: value.slice(0, lastComma + 1),
    partial: value.slice(lastComma + 1).trimStart(),
  };
}

async function resolveSuggestions(
  ctx: ActionAutocompleteProviderContext,
  spec: ActionArgAutocompleteSpec,
): Promise<string[]> {
  if (spec.type !== 'provider') {
    return spec.values;
  }

  const provider = providers.get(spec.providerId);
  if (!provider) return [];
  try {
    return await provider(ctx, spec);
  } catch {
    return [];
  }
}

function requestSuggestions(cacheKey: string, options: ActionAutocompleteOptions): void {
  if (inflight.has(cacheKey)) return;
  const spec = getAutocompleteSpec(options.schema);
  if (!spec) return;
  const requestGeneration = cacheGeneration;

  const request = resolveSuggestions(
    {
      actionId: options.actionId,
      argName: options.argName,
      schema: options.schema,
      currentArgs: options.currentArgs,
      valuePartial: options.valuePartial,
    },
    spec,
  )
    .then((suggestions) => {
      setCachedSuggestions(cacheKey, suggestions, requestGeneration);
      emitRefresh();
    })
    .finally(() => {
      if (inflight.get(cacheKey) === request) {
        inflight.delete(cacheKey);
      }
    });

  inflight.set(cacheKey, request);
}

providers.set('activity.types', async (ctx, spec) => {
  if (spec.type !== 'provider' || spec.providerId !== 'activity.types') return [];
  const platformArg =
    typeof spec.params?.platformArg === 'string' && spec.params.platformArg.length > 0
      ? spec.params.platformArg
      : 'platform';
  const platform = ctx.currentArgs[platformArg]?.trim().toLowerCase() || 'all';
  return ACTIVITY_TYPE_SUGGESTIONS[platform] ?? ACTIVITY_TYPE_SUGGESTIONS.all ?? [];
});

providers.set('obs.scenes', async () => {
  if (!runtime?.getObsConnectionState()) return [];
  const sceneList = await runtime.getObsSceneList();
  return (sceneList.scenes ?? []).map((scene) => scene.sceneName).filter(Boolean);
});

providers.set('obs.sceneSources', async (ctx, spec) => {
  if (spec.type !== 'provider' || spec.providerId !== 'obs.sceneSources') return [];
  if (!runtime?.getObsConnectionState()) return [];

  const sceneArg =
    typeof spec.params?.sceneArg === 'string' && spec.params.sceneArg.length > 0
      ? spec.params.sceneArg
      : 'scene';
  const explicitScene = ctx.currentArgs[sceneArg]?.trim();
  const useCurrentSceneByDefault = spec.params?.useCurrentSceneByDefault !== false;
  const sceneName =
    explicitScene && explicitScene.length > 0
      ? explicitScene
      : useCurrentSceneByDefault
        ? await runtime.getObsCurrentScene()
        : null;
  if (!sceneName) return [];

  const items = await runtime.getObsSceneItemList(sceneName);
  return normalizeSceneSourceSuggestions(sceneName, items, spec);
});

export function setActionAutocompleteRuntime(nextRuntime: ActionAutocompleteRuntime | null): void {
  runtime = nextRuntime;
}

export function subscribeToActionAutocompleteRefresh(
  listener: ActionAutocompleteRefreshListener,
): () => void {
  refreshListeners.add(listener);
  return () => {
    refreshListeners.delete(listener);
  };
}

export function getDynamicActionArgAutocomplete(
  options: ActionAutocompleteOptions,
): ActionAutocompleteResult | null {
  const spec = getAutocompleteSpec(options.schema);
  if (!spec) return null;
  const valueMode = getValueMode(spec);
  const csvContext = valueMode === 'csv' ? splitCsvTail(options.valuePartial) : null;
  const filterPartial = csvContext?.partial ?? options.valuePartial;

  if (spec.type === 'static') {
    const suggestions = filterSuggestions(spec.values, filterPartial);
    const base = `/action ${options.actionIdToken} ${options.tokens.slice(0, -1).join(' ')}${
      options.tokens.length > 1 ? ' ' : ''
    }${options.argName}=`;
    return {
      hints: suggestions,
      completions: suggestions.map(
        (suggestion) => `${base}${csvContext ? `${csvContext.prefix}${suggestion}` : suggestion}`,
      ),
      loading: false,
    };
  }

  const cacheKey = buildCacheKey(options);
  if (!cacheKey) return null;

  const cachedSuggestions = getCachedSuggestions(cacheKey);
  if (!cachedSuggestions) {
    requestSuggestions(cacheKey, options);
    return { hints: [], completions: [], loading: true };
  }

  const suggestions = filterSuggestions(cachedSuggestions, filterPartial);
  const base = `/action ${options.actionIdToken} ${options.tokens.slice(0, -1).join(' ')}${
    options.tokens.length > 1 ? ' ' : ''
  }${options.argName}=`;

  return {
    hints: suggestions,
    completions: suggestions.map(
      (suggestion) => `${base}${csvContext ? `${csvContext.prefix}${suggestion}` : suggestion}`,
    ),
    loading: inflight.has(cacheKey),
  };
}

export function parseActionAutocompleteContext(
  argsPart: string,
  argDefs?: Record<string, ActionArgSchema>,
): {
  tokens: string[];
  currentArgs: Record<string, string>;
} {
  const rawTokens = argsPart.split(' ');
  const tokens: string[] = [];
  let currentIndex = -1;

  for (const token of rawTokens) {
    if (!token) continue;
    if (token.includes('=')) {
      tokens.push(token);
      currentIndex = tokens.length - 1;
      continue;
    }
    if (currentIndex >= 0) {
      const currentToken = tokens[currentIndex] ?? '';
      const currentEqIdx = currentToken.indexOf('=');
      const currentArgName = currentEqIdx === -1 ? '' : currentToken.slice(0, currentEqIdx);
      const currentSchema = currentArgName ? argDefs?.[currentArgName] : undefined;
      const looksLikeArgName =
        token.length > 0 &&
        /^[A-Za-z][A-Za-z0-9.-]*$/.test(token) &&
        Object.keys(argDefs ?? {}).some(
          (argName) =>
            argName !== currentArgName && argName.toLowerCase().startsWith(token.toLowerCase()),
        );
      if (currentSchema && currentSchema.type !== 'string' && looksLikeArgName) {
        tokens.push(token);
        currentIndex = -1;
        continue;
      }
      tokens[currentIndex] = `${tokens[currentIndex]} ${token}`;
      continue;
    }
    tokens.push(token);
    currentIndex = -1;
  }

  if (argsPart.endsWith(' ')) {
    tokens.push('');
  }

  return {
    tokens,
    currentArgs: parseLooseActionArgs(tokens.filter((token) => token.length > 0)),
  };
}

export function clearActionAutocompleteCaches(): void {
  cacheGeneration++;
  cache.clear();
  inflight.clear();
}

export function invalidateActionAutocompleteForObsEvent(event: unknown): boolean {
  const eventType = (event as { eventType?: unknown } | null)?.eventType;
  if (typeof eventType !== 'string' || !OBS_AUTOCOMPLETE_INVALIDATION_EVENTS.has(eventType)) {
    return false;
  }
  clearActionAutocompleteCaches();
  return true;
}

export function __getActionAutocompleteDebugState(): {
  cacheKeys: string[];
  inflightKeys: string[];
  cacheGeneration: number;
} {
  return {
    cacheKeys: [...cache.keys()],
    inflightKeys: [...inflight.keys()],
    cacheGeneration,
  };
}
