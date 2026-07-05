import { BoxRenderable, type CliRenderer, InputRenderable, TextRenderable } from '@opentui/core';
import type { YouTubeStreamSetup } from '../platforms/youtube';

export type YouTubeSetupModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

type ToggleKey =
  | 'defaultPlaylist'
  | 'subjectPlaylist'
  | 'chaptering'
  | 'clearMarkersOnNewStream'
  | 'tags'
  | 'description'
  | 'subjectTitle'
  | 'defaultMarkerAtStart'
  | 'markerSyncDelay';

type YouTubeSetupModalContext = {
  renderer: CliRenderer;
  getActiveModal: () => YouTubeSetupModalState | null;
  setActiveModal: (modal: YouTubeSetupModalState | null) => void;
  focusMainInput: () => void;
  appendAndRender: (message: string) => void;
  getSetup: () => YouTubeStreamSetup;
  saveSetup: (setup: YouTubeStreamSetup) => Promise<void>;
  openPlaylistPicker: (
    onPicked: (id: string, title: string) => void,
    onCancelled: () => void,
  ) => void;
};

type YouTubeSetupToggleState = Record<ToggleKey, boolean>;

const YOUTUBE_SETUP_LABELS: Record<ToggleKey, string> = {
  defaultPlaylist: 'Default Playlist ',
  subjectPlaylist: 'Subject Playlist ',
  chaptering: 'Chaptering       ',
  clearMarkersOnNewStream: 'Clear Markers    ',
  tags: 'Tags             ',
  description: 'Description      ',
  subjectTitle: 'Subject in Title ',
  defaultMarkerAtStart: 'Auto-Start Marker',
  markerSyncDelay: 'Marker Delay (s) ',
};

export function buildYouTubeSetupConfig(input: {
  state: YouTubeSetupToggleState;
  playlistId: string;
  playlistTitle: string;
  defaultMarkerMessage: string;
  markerDelay: string;
}): YouTubeStreamSetup {
  return {
    defaultPlaylist: {
      enabled: input.state.defaultPlaylist,
      playlistId: input.playlistId,
      playlistTitle: input.playlistTitle.trim(),
    },
    subjectPlaylist: { enabled: input.state.subjectPlaylist },
    chaptering: { enabled: input.state.chaptering },
    clearMarkersOnNewStream: { enabled: input.state.clearMarkersOnNewStream },
    tags: { enabled: input.state.tags },
    description: { enabled: input.state.description },
    subjectTitle: { enabled: input.state.subjectTitle },
    defaultMarkerAtStart: {
      enabled: input.state.defaultMarkerAtStart,
      message: input.defaultMarkerMessage.trim() || 'start',
    },
    markerSyncDelay: {
      enabled: input.state.markerSyncDelay,
      offsetSeconds: Number.parseInt(input.markerDelay.trim(), 10) || 0,
    },
  };
}

function createToggleState(saved: YouTubeStreamSetup): YouTubeSetupToggleState {
  return {
    defaultPlaylist: saved.defaultPlaylist.enabled,
    subjectPlaylist: saved.subjectPlaylist.enabled,
    chaptering: saved.chaptering.enabled,
    clearMarkersOnNewStream: saved.clearMarkersOnNewStream.enabled,
    tags: saved.tags.enabled,
    description: saved.description.enabled,
    subjectTitle: saved.subjectTitle.enabled,
    defaultMarkerAtStart: saved.defaultMarkerAtStart.enabled,
    markerSyncDelay: saved.markerSyncDelay.enabled,
  };
}

function badge(state: YouTubeSetupToggleState, key: ToggleKey, focused: boolean): string {
  const mark = state[key] ? '[ON ]' : '[OFF]';
  return `${focused ? '▶ ' : '  '}${mark} ${YOUTUBE_SETUP_LABELS[key]}`;
}

