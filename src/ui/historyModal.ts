import {
  BoxRenderable,
  type CliRenderer,
  fg,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
} from '@opentui/core';
import type { ChatMessage } from '../platforms/base';
import type { StreamSummary } from '../services/message-log';
import type { SharedTwitchEmoteDefinition } from '../utils/ffz-fetch';
import { buildTuiFfzMessageParts } from '../utils/tuiFfz';

export type HistoryModalState = { box: BoxRenderable };

export type HistoryMessageLog = {
  getStreams(): StreamSummary[];
  getForStream(streamId: string, limit: number, offset: number): ChatMessage[];
  searchMessages(query: string, options: { limit: number }): ChatMessage[];
};

export type HistoryModalContext = {
  uiNodes: { renderer: CliRenderer } | null;
  hasBlockingModal: () => boolean;
  getActiveHistoryModal: () => HistoryModalState | null;
  setActiveHistoryModal: (modal: HistoryModalState | null) => void;
  focusMainInput: () => void;
  messageLog: HistoryMessageLog;
  tuiFfzEmotes: Record<string, SharedTwitchEmoteDefinition>;
  tuiFfzImageIdsByName: Record<string, number>;
  getTuiEmoteColumns: () => number;
};

export function historyPlatformColor(platform: string): string {
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'youtube') return '#FF0000';
  if (platform === 'kick') return '#53FC18';
  return 'white';
}

export function formatHistoryTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}:${String(d.getSeconds()).padStart(2, '0')}  `;
}

export function formatHistoryDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}`;
}

export function formatHistoryStreamRowLabel(stream: StreamSummary, selected: boolean): string {
  const cursor = selected ? '▶' : ' ';
  const idStr =
    stream.streamId.length > 20 ? `${stream.streamId.slice(0, 17)}...` : stream.streamId.padEnd(20);
  const platStr = stream.platforms.join(',').padEnd(14);
  return `  ${cursor}  ${idStr}  ${platStr}  ${String(stream.messageCount).padStart(6)} msgs  ${String(stream.userCount).padStart(4)} users  ${formatHistoryDate(stream.startTime)}`;
}

