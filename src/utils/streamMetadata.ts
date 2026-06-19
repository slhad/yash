export interface StreamMetadataDraft {
  title?: string;
  tags?: string[];
  game?: string;
  youtubeCategory?: string;
  description?: string;
  twitchGame?: string;
  notification?: string;
  kickCategory?: string;
}

export interface StreamTemplateDraft extends StreamMetadataDraft {
  selectedPlatforms?: string[];
}

export interface StreamTemplateCollection {
  activeName?: string;
  items: Record<string, StreamTemplateDraft>;
}

type StreamMetadataUpdateOptions = {
  force?: boolean;
};

const STREAM_TEMPLATE_KEYS = [
  'title',
  'tags',
  'game',
  'youtubeCategory',
  'description',
  'twitchGame',
  'notification',
  'kickCategory',
] as const;

const VALID_STREAM_TEMPLATE_PLATFORMS = new Set(['youtube', 'twitch', 'kick']);

function cloneArray<T>(value: T[] | undefined): T[] | undefined {
  return Array.isArray(value) ? [...value] : undefined;
}

export function buildStreamTemplateDraft(
  draft: StreamMetadataDraft,
  selectedPlatforms: Iterable<string>,
): StreamTemplateDraft {
  return {
    title: draft.title,
    tags: cloneArray(draft.tags),
    game: draft.game,
    youtubeCategory: draft.youtubeCategory,
    description: draft.description,
    twitchGame: draft.twitchGame,
    notification: draft.notification,
    kickCategory: draft.kickCategory,
    selectedPlatforms: [...new Set(selectedPlatforms)].filter((platform) =>
      VALID_STREAM_TEMPLATE_PLATFORMS.has(platform),
    ),
  };
}

export function sanitizeStreamTemplateDraft(value: unknown): StreamTemplateDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const next: StreamTemplateDraft = {};
  for (const key of STREAM_TEMPLATE_KEYS) {
    const current = source[key];
    if (current === undefined) continue;
    if (key === 'tags') {
      if (Array.isArray(current)) {
        next.tags = current
          .filter((entry): entry is string => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter(Boolean);
      }
      continue;
    }
    if (typeof current === 'string') {
      next[key] = current;
    }
  }
  if (Array.isArray(source.selectedPlatforms)) {
    next.selectedPlatforms = source.selectedPlatforms
      .filter((platform): platform is string => typeof platform === 'string')
      .filter((platform, index, all) => all.indexOf(platform) === index)
      .filter((platform) => VALID_STREAM_TEMPLATE_PLATFORMS.has(platform));
  }
  return next;
}

export function sanitizeStreamTemplateCollection(value: unknown): StreamTemplateCollection {
  const fallback: StreamTemplateCollection = { activeName: '', items: {} };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const source = value as Record<string, unknown>;
  const itemsSource =
    source.items && typeof source.items === 'object' && !Array.isArray(source.items)
      ? (source.items as Record<string, unknown>)
      : {};
  const items: Record<string, StreamTemplateDraft> = {};
  for (const [rawName, rawTemplate] of Object.entries(itemsSource)) {
    const name = rawName.trim();
    if (!name) continue;
    const template = sanitizeStreamTemplateDraft(rawTemplate);
    if (!template) continue;
    items[name] = template;
  }
  const activeName =
    typeof source.activeName === 'string' && source.activeName.trim().length > 0
      ? source.activeName.trim()
      : '';
  return {
    activeName,
    items,
  };
}

export function buildTargetedStreamMetadataUpdate(
  savedStream: Record<string, unknown>,
  selectedPlatforms: Iterable<string>,
  draft: StreamMetadataDraft,
  options: StreamMetadataUpdateOptions = {},
): { changed: Record<string, unknown>; merged: Record<string, unknown> } {
  const selected = new Set(selectedPlatforms);
  const force = options.force === true;

  const candidate: Record<string, unknown> = {
    title: draft.title,
    tags: draft.tags,
  };

  if (selected.has('youtube')) {
    candidate.game = draft.game;
    candidate.youtubeCategory = draft.youtubeCategory;
    candidate.description = draft.description;
  }

  if (selected.has('twitch')) {
    candidate.twitchGame = draft.twitchGame;
    candidate.notification = draft.notification;
  }

  if (selected.has('kick')) {
    candidate.kickCategory = draft.kickCategory;
  }

  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(candidate)) {
    if (force || JSON.stringify(value) !== JSON.stringify(savedStream[key])) {
      changed[key] = value;
    }
  }

  return {
    changed,
    merged: { ...savedStream, ...changed },
  };
}
