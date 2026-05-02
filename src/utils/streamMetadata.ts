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

export function buildTargetedStreamMetadataUpdate(
  savedStream: Record<string, unknown>,
  selectedPlatforms: Iterable<string>,
  draft: StreamMetadataDraft,
): { changed: Record<string, unknown>; merged: Record<string, unknown> } {
  const selected = new Set(selectedPlatforms);

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
    if (JSON.stringify(value) !== JSON.stringify(savedStream[key])) {
      changed[key] = value;
    }
  }

  return {
    changed,
    merged: { ...savedStream, ...changed },
  };
}
