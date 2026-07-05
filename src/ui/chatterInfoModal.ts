import {
  BoxRenderable,
  bold,
  type CliRenderer,
  fg,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  underline,
} from '@opentui/core';
import type { ChatMessage, ChatterInfo } from '../platforms/base';
import type { ChatterCache } from '../services/chatter-cache';
import type { MessageLog } from '../services/message-log';
import type { SharedTwitchEmoteDefinition } from '../utils/ffz-fetch';
import { buildTuiFfzMessageParts } from '../utils/tuiFfz';
import { formatBadgeLabels } from './tuiChatLines';

export type ChatterInfoModalState = {
  box: BoxRenderable;
  refreshForMessage: (msg: ChatMessage) => void;
};

type ChatterInfoProvider = {
  fetchChatterInfo?: (userId: string, username: string) => Promise<ChatterInfo | null>;
};

type ChatterSessionStats = { count: number; firstSeenAt?: Date };

type ChatterInfoSessionHelpers = {
  getChatterSessionMessages: (
    msg: ChatMessage,
    deps: {
      getPersistedMessages: (platform: string, userId: string, streamId: string) => ChatMessage[];
      getPersistedStats: (
        platform: string,
        userId: string,
        streamId: string,
      ) => ChatterSessionStats;
      getInMemoryMessages: () => ChatMessage[];
      getInMemoryStats: (
        platform: string,
        userId: string,
        messages: ChatMessage[],
      ) => ChatterSessionStats;
    },
  ) => ChatMessage[];
  getChatterSessionStats: (
    msg: ChatMessage,
    deps: {
      getPersistedMessages: (platform: string, userId: string, streamId: string) => ChatMessage[];
      getPersistedStats: (
        platform: string,
        userId: string,
        streamId: string,
      ) => ChatterSessionStats;
      getInMemoryMessages: () => ChatMessage[];
      getInMemoryStats: (
        platform: string,
        userId: string,
        messages: ChatMessage[],
      ) => ChatterSessionStats;
    },
  ) => ChatterSessionStats;
  applySessionStatsToChatterInfo: (info: ChatterInfo, stats: ChatterSessionStats) => ChatterInfo;
  doesIncomingMessageAffectChatterSession: (
    selected: ChatMessage,
    incoming: ChatMessage,
  ) => boolean;
  doesIncomingMessageAffectChatterAllTime: (
    selected: ChatMessage,
    incoming: ChatMessage,
  ) => boolean;
  doesIncomingMessageAffectChatterContext: (
    incoming: ChatMessage,
    hasUserSessionInStream: (streamId: string) => boolean,
  ) => boolean;
};

type ChatterInfoModalContext = {
  uiNodes: { renderer: CliRenderer } | null;
  hasBlockingModal: () => boolean;
  getActiveChatterInfoModal: () => ChatterInfoModalState | null;
  setActiveChatterInfoModal: (modal: ChatterInfoModalState | null) => void;
  focusMainInput: () => void;
  chatterCache: ChatterCache;
  messageLog: MessageLog;
  chatService: { getMessageHistory(): ChatMessage[] };
  sessionHelpers: ChatterInfoSessionHelpers;
  providers: {
    twitch: ChatterInfoProvider;
    youtube: ChatterInfoProvider;
    kick: ChatterInfoProvider;
  };
  tuiFfzEmotes: Record<string, SharedTwitchEmoteDefinition>;
  tuiFfzImageIdsByName: Record<string, number>;
  getTuiEmoteColumns: () => number;
};

export function getChatterPlatformColor(platform: string): string {
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'youtube') return '#FF0000';
  if (platform === 'kick') return '#53FC18';
  return 'white';
}

