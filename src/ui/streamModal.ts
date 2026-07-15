import {
  BoxRenderable,
  type CliRenderer,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
} from '@opentui/core';
import { YT_CATEGORY_NAMES } from '../platforms/youtube';
import {
  buildStreamTemplateDraft,
  buildTargetedStreamMetadataUpdate,
  sanitizeStreamTemplateCollection,
  sanitizeStreamTemplateDraft,
} from '../utils/streamMetadata';
import type { ChatLine } from './tuiChatLines';

const STREAM_TEMPLATE_SETTINGS_KEY = 'streamTemplates';

export function isYouTubeCategoryPreviousKey(sequence: string): boolean {
  return sequence === '\x1b[D' || sequence === '\x1bOD';
}

export function isYouTubeCategoryNextKey(sequence: string): boolean {
  return sequence === '\x1b[C' || sequence === '\x1bOC';
}

export type StreamModalState = {
  box: BoxRenderable;
  focusIndex: number;
  selectedPlatforms: Set<string>;
  op: 'start' | 'stop' | 'update';
};

type StreamModalProvider = {
  isAuthenticated(): boolean;
  searchCategories?(query: string): Promise<string[]>;
  searchPlaylists?(query: string): Promise<string[]>;
  clearPersistedMarkers?(selectionIds?: number[]): Promise<any>;
};

type StreamModalProviders = {
  youtube: StreamModalProvider & { searchPlaylists(query: string): Promise<string[]> };
  twitch: StreamModalProvider & { searchCategories(query: string): Promise<string[]> };
  kick: StreamModalProvider & { searchCategories(query: string): Promise<string[]> };
};

type StreamSettings = {
  get(key: string, fallback?: any): any;
  set(key: string, value: any): Promise<void>;
};

type StreamServiceLike = {
  setStreamMetadata(platforms: string[], metadata: Record<string, any>): Promise<any[]>;
};

type StreamModalUiNodes = {
  renderer: CliRenderer;
  inputEl: InputRenderable;
};

export type StreamModalContext = {
  uiNodes: StreamModalUiNodes | null;
  hasBlockingModal: () => boolean;
  getActiveStreamModal: () => StreamModalState | null;
  setActiveStreamModal: (modal: StreamModalState | null) => void;
  platforms: string[];
  providers: StreamModalProviders;
  settings: StreamSettings;
  streamService: StreamServiceLike;
  lastMessages: ChatLine[];
  updateUI: (messages: ChatLine[]) => void;
  createIndentedInputRow: (
    renderer: CliRenderer,
    input: InputRenderable,
    indent?: string,
  ) => BoxRenderable;
};

export function getDefaultStreamModalPlatforms(
  preselected: string[],
  platforms: string[],
  providers: StreamModalProviders,
): string[] {
  if (preselected.length > 0) return preselected;
  return platforms.filter((platform) => {
    const provider =
      platform === 'youtube'
        ? providers.youtube
        : platform === 'twitch'
          ? providers.twitch
          : platform === 'kick'
            ? providers.kick
            : null;
    return provider?.isAuthenticated() ?? false;
  });
}