export function openYouTubeSetupModal(ctx: YouTubeSetupModalContext): void {
  if (ctx.getActiveModal()) return;
  const { renderer } = ctx;

  const saved = ctx.getSetup();
  const state = createToggleState(saved);
  let playlistId = saved.defaultPlaylist.playlistId;

  const toggleNodes: Record<ToggleKey, TextRenderable> = {
    defaultPlaylist: new TextRenderable(renderer, {
      content: badge(state, 'defaultPlaylist', true),
      fg: 'cyan',
    }),
    subjectPlaylist: new TextRenderable(renderer, {
      content: badge(state, 'subjectPlaylist', false),
      fg: 'white',
    }),
    chaptering: new TextRenderable(renderer, {
      content: badge(state, 'chaptering', false),
      fg: 'white',
    }),
    clearMarkersOnNewStream: new TextRenderable(renderer, {
      content: badge(state, 'clearMarkersOnNewStream', false),
      fg: 'white',
    }),
    tags: new TextRenderable(renderer, { content: badge(state, 'tags', false), fg: 'white' }),
    description: new TextRenderable(renderer, {
      content: badge(state, 'description', false),
      fg: 'white',
    }),
    subjectTitle: new TextRenderable(renderer, {
      content: badge(state, 'subjectTitle', false),
      fg: 'white',
    }),
    defaultMarkerAtStart: new TextRenderable(renderer, {
      content: badge(state, 'defaultMarkerAtStart', false),
      fg: 'white',
    }),
    markerSyncDelay: new TextRenderable(renderer, {
      content: badge(state, 'markerSyncDelay', false),
      fg: 'white',
    }),
  };

  const playlistInput = new InputRenderable(renderer, {
    placeholder: 'playlist name (type to create new)',
    width: '100%',
  });
  playlistInput.value = saved.defaultPlaylist.playlistTitle;
  const playlistHint = new TextRenderable(renderer, {
    content:
      '  ↳ adds every stream to this playlist — type name to create, Ctrl+P to pick existing',
    fg: 'gray',
  });
  const subjectHint = new TextRenderable(renderer, {
    content: '  ↳ creates a new playlist per stream using the Subject field from /stream',
    fg: 'gray',
  });
  const chapteringHint = new TextRenderable(renderer, {
    content: '  ↳ appends a Timestamps block to the description when /marker is used',
    fg: 'gray',
  });
  const clearMarkersHint = new TextRenderable(renderer, {
    content: '  ↳ clears chapter markers automatically when a new broadcast is detected',
    fg: 'gray',
  });
  const tagsHint = new TextRenderable(renderer, {
    content: '  ↳ appends tags from /stream as #hashtags to the description',
    fg: 'gray',
  });
  const descriptionHint = new TextRenderable(renderer, {
    content: '  ↳ adds the description from /stream to the YouTube video description',
    fg: 'gray',
  });
  const subjectTitleHint = new TextRenderable(renderer, {
    content: '  ↳ appends " - {subject}" to the YouTube title (e.g. "My Stream - Gaming")',
    fg: 'gray',
  });

  const defaultMarkerMessageInput = new InputRenderable(renderer, {
    placeholder: 'marker message (default: start)',
    width: '100%',
  });
  defaultMarkerMessageInput.value = saved.defaultMarkerAtStart.message;
  const defaultMarkerAtStartHint = new TextRenderable(renderer, {
    content: '  ↳ creates a marker at 00:00:00 automatically when a new broadcast goes live',
    fg: 'gray',
  });

  const markerDelayInput = new InputRenderable(renderer, {
    placeholder: 'offset in seconds (e.g. -5 or 3)',
    width: '100%',
  });
  markerDelayInput.value =
    saved.markerSyncDelay.offsetSeconds !== 0 ? String(saved.markerSyncDelay.offsetSeconds) : '';
  const markerSyncDelayHint = new TextRenderable(renderer, {
    content: '  ↳ adds this offset (seconds, may be negative) to every marker timestamp',
    fg: 'gray',
  });

  const hint = new TextRenderable(renderer, {
    content: '  [Tab] navigate  [Space] toggle  [Ctrl+P] pick playlist  [Enter] save  [Esc] cancel',
    fg: 'gray',
  });

  type FocusItem = { kind: 'toggle'; key: ToggleKey } | { kind: 'input'; node: InputRenderable };

  const items: FocusItem[] = [
    { kind: 'toggle', key: 'defaultPlaylist' },
    { kind: 'input', node: playlistInput },
    { kind: 'toggle', key: 'subjectPlaylist' },
    { kind: 'toggle', key: 'chaptering' },
    { kind: 'toggle', key: 'clearMarkersOnNewStream' },
    { kind: 'toggle', key: 'defaultMarkerAtStart' },
    { kind: 'input', node: defaultMarkerMessageInput },
    { kind: 'toggle', key: 'markerSyncDelay' },
    { kind: 'input', node: markerDelayInput },
    { kind: 'toggle', key: 'tags' },
    { kind: 'toggle', key: 'description' },
    { kind: 'toggle', key: 'subjectTitle' },
  ];

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '5%',
    left: '5%',
    width: '90%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'red',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' YouTube Stream Setup ',
  });

  box.add(toggleNodes.defaultPlaylist);
  box.add(playlistHint);
  box.add(playlistInput);
  box.add(toggleNodes.subjectPlaylist);
  box.add(subjectHint);
  box.add(toggleNodes.chaptering);
  box.add(chapteringHint);
  box.add(toggleNodes.clearMarkersOnNewStream);
  box.add(clearMarkersHint);
  box.add(toggleNodes.defaultMarkerAtStart);
  box.add(defaultMarkerAtStartHint);
  box.add(defaultMarkerMessageInput);
  box.add(toggleNodes.markerSyncDelay);
  box.add(markerSyncDelayHint);
  box.add(markerDelayInput);
  box.add(toggleNodes.tags);
  box.add(tagsHint);
  box.add(toggleNodes.description);
  box.add(descriptionHint);
  box.add(toggleNodes.subjectTitle);
  box.add(subjectTitleHint);
  box.add(hint);

  renderer.root.add(box);
  ctx.setActiveModal({ box, focusIndex: 0 });
  items[0];

  let focusIdx = 0;

  function blurItem(idx: number): void {
    const item = items[idx]!;
    if (item.kind === 'toggle') {
      toggleNodes[item.key].content = badge(state, item.key, false);
      toggleNodes[item.key].fg = state[item.key] ? 'white' : 'gray';
    } else {
      item.node.blur();
    }
  }

  function focusItem(idx: number): void {
    const item = items[idx]!;
    if (item.kind === 'toggle') {
      toggleNodes[item.key].content = badge(state, item.key, true);
      toggleNodes[item.key].fg = 'cyan';
    } else {
      item.node.focus();
    }
  }

  function advanceFocus(delta: number): void {
    blurItem(focusIdx);
    focusIdx = (focusIdx + delta + items.length) % items.length;
    const activeModal = ctx.getActiveModal();
    if (activeModal) activeModal.focusIndex = focusIdx;
    focusItem(focusIdx);
  }

  function suspendAndPickPlaylist(): void {
    const savedIdx = focusIdx;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);

    ctx.openPlaylistPicker(
      (id, title) => {
        playlistId = id;
        playlistInput.value = title;
        state.defaultPlaylist = true;
        renderer.root.add(box);
        focusIdx = 1;
        ctx.setActiveModal({ box, focusIndex: focusIdx });
        renderer.prependInputHandler(modalKeyHandler);
        focusItem(1);
      },
      () => {
        renderer.root.add(box);
        focusIdx = savedIdx;
        ctx.setActiveModal({ box, focusIndex: focusIdx });
        renderer.prependInputHandler(modalKeyHandler);
        focusItem(focusIdx);
      },
    );
  }

  async function closeModal(save: boolean): Promise<void> {
    if (!ctx.getActiveModal()) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();

    if (!save) {
      ctx.appendAndRender('[system] YouTube setup cancelled.');
      return;
    }

    await ctx.saveSetup(
      buildYouTubeSetupConfig({
        state,
        playlistId,
        playlistTitle: playlistInput.value,
        defaultMarkerMessage: defaultMarkerMessageInput.value,
        markerDelay: markerDelayInput.value,
      }),
    );
    ctx.appendAndRender('[system] YouTube setup saved.');
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveModal()) return false;
    if (sequence === '\t') {
      advanceFocus(1);
      return true;
    }
    if (sequence === '\x1b[Z') {
      advanceFocus(-1);
      return true;
    }
    if (sequence === ' ') {
      const item = items[focusIdx]!;
      if (item.kind === 'toggle') {
        state[item.key] = !state[item.key];
        toggleNodes[item.key].content = badge(state, item.key, true);
        return true;
      }
      return false;
    }
    if (sequence === '\x10') {
      if (focusIdx === 0 || focusIdx === 1) suspendAndPickPlaylist();
      return true;
    }
    if (sequence === '\r' || sequence === '\n') {
      closeModal(true);
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      closeModal(false);
      return true;
    }
    if (sequence === '\x1b[A' || sequence === '\x1b[B') return true;
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);
}