export function formatChatterModalTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(
    2,
    '0',
  )}:${String(d.getSeconds()).padStart(2, '0')}  `;
}

export function openChatterInfoModal(ctx: ChatterInfoModalContext, msg: ChatMessage): void {
  if (!ctx.uiNodes || ctx.hasBlockingModal() || ctx.getActiveChatterInfoModal()) return;
  const { renderer } = ctx.uiNodes;
  const {
    chatterCache,
    messageLog,
    chatService,
    sessionHelpers,
    providers,
    tuiFfzEmotes,
    tuiFfzImageIdsByName,
    getTuiEmoteColumns,
  } = ctx;

  let activeTab: 'session' | 'alltime' | 'context' = 'session';
  let tabSessionCount = 0;
  let tabAlltimeCount = 0;
  let tabContextCount = 0;

  const ALLTIME_PAGE_SIZE = 100;
  let alltimeMessages: ChatMessage[] = [];
  let alltimePage = 0;
  let alltimeExhausted = false;
  let alltimeLoading = false;

  let contextMessages: ChatMessage[] = [];
  let contextPage = 0;
  let contextExhausted = false;
  let contextLoading = false;

  function renderTabBar(tab: 'session' | 'alltime' | 'context', count: number): StyledText {
    return new StyledText([
      fg(activeTab === tab ? 'cyan' : '#555555')(
        `  [${tab === 'session' ? 'S' : tab === 'alltime' ? 'A' : 'C'}] `,
      ),
      bold(
        fg(activeTab === tab ? 'cyan' : '#555555')(
          `${tab === 'session' ? 'Session' : tab === 'alltime' ? 'All time' : 'Context'} (${count})  `,
        ),
      ),
    ]);
  }

  function openExternalUrl(url: string): void {
    const proc = Bun.spawn(['xdg-open', url]);
    proc.exited.catch(() => {});
  }

  function getSessionMessagesForModal(): ChatMessage[] {
    return sessionHelpers.getChatterSessionMessages(msg, {
      getPersistedMessages: (platform, userId, streamId) =>
        messageLog.getForUserInStream(platform, userId, streamId),
      getPersistedStats: (platform, userId, streamId) =>
        messageLog.getSessionStatsForUserInStream(platform, userId, streamId),
      getInMemoryMessages: () => chatService.getMessageHistory(),
      getInMemoryStats: (platform, userId, messages) =>
        chatterCache.computeSessionStats(platform, userId, messages),
    });
  }

  function getSessionStatsForModal(): ChatterSessionStats {
    return sessionHelpers.getChatterSessionStats(msg, {
      getPersistedMessages: (platform, userId, streamId) =>
        messageLog.getForUserInStream(platform, userId, streamId),
      getPersistedStats: (platform, userId, streamId) =>
        messageLog.getSessionStatsForUserInStream(platform, userId, streamId),
      getInMemoryMessages: () => chatService.getMessageHistory(),
      getInMemoryStats: (platform, userId, messages) =>
        chatterCache.computeSessionStats(platform, userId, messages),
    });
  }

  const msgScroll = new ScrollBoxRenderable(renderer, {
    stickyScroll: false,
    stickyStart: 'top',
    flexGrow: 1,
    minHeight: 5,
    viewportCulling: true,
  });

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '5%',
    left: '8%',
    width: '84%',
    height: '85%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: '#1a1a1a',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' Chatter Info ',
  });

  const infoText = new TextRenderable(renderer, {
    content: `  Loading info for @${msg.username}...`,
    fg: 'cyan',
    wrapMode: 'none',
  });
  let currentInfo: ChatterInfo | null = null;
  let currentProfileUrl: string | null = null;
  const usernameTextNode = new TextRenderable(renderer, {
    content: '',
    wrapMode: 'none',
  });
  usernameTextNode.onMouseDown = (e) => {
    if (e.button === 0 && currentProfileUrl) openExternalUrl(currentProfileUrl);
  };
  const tabBarRow = new BoxRenderable(renderer, {
    flexDirection: 'row',
    width: '100%',
  });
  const sessionTabTextNode = new TextRenderable(renderer, { content: '' });
  const alltimeTabTextNode = new TextRenderable(renderer, { content: '' });
  const contextTabTextNode = new TextRenderable(renderer, { content: '' });
  sessionTabTextNode.onMouseDown = (e) => {
    if (e.button === 0) switchTab('session');
  };
  alltimeTabTextNode.onMouseDown = (e) => {
    if (e.button === 0) switchTab('alltime');
  };
  contextTabTextNode.onMouseDown = (e) => {
    if (e.button === 0) switchTab('context');
  };
  tabBarRow.add(sessionTabTextNode);
  tabBarRow.add(alltimeTabTextNode);
  tabBarRow.add(contextTabTextNode);

  function updateTabBar(): void {
    sessionTabTextNode.content = renderTabBar('session', tabSessionCount);
    alltimeTabTextNode.content = renderTabBar('alltime', tabAlltimeCount);
    contextTabTextNode.content = renderTabBar('context', tabContextCount);
  }

  function renderInfoSummary(info: ChatterInfo): void {
    const userColor = info.color ?? 'white';
    const pColor = getChatterPlatformColor(info.platform);

    type InfoRow = [string, string, string];
    const rows: InfoRow[] = [['Platform:', info.platform, pColor]];

    if (info.accountCreatedAt !== undefined) {
      const dateStr = info.accountCreatedAt
        ? (new Date(info.accountCreatedAt).toISOString().split('T')[0] ?? 'Unknown')
        : 'Unknown';
      rows.push(['Account created:', dateStr, 'white']);
    }

    rows.push(['Session messages:', String(info.sessionMessageCount), 'white']);

    if (info.sessionFirstSeenAt) {
      const timeStr = new Date(info.sessionFirstSeenAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
      });
      rows.push(['First seen:', timeStr, 'white']);
    } else {
      rows.push(['First seen:', 'Unknown', '#888888']);
    }

    if (info.badges && Object.keys(info.badges).length > 0) {
      rows.push(['Badges:', formatBadgeLabels(info.badges).join(', '), 'white']);
    }

    if (info.profileImageUrl) {
      rows.push(['Avatar:', info.profileImageUrl, '#7dd3fc']);
    }

    if (info.subscriberCount !== null && info.subscriberCount !== undefined) {
      rows.push(['Subscribers:', info.subscriberCount.toLocaleString(), 'white']);
    }

    const chunks = rows.flatMap(([label, value, valueFg], i) => {
      const labelPadded = (i > 0 ? '\n' : '') + `  ${label}`.padEnd(20);
      return [fg('#888888')(labelPadded), fg(valueFg)(value)];
    });
    infoText.content = new StyledText(chunks);
    infoText.height = rows.length;
    currentProfileUrl = info.profileUrl ?? null;
    usernameTextNode.content = currentProfileUrl
      ? new StyledText([
          fg('#888888')('  Username:'.padEnd(20)),
          underline(fg(userColor)(`@${info.username}`)),
        ])
      : new StyledText([
          fg('#888888')('  Username:'.padEnd(20)),
          fg(userColor)(`@${info.username}`),
        ]);

    tabSessionCount = info.sessionMessageCount;
    tabAlltimeCount = messageLog.countForUser(msg.platform, msg.userId);
    tabContextCount = messageLog.countContextForUser(msg.platform, msg.userId);
    updateTabBar();
  }
  box.add(infoText);
  box.add(usernameTextNode);
  box.add(tabBarRow);
  box.add(msgScroll);
  box.add(
    new TextRenderable(renderer, {
      content:
        '  [S] session  [A] all-time  [C] context  [click tabs/username]  [↑] scroll / load older  [↓] scroll  [Esc] close',
      fg: '#888888',
    }),
  );
  renderer.root.add(box);
  ctx.setActiveChatterInfoModal({
    box,
    refreshForMessage: (incomingMsg) => {
      if (!currentInfo || !ctx.getActiveChatterInfoModal()) return;
      const sessionAffected = sessionHelpers.doesIncomingMessageAffectChatterSession(
        msg,
        incomingMsg,
      );
      const alltimeAffected = sessionHelpers.doesIncomingMessageAffectChatterAllTime(
        msg,
        incomingMsg,
      );
      const contextAffected = sessionHelpers.doesIncomingMessageAffectChatterContext(
        incomingMsg,
        (streamId) => {
          return (
            messageLog.getSessionStatsForUserInStream(msg.platform, msg.userId, streamId).count > 0
          );
        },
      );

      if (!sessionAffected && !alltimeAffected && !contextAffected) return;

      if (sessionAffected) {
        currentInfo = sessionHelpers.applySessionStatsToChatterInfo(
          currentInfo,
          getSessionStatsForModal(),
        );
      }
      renderInfoSummary(currentInfo);

      if (activeTab === 'session' && sessionAffected) {
        fillMessageScroll('session', msg.platform, msg.userId);
        msgScroll.scrollTo(99999);
      } else if (activeTab === 'alltime' && alltimeAffected) {
        alltimeMessages = [];
        alltimePage = 0;
        alltimeExhausted = false;
        fillMessageScroll('alltime', msg.platform, msg.userId);
        msgScroll.scrollTo(99999);
      } else if (activeTab === 'context' && contextAffected) {
        contextMessages = [];
        contextPage = 0;
        contextExhausted = false;
        fillMessageScroll('context', msg.platform, msg.userId);
        msgScroll.scrollTo(99999);
      }
    },
  });

  function makeMessageRow(m: ChatMessage): BoxRenderable {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    row.add(
      new TextRenderable(renderer, {
        content: formatChatterModalTimestamp(m.timestamp),
        fg: '#888888',
      }),
    );
    for (const badge of formatBadgeLabels(m.badges)) {
      row.add(new TextRenderable(renderer, { content: `[${badge}] `, fg: '#94a3b8' }));
    }
    for (const part of buildTuiFfzMessageParts(
      m.platform,
      m.message,
      'white',
      tuiFfzEmotes,
      tuiFfzImageIdsByName,
      getTuiEmoteColumns(),
    )) {
      row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
    }
    return row;
  }

  function makeStreamSeparator(timestamp: number): TextRenderable {
    return new TextRenderable(renderer, {
      content: `── stream starting ${formatChatterModalTimestamp(timestamp).trim()} ──`,
      fg: '#4a9eff',
    });
  }

  function makeContextMessageRow(m: ChatMessage, isTargetUser: boolean): BoxRenderable {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    row.add(
      new TextRenderable(renderer, {
        content: formatChatterModalTimestamp(m.timestamp),
        fg: '#888888',
      }),
    );
    if (isTargetUser) {
      row.add(new TextRenderable(renderer, { content: '★ ', fg: 'cyan' }));
      for (const badge of formatBadgeLabels(m.badges)) {
        row.add(new TextRenderable(renderer, { content: `[${badge}] `, fg: '#94a3b8' }));
      }
      row.add(
        new TextRenderable(renderer, {
          content: `${m.username}: `,
          fg: m.color ?? getChatterPlatformColor(m.platform),
        }),
      );
      for (const part of buildTuiFfzMessageParts(
        m.platform,
        m.message,
        'white',
        tuiFfzEmotes,
        tuiFfzImageIdsByName,
        getTuiEmoteColumns(),
      )) {
        row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
      }
    } else {
      row.add(
        new TextRenderable(renderer, {
          content: `[${m.platform}] `,
          fg: getChatterPlatformColor(m.platform),
        }),
      );
      for (const badge of formatBadgeLabels(m.badges)) {
        row.add(new TextRenderable(renderer, { content: `[${badge}] `, fg: '#94a3b8' }));
      }
      row.add(new TextRenderable(renderer, { content: `${m.username}: `, fg: '#888888' }));
      for (const part of buildTuiFfzMessageParts(
        m.platform,
        m.message,
        '#aaaaaa',
        tuiFfzEmotes,
        tuiFfzImageIdsByName,
        getTuiEmoteColumns(),
      )) {
        row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
      }
    }
    return row;
  }

  function renderAlltimeFull(): void {
    if (alltimeExhausted) {
      msgScroll.add(
        new TextRenderable(renderer, { content: '  ── beginning of history ──', fg: '#555555' }),
      );
    }
    let lastStreamId: string | undefined;
    for (const m of alltimeMessages) {
      if (m.streamId !== lastStreamId) {
        lastStreamId = m.streamId;
        msgScroll.add(makeStreamSeparator(m.timestamp));
      }
      msgScroll.add(makeMessageRow(m));
    }
  }

  function loadMoreOlderMessages(platform: string, userId: string): void {
    if (alltimeLoading || alltimeExhausted) return;
    alltimeLoading = true;
    try {
      const batch = messageLog.getForUserDesc(
        platform,
        userId,
        ALLTIME_PAGE_SIZE,
        alltimePage * ALLTIME_PAGE_SIZE,
      );
      if (batch.length === 0) {
        alltimeExhausted = true;
        msgScroll.add(
          new TextRenderable(renderer, { content: '  ── beginning of history ──', fg: '#555555' }),
          0,
        );
        return;
      }

      const chronoBatch = batch.slice().reverse();
      alltimePage++;
      if (batch.length < ALLTIME_PAGE_SIZE) alltimeExhausted = true;

      const lastInBatch = chronoBatch[chronoBatch.length - 1];
      const firstInExisting = alltimeMessages[0];
      if (lastInBatch?.streamId === firstInExisting?.streamId) {
        const children = msgScroll.getChildren();
        if (children.length > 0) msgScroll.remove(children[0]!.id);
      }

      let insertIdx = 0;
      let localLastStreamId: string | undefined;
      for (const m of chronoBatch) {
        if (m.streamId !== localLastStreamId) {
          localLastStreamId = m.streamId;
          msgScroll.add(makeStreamSeparator(m.timestamp), insertIdx++);
        }
        msgScroll.add(makeMessageRow(m), insertIdx++);
      }

      if (alltimeExhausted) {
        msgScroll.add(
          new TextRenderable(renderer, { content: '  ── beginning of history ──', fg: '#555555' }),
          0,
        );
      }

      alltimeMessages = [...chronoBatch, ...alltimeMessages];
    } finally {
      alltimeLoading = false;
    }
  }

  function renderContextFull(): void {
    if (contextExhausted) {
      msgScroll.add(
        new TextRenderable(renderer, { content: '  ── beginning of context ──', fg: '#555555' }),
      );
    }
    let lastStreamId: string | undefined;
    for (const m of contextMessages) {
      if (m.streamId !== lastStreamId) {
        lastStreamId = m.streamId;
        msgScroll.add(makeStreamSeparator(m.timestamp));
      }
      msgScroll.add(
        makeContextMessageRow(m, m.platform === msg.platform && m.userId === msg.userId),
      );
    }
  }

  function loadMoreOlderContextMessages(platform: string, userId: string): void {
    if (contextLoading || contextExhausted) return;
    contextLoading = true;
    try {
      const batch = messageLog.getContextForUserDesc(
        platform,
        userId,
        ALLTIME_PAGE_SIZE,
        contextPage * ALLTIME_PAGE_SIZE,
      );
      if (batch.length === 0) {
        contextExhausted = true;
        msgScroll.add(
          new TextRenderable(renderer, { content: '  ── beginning of context ──', fg: '#555555' }),
          0,
        );
        return;
      }

      const chronoBatch = batch.slice().reverse();
      contextPage++;
      if (batch.length < ALLTIME_PAGE_SIZE) contextExhausted = true;

      const lastInBatch = chronoBatch[chronoBatch.length - 1];
      const firstInExisting = contextMessages[0];
      if (lastInBatch?.streamId === firstInExisting?.streamId) {
        const children = msgScroll.getChildren();
        if (children.length > 0) msgScroll.remove(children[0]!.id);
      }

      let insertIdx = 0;
      let localLastStreamId: string | undefined;
      for (const m of chronoBatch) {
        if (m.streamId !== localLastStreamId) {
          localLastStreamId = m.streamId;
          msgScroll.add(makeStreamSeparator(m.timestamp), insertIdx++);
        }
        msgScroll.add(
          makeContextMessageRow(m, m.platform === platform && m.userId === userId),
          insertIdx++,
        );
      }

      if (contextExhausted) {
        msgScroll.add(
          new TextRenderable(renderer, { content: '  ── beginning of context ──', fg: '#555555' }),
          0,
        );
      }

      contextMessages = [...chronoBatch, ...contextMessages];
    } finally {
      contextLoading = false;
    }
  }

  function fillMessageScroll(
    tab: 'session' | 'alltime' | 'context',
    platform: string,
    userId: string,
  ): void {
    for (const child of msgScroll.getChildren()) {
      msgScroll.remove(child.id);
    }

    if (tab === 'session') {
      const messages = getSessionMessagesForModal();
      if (messages.length === 0) {
        msgScroll.add(new TextRenderable(renderer, { content: '  (no messages)', fg: '#888888' }));
        return;
      }
      for (const m of messages) {
        msgScroll.add(makeMessageRow(m));
      }
    } else if (tab === 'alltime') {
      if (alltimeMessages.length === 0) {
        const batch = messageLog.getForUserDesc(platform, userId, ALLTIME_PAGE_SIZE, 0);
        alltimeMessages = batch.slice().reverse();
        alltimePage = 1;
        alltimeExhausted = batch.length < ALLTIME_PAGE_SIZE;
      }
      if (alltimeMessages.length === 0) {
        msgScroll.add(new TextRenderable(renderer, { content: '  (no messages)', fg: '#888888' }));
        alltimeExhausted = true;
        return;
      }
      renderAlltimeFull();
      setTimeout(() => {
        msgScroll.scrollTo(99999);
      }, 32);
    } else {
      if (contextMessages.length === 0) {
        const batch = messageLog.getContextForUserDesc(platform, userId, ALLTIME_PAGE_SIZE, 0);
        contextMessages = batch.slice().reverse();
        contextPage = 1;
        contextExhausted = batch.length < ALLTIME_PAGE_SIZE;
      }
      if (contextMessages.length === 0) {
        msgScroll.add(
          new TextRenderable(renderer, {
            content: '  (no context — messages need stream IDs)',
            fg: '#888888',
          }),
        );
        contextExhausted = true;
        return;
      }
      renderContextFull();
      setTimeout(() => {
        msgScroll.scrollTo(99999);
      }, 32);
    }
  }

  function switchTab(tab: 'session' | 'alltime' | 'context'): void {
    if (activeTab === tab) return;
    activeTab = tab;
    updateTabBar();
    fillMessageScroll(tab, msg.platform, msg.userId);
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveChatterInfoModal()) return false;
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      renderer.removeInputHandler(modalKeyHandler);
      renderer.root.remove(box.id);
      ctx.setActiveChatterInfoModal(null);
      ctx.focusMainInput();
      return true;
    }
    if (sequence === 's' || sequence === 'S') {
      switchTab('session');
      return true;
    }
    if (sequence === 'a' || sequence === 'A') {
      switchTab('alltime');
      return true;
    }
    if (sequence === 'c' || sequence === 'C') {
      switchTab('context');
      return true;
    }
    if (sequence === '\x1b[A') {
      if (activeTab === 'alltime' && msgScroll.scrollTop === 0 && !alltimeExhausted) {
        loadMoreOlderMessages(msg.platform, msg.userId);
      } else if (activeTab === 'context' && msgScroll.scrollTop === 0 && !contextExhausted) {
        loadMoreOlderContextMessages(msg.platform, msg.userId);
      } else {
        msgScroll.scrollBy(-3);
      }
      return true;
    }
    if (sequence === '\x1b[B') {
      msgScroll.scrollBy(3);
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  void (async () => {
    try {
      let info = chatterCache.get(msg.platform, msg.userId);

      if (!info) {
        let provider: ChatterInfoProvider | null = null;
        if (msg.platform === 'twitch') provider = providers.twitch;
        else if (msg.platform === 'youtube') provider = providers.youtube;
        else if (msg.platform === 'kick') provider = providers.kick;

        if (provider?.fetchChatterInfo) {
          const fetched = await provider.fetchChatterInfo(msg.userId, msg.username);
          if (fetched) {
            info = fetched;
          }
        }

        if (!info) {
          info = {
            platform: msg.platform,
            userId: msg.userId,
            username: msg.username,
            color: msg.color,
            badges: msg.badges,
            sessionMessageCount: 0,
          };
        }

        const stats = getSessionStatsForModal();
        info = sessionHelpers.applySessionStatsToChatterInfo(info, stats);

        chatterCache.set(msg.platform, msg.userId, info);
      } else {
        const stats = getSessionStatsForModal();
        info = sessionHelpers.applySessionStatsToChatterInfo(info, stats);
      }

      if (!ctx.getActiveChatterInfoModal()) return;

      currentInfo = info;
      renderInfoSummary(info);

      fillMessageScroll('session', msg.platform, msg.userId);
    } catch (err) {
      if (!ctx.getActiveChatterInfoModal()) return;
      infoText.content = `  Error loading info: ${String(err)}`;
      infoText.fg = 'red';
    }
  })();
}