export function openStreamModal(ctx: StreamModalContext, preselected: string[]): void {
  if (!ctx.uiNodes || ctx.getActiveStreamModal() || ctx.hasBlockingModal()) return;
  const { renderer } = ctx.uiNodes;
  const { platforms, settings, streamService, lastMessages, updateUI, createIndentedInputRow } =
    ctx;
  const { youtube, twitch, kick } = ctx.providers;

  const defaultSelectedPlatforms = getDefaultStreamModalPlatforms(preselected, platforms, {
    youtube,
    twitch,
    kick,
  });
  const selectedPlatforms = new Set(
    defaultSelectedPlatforms.length > 0 ? defaultSelectedPlatforms : [...platforms],
  );
  const savedStream = settings.get('stream', {});
  const savedTemplates = sanitizeStreamTemplateCollection(
    settings.get(STREAM_TEMPLATE_SETTINGS_KEY, null),
  );
  const templateItems = { ...savedTemplates.items };
  let templateNames = Object.keys(templateItems).sort((a, b) => a.localeCompare(b));
  let forceApplyAll = false;

  function makeLabel(text: string): TextRenderable {
    return new TextRenderable(renderer, { content: text, fg: 'gray' });
  }

  // ── Platform toggle row ──────────────────────────────────────────
  function platformToggleContent(focused: boolean): string {
    const indicator = focused ? '> ' : '  ';
    return (
      indicator +
      platforms.map((p) => (selectedPlatforms.has(p) ? `[x] ${p}` : `[ ] ${p}`)).join('   ')
    );
  }
  const platformToggleLabel = makeLabel(' Platforms ([Tab] to focus, 1/2/3 to toggle):');
  const platformToggleText = new TextRenderable(renderer, {
    content: platformToggleContent(true),
    fg: 'cyan',
  });

  // ── Title ────────────────────────────────────────────────────────
  const titleLabel = makeLabel(' Title (all platforms):');
  const titleInput = new InputRenderable(renderer, { placeholder: 'Stream title', width: '100%' });
  const titleInputRow = createIndentedInputRow(renderer, titleInput);
  titleInput.value = savedStream.title ?? '';

  // ── YouTube video category selector ─────────────────────────────
  const YT_CATS = YT_CATEGORY_NAMES as unknown as string[];
  let ytCatIdx = Math.max(0, YT_CATS.indexOf(savedStream.youtubeCategory ?? 'Gaming'));
  function ytCatContent(focused: boolean): string {
    return `${focused ? '▶ ' : '  '}[${YT_CATS[ytCatIdx]}]  ◄/► to change`;
  }
  const ytCatLabel = makeLabel(' Video Category (YouTube):');
  const ytCatText = new TextRenderable(renderer, { content: ytCatContent(false), fg: 'white' });

  // ── YouTube subject (for playlists / title suffix) ───────────────
  const subjectLabel = makeLabel(' Subject (YouTube — playlist & title suffix):');
  const subjectInput = new InputRenderable(renderer, {
    placeholder: 'Stream subject',
    width: '100%',
  });
  const subjectInputRow = createIndentedInputRow(renderer, subjectInput);
  subjectInput.value = savedStream.game ?? '';

  const subjectHint = new TextRenderable(renderer, { content: '', fg: 'gray' });
  subjectHint.visible = false;
  let subjectSuggestions: string[] = [];
  let subjectSelectedIdx = -1;
  let subjectFetchTimer: ReturnType<typeof setTimeout> | null = null;
  let isNavigatingSubject = false;

  // ── Twitch category ──────────────────────────────────────────────
  const twitchGameLabel = makeLabel(' Category (Twitch):');
  const twitchGameInput = new InputRenderable(renderer, {
    placeholder: 'Category name',
    width: '100%',
  });
  const twitchGameInputRow = createIndentedInputRow(renderer, twitchGameInput);
  twitchGameInput.value = savedStream.twitchGame ?? '';
  const twitchCatHint = new TextRenderable(renderer, { content: '', fg: 'gray' });
  twitchCatHint.visible = false;
  let catSuggestions: string[] = [];
  let catSelectedIdx = -1;
  let catFetchTimer: ReturnType<typeof setTimeout> | null = null;
  let isNavigatingTwitch = false;

  // ── Kick category ────────────────────────────────────────────────
  const kickCatLabel = makeLabel(' Category (Kick):');
  const kickCatInput = new InputRenderable(renderer, {
    placeholder: 'Category name',
    width: '100%',
  });
  const kickCatInputRow = createIndentedInputRow(renderer, kickCatInput);
  kickCatInput.value = savedStream.kickCategory ?? '';
  const kickCatHint = new TextRenderable(renderer, { content: '', fg: 'gray' });
  kickCatHint.visible = false;
  let kickCatSuggestions: string[] = [];
  let kickCatSelectedIdx = -1;
  let isNavigatingKick = false;
  let kickCatFetchTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Tags ─────────────────────────────────────────────────────────
  const tagsLabel = makeLabel(' Tags — comma-separated (no spaces, Twitch max 25 chars each):');
  const tagsInput = new InputRenderable(renderer, {
    placeholder: 'gaming, fps, variety',
    width: '100%',
  });
  const tagsInputRow = createIndentedInputRow(renderer, tagsInput);
  tagsInput.value = Array.isArray(savedStream.tags)
    ? savedStream.tags.join(', ')
    : (savedStream.tags ?? '');

  // ── YouTube description ──────────────────────────────────────────
  const descLabel = makeLabel(' Description (YouTube):');
  const descInput = new InputRenderable(renderer, {
    placeholder: 'Stream description',
    width: '100%',
  });
  const descInputRow = createIndentedInputRow(renderer, descInput);
  descInput.value = savedStream.description ?? '';

  // ── Twitch notification ──────────────────────────────────────────
  const notifLabel = makeLabel(' Notification (Twitch):');
  const notifInput = new InputRenderable(renderer, {
    placeholder: 'Going live notification message',
    width: '100%',
  });
  const notifInputRow = createIndentedInputRow(renderer, notifInput);
  notifInput.value = savedStream.notification ?? '';

  const templateNameLabel = makeLabel(' Template name:');
  const templateNameInput = new InputRenderable(renderer, {
    placeholder: 'focus, chill, launch...',
    width: '100%',
  });
  const templateNameInputRow = createIndentedInputRow(renderer, templateNameInput);
  templateNameInput.value = savedTemplates.activeName || templateNames[0] || '';
  const templateHint = new TextRenderable(renderer, { content: '', fg: 'gray' });
  templateHint.visible = false;
  let templateSuggestions: string[] = [];
  let templateSelectedIdx = -1;
  let isNavigatingTemplate = false;

  const applyModeText = new TextRenderable(renderer, {
    content: '',
    fg: 'gray',
  });
  const templateText = new TextRenderable(renderer, {
    content: '',
    fg: 'gray',
  });
  const modalStatus = new TextRenderable(renderer, {
    content: '',
    fg: 'gray',
  });
  modalStatus.visible = false;

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] next field  [Enter] confirm  [Esc] cancel',
    fg: 'gray',
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '5%',
    left: '5%',
    width: '90%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' Stream Info ',
  });

  box.add(platformToggleLabel);
  box.add(platformToggleText);
  box.add(titleLabel);
  box.add(titleInputRow);
  box.add(ytCatLabel);
  box.add(ytCatText);
  box.add(subjectLabel);
  box.add(subjectInputRow);
  box.add(subjectHint);
  box.add(twitchGameLabel);
  box.add(twitchGameInputRow);
  box.add(twitchCatHint);
  box.add(kickCatLabel);
  box.add(kickCatInputRow);
  box.add(kickCatHint);
  box.add(tagsLabel);
  box.add(tagsInputRow);
  box.add(descLabel);
  box.add(descInputRow);
  box.add(notifLabel);
  box.add(notifInputRow);
  box.add(templateNameLabel);
  box.add(templateNameInputRow);
  box.add(templateHint);
  box.add(applyModeText);
  box.add(templateText);
  box.add(modalStatus);
  box.add(hint);
  renderer.root.add(box);

  // ── Focus management ─────────────────────────────────────────────
  // FocusItem discriminated union: platforms row, YouTube category selector, or an InputRenderable.
  type StreamFocusItem =
    | { kind: 'platforms' }
    | { kind: 'yt-category' }
    | { kind: 'input'; node: InputRenderable };

  let visibleItems: StreamFocusItem[] = [];
  let focusIdx = 0;

  const modal: StreamModalState = { box, focusIndex: 0, selectedPlatforms, op: 'update' };
  ctx.setActiveStreamModal(modal);

  function blurCurrent(): void {
    const item = visibleItems[focusIdx];
    if (!item) return;
    if (item.kind === 'platforms') {
      platformToggleText.content = platformToggleContent(false);
      platformToggleText.fg = 'white';
    } else if (item.kind === 'yt-category') {
      ytCatText.content = ytCatContent(false);
      ytCatText.fg = 'white';
    } else {
      item.node.blur();
    }
  }

  function focusCurrent(): void {
    const item = visibleItems[focusIdx];
    if (!item) return;
    if (item.kind === 'platforms') {
      platformToggleText.content = platformToggleContent(true);
      platformToggleText.fg = 'cyan';
    } else if (item.kind === 'yt-category') {
      ytCatText.content = ytCatContent(true);
      ytCatText.fg = 'cyan';
    } else {
      item.node.focus();
    }
    updateHint();
  }

  function setModalStatus(content: string, fgColor: string = 'gray'): void {
    modalStatus.content = content ? ` ${content}` : '';
    modalStatus.fg = fgColor;
    modalStatus.visible = content.length > 0;
  }

  function updateApplyModeText(): void {
    applyModeText.content = forceApplyAll
      ? ' Apply mode: force apply all visible fields [Ctrl+F]'
      : ' Apply mode: changed fields only [Ctrl+F]';
    applyModeText.fg = forceApplyAll ? 'yellow' : 'gray';
  }

  function persistTemplateState(): Promise<void> {
    return settings.set(STREAM_TEMPLATE_SETTINGS_KEY, {
      activeName: templateNameInput.value.trim(),
      items: templateItems,
    });
  }

  function refreshTemplateSuggestions(): void {
    const query = templateNameInput.value.trim().toLowerCase();
    templateSuggestions = templateNames.filter((name) =>
      query.length === 0 ? true : name.toLowerCase().includes(query),
    );
    templateSelectedIdx = -1;
    templateHint.content =
      templateSuggestions.length > 0
        ? `  ${templateSuggestions.join('  ·  ')}  [↑/↓ to select]`
        : templateNames.length > 0
          ? '  No matching template names.'
          : '  No saved templates yet.';
    templateHint.visible = true;
  }

  function updateTemplateText(): void {
    const activeLabel = templateNameInput.value.trim() || '(unnamed)';
    templateText.content = ` Templates: ${templateNames.length} saved  active: ${activeLabel}  [F5] save current  [F8] restore current name  [F10] delete current name`;
    templateText.fg = templateNames.length > 0 ? 'green' : 'gray';
  }

  function readModalDraft(): ReturnType<typeof buildStreamTemplateDraft> {
    const rawTags = tagsInput.value
      .split(',')
      .map((tag) => tag.trim().replace(/\s+/g, ''))
      .filter(Boolean);
    return buildStreamTemplateDraft(
      {
        title: titleInput.value.trim() || undefined,
        game: subjectInput.value.trim() || undefined,
        youtubeCategory: YT_CATS[ytCatIdx],
        twitchGame: twitchGameInput.value.trim() || undefined,
        kickCategory: kickCatInput.value.trim() || undefined,
        tags: rawTags.length > 0 ? rawTags : undefined,
        description: descInput.value.trim() || undefined,
        notification: notifInput.value.trim() || undefined,
      },
      selectedPlatforms,
    );
  }

  function applyTemplateDraft(
    template: NonNullable<ReturnType<typeof sanitizeStreamTemplateDraft>>,
  ): void {
    titleInput.value = template.title ?? '';
    subjectInput.value = template.game ?? '';
    ytCatIdx = Math.max(0, YT_CATS.indexOf(template.youtubeCategory ?? 'Gaming'));
    ytCatText.content = ytCatContent(visibleItems[focusIdx]?.kind === 'yt-category');
    twitchGameInput.value = template.twitchGame ?? '';
    kickCatInput.value = template.kickCategory ?? '';
    tagsInput.value = Array.isArray(template.tags) ? template.tags.join(', ') : '';
    descInput.value = template.description ?? '';
    notifInput.value = template.notification ?? '';

    if (Array.isArray(template.selectedPlatforms)) {
      selectedPlatforms.clear();
      for (const platform of template.selectedPlatforms) {
        selectedPlatforms.add(platform);
      }
    }

    scheduleSubjectSearch(subjectInput.value.trim(), 0);
    scheduleTwitchSearch(twitchGameInput.value.trim(), 0);
    scheduleKickSearch(kickCatInput.value.trim(), 0);
    updateConditionalVisibility();
    refreshTemplateSuggestions();
  }

  function updateHint(): void {
    const item = visibleItems[focusIdx];
    const parts = ['[Tab] next field'];
    if (item?.kind === 'yt-category') parts.push('[◄/►] change YT category');
    if (item?.kind === 'input' && item.node === subjectInput) {
      const hasTwitch = selectedPlatforms.has('twitch');
      const hasKick = selectedPlatforms.has('kick');
      if (hasTwitch && hasKick) parts.push('[Ctrl+→] cascade to Twitch/Kick');
      else if (hasTwitch) parts.push('[Ctrl+→] cascade to Twitch');
      else if (hasKick) parts.push('[Ctrl+→] cascade to Kick');
    }
    if (item?.kind === 'input' && item.node === twitchGameInput && selectedPlatforms.has('kick'))
      parts.push('[Ctrl+→] cascade to Kick');
    parts.push(`[Ctrl+F] ${forceApplyAll ? 'force apply: on' : 'force apply: off'}`);
    parts.push('[F5] save template', '[F8] restore template', '[F10] delete template');
    parts.push('[Enter] confirm', '[Esc] cancel');
    hint.content = ` ${parts.join('  ')}`;
  }

  function updateConditionalVisibility(): void {
    const hasYT = selectedPlatforms.has('youtube');
    const hasTwitch = selectedPlatforms.has('twitch');
    const hasKick = selectedPlatforms.has('kick');

    ytCatLabel.visible = hasYT;
    ytCatText.visible = hasYT;
    subjectLabel.visible = hasYT;
    subjectInputRow.visible = hasYT;
    subjectHint.visible = hasYT && String(subjectHint.content) !== '';
    twitchGameLabel.visible = hasTwitch;
    twitchGameInputRow.visible = hasTwitch;
    twitchCatHint.visible = hasTwitch && catSuggestions.length > 0;
    kickCatLabel.visible = hasKick;
    kickCatInputRow.visible = hasKick;
    kickCatHint.visible = hasKick && kickCatSuggestions.length > 0;
    descLabel.visible = hasYT;
    descInputRow.visible = hasYT;
    notifLabel.visible = hasTwitch;
    notifInputRow.visible = hasTwitch;
    templateNameLabel.visible = true;
    templateNameInputRow.visible = true;
    templateHint.visible = true;

    const items: StreamFocusItem[] = [{ kind: 'platforms' }, { kind: 'input', node: titleInput }];
    if (hasYT) items.push({ kind: 'yt-category' });
    if (hasYT) items.push({ kind: 'input', node: subjectInput });
    if (hasTwitch) items.push({ kind: 'input', node: twitchGameInput });
    if (hasKick) items.push({ kind: 'input', node: kickCatInput });
    items.push({ kind: 'input', node: tagsInput });
    if (hasYT) items.push({ kind: 'input', node: descInput });
    if (hasTwitch) items.push({ kind: 'input', node: notifInput });
    items.push({ kind: 'input', node: templateNameInput });
    visibleItems = items;
    if (focusIdx >= visibleItems.length) focusIdx = 0;
    modal.focusIndex = focusIdx;
    updateHint();
  }

  function togglePlatform(idx: number): void {
    const p = platforms[idx];
    if (!p) return;
    blurCurrent();
    if (selectedPlatforms.has(p)) selectedPlatforms.delete(p);
    else selectedPlatforms.add(p);
    updateConditionalVisibility();
    focusCurrent();
  }

  updateApplyModeText();
  updateTemplateText();
  refreshTemplateSuggestions();
  updateConditionalVisibility();
  focusCurrent();

  async function closeModal(confirm: boolean): Promise<void> {
    if (!ctx.getActiveStreamModal()) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveStreamModal(null);
    if (subjectFetchTimer) {
      clearTimeout(subjectFetchTimer);
      subjectFetchTimer = null;
    }
    if (catFetchTimer) {
      clearTimeout(catFetchTimer);
      catFetchTimer = null;
    }
    if (kickCatFetchTimer) {
      clearTimeout(kickCatFetchTimer);
      kickCatFetchTimer = null;
    }
    ctx.uiNodes?.inputEl.focus();

    if (!confirm) {
      return;
    }

    const targetPlatforms = [...selectedPlatforms];
    if (targetPlatforms.length === 0) {
      lastMessages.push('[stream] No platforms selected.');
      updateUI(lastMessages);
      return;
    }

    const draft = readModalDraft();

    const newMeta: Record<string, any> = {
      title: draft.title,
      game: selectedPlatforms.has('youtube') ? draft.game : undefined,
      youtubeCategory: selectedPlatforms.has('youtube') ? draft.youtubeCategory : undefined,
      twitchGame: selectedPlatforms.has('twitch') ? draft.twitchGame : undefined,
      kickCategory: selectedPlatforms.has('kick') ? draft.kickCategory : undefined,
      tags: draft.tags,
      description: selectedPlatforms.has('youtube') ? draft.description : undefined,
      notification: selectedPlatforms.has('twitch') ? draft.notification : undefined,
    };

    const { changed, merged } = buildTargetedStreamMetadataUpdate(
      savedStream,
      selectedPlatforms,
      newMeta,
      { force: forceApplyAll },
    );

    if (Object.keys(changed).length === 0) {
      lastMessages.push('[stream] No changes.');
      updateUI(lastMessages);
      return;
    }

    lastMessages.push(
      `[stream] ${forceApplyAll ? 'Force applying' : 'Updating'} on: ${targetPlatforms.join(', ')}…`,
    );
    updateUI(lastMessages);
    try {
      await settings.set('stream', merged);
      let platformResults: {
        platform: string;
        skipped?: string[];
        skippedTags?: string[];
        appliedTags?: string[];
        warnings?: { code: string; message: string; details?: Record<string, unknown> }[];
        references?: Record<string, unknown>;
        error?: string;
      }[] = [];
      try {
        platformResults = await streamService.setStreamMetadata(targetPlatforms, merged);
      } catch (err: any) {
        platformResults = err.platformResults ?? [];
      }
      for (const r of platformResults) {
        if (r.error) {
          lastMessages.push({ content: `[stream] ${r.platform}: ✗ ${r.error}`, fg: 'red' });
        } else {
          const okFields = Object.keys(changed)
            .filter((k) => k !== 'tags' || (!r.skippedTags?.length && !r.appliedTags?.length))
            .filter((k) => !r.skipped?.includes(k))
            .join(', ');
          const appliedTagStr = r.appliedTags?.length ? `  tags: ${r.appliedTags.join(', ')}` : '';
          const hasRejected = (r.skippedTags?.length ?? 0) > 0;
          lastMessages.push({
            content: `[stream] ${r.platform}: ✓${okFields ? ` ${okFields}` : ''}${appliedTagStr}`,
            fg: hasRejected ? 'yellow' : 'green',
          });
          if (hasRejected) {
            lastMessages.push({
              content: `[stream] ${r.platform}:   ✗ tags rejected: ${r.skippedTags!.join(', ')}`,
              fg: 'red',
            });
          }
          for (const warning of r.warnings ?? []) {
            lastMessages.push({
              content: `[stream] ${r.platform}:   ! ${warning.message}`,
              fg: 'yellow',
            });
            const refs = warning.details?.references as
              | {
                  active?: Array<{ id: string; title: string; lifeCycleStatus: string }>;
                  scheduled?: Array<{ id: string; title: string; lifeCycleStatus: string }>;
                  all?: Array<{ id: string; title: string; lifeCycleStatus: string }>;
                }
              | undefined;
            if (refs) {
              const groups: Array<['active' | 'scheduled' | 'all', typeof refs.all]> = [
                ['active', refs.active],
                ['scheduled', refs.scheduled],
                ['all', refs.all],
              ];
              for (const [group, entries] of groups) {
                const preview = (entries ?? [])
                  .slice(0, 3)
                  .map((entry) => `${entry.id} (${entry.lifeCycleStatus}) ${entry.title}`)
                  .join(' | ');
                lastMessages.push({
                  content: `[stream] ${r.platform}:   ${group}: ${preview || '(none)'}`,
                  fg: 'gray',
                });
              }
            }
          }
        }
      }
    } catch (err) {
      lastMessages.push({ content: `[stream] Error: ${String(err)}`, fg: 'red' });
    }
    updateUI(lastMessages);
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveStreamModal()) return false;
    const current = visibleItems[focusIdx];

    // Platform digit toggles — only when platform row is focused
    if (current?.kind === 'platforms') {
      if (sequence === '1') {
        togglePlatform(0);
        return true;
      }
      if (sequence === '2') {
        togglePlatform(1);
        return true;
      }
      if (sequence === '3') {
        togglePlatform(2);
        return true;
      }
    }

    // YouTube category left/right navigation
    if (current?.kind === 'yt-category') {
      if (isYouTubeCategoryPreviousKey(sequence)) {
        ytCatIdx = (ytCatIdx - 1 + YT_CATS.length) % YT_CATS.length;
        ytCatText.content = ytCatContent(true);
        return true;
      }
      if (isYouTubeCategoryNextKey(sequence)) {
        ytCatIdx = (ytCatIdx + 1) % YT_CATS.length;
        ytCatText.content = ytCatContent(true);
        return true;
      }
    }

    if (sequence === '\t' || sequence === '\x1b[Z') {
      const forward = sequence === '\t';
      blurCurrent();
      focusIdx = forward
        ? (focusIdx + 1) % visibleItems.length
        : (focusIdx - 1 + visibleItems.length) % visibleItems.length;
      modal.focusIndex = focusIdx;
      focusCurrent();
      return true;
    }

    if (sequence === '\x06') {
      forceApplyAll = !forceApplyAll;
      updateApplyModeText();
      updateHint();
      setModalStatus(
        forceApplyAll ? 'Force apply all enabled.' : 'Force apply all disabled.',
        forceApplyAll ? 'yellow' : 'gray',
      );
      return true;
    }

    if (sequence === '\x1b[15~') {
      const nextName = templateNameInput.value.trim();
      if (!nextName) {
        setModalStatus('Template name required before saving.', 'yellow');
        return true;
      }
      templateNameInput.value = nextName;
      templateItems[nextName] = readModalDraft();
      templateNames = Object.keys(templateItems).sort((a, b) => a.localeCompare(b));
      void persistTemplateState();
      updateTemplateText();
      refreshTemplateSuggestions();
      setModalStatus(`Saved template "${nextName}".`, 'green');
      return true;
    }

    if (sequence === '\x1b[19~') {
      const nextName = templateNameInput.value.trim();
      if (!nextName) {
        setModalStatus('Template name required before restoring.', 'yellow');
        return true;
      }
      templateNameInput.value = nextName;
      const savedTemplate = sanitizeStreamTemplateDraft(templateItems[nextName]);
      if (!savedTemplate) {
        setModalStatus(`No saved template named "${nextName}".`, 'yellow');
        return true;
      }
      blurCurrent();
      applyTemplateDraft(savedTemplate);
      focusCurrent();
      void persistTemplateState();
      setModalStatus(`Restored template "${nextName}".`, 'green');
      return true;
    }

    if (sequence === '\x1b[21~') {
      const nextName = templateNameInput.value.trim();
      if (!nextName) {
        setModalStatus('Template name required before deleting.', 'yellow');
        return true;
      }
      if (!(nextName in templateItems)) {
        setModalStatus(`No saved template named "${nextName}".`, 'yellow');
        return true;
      }
      delete templateItems[nextName];
      templateNames = Object.keys(templateItems).sort((a, b) => a.localeCompare(b));
      templateNameInput.value = templateNames[0] ?? '';
      void persistTemplateState();
      updateTemplateText();
      refreshTemplateSuggestions();
      setModalStatus(`Deleted template "${nextName}".`, 'yellow');
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
    if (sequence === '\x1b[A' || sequence === '\x1b[B') {
      if (
        current?.kind === 'input' &&
        current.node === templateNameInput &&
        templateSuggestions.length > 0
      ) {
        templateSelectedIdx =
          sequence === '\x1b[B'
            ? (templateSelectedIdx + 1) % templateSuggestions.length
            : (templateSelectedIdx - 1 + templateSuggestions.length) % templateSuggestions.length;
        isNavigatingTemplate = true;
        templateNameInput.value = templateSuggestions[templateSelectedIdx] ?? '';
        return true;
      }
      if (
        current?.kind === 'input' &&
        current.node === subjectInput &&
        subjectSuggestions.length > 0
      ) {
        subjectSelectedIdx =
          sequence === '\x1b[B'
            ? (subjectSelectedIdx + 1) % subjectSuggestions.length
            : (subjectSelectedIdx - 1 + subjectSuggestions.length) % subjectSuggestions.length;
        isNavigatingSubject = true;
        subjectInput.value = subjectSuggestions[subjectSelectedIdx] ?? '';
      }
      if (
        current?.kind === 'input' &&
        current.node === twitchGameInput &&
        catSuggestions.length > 0
      ) {
        catSelectedIdx =
          sequence === '\x1b[B'
            ? (catSelectedIdx + 1) % catSuggestions.length
            : (catSelectedIdx - 1 + catSuggestions.length) % catSuggestions.length;
        isNavigatingTwitch = true;
        twitchGameInput.value = catSuggestions[catSelectedIdx] ?? '';
      }
      if (
        current?.kind === 'input' &&
        current.node === kickCatInput &&
        kickCatSuggestions.length > 0
      ) {
        kickCatSelectedIdx =
          sequence === '\x1b[B'
            ? (kickCatSelectedIdx + 1) % kickCatSuggestions.length
            : (kickCatSelectedIdx - 1 + kickCatSuggestions.length) % kickCatSuggestions.length;
        isNavigatingKick = true;
        kickCatInput.value = kickCatSuggestions[kickCatSelectedIdx] ?? '';
      }
      return true;
    }
    // Ctrl+→: cascade current field value down the platform chain
    if (sequence === '\x1b[1;5C') {
      if (current?.kind === 'input' && current.node === subjectInput) {
        const val = subjectInput.value.trim();
        if (val && selectedPlatforms.has('twitch')) {
          twitchGameInput.value = val;
          scheduleTwitchSearch(val, 0);
        }
        if (val && selectedPlatforms.has('kick')) {
          kickCatInput.value = val;
          scheduleKickSearch(val, 0);
        }
        return true;
      }
      if (current?.kind === 'input' && current.node === twitchGameInput) {
        const val = twitchGameInput.value.trim();
        if (val && selectedPlatforms.has('kick')) {
          kickCatInput.value = val;
          scheduleKickSearch(val, 0);
        }
        return true;
      }
      return false;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && ctx.getActiveStreamModal()) closeModal(false);
  };
  for (const input of [
    titleInput,
    subjectInput,
    twitchGameInput,
    kickCatInput,
    tagsInput,
    descInput,
    notifInput,
    templateNameInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }

  function scheduleSubjectSearch(q: string, delayMs = 300): void {
    subjectSuggestions = [];
    subjectSelectedIdx = -1;
    if (subjectFetchTimer) {
      clearTimeout(subjectFetchTimer);
      subjectFetchTimer = null;
    }
    if (q.length < 2) {
      subjectHint.content = '';
      subjectHint.visible = false;
      return;
    }
    subjectFetchTimer = setTimeout(async () => {
      const results = await youtube.searchPlaylists(q);
      subjectSuggestions = results;
      const exactMatch = results.some((r) => r.toLowerCase() === q.toLowerCase());
      const items = exactMatch ? results : [...results, '(new)'];
      subjectHint.content = items.length > 0 ? `  ${items.join('  ·  ')}  [↑/↓ to select]` : '';
      subjectHint.visible = selectedPlatforms.has('youtube') && items.length > 0;
    }, delayMs);
  }

  function scheduleTwitchSearch(q: string, delayMs = 300): void {
    catSuggestions = [];
    catSelectedIdx = -1;
    if (catFetchTimer) {
      clearTimeout(catFetchTimer);
      catFetchTimer = null;
    }
    if (q.length < 2) {
      twitchCatHint.content = '';
      twitchCatHint.visible = false;
      return;
    }
    catFetchTimer = setTimeout(async () => {
      const results = await twitch.searchCategories(q);
      catSuggestions = results;
      twitchCatHint.content =
        catSuggestions.length > 0 ? `  ${catSuggestions.join('  ·  ')}  [↑/↓ to select]` : '';
      twitchCatHint.visible = catSuggestions.length > 0 && selectedPlatforms.has('twitch');
    }, delayMs);
  }

  function scheduleKickSearch(q: string, delayMs = 300): void {
    kickCatSuggestions = [];
    kickCatSelectedIdx = -1;
    if (kickCatFetchTimer) {
      clearTimeout(kickCatFetchTimer);
      kickCatFetchTimer = null;
    }
    if (q.length < 2) {
      kickCatHint.content = '';
      kickCatHint.visible = false;
      return;
    }
    kickCatFetchTimer = setTimeout(async () => {
      const results = await kick.searchCategories(q);
      kickCatSuggestions = results;
      kickCatHint.content =
        kickCatSuggestions.length > 0
          ? `  ${kickCatSuggestions.join('  ·  ')}  [↑/↓ to select]`
          : '';
      kickCatHint.visible = kickCatSuggestions.length > 0 && selectedPlatforms.has('kick');
    }, delayMs);
  }

  subjectInput.on(InputRenderableEvents.INPUT, () => {
    if (isNavigatingSubject) {
      isNavigatingSubject = false;
      return;
    }
    scheduleSubjectSearch(subjectInput.value.trim());
  });

  twitchGameInput.on(InputRenderableEvents.INPUT, () => {
    if (isNavigatingTwitch) {
      isNavigatingTwitch = false;
      return;
    }
    scheduleTwitchSearch(twitchGameInput.value.trim());
  });

  kickCatInput.on(InputRenderableEvents.INPUT, () => {
    if (isNavigatingKick) {
      isNavigatingKick = false;
      return;
    }
    scheduleKickSearch(kickCatInput.value.trim());
  });

  templateNameInput.on(InputRenderableEvents.INPUT, () => {
    if (isNavigatingTemplate) {
      isNavigatingTemplate = false;
      updateTemplateText();
      return;
    }
    updateTemplateText();
    refreshTemplateSuggestions();
  });
}
