import { BoxRenderable, type CliRenderer, InputRenderable, TextRenderable } from '@opentui/core';

export type YouTubeStreamModalState = {
  box: BoxRenderable;
  focusIndex: number;
};

export type YouTubeStreamEntry = { title: string; streamKey: string };
export type YouTubePlaylistEntry = { id: string; title: string };

export type YouTubeStreamModalsContext = {
  renderer: CliRenderer;
  getActiveModal: () => YouTubeStreamModalState | null;
  setActiveModal: (modal: YouTubeStreamModalState | null) => void;
  focusMainInput: () => void;
  appendAndRender: (message: string) => void;
  saveStreamKey: (streamKey: string) => Promise<void>;
  listStreams: () => Promise<YouTubeStreamEntry[]>;
  listPlaylists: () => Promise<YouTubePlaylistEntry[]>;
};

export function maskStreamKey(key: string): string {
  const parts = key.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${'•'.repeat(4)}${parts.length > 2 ? `-${'•'.repeat(4)}` : ''}`;
  }
  return `${key.slice(0, 4)}••••`;
}

export function formatYouTubeStreamItem(entry: YouTubeStreamEntry, selected: boolean): string {
  const prefix = selected ? ' ▶ ' : '   ';
  const title = entry.title.slice(0, 36).padEnd(36, ' ');
  return `${prefix}${title}  ${maskStreamKey(entry.streamKey)}`;
}

export function formatYouTubePlaylistItem(entry: YouTubePlaylistEntry, selected: boolean): string {
  return `${selected ? ' ▶ ' : '   '}${entry.title}`;
}

export function openYouTubeStreamKeyModal(
  ctx: YouTubeStreamModalsContext,
  onSaved?: () => void,
): void {
  const { renderer } = ctx;

  const instructions = new TextRenderable(renderer, {
    content:
      ' No stream keys found on your account yet.\n' +
      ' To create one:\n' +
      '  1. Go to YouTube Studio (studio.youtube.com)\n' +
      '  2. Click "Go Live" → "Stream" tab → "Stream settings"\n' +
      '  3. Copy the Stream Key and paste it below.\n',
    fg: 'white',
  });

  const keyLabel = new TextRenderable(renderer, { content: ' Stream Key:', fg: 'red' });
  const keyInput = new InputRenderable(renderer, {
    placeholder: 'paste your YouTube stream key…',
    width: '100%',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Enter] save   [Esc] cancel',
    fg: 'gray',
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '10%',
    left: '10%',
    width: '80%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'red',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' YouTube Stream Key ',
  });

  box.add(instructions);
  box.add(keyLabel);
  box.add(keyInput);
  box.add(hint);

  renderer.root.add(box);
  ctx.setActiveModal({ box, focusIndex: 0 });
  keyInput.focus();

  function closeModal(save: boolean): void {
    if (!ctx.getActiveModal()) return;
    if (save) {
      const key = keyInput.value.trim();
      if (key) {
        ctx.saveStreamKey(key).then(() => {
          ctx.appendAndRender('[system] YouTube stream key saved.');
          onSaved?.();
        });
      } else {
        ctx.appendAndRender('[system] YouTube stream key setup cancelled (empty value).');
      }
    } else {
      ctx.appendAndRender('[system] YouTube stream key setup cancelled.');
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveModal()) return false;
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

  keyInput.onKeyDown = ((key: { name: string }) => {
    if (key.name === 'escape' && ctx.getActiveModal()) closeModal(false);
  }) as any;
}

export function openYouTubeStreamPickerModal(
  ctx: YouTubeStreamModalsContext,
  onSaved?: () => void,
): void {
  const { renderer } = ctx;

  const statusText = new TextRenderable(renderer, {
    content: ' Fetching your stream keys from YouTube…',
    fg: 'gray',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [↑↓] navigate   [Enter] select   [Esc] cancel',
    fg: 'gray',
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '10%',
    left: '10%',
    width: '80%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'red',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' YouTube Stream Key ',
  });

  box.add(statusText);
  box.add(hint);
  renderer.root.add(box);
  ctx.setActiveModal({ box, focusIndex: 0 });

  let streams: YouTubeStreamEntry[] = [];
  const itemNodes: TextRenderable[] = [];

  function updateSelection(newIdx: number): void {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return;
    const oldIdx = activeModal.focusIndex;
    if (itemNodes[oldIdx]) {
      itemNodes[oldIdx].content = formatYouTubeStreamItem(streams[oldIdx]!, false);
      itemNodes[oldIdx].fg = 'white';
    }
    activeModal.focusIndex = newIdx;
    if (itemNodes[newIdx]) {
      itemNodes[newIdx].content = formatYouTubeStreamItem(streams[newIdx]!, true);
      itemNodes[newIdx].fg = 'cyan';
    }
  }

  function closeModal(save: boolean): void {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return;
    if (save && streams.length > 0) {
      const selected = streams[activeModal.focusIndex];
      if (selected) {
        ctx.saveStreamKey(selected.streamKey).then(() => {
          ctx.appendAndRender(`[system] YouTube stream key set to "${selected.title}".`);
          onSaved?.();
        });
      }
    } else if (!save) {
      ctx.appendAndRender('[system] YouTube stream key selection cancelled.');
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    ctx.focusMainInput();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return false;
    if (sequence === '\x1b[A') {
      updateSelection(Math.max(0, activeModal.focusIndex - 1));
      return true;
    }
    if (sequence === '\x1b[B') {
      updateSelection(Math.min(streams.length - 1, activeModal.focusIndex + 1));
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
    return true;
  };

  renderer.prependInputHandler(modalKeyHandler);

  ctx
    .listStreams()
    .then((result) => {
      if (!ctx.getActiveModal()) return;
      box.remove(statusText.id);

      if (result.length === 0) {
        renderer.removeInputHandler(modalKeyHandler);
        renderer.root.remove(box.id);
        ctx.setActiveModal(null);
        ctx.focusMainInput();
        openYouTubeStreamKeyModal(ctx, onSaved);
        return;
      }

      streams = result;
      for (let i = 0; i < streams.length; i++) {
        const node = new TextRenderable(renderer, {
          content: formatYouTubeStreamItem(streams[i]!, i === 0),
          fg: i === 0 ? 'cyan' : 'white',
        });
        itemNodes.push(node);
        box.add(node);
      }
    })
    .catch(() => {
      if (!ctx.getActiveModal()) return;
      box.remove(statusText.id);
      const errorText = new TextRenderable(renderer, {
        content: ' Failed to fetch stream keys. Check your connection and try again.',
        fg: 'yellow',
      });
      box.add(errorText);
      hint.content = ' [Esc] close';
    });
}

export function openYouTubePlaylistPickerModal(
  ctx: YouTubeStreamModalsContext,
  onSelect: (id: string, title: string) => void,
  onCancel: () => void,
): void {
  const { renderer } = ctx;

  const statusText = new TextRenderable(renderer, {
    content: ' Fetching your playlists from YouTube…',
    fg: 'gray',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [↑↓] navigate   [Enter] select   [Esc] cancel',
    fg: 'gray',
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '10%',
    left: '10%',
    width: '80%',
    zIndex: 101,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'red',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' Select Playlist ',
  });

  box.add(statusText);
  box.add(hint);
  renderer.root.add(box);
  ctx.setActiveModal({ box, focusIndex: 0 });

  let playlists: YouTubePlaylistEntry[] = [];
  const itemNodes: TextRenderable[] = [];

  function updateSelection(newIdx: number): void {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return;
    const oldIdx = activeModal.focusIndex;
    if (itemNodes[oldIdx]) {
      itemNodes[oldIdx].content = formatYouTubePlaylistItem(playlists[oldIdx]!, false);
      itemNodes[oldIdx].fg = 'white';
    }
    activeModal.focusIndex = newIdx;
    if (itemNodes[newIdx]) {
      itemNodes[newIdx].content = formatYouTubePlaylistItem(playlists[newIdx]!, true);
      itemNodes[newIdx].fg = 'cyan';
    }
  }

  function closeModal(save: boolean): void {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return;
    const idx = activeModal.focusIndex;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveModal(null);
    if (save && playlists[idx]) onSelect(playlists[idx]!.id, playlists[idx]!.title);
    else onCancel();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    const activeModal = ctx.getActiveModal();
    if (!activeModal) return false;
    if (sequence === '\x1b[A') {
      updateSelection(Math.max(0, activeModal.focusIndex - 1));
      return true;
    }
    if (sequence === '\x1b[B') {
      updateSelection(Math.min(playlists.length - 1, activeModal.focusIndex + 1));
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
    return true;
  };

  renderer.prependInputHandler(modalKeyHandler);

  ctx
    .listPlaylists()
    .then((result) => {
      if (!ctx.getActiveModal()) return;
      box.remove(statusText.id);
      if (result.length === 0) {
        box.add(
          new TextRenderable(renderer, {
            content: ' No playlists found. Type a name below to create one.',
            fg: 'yellow',
          }),
        );
        hint.content = ' [Esc] close';
        return;
      }
      playlists = result;
      for (let i = 0; i < playlists.length; i++) {
        const node = new TextRenderable(renderer, {
          content: formatYouTubePlaylistItem(playlists[i]!, i === 0),
          fg: i === 0 ? 'cyan' : 'white',
        });
        itemNodes.push(node);
        box.add(node);
      }
    })
    .catch(() => {
      if (!ctx.getActiveModal()) return;
      box.remove(statusText.id);
      box.add(
        new TextRenderable(renderer, { content: ' Failed to fetch playlists.', fg: 'yellow' }),
      );
      hint.content = ' [Esc] close';
    });
}