export function openHistoryModal(ctx: HistoryModalContext, opts?: { query?: string }): void {
  if (!ctx.uiNodes || ctx.hasBlockingModal()) return;
  const { renderer } = ctx.uiNodes;

  type HistoryTab = 'broadcasts' | 'search';
  type BcastView = 'list' | 'messages';

  let activeTab: HistoryTab = opts?.query != null ? 'search' : 'broadcasts';
  let bcastView: BcastView = 'list';

  let streams: StreamSummary[] = [];
  let selectedIdx = 0;
  let streamListNodes: TextRenderable[] = [];

  const STREAM_PAGE = 100;
  let viewStream: StreamSummary | null = null;
  let streamMessages: ChatMessage[] = [];
  let streamPage = 0;
  let streamExhausted = false;
  let streamLoading = false;

  // ── Layout ─────────────────────────────────────────────────────────────────

  const contentScroll = new ScrollBoxRenderable(renderer, {
    stickyScroll: false,
    stickyStart: 'top',
    flexGrow: 1,
    minHeight: 5,
    viewportCulling: true,
  });

  const searchInput = new InputRenderable(renderer, {
    placeholder: 'message / user / stream-id ...',
    flexGrow: 1,
  });

  const searchRow = new BoxRenderable(renderer, { flexDirection: 'row' });
  searchRow.add(new TextRenderable(renderer, { content: '  Search: ', fg: '#888888' }));
  searchRow.add(searchInput);

  const headerText = new TextRenderable(renderer, {
    content: ' ',
    fg: '#888888',
    wrapMode: 'none',
  });
  const tabBarNode = new TextRenderable(renderer, { content: '' });
  const footerText = new TextRenderable(renderer, { content: '', fg: '#888888' });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '5%',
    left: '8%',
    width: '84%',
    height: '85%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: '#4a9eff',
    backgroundColor: '#1a1a1a',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' History ',
  });

  box.add(headerText);
  box.add(tabBarNode);
  box.add(searchRow);
  box.add(contentScroll);
  box.add(footerText);
  renderer.root.add(box);
  ctx.setActiveHistoryModal({ box });

  // ── Helpers ────────────────────────────────────────────────────────────────

  function clearScroll(): void {
    for (const child of contentScroll.getChildren()) contentScroll.remove(child.id);
  }

  function renderTabBar(): void {
    const bColor = activeTab === 'broadcasts' ? 'cyan' : '#555555';
    const sColor = activeTab === 'search' ? 'cyan' : '#555555';
    tabBarNode.content = new StyledText([
      fg(bColor)(`  [B] Broadcasts (${streams.length})  `),
      fg(sColor)(`[/] Search`),
    ]);
  }

  function streamRowLabel(i: number, selected: boolean): string {
    return formatHistoryStreamRowLabel(streams[i]!, selected);
  }

  function renderStreamList(): void {
    clearScroll();
    headerText.content = ' ';

    if (streams.length === 0) {
      contentScroll.add(
        new TextRenderable(renderer, {
          content: '  (no streams — messages need stream IDs to appear here)',
          fg: '#888888',
        }),
      );
      streamListNodes = [];
      return;
    }

    contentScroll.add(
      new TextRenderable(renderer, {
        content: '     Stream ID                Platform(s)       Messages    Users   Started',
        fg: '#555555',
      }),
    );

    streamListNodes = [];
    for (let i = 0; i < streams.length; i++) {
      const node = new TextRenderable(renderer, {
        content: streamRowLabel(i, i === selectedIdx),
        fg: i === selectedIdx ? 'cyan' : 'white',
      });
      streamListNodes.push(node);
      contentScroll.add(node);
    }
    footerText.content = '  [↑/↓] navigate  [Enter] view stream  [/] search  [Esc] close';
  }

  function moveCursor(oldIdx: number, newIdx: number): void {
    if (streamListNodes[oldIdx]) {
      streamListNodes[oldIdx].content = streamRowLabel(oldIdx, false);
      (streamListNodes[oldIdx] as any).fg = 'white';
    }
    if (streamListNodes[newIdx]) {
      streamListNodes[newIdx].content = streamRowLabel(newIdx, true);
      (streamListNodes[newIdx] as any).fg = 'cyan';
    }
    contentScroll.scrollTo(newIdx + 1); // +1 for header row
  }

  function openStream(stream: StreamSummary): void {
    bcastView = 'messages';
    viewStream = stream;
    streamMessages = [];
    streamPage = 0;
    streamExhausted = false;

    clearScroll();
    footerText.content = '  [↑] load older  [↓] scroll  [Backspace] back to list  [Esc] close';

    const idDisplay =
      stream.streamId.length > 26 ? `${stream.streamId.slice(0, 23)}...` : stream.streamId;
    headerText.content = new StyledText([
      fg('#888888')('  Stream '),
      fg('cyan')(idDisplay),
      fg('#888888')(
        ` · ${stream.platforms.join(',')} · ${stream.messageCount.toLocaleString()} msgs · ${stream.userCount} users · ${formatHistoryDate(stream.startTime)}`,
      ),
    ]);

    _loadStreamPage();
    setTimeout(() => {
      contentScroll.scrollTo(99999);
    }, 32);
  }

  function _loadStreamPage(): void {
    if (streamLoading || streamExhausted || !viewStream) return;
    streamLoading = true;
    try {
      const batch = ctx.messageLog.getForStream(
        viewStream.streamId,
        STREAM_PAGE,
        streamPage * STREAM_PAGE,
      );
      if (batch.length === 0) {
        streamExhausted = true;
        contentScroll.add(
          new TextRenderable(renderer, { content: '  ── beginning of stream ──', fg: '#555555' }),
          0,
        );
        return;
      }

      const chrono = batch.slice().reverse();
      streamPage++;
      if (batch.length < STREAM_PAGE) streamExhausted = true;

      let idx = 0;
      for (const m of chrono) {
        const row = new BoxRenderable(renderer, { flexDirection: 'row' });
        row.add(
          new TextRenderable(renderer, {
            content: formatHistoryTimestamp(m.timestamp),
            fg: '#888888',
          }),
        );
        row.add(
          new TextRenderable(renderer, {
            content: `[${m.platform}] `,
            fg: historyPlatformColor(m.platform),
          }),
        );
        row.add(
          new TextRenderable(renderer, {
            content: `${m.username}: `,
            fg: m.color ?? historyPlatformColor(m.platform),
          }),
        );
        for (const part of buildTuiFfzMessageParts(
          m.platform,
          m.message,
          'white',
          ctx.tuiFfzEmotes,
          ctx.tuiFfzImageIdsByName,
          ctx.getTuiEmoteColumns(),
        )) {
          row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
        }
        contentScroll.add(row, idx++);
      }

      if (streamExhausted) {
        contentScroll.add(
          new TextRenderable(renderer, { content: '  ── beginning of stream ──', fg: '#555555' }),
          0,
        );
      }

      streamMessages = [...chrono, ...streamMessages];
    } finally {
      streamLoading = false;
    }
  }

  function runSearch(query: string): void {
    clearScroll();
    const q = query.trim();
    if (!q) {
      contentScroll.add(
        new TextRenderable(renderer, {
          content: '  Type to search messages, users, or stream IDs...',
          fg: '#555555',
        }),
      );
      return;
    }

    const results = ctx.messageLog.searchMessages(q, { limit: 200 });
    const countLabel =
      results.length >= 200
        ? '200+ results (first 200 shown):'
        : `${results.length} result${results.length !== 1 ? 's' : ''}:`;
    contentScroll.add(new TextRenderable(renderer, { content: `  ${countLabel}`, fg: '#888888' }));

    for (const m of results) {
      const streamLabel = m.streamId ? ` [${m.streamId.slice(0, 8)}]` : '';
      const row = new BoxRenderable(renderer, { flexDirection: 'row' });
      row.add(
        new TextRenderable(renderer, {
          content: formatHistoryTimestamp(m.timestamp),
          fg: '#888888',
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          content: `[${m.platform}${streamLabel}] `,
          fg: historyPlatformColor(m.platform),
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          content: `${m.username}: `,
          fg: m.color ?? historyPlatformColor(m.platform),
        }),
      );
      for (const part of buildTuiFfzMessageParts(
        m.platform,
        m.message,
        'white',
        ctx.tuiFfzEmotes,
        ctx.tuiFfzImageIdsByName,
        ctx.getTuiEmoteColumns(),
      )) {
        row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
      }
      contentScroll.add(row);
    }

    setTimeout(() => {
      contentScroll.scrollTo(0);
    }, 16);
  }

  function switchToTab(tab: HistoryTab): void {
    if (activeTab === tab) return;
    activeTab = tab;
    renderTabBar();

    if (tab === 'broadcasts') {
      (searchRow as any).visible = false;
      bcastView = 'list';
      headerText.content = ' ';
      renderStreamList();
    } else {
      (searchRow as any).visible = true;
      headerText.content = ' ';
      footerText.content = '  [↑/↓] scroll results  [B] broadcasts  [Esc] close';
      runSearch(searchInput.value);
      setTimeout(() => {
        searchInput.focus();
      }, 0);
    }
  }

  function closeHistoryModal(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    ctx.setActiveHistoryModal(null);
    ctx.focusMainInput();
  }

  // ── Key handler ────────────────────────────────────────────────────────────

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveHistoryModal()) return false;

    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      closeHistoryModal();
      return true;
    }

    if (activeTab === 'broadcasts') {
      if (bcastView === 'list') {
        if (sequence === '/' || sequence === '\t') {
          switchToTab('search');
          return true;
        }
        if (sequence === '\x1b[A') {
          if (selectedIdx > 0) {
            const p = selectedIdx;
            selectedIdx--;
            moveCursor(p, selectedIdx);
          }
          return true;
        }
        if (sequence === '\x1b[B') {
          if (selectedIdx < streams.length - 1) {
            const p = selectedIdx;
            selectedIdx++;
            moveCursor(p, selectedIdx);
          }
          return true;
        }
        if (sequence === '\r' || sequence === '\n') {
          const s = streams[selectedIdx];
          if (s) openStream(s);
          return true;
        }
      } else {
        if (sequence === '\x7f' || sequence === '\x08') {
          bcastView = 'list';
          viewStream = null;
          renderStreamList();
          return true;
        }
        if (sequence === '\x1b[A') {
          if (contentScroll.scrollTop === 0 && !streamExhausted) {
            _loadStreamPage();
          } else {
            contentScroll.scrollBy(-3);
          }
          return true;
        }
        if (sequence === '\x1b[B') {
          contentScroll.scrollBy(3);
          return true;
        }
      }
      return true; // consume all unhandled keys in broadcasts mode
    }

    if (activeTab === 'search') {
      if (sequence === 'b' || sequence === 'B') {
        switchToTab('broadcasts');
        return true;
      }
      if (sequence === '\x1b[A') {
        contentScroll.scrollBy(-3);
        return true;
      }
      if (sequence === '\x1b[B') {
        contentScroll.scrollBy(3);
        return true;
      }
      return false; // let remaining keys reach searchInput
    }

    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  // ── Search input ───────────────────────────────────────────────────────────

  let searchDebounce: ReturnType<typeof setTimeout> | null = null;
  searchInput.on(InputRenderableEvents.INPUT, () => {
    if (searchDebounce) clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      runSearch(searchInput.value);
    }, 200);
  });

  searchInput.onKeyDown = ((key: { name: string }) => {
    if (key.name === 'escape') {
      closeHistoryModal();
    }
  }) as any;

  // ── Initial render ─────────────────────────────────────────────────────────

  streams = ctx.messageLog.getStreams();
  renderTabBar();

  if (activeTab === 'search') {
    if (opts?.query) searchInput.value = opts.query;
    footerText.content = '  [↑/↓] scroll results  [B] broadcasts  [Esc] close';
    runSearch(opts?.query ?? '');
    setTimeout(() => {
      searchInput.focus();
    }, 0);
  } else {
    (searchRow as any).visible = false;
    renderStreamList();
  }
}
