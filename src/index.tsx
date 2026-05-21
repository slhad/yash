// Suppress EventTarget MaxListeners warning from OpenTUI's CliRenderer
process.setMaxListeners(0);

import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  fg,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextAttributes,
  TextRenderable,
} from '@opentui/core';
import type { ChatMessage } from './platforms/base';
import { YT_CATEGORY_NAMES } from './platforms/youtube';
import {
  authService,
  chatService,
  initializeServices,
  kick,
  obsService,
  platforms,
  settingsStore,
  streamService,
  twitch,
  youtube,
} from './services';
import { ChatterCache } from './services/chatter-cache';
import { messageLog, type StreamSummary } from './services/message-log';
import { type ChatClearLineKind, runChatClearCommand } from './utils/chatClear';
import { getDataDir, isDemoMode, saveConfig } from './utils/config';
import logCollector from './utils/logCollector';
import { defaultLogger } from './utils/logger';
import { formatMarkerCreationSummary } from './utils/markerSummary';
import { buildTargetedStreamMetadataUpdate } from './utils/streamMetadata';
import { buildChatHistoryMessages } from './utils/chatHistoryLoader';
import { getAutocomplete, initTuiCommands } from './utils/tuiCommands';
import { installTuiErrorCapture } from './utils/tuiErrorCapture';
import { type MessageTarget } from './utils/tuiMessageInput';
import {
  buildTuiSettingsEntries,
  SETTINGS_ACTIVITY_MODES,
  SETTINGS_MESSAGE_POSITIONS,
  SETTINGS_VIEWER_MODES,
  SETTINGS_WIDTH_OPTIONS,
  validateTuiSettingsDraft,
} from './utils/tuiSettings';
import { runIpcCommand } from './utils/ipcCommandRunner';
import { parseMarkerArgs, parseSettingsValue } from './utils/webCommands';
import './index.ts'; // start Bun.serve web server in the same process
import { startIpcServer } from './ipc/server';

const settings = settingsStore;

installTuiErrorCapture();

// In-memory event log for the sidebar
const eventLog: Array<{ ts: number; platform: string; type: string; message: string }> = [];
function pushEvent(platform: string, type: string, message: string): void {
  eventLog.push({ ts: Date.now(), platform, type, message });
}

// ─── Activity log ────────────────────────────────────────────────────────────
// Persisted to disk; tracks sub/follow/cheer/raid events from live platforms.

interface ActivityEvent {
  ts: number;
  platform: string;
  type: string;
  message: string;
  sessionId?: string;
}

const activityEvents: ActivityEvent[] = [];
let activityRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let activityBarHovered = false;
let currentActivitySessionId = '';

function _getActivityLogPath(): string {
  return `${getDataDir()}/activity-events.json`;
}

function _loadActivityEvents(): ActivityEvent[] {
  try {
    const raw = require('node:fs').readFileSync(_getActivityLogPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e: ActivityEvent) => !e.sessionId || e.sessionId === currentActivitySessionId,
    );
  } catch {
    return [];
  }
}

function _saveActivityEvents(): void {
  try {
    require('node:fs').writeFileSync(
      _getActivityLogPath(),
      JSON.stringify(activityEvents),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

function _timedVisibleEvents(): ActivityEvent[] {
  if (activityBarHovered) return activityEvents; // freeze expiry while mouse is over the bar
  const secs = numSetting(settings.get('activity.timeout', 10), 10);
  const cutoff = Date.now() - secs * 1000;
  return activityEvents.filter((ev) => ev.ts > cutoff);
}

function _activityBarShouldBeVisible(): boolean {
  if (!boolSetting(settings.get('activity.visible', true), true)) return false;
  const mode = settings.get('activity.mode', 'permanent') as string;
  if (mode !== 'timed') return true;
  if (activityEvents.length === 0) return true; // show "No events yet" until first event
  return _timedVisibleEvents().length > 0;
}

function _scheduleActivityBarRefresh(): void {
  if (activityRefreshTimer) clearTimeout(activityRefreshTimer);
  activityRefreshTimer = null;
  if (activityBarHovered) return; // paused while mouse is over the bar
  const mode = settings.get('activity.mode', 'permanent') as string;
  if (mode !== 'timed') return;
  const secs = numSetting(settings.get('activity.timeout', 10), 10);
  const now = Date.now();
  const nextExpiry = activityEvents
    .map((ev) => ev.ts + secs * 1000)
    .filter((t) => t > now)
    .sort((a, b) => a - b)[0];
  if (nextExpiry === undefined) return;
  activityRefreshTimer = setTimeout(() => {
    if (uiNodes) updateUI(lastMessages);
    _scheduleActivityBarRefresh();
  }, nextExpiry - now + 50);
}

function _rotateActivitySession(): void {
  currentActivitySessionId = crypto.randomUUID();
  settings.set('activity.sessionId', currentActivitySessionId).catch(() => {});
  activityEvents.length = 0;
  _saveActivityEvents();
  _scheduleActivityBarRefresh();
  if (uiNodes) updateUI(lastMessages);
}

function pushActivityEvent(platform: string, type: string, message: string): void {
  const ev: ActivityEvent = { ts: Date.now(), platform, type, message, sessionId: currentActivitySessionId };
  activityEvents.push(ev);
  _saveActivityEvents();
  _scheduleActivityBarRefresh();
  if (uiNodes) updateUI(lastMessages);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function boolSetting(value: unknown, def: boolean): boolean {
  if (value === null || value === undefined) return def;
  if (typeof value === 'boolean') return value;
  return String(value).toLowerCase() === 'true';
}

function numSetting(value: unknown, def: number): number {
  if (value === null || value === undefined) return def;
  if (typeof value === 'number') return value;
  return parseInt(String(value), 10) || def;
}

function getSettingValue(key: string): unknown {
  return settings.get(key, null);
}

function applySettingSideEffects(key: string, value: unknown): void {
  if (key === 'chat.maxHistorySize') {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      chatService.setMaxHistorySize(parsed);
    }
  }
  if (key === 'activity.mode') {
    _scheduleActivityBarRefresh();
  }
}

const STRUCTURAL_SETTING_KEYS = new Set(['messages.position', 'events.width', 'logs.height']);

async function persistSettingEntries(
  entries: Array<{ key: string; value: unknown }>,
): Promise<string[]> {
  const changedKeys: string[] = [];
  for (const entry of entries) {
    if (Object.is(settings.get(entry.key, null), entry.value)) continue;
    await settings.set(entry.key, entry.value);
    applySettingSideEffects(entry.key, entry.value);
    changedKeys.push(entry.key);
  }
  if (changedKeys.some((key) => STRUCTURAL_SETTING_KEYS.has(key)) && cliRenderer && uiNodes) {
    uiNodes = initUI(cliRenderer, lastMessages);
    uiNodes.inputEl.focus();
  }
  return changedKeys;
}

function formatElapsed(start: Date): string {
  const secs = Math.floor((Date.now() - start.getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`;
}

function formatMarkerPosition(positionInSeconds: number): string {
  const h = Math.floor(positionInSeconds / 3600);
  const m = Math.floor((positionInSeconds % 3600) / 60);
  const s = positionInSeconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

function formatPlatformStatusLabel(
  status: { authenticated: boolean; streamStatus: string },
  viewers: string,
): string {
  if (!status.authenticated) {
    return `✗${viewers}`;
  }
  if (status.streamStatus === 'ONLINE') {
    return `✓${viewers}`;
  }
  if (status.streamStatus === 'OFFLINE') {
    return `○${viewers}`;
  }
  return `${status.streamStatus}${viewers}`;
}

function getPlatformStatusColor(status: { authenticated: boolean; streamStatus: string }): string {
  if (!status.authenticated) {
    return 'red';
  }
  if (status.streamStatus === 'ONLINE') {
    return 'green';
  }
  if (status.streamStatus === 'OFFLINE') {
    return 'yellow';
  }
  return 'yellow';
}

function clearScrollBox(scroll: ScrollBoxRenderable): void {
  for (const child of scroll.getChildren()) {
    scroll.remove(child.id);
  }
}

function createIndentedInputRow(
  renderer: CliRenderer,
  input: InputRenderable,
  indent = '  ',
): BoxRenderable {
  const row = new BoxRenderable(renderer, { flexDirection: 'row', width: '100%' });
  row.add(new TextRenderable(renderer, { content: indent, fg: 'white' }));
  const inputBox = new BoxRenderable(renderer, { width: '96%', flexDirection: 'column' });
  inputBox.add(input);
  row.add(inputBox);
  return row;
}

// ─── Persistent UI node references ──────────────────────────────────────────
// Built once in initUI(); mutated in-place in updateUI() to avoid flicker.

interface UINodes {
  renderer: CliRenderer;
  mainBox: BoxRenderable;
  titleText: TextRenderable;
  subtitleText: TextRenderable;
  platformTexts: Map<string, TextRenderable>;
  obsText: TextRenderable;
  demoText: TextRenderable;
  totalViewersText: TextRenderable;
  activityBar: BoxRenderable;
  activityBarText: TextRenderable;
  chatScroll: ScrollBoxRenderable;
  sidebarBox: BoxRenderable;
  sidebarScroll: ScrollBoxRenderable;
  composeTargetText: TextRenderable;
  inputEl: InputRenderable;
  autocompleteHint: TextRenderable;
}

let uiNodes: UINodes | null = null;
let selectedMessageTarget: MessageTarget = 'all';

let autocycleSuggestions: string[] = [];
let autocycleHints: string[] = [];
let autocycleIndex = -1;

interface TwitchSetupModal {
  box: BoxRenderable;
  focusIndex: number;
}

interface StreamModal {
  box: BoxRenderable;
  focusIndex: number;
  selectedPlatforms: Set<string>;
  op: 'start' | 'stop' | 'update';
}

interface SettingsModal {
  box: BoxRenderable;
  focusIndex: number;
}

let activeModal: TwitchSetupModal | null = null;
let activeStreamModal: StreamModal | null = null;
let activeSettingsModal: SettingsModal | null = null;
let activeChatterInfoModal: { box: BoxRenderable } | null = null;
let activeHistoryModal: { box: BoxRenderable } | null = null;
let activeActivityModal: { box: BoxRenderable } | null = null;

const chatterCache = new ChatterCache();

function ensureMainInputFocus(): void {
  if (!uiNodes) return;
  if (
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeChatterInfoModal ||
    activeHistoryModal ||
    activeActivityModal
  )
    return;
  if (!uiNodes.inputEl.focused) {
    uiNodes.inputEl.focus();
  }
}

function getConnectedMessageTargets(): MessageTarget[] {
  const targets: MessageTarget[] = ['all'];
  if (youtube.isAuthenticated()) targets.push('youtube');
  if (twitch.isAuthenticated()) targets.push('twitch');
  if (kick.isAuthenticated()) targets.push('kick');
  return targets;
}

function cycleMessageTarget(): void {
  const targets = getConnectedMessageTargets();
  const currentIndex = targets.indexOf(selectedMessageTarget);
  if (currentIndex === -1 || currentIndex === targets.length - 1) {
    selectedMessageTarget = targets[0] ?? 'all';
    return;
  }
  selectedMessageTarget = targets[currentIndex + 1] ?? 'all';
}

function getMessageTargetColor(target: MessageTarget): string {
  if (target === 'all') return 'cyan';
  return platformColor(target);
}

function updateInputAssist(): void {
  if (!uiNodes) return;
  const val = uiNodes.inputEl.value;
  const hint = uiNodes.autocompleteHint;
  const composeTargetText = uiNodes.composeTargetText;

  if (val.startsWith('/') && val.length > 0) {
    uiNodes.inputEl.fg = 'white';
    uiNodes.inputEl.placeholder = '> type a command…';
    composeTargetText.visible = false;
    // Re-render cycling hint if mid-cycle (prevents periodic updateUI from clobbering it)
    if (
      autocycleIndex >= 0 &&
      autocycleSuggestions[autocycleIndex] === val &&
      autocycleSuggestions.length > 1
    ) {
      hint.content = `  ${autocycleHints.map((h, i) => (i === autocycleIndex ? `[${h}]` : h)).join('  ')}`;
      hint.visible = true;
      return;
    }
    const { hints } = getAutocomplete(val);
    if (hints.length > 0) {
      hint.content = `  ${hints.join('  ')}`;
      hint.visible = true;
    } else {
      hint.visible = false;
    }
    return;
  }

  hint.visible = false;
  composeTargetText.content = `${selectedMessageTarget} > `;
  composeTargetText.fg = getMessageTargetColor(selectedMessageTarget);
  composeTargetText.visible = true;
  uiNodes.inputEl.placeholder = 'type a message…';
  uiNodes.inputEl.fg = 'white';
}

// ─── initUI ─────────────────────────────────────────────────────────────────
// Builds the complete layout tree once and attaches it to renderer.root.
// Called once at startup; called again only on structural settings changes.

function initUI(renderer: CliRenderer, messages: ChatLine[]): UINodes {
  // Tear down any previous tree
  if (uiNodes) {
    try {
      renderer.root.remove(uiNodes.mainBox.id);
    } catch {}
  }

  // ── Read settings ────────────────────────────────────────────────
  const titleVisible = boolSetting(settings.get('title.visible', false), false);
  const viewersVisible = boolSetting(settings.get('viewers.visible', true), true);
  const viewersMode = (settings.get('viewers.mode', 'per-platform') ?? 'per-platform') as string;
  const eventsVisible = boolSetting(settings.get('events.visible', true), true);
  const logsVisible = boolSetting(settings.get('logs.visible', true), true);
  const sidebarWidth = (settings.get('events.width', '30%') ?? '30%') as string;
  const logsHeight = numSetting(settings.get('logs.height', 15), 15);
  const logsTail = numSetting(settings.get('logs.tail', 20), 20);
  const eventsTail = numSetting(settings.get('events.tail', 15), 15);
  const messagesPosition = (settings.get('messages.position', 'bottom') ?? 'bottom') as string;

  // ── Root container ───────────────────────────────────────────────
  const mainBox = new BoxRenderable(renderer, {
    id: 'yash-root',
    borderStyle: 'rounded',
    border: true,
    paddingTop: 1,
    paddingRight: 2,
    paddingBottom: 1,
    paddingLeft: 2,
    width: '100%',
    height: '100%',
    flexDirection: 'column',
  });

  // ── Optional title (hidden by default) ──────────────────────────
  const titleText = new TextRenderable(renderer, {
    content: 'YASH - Yet Another Streamer Helper',
    attributes: TextAttributes.BOLD,
    fg: 'cyan',
  });
  titleText.visible = titleVisible;

  const subtitleText = new TextRenderable(renderer, {
    content: 'Unified platform management for YouTube, Twitch, and Kick',
    fg: 'gray',
  });
  subtitleText.visible = titleVisible;

  mainBox.add(titleText);
  mainBox.add(subtitleText);

  // ── Status bar ───────────────────────────────────────────────────
  const platformRow = new BoxRenderable(renderer, { flexDirection: 'row' });

  platformRow.add(new TextRenderable(renderer, { content: 'Status  ', fg: 'gray' }));

  const platformTexts = new Map<string, TextRenderable>();
  let totalViewers = 0;
  for (const platform of platforms) {
    const provider = platform === 'youtube' ? youtube : platform === 'twitch' ? twitch : kick;
    const status = provider.getStatus();
    const viewerCount = provider.getViewerCount();
    totalViewers += viewerCount;
    const showViewers = settings.get(`platforms.${platform}.showViewers`, true) !== false;
    const isOnline = status.streamStatus === 'ONLINE';
    const startTime = provider.getStreamStartTime();
    const elapsed = isOnline && startTime ? formatElapsed(startTime) : null;
    const viewers =
      isOnline && showViewers && viewersVisible
        ? elapsed
          ? ` (${elapsed}/${viewerCount})`
          : ` (${viewerCount})`
        : '';
    const t = new TextRenderable(renderer, {
      content: `${platform}: ${formatPlatformStatusLabel(status, viewers)}  `,
      fg: getPlatformStatusColor(status),
    });
    platformTexts.set(platform, t);
    platformRow.add(t);
  }

  const totalViewersText = new TextRenderable(renderer, {
    content: `Total viewers: ${totalViewers}  `,
    fg: 'cyan',
  });
  totalViewersText.visible =
    viewersVisible && (viewersMode === 'cumulative' || viewersMode === 'both');
  platformRow.add(totalViewersText);

  const obsText = new TextRenderable(renderer, {
    content: `OBS: ${obsService.isConnected() ? '✓' : '✗'}  `,
    fg: obsService.isConnected() ? 'green' : 'gray',
  });
  platformRow.add(obsText);

  const demoText = new TextRenderable(renderer, {
    content: '[DEMO MODE]',
    fg: 'yellow',
    attributes: TextAttributes.BOLD,
  });
  demoText.visible = isDemoMode();
  platformRow.add(demoText);

  // ── Activity bar ────────────────────────────────────────────────
  const activityBarLabel = new TextRenderable(renderer, {
    content: 'Activity  ',
    fg: 'gray',
  });
  const activityBarText = new TextRenderable(renderer, {
    content: '',
    fg: 'white',
  });
  const activityBar = new BoxRenderable(renderer, {
    flexDirection: 'row',
    width: '100%',
    paddingLeft: 1,
  });
  activityBar.add(activityBarLabel);
  activityBar.add(activityBarText);
  activityBar.onMouseDown = () => openActivityModal();
  activityBar.onMouseOver = () => {
    activityBarHovered = true;
    if (activityRefreshTimer) { clearTimeout(activityRefreshTimer); activityRefreshTimer = null; }
    updateUI(lastMessages);
  };
  activityBar.onMouseOut = () => {
    activityBarHovered = false;
    _scheduleActivityBarRefresh();
    updateUI(lastMessages);
  };
  _updateActivityBarText(activityBarText);
  activityBar.visible = _activityBarShouldBeVisible();

  // ── Content row: chat (center, grows) + sidebar (right) ─────────
  const contentRow = new BoxRenderable(renderer, {
    flexDirection: 'row',
    width: '100%',
    flexGrow: 1,
    marginTop: 1,
  });

  const chatScroll = new ScrollBoxRenderable(renderer, {
    height: '100%',
    stickyScroll: true,
    stickyStart: 'bottom',
  });
  for (const msg of messages) {
    chatScroll.add(renderChatLine(renderer, msg));
  }

  const chatBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: true,
    padding: 1,
    flexGrow: 1,
    title: ' Chat ',
  });
  chatBox.add(chatScroll);
  contentRow.add(chatBox);

  // Sidebar: events + logs merged into one panel
  const sidebarScroll = new ScrollBoxRenderable(renderer, {
    height: '100%',
    stickyScroll: true,
    stickyStart: 'bottom',
  });
  _fillSidebar(renderer, sidebarScroll, eventsVisible, logsVisible, eventsTail, logsTail);

  const sidebarBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: ['top', 'right', 'bottom'],
    padding: 1,
    width: sidebarWidth as `${number}%`,
    flexDirection: 'column',
    title: ' Events & Logs ',
  });
  sidebarBox.add(sidebarScroll);
  sidebarBox.visible = eventsVisible || logsVisible;
  contentRow.add(sidebarBox);

  // ── Input box ───────────────────────────────────────────────────
  // Re-use the singleton inputEl so it retains state across initUI calls.
  const inputEl =
    uiNodes?.inputEl ??
    new InputRenderable(renderer, {
      placeholder: 'type a message…',
      width: '90%',
    });
  inputEl.fg = 'white';

  const inputBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: ['left', 'right', 'bottom'],
    padding: 1,
    width: '100%',
    flexDirection: 'column',
    gap: 1,
  });
  const inputRow = new BoxRenderable(renderer, { flexDirection: 'row', width: '100%' });
  const composeTargetText =
    uiNodes?.composeTargetText ??
    new TextRenderable(renderer, {
      content: `${selectedMessageTarget} > `,
      fg: getMessageTargetColor(selectedMessageTarget),
    });
  inputRow.add(composeTargetText);
  inputRow.add(inputEl);
  inputBox.add(inputRow);

  // Autocomplete hint — hidden until user types a '/'
  // Re-use singleton so it survives initUI rebuilds
  const autocompleteHint =
    uiNodes?.autocompleteHint ?? new TextRenderable(renderer, { content: '', fg: 'gray' });
  autocompleteHint.visible = false;
  inputBox.add(autocompleteHint);

  // ── Assemble ─────────────────────────────────────────────────────
  if (messagesPosition === 'top') {
    mainBox.add(contentRow);
    mainBox.add(activityBar);
    mainBox.add(platformRow);
  } else {
    mainBox.add(platformRow);
    mainBox.add(activityBar);
    mainBox.add(contentRow);
  }
  if (messagesPosition !== 'hide') {
    mainBox.add(inputBox);
  }

  renderer.root.add(mainBox);

  return {
    renderer,
    mainBox,
    titleText,
    subtitleText,
    platformTexts,
    obsText,
    demoText,
    totalViewersText,
    activityBar,
    activityBarText,
    chatScroll,
    sidebarBox,
    sidebarScroll,
    composeTargetText,
    inputEl,
    autocompleteHint,
  };
}

// ─── _fillSidebar ────────────────────────────────────────────────────────────
// Populates sidebarScroll with events then logs. Called from initUI & updateUI.

function _fillSidebar(
  renderer: CliRenderer,
  scroll: ScrollBoxRenderable,
  eventsVisible: boolean,
  logsVisible: boolean,
  eventsTail: number,
  logsTail: number,
): void {
  if (eventsVisible) {
    for (const ev of eventLog.slice(-eventsTail)) {
      const fg =
        ev.platform === 'youtube'
          ? 'red'
          : ev.platform === 'twitch'
            ? '#9146FF'
            : ev.platform === 'kick'
              ? 'green'
              : 'gray';
      scroll.add(
        new TextRenderable(renderer, {
          content: `[${ev.platform}] ${ev.type}: ${ev.message}`,
          fg,
        }),
      );
    }
  }
  if (logsVisible) {
    if (eventsVisible) {
      scroll.add(new TextRenderable(renderer, { content: '─── Logs ───', fg: 'gray' }));
    }
    try {
      for (const e of logCollector.tail(logsTail)) {
        const time = new Date(e.ts).toLocaleTimeString();
        const color = e.level === 'ERROR' ? 'red' : e.level === 'WARN' ? 'yellow' : 'gray';
        scroll.add(
          new TextRenderable(renderer, {
            content: `[${time}] [${e.level}] ${e.text}`,
            fg: color,
          }),
        );
      }
    } catch {}
  }
}

// ─── Activity bar helpers ─────────────────────────────────────────────────────

const ACTIVITY_MAX_VISIBLE = 5;

function _activityPlatformColor(platform: string): string {
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'youtube') return '#FF0000';
  if (platform === 'kick') return '#53FC18';
  return 'gray';
}

function _updateActivityBarText(node: TextRenderable): void {
  const mode = settings.get('activity.mode', 'permanent') as string;
  const source = mode === 'timed' ? _timedVisibleEvents() : activityEvents;
  if (source.length === 0) {
    node.content = 'No events yet';
    node.fg = 'gray';
    return;
  }
  node.fg = 'white';
  const recent = source.slice(-ACTIVITY_MAX_VISIBLE);
  const parts: ReturnType<typeof fg>[] = [];
  for (let i = 0; i < recent.length; i++) {
    const ev = recent[i]!;
    if (i > 0) parts.push(fg('gray')('  │  '));
    parts.push(fg(_activityPlatformColor(ev.platform))(ev.message));
  }
  if (source.length > ACTIVITY_MAX_VISIBLE) {
    parts.push(fg('gray')(` … +${source.length - ACTIVITY_MAX_VISIBLE} older`));
  }
  parts.push(fg('#555555')('  [click to view all]'));
  node.content = new StyledText(parts);
}

function openActivityModal(): void {
  if (!uiNodes || activeActivityModal) return;
  const { renderer } = uiNodes;

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '5%',
    left: '5%',
    width: '90%',
    zIndex: 110,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'yellow',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 0,
    title: ' Activity Events ',
  });

  box.add(
    new TextRenderable(renderer, {
      content: '  ↑↓ scroll  •  Esc close',
      fg: 'gray',
    }),
  );

  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'bottom',
  });

  const events = [...activityEvents].reverse();
  if (events.length === 0) {
    scroll.add(new TextRenderable(renderer, { content: '  No activity events yet.', fg: 'gray' }));
  } else {
    for (const ev of events) {
      const time = new Date(ev.ts).toLocaleTimeString();
      scroll.add(
        new TextRenderable(renderer, {
          content: new StyledText([
            fg('gray')(`  [${time}] `),
            fg(_activityPlatformColor(ev.platform))(`[${ev.platform}] ${ev.type}: ${ev.message}`),
          ]),
        }),
      );
    }
  }

  box.add(scroll);
  renderer.root.add(box);
  activeActivityModal = { box };

  const keyHandler = (sequence: string): boolean => {
    if (!activeActivityModal) return false;
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      renderer.removeInputHandler(keyHandler);
      renderer.root.remove(box.id);
      activeActivityModal = null;
      uiNodes?.inputEl.focus();
      return true;
    }
    if (sequence === '\x1b[A') {
      scroll.scrollBy(-1);
      return true;
    }
    if (sequence === '\x1b[B') {
      scroll.scrollBy(1);
      return true;
    }
    return false;
  };
  renderer.prependInputHandler(keyHandler);
}

// ─── updateUI ────────────────────────────────────────────────────────────────
// Mutates existing nodes in-place — never removes/re-adds root, so no flicker.

function updateUI(messages: ChatLine[]): void {
  if (!uiNodes) return;
  const {
    renderer,
    titleText,
    subtitleText,
    platformTexts,
    obsText,
    demoText,
    totalViewersText,
    chatScroll,
    sidebarBox,
    sidebarScroll,
  } = uiNodes;

  // Title visibility
  const titleVisible = boolSetting(settings.get('title.visible', false), false);
  titleText.visible = titleVisible;
  subtitleText.visible = titleVisible;

  // Platform statuses
  const viewersVisible = boolSetting(settings.get('viewers.visible', true), true);
  const viewersMode = (settings.get('viewers.mode', 'per-platform') ?? 'per-platform') as string;
  let totalViewers = 0;
  for (const platform of platforms) {
    const provider = platform === 'youtube' ? youtube : platform === 'twitch' ? twitch : kick;
    const status = provider.getStatus();
    const viewerCount = provider.getViewerCount();
    totalViewers += viewerCount;
    const node = platformTexts.get(platform);
    if (node) {
      const showViewers = settings.get(`platforms.${platform}.showViewers`, true) !== false;
      const isOnline = status.streamStatus === 'ONLINE';
      const startTime = provider.getStreamStartTime();
      const elapsed = isOnline && startTime ? formatElapsed(startTime) : null;
      const viewers =
        isOnline && showViewers && viewersVisible
          ? elapsed
            ? ` (${elapsed}/${viewerCount})`
            : ` (${viewerCount})`
          : '';
      node.content = `${platform}: ${formatPlatformStatusLabel(status, viewers)}  `;
      node.fg = getPlatformStatusColor(status);
    }
  }

  obsText.content = `  OBS: ${obsService.isConnected() ? '✓' : '✗'}`;
  obsText.fg = obsService.isConnected() ? 'green' : 'red';
  demoText.visible = isDemoMode();
  totalViewersText.content = `  Total viewers: ${totalViewers}`;
  totalViewersText.visible =
    viewersVisible && (viewersMode === 'cumulative' || viewersMode === 'both');

  // Chat: clear and refill
  clearScrollBox(chatScroll);
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    let rendered: TextRenderable | BoxRenderable;
    if (browseModeActive && i === browseSelectedIdx) {
      rendered = renderHighlightedChatLine(renderer, msg);
    } else {
      rendered = renderChatLine(renderer, msg);
    }
    if (typeof msg !== 'string' && msg.rawMsg) {
      const rawMsg = msg.rawMsg;
      rendered.onMouseDown = (e) => {
        if (e.button === 0) openChatterInfoModal(rawMsg);
      };
    }
    chatScroll.add(rendered);
  }

  // Browse mode status indicator
  const { composeTargetText } = uiNodes;
  if (browseModeActive) {
    composeTargetText.content = '[BROWSE ↑↓ Enter=info Esc=exit] ';
    composeTargetText.fg = 'cyan';
    composeTargetText.visible = true;
  } else {
    updateInputAssist();
  }

  // Activity bar
  const { activityBar, activityBarText } = uiNodes;
  activityBar.visible = _activityBarShouldBeVisible();
  _updateActivityBarText(activityBarText);

  // Sidebar: clear and refill
  const eventsVisible = boolSetting(settings.get('events.visible', true), true);
  const logsVisible = boolSetting(settings.get('logs.visible', true), true);
  const eventsTail = numSetting(settings.get('events.tail', 15), 15);
  const logsTail = numSetting(settings.get('logs.tail', 20), 20);
  sidebarBox.visible = eventsVisible || logsVisible;
  clearScrollBox(sidebarScroll);
  _fillSidebar(renderer, sidebarScroll, eventsVisible, logsVisible, eventsTail, logsTail);

  ensureMainInputFocus();
}

// ─── Command dispatch ────────────────────────────────────────────────────────

function openTwitchSetupModal(): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

  const instructions = new TextRenderable(renderer, {
    content:
      ' To connect Twitch, create an app at dev.twitch.tv/console,\n' +
      ' set redirect URL to http://localhost:3000/api/twitch/callback,\n' +
      ' then fill in the fields below. Press Tab to move between fields,\n' +
      ' Enter to save, Escape to cancel.\n',
    fg: 'white',
  });

  const clientIdLabel = new TextRenderable(renderer, { content: ' Client ID:', fg: 'cyan' });
  const clientIdInput = new InputRenderable(renderer, {
    placeholder: 'paste your Twitch Client ID…',
    width: '100%',
  });

  const clientSecretLabel = new TextRenderable(renderer, {
    content: ' Client Secret:',
    fg: 'cyan',
  });
  const clientSecretInput = new InputRenderable(renderer, {
    placeholder: 'paste your Twitch Client Secret…',
    width: '100%',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] switch field   [Enter] save   [Esc] cancel',
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
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' Twitch Setup ',
  });

  box.add(instructions);
  box.add(clientIdLabel);
  box.add(clientIdInput);
  box.add(clientSecretLabel);
  box.add(clientSecretInput);
  box.add(hint);

  renderer.root.add(box);

  activeModal = { box, focusIndex: 0 };

  const inputs = [clientIdInput, clientSecretInput];
  inputs[0].focus();

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    if (save) {
      const clientId = clientIdInput.value.trim();
      const clientSecret = clientSecretInput.value.trim();
      saveConfig({
        platforms: {
          twitch: {
            ...(clientId ? { clientId } : {}),
            ...(clientSecret ? { clientSecret } : {}),
          },
        },
      }).then(() => {
        lastMessages.push(
          '[system] Twitch credentials saved. Run /connect twitch to authenticate.',
        );
        updateUI(lastMessages);
      });
    } else {
      lastMessages.push('[system] Twitch setup cancelled.');
      updateUI(lastMessages);
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();
  }

  // Tab cycles fields, Enter saves, Escape cancels
  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
    if (sequence === '\t') {
      inputs[activeModal.focusIndex].blur();
      activeModal.focusIndex = (activeModal.focusIndex + 1) % inputs.length;
      inputs[activeModal.focusIndex].focus();
      return true;
    }
    if (sequence === '\r' || sequence === '\n') {
      closeModal(true);
      return true;
    }
    // \x1b = bare escape; \x1b\x1b = double-escape some terminals send
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      closeModal(false);
      return true;
    }
    if (sequence === '\x1b[A' || sequence === '\x1b[B') return true;
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  // Belt-and-suspenders: also catch escape via the keypress event path
  // in case the terminal sends it after the sequence handler has already run.
  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeModal) closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function openKickSetupModal(): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

  const instructions = new TextRenderable(renderer, {
    content:
      ' To connect Kick:\n' +
      '  1. Enable 2FA on your account (required by Kick)\n' +
      '  2. Go to kick.com/settings/developer and create an app\n' +
      '  3. Set redirect URL to http://localhost:3000/api/kick/callback\n' +
      '  4. Paste the generated Client ID and Client Secret below.\n',
    fg: 'white',
  });

  const clientIdLabel = new TextRenderable(renderer, { content: ' Client ID:', fg: 'cyan' });
  const clientIdInput = new InputRenderable(renderer, {
    placeholder: 'paste your Kick Client ID…',
    width: '100%',
  });

  const clientSecretLabel = new TextRenderable(renderer, {
    content: ' Client Secret:',
    fg: 'cyan',
  });
  const clientSecretInput = new InputRenderable(renderer, {
    placeholder: 'paste your Kick Client Secret…',
    width: '100%',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] switch field   [Enter] save   [Esc] cancel',
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
    borderColor: 'green',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' Kick Setup ',
  });

  box.add(instructions);
  box.add(clientIdLabel);
  box.add(clientIdInput);
  box.add(clientSecretLabel);
  box.add(clientSecretInput);
  box.add(hint);

  renderer.root.add(box);

  activeModal = { box, focusIndex: 0 };

  const inputs = [clientIdInput, clientSecretInput];
  inputs[0].focus();

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    if (save) {
      const clientId = clientIdInput.value.trim();
      const clientSecret = clientSecretInput.value.trim();
      saveConfig({
        platforms: {
          kick: {
            ...(clientId ? { clientId } : {}),
            ...(clientSecret ? { clientSecret } : {}),
          },
        },
      }).then(() => {
        lastMessages.push('[system] Kick credentials saved. Run /connect kick to authenticate.');
        updateUI(lastMessages);
      });
    } else {
      lastMessages.push('[system] Kick setup cancelled.');
      updateUI(lastMessages);
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
    if (sequence === '\t') {
      inputs[activeModal.focusIndex].blur();
      activeModal.focusIndex = (activeModal.focusIndex + 1) % inputs.length;
      inputs[activeModal.focusIndex].focus();
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

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeModal) closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function openYouTubeCredentialsModal(): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

  const instructions = new TextRenderable(renderer, {
    content:
      ' To connect YouTube:\n' +
      '  1. Go to console.cloud.google.com and create a project\n' +
      '  2. Enable the YouTube Data API v3\n' +
      '  3. Under Credentials, create an OAuth 2.0 Client ID (Web application)\n' +
      '  4. Add http://localhost:3000/api/youtube/callback as an authorized redirect URI\n' +
      '  5. Paste the generated Client ID and Client Secret below.\n',
    fg: 'white',
  });

  const clientIdLabel = new TextRenderable(renderer, { content: ' Client ID:', fg: 'red' });
  const clientIdInput = new InputRenderable(renderer, {
    placeholder: 'paste your Google OAuth Client ID…',
    width: '100%',
  });

  const clientSecretLabel = new TextRenderable(renderer, {
    content: ' Client Secret:',
    fg: 'red',
  });
  const clientSecretInput = new InputRenderable(renderer, {
    placeholder: 'paste your Google OAuth Client Secret…',
    width: '100%',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] switch field   [Enter] save   [Esc] cancel',
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
    title: ' YouTube Setup ',
  });

  box.add(instructions);
  box.add(clientIdLabel);
  box.add(clientIdInput);
  box.add(clientSecretLabel);
  box.add(clientSecretInput);
  box.add(hint);

  renderer.root.add(box);

  activeModal = { box, focusIndex: 0 };

  const inputs = [clientIdInput, clientSecretInput];
  inputs[0].focus();

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    if (save) {
      const clientId = clientIdInput.value.trim();
      const clientSecret = clientSecretInput.value.trim();
      saveConfig({
        platforms: {
          youtube: {
            ...(clientId ? { clientId } : {}),
            ...(clientSecret ? { clientSecret } : {}),
          },
        },
      }).then(() => {
        lastMessages.push(
          '[system] YouTube credentials saved. Run /connect youtube to authenticate.',
        );
        updateUI(lastMessages);
      });
    } else {
      lastMessages.push('[system] YouTube setup cancelled.');
      updateUI(lastMessages);
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
    if (sequence === '\t') {
      inputs[activeModal.focusIndex].blur();
      activeModal.focusIndex = (activeModal.focusIndex + 1) % inputs.length;
      inputs[activeModal.focusIndex].focus();
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

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeModal) closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function openObsConnectModal(): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

  const info = obsService.getConnectionInfo();
  const statusLabel = obsService.isConnected() ? '● Connected' : '○ Disconnected';

  const instructions = new TextRenderable(renderer, {
    content:
      ` OBS status: ${statusLabel}\n\n` +
      ' To enable the OBS WebSocket server:\n' +
      '  OBS → Tools → WebSocket Server Settings → Enable WebSocket server\n' +
      '  Set the port and password below to match.\n',
    fg: 'white',
  });

  const hostLabel = new TextRenderable(renderer, { content: ' Host:', fg: 'yellow' });
  const hostInput = new InputRenderable(renderer, {
    placeholder: 'e.g. localhost',
    width: '100%',
    value: info.host,
  });

  const portLabel = new TextRenderable(renderer, { content: ' Port:', fg: 'yellow' });
  const portInput = new InputRenderable(renderer, {
    placeholder: 'e.g. 4455',
    width: '100%',
    value: String(info.port),
  });

  const passwordLabel = new TextRenderable(renderer, { content: ' Password:', fg: 'yellow' });
  const passwordInput = new InputRenderable(renderer, {
    placeholder: '(leave blank if no password)',
    width: '100%',
    value: info.password ?? '',
  });

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] switch field   [Enter] connect   [Esc] cancel',
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
    borderColor: 'yellow',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' OBS WebSocket ',
  });

  box.add(instructions);
  box.add(hostLabel);
  box.add(hostInput);
  box.add(portLabel);
  box.add(portInput);
  box.add(passwordLabel);
  box.add(passwordInput);
  box.add(hint);

  renderer.root.add(box);

  activeModal = { box, focusIndex: 0 };

  const inputs = [hostInput, portInput, passwordInput];
  inputs[0].focus();

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();

    if (!save) {
      return;
    }

    const host = hostInput.value.trim() || 'localhost';
    const port = Number.parseInt(portInput.value.trim(), 10) || 4455;
    const password = passwordInput.value.trim() || null;

    saveConfig({
      obs: { websocket: { server: host, port: String(port), password: password ?? '' } },
    }).then(async () => {
      obsService.reconfigure(host, port, password);
      lastMessages.push(`[obs] Saved — ws://${host}:${port}  password: ${password ?? '(none)'}`);
      if (obsService.isConnected()) {
        await obsService.disconnect();
      }
      lastMessages.push('[obs] Connecting...');
      updateUI(lastMessages);
      try {
        await obsService.connect();
        lastMessages.push('[obs] Connected to OBS');
      } catch {
        lastMessages.push(
          '[obs] Connection failed — is OBS running with WebSocket server enabled?',
        );
      }
      updateUI(lastMessages);
    });
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
    if (sequence === '\t') {
      inputs[activeModal.focusIndex].blur();
      activeModal.focusIndex = (activeModal.focusIndex + 1) % inputs.length;
      inputs[activeModal.focusIndex].focus();
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

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeModal) closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function openYouTubeStreamKeyModal(onSaved?: () => void): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

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
  activeModal = { box, focusIndex: 0 };
  keyInput.focus();

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    if (save) {
      const key = keyInput.value.trim();
      if (key) {
        saveConfig({ platforms: { youtube: { streamKey: key } } }).then(() => {
          youtube.setStreamKey(key);
          lastMessages.push('[system] YouTube stream key saved.');
          updateUI(lastMessages);
          onSaved?.();
        });
      } else {
        lastMessages.push('[system] YouTube stream key setup cancelled (empty value).');
        updateUI(lastMessages);
      }
    } else {
      lastMessages.push('[system] YouTube stream key setup cancelled.');
      updateUI(lastMessages);
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
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
    if (key.name === 'escape' && activeModal) closeModal(false);
  }) as any;
}

function maskStreamKey(key: string): string {
  const parts = key.split('-');
  if (parts.length >= 2) {
    return `${parts[0]}-${'•'.repeat(4)}${parts.length > 2 ? `-${'•'.repeat(4)}` : ''}`;
  }
  return `${key.slice(0, 4)}••••`;
}

function openYouTubeStreamPickerModal(onSaved?: () => void): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

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
  activeModal = { box, focusIndex: 0 };

  type StreamEntry = { title: string; streamKey: string };
  let streams: StreamEntry[] = [];
  const itemNodes: TextRenderable[] = [];

  function itemContent(entry: StreamEntry, selected: boolean): string {
    const prefix = selected ? ' ▶ ' : '   ';
    const title = entry.title.slice(0, 36).padEnd(36, ' ');
    return `${prefix}${title}  ${maskStreamKey(entry.streamKey)}`;
  }

  function updateSelection(newIdx: number): void {
    if (!activeModal) return;
    const oldIdx = activeModal.focusIndex;
    if (itemNodes[oldIdx]) {
      itemNodes[oldIdx].content = itemContent(streams[oldIdx]!, false);
      itemNodes[oldIdx].fg = 'white';
    }
    activeModal.focusIndex = newIdx;
    if (itemNodes[newIdx]) {
      itemNodes[newIdx].content = itemContent(streams[newIdx]!, true);
      itemNodes[newIdx].fg = 'cyan';
    }
  }

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    if (save && streams.length > 0) {
      const selected = streams[activeModal.focusIndex];
      if (selected) {
        saveConfig({ platforms: { youtube: { streamKey: selected.streamKey } } }).then(() => {
          youtube.setStreamKey(selected.streamKey);
          lastMessages.push(`[system] YouTube stream key set to "${selected.title}".`);
          updateUI(lastMessages);
          onSaved?.();
        });
      }
    } else if (!save) {
      lastMessages.push('[system] YouTube stream key selection cancelled.');
      updateUI(lastMessages);
    }
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
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

  youtube
    .listStreams()
    .then((result) => {
      if (!activeModal) return;
      box.remove(statusText.id);

      if (result.length === 0) {
        renderer.removeInputHandler(modalKeyHandler);
        renderer.root.remove(box.id);
        activeModal = null;
        uiNodes?.inputEl.focus();
        openYouTubeStreamKeyModal(onSaved);
        return;
      }

      streams = result;
      for (let i = 0; i < streams.length; i++) {
        const node = new TextRenderable(renderer, {
          content: itemContent(streams[i]!, i === 0),
          fg: i === 0 ? 'cyan' : 'white',
        });
        itemNodes.push(node);
        box.add(node);
      }
    })
    .catch(() => {
      if (!activeModal) return;
      box.remove(statusText.id);
      const errorText = new TextRenderable(renderer, {
        content: ' Failed to fetch stream keys. Check your connection and try again.',
        fg: 'yellow',
      });
      box.add(errorText);
      hint.content = ' [Esc] close';
    });
}

function openYouTubePlaylistPickerModal(
  onSelect: (id: string, title: string) => void,
  onCancel: () => void,
): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

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
  activeModal = { box, focusIndex: 0 };

  type PlaylistEntry = { id: string; title: string };
  let playlists: PlaylistEntry[] = [];
  const itemNodes: TextRenderable[] = [];

  function itemContent(entry: PlaylistEntry, selected: boolean): string {
    return `${selected ? ' ▶ ' : '   '}${entry.title}`;
  }

  function updateSelection(newIdx: number): void {
    if (!activeModal) return;
    const oldIdx = activeModal.focusIndex;
    if (itemNodes[oldIdx]) {
      itemNodes[oldIdx].content = itemContent(playlists[oldIdx]!, false);
      itemNodes[oldIdx].fg = 'white';
    }
    activeModal.focusIndex = newIdx;
    if (itemNodes[newIdx]) {
      itemNodes[newIdx].content = itemContent(playlists[newIdx]!, true);
      itemNodes[newIdx].fg = 'cyan';
    }
  }

  function closeModal(save: boolean): void {
    if (!activeModal) return;
    const idx = activeModal.focusIndex;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    if (save && playlists[idx]) onSelect(playlists[idx]!.id, playlists[idx]!.title);
    else onCancel();
  }

  const modalKeyHandler = (sequence: string): boolean => {
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

  youtube
    .listPlaylists()
    .then((result) => {
      if (!activeModal) return;
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
          content: itemContent(playlists[i]!, i === 0),
          fg: i === 0 ? 'cyan' : 'white',
        });
        itemNodes.push(node);
        box.add(node);
      }
    })
    .catch(() => {
      if (!activeModal) return;
      box.remove(statusText.id);
      box.add(
        new TextRenderable(renderer, { content: ' Failed to fetch playlists.', fg: 'yellow' }),
      );
      hint.content = ' [Esc] close';
    });
}

function openYouTubeSetupModal(): void {
  if (!uiNodes || activeModal) return;
  const { renderer } = uiNodes;

  const saved = youtube.getSetup();

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
  const state: Record<ToggleKey, boolean> = {
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
  let playlistId = saved.defaultPlaylist.playlistId;

  const LABELS: Record<ToggleKey, string> = {
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

  function badge(key: ToggleKey, focused: boolean): string {
    const mark = state[key] ? '[ON ]' : '[OFF]';
    return `${focused ? '▶ ' : '  '}${mark} ${LABELS[key]}`;
  }

  // Toggle nodes
  const toggleNodes: Record<ToggleKey, TextRenderable> = {
    defaultPlaylist: new TextRenderable(renderer, {
      content: badge('defaultPlaylist', true),
      fg: 'cyan',
    }),
    subjectPlaylist: new TextRenderable(renderer, {
      content: badge('subjectPlaylist', false),
      fg: 'white',
    }),
    chaptering: new TextRenderable(renderer, { content: badge('chaptering', false), fg: 'white' }),
    clearMarkersOnNewStream: new TextRenderable(renderer, {
      content: badge('clearMarkersOnNewStream', false),
      fg: 'white',
    }),
    tags: new TextRenderable(renderer, { content: badge('tags', false), fg: 'white' }),
    description: new TextRenderable(renderer, {
      content: badge('description', false),
      fg: 'white',
    }),
    subjectTitle: new TextRenderable(renderer, {
      content: badge('subjectTitle', false),
      fg: 'white',
    }),
    defaultMarkerAtStart: new TextRenderable(renderer, {
      content: badge('defaultMarkerAtStart', false),
      fg: 'white',
    }),
    markerSyncDelay: new TextRenderable(renderer, {
      content: badge('markerSyncDelay', false),
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
    saved.markerSyncDelay.offsetSeconds !== 0
      ? String(saved.markerSyncDelay.offsetSeconds)
      : '';
  const markerSyncDelayHint = new TextRenderable(renderer, {
    content: '  ↳ adds this offset (seconds, may be negative) to every marker timestamp',
    fg: 'gray',
  });

  const hint = new TextRenderable(renderer, {
    content: '  [Tab] navigate  [Space] toggle  [Ctrl+P] pick playlist  [Enter] save  [Esc] cancel',
    fg: 'gray',
  });

  // Focusable item list: toggles and inputs interleaved
  type FocusItem = { kind: 'toggle'; key: ToggleKey } | { kind: 'input'; node: InputRenderable };

  const items: FocusItem[] = [
    { kind: 'toggle', key: 'defaultPlaylist' }, // 0
    { kind: 'input', node: playlistInput }, // 1
    { kind: 'toggle', key: 'subjectPlaylist' }, // 2
    { kind: 'toggle', key: 'chaptering' }, // 3
    { kind: 'toggle', key: 'clearMarkersOnNewStream' }, // 4
    { kind: 'toggle', key: 'defaultMarkerAtStart' }, // 5
    { kind: 'input', node: defaultMarkerMessageInput }, // 6
    { kind: 'toggle', key: 'markerSyncDelay' }, // 7
    { kind: 'input', node: markerDelayInput }, // 8
    { kind: 'toggle', key: 'tags' }, // 9
    { kind: 'toggle', key: 'description' }, // 10
    { kind: 'toggle', key: 'subjectTitle' }, // 11
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
  activeModal = { box, focusIndex: 0 };
  items[0]; // initial focus already set via badge('defaultPlaylist', true)

  let focusIdx = 0;

  function blurItem(idx: number): void {
    const item = items[idx]!;
    if (item.kind === 'toggle') {
      toggleNodes[item.key].content = badge(item.key, false);
      toggleNodes[item.key].fg = state[item.key] ? 'white' : 'gray';
    } else {
      item.node.blur();
    }
  }

  function focusItem(idx: number): void {
    const item = items[idx]!;
    if (item.kind === 'toggle') {
      toggleNodes[item.key].content = badge(item.key, true);
      toggleNodes[item.key].fg = 'cyan';
    } else {
      item.node.focus();
    }
  }

  function advanceFocus(delta: number): void {
    blurItem(focusIdx);
    focusIdx = (focusIdx + delta + items.length) % items.length;
    if (activeModal) activeModal.focusIndex = focusIdx;
    focusItem(focusIdx);
  }

  function suspendAndPickPlaylist(): void {
    const savedIdx = focusIdx;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;

    openYouTubePlaylistPickerModal(
      (id, title) => {
        playlistId = id;
        playlistInput.value = title;
        state.defaultPlaylist = true;
        renderer.root.add(box);
        focusIdx = 1;
        activeModal = { box, focusIndex: focusIdx };
        renderer.prependInputHandler(modalKeyHandler);
        focusItem(1);
      },
      () => {
        renderer.root.add(box);
        focusIdx = savedIdx;
        activeModal = { box, focusIndex: focusIdx };
        renderer.prependInputHandler(modalKeyHandler);
        focusItem(focusIdx);
      },
    );
  }

  async function closeModal(save: boolean): Promise<void> {
    if (!activeModal) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();

    if (!save) {
      lastMessages.push('[system] YouTube setup cancelled.');
      updateUI(lastMessages);
      return;
    }

    await settings.set('platforms.youtube.setup', {
      defaultPlaylist: {
        enabled: state.defaultPlaylist,
        playlistId,
        playlistTitle: playlistInput.value.trim(),
      },
      subjectPlaylist: { enabled: state.subjectPlaylist },
      chaptering: { enabled: state.chaptering },
      clearMarkersOnNewStream: { enabled: state.clearMarkersOnNewStream },
      tags: { enabled: state.tags },
      description: { enabled: state.description },
      subjectTitle: { enabled: state.subjectTitle },
      defaultMarkerAtStart: {
        enabled: state.defaultMarkerAtStart,
        message: defaultMarkerMessageInput.value.trim() || 'start',
      },
      markerSyncDelay: {
        enabled: state.markerSyncDelay,
        offsetSeconds: parseInt(markerDelayInput.value.trim(), 10) || 0,
      },
    });
    lastMessages.push('[system] YouTube setup saved.');
    updateUI(lastMessages);
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
    if (sequence === '\t') {
      advanceFocus(1);
      return true;
    }
    if (sequence === '\x1b[Z') {
      advanceFocus(-1);
      return true;
    } // Shift+Tab
    if (sequence === ' ') {
      const item = items[focusIdx]!;
      if (item.kind === 'toggle') {
        state[item.key] = !state[item.key];
        toggleNodes[item.key].content = badge(item.key, true);
        return true;
      }
      return false;
    }
    if (sequence === '\x10') {
      // Ctrl+P
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

function openStreamModal(preselected: string[]): void {
  if (!uiNodes || activeStreamModal || activeModal || activeSettingsModal) return;
  const { renderer } = uiNodes;

  const selectedPlatforms = new Set(preselected.length > 0 ? preselected : [...platforms]);
  const savedStream = settings.get('stream', {});

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

  const modal: StreamModal = { box, focusIndex: 0, selectedPlatforms, op: 'update' };
  activeStreamModal = modal;

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
    subjectHint.visible = hasYT && subjectHint.content !== '';
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

    const items: StreamFocusItem[] = [{ kind: 'platforms' }, { kind: 'input', node: titleInput }];
    if (hasYT) items.push({ kind: 'yt-category' });
    if (hasYT) items.push({ kind: 'input', node: subjectInput });
    if (hasTwitch) items.push({ kind: 'input', node: twitchGameInput });
    if (hasKick) items.push({ kind: 'input', node: kickCatInput });
    items.push({ kind: 'input', node: tagsInput });
    if (hasYT) items.push({ kind: 'input', node: descInput });
    if (hasTwitch) items.push({ kind: 'input', node: notifInput });
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

  updateConditionalVisibility();
  focusCurrent();

  async function closeModal(confirm: boolean): Promise<void> {
    if (!activeStreamModal) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeStreamModal = null;
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
    uiNodes?.inputEl.focus();

    if (!confirm) {
      return;
    }

    const targetPlatforms = [...selectedPlatforms];
    if (targetPlatforms.length === 0) {
      lastMessages.push('[stream] No platforms selected.');
      updateUI(lastMessages);
      return;
    }

    const rawTags = tagsInput.value
      .split(',')
      .map((t) => t.trim().replace(/\s+/g, ''))
      .filter(Boolean);

    const newMeta: Record<string, any> = {
      title: titleInput.value.trim() || undefined,
      game: selectedPlatforms.has('youtube') ? subjectInput.value.trim() || undefined : undefined,
      youtubeCategory: selectedPlatforms.has('youtube') ? YT_CATS[ytCatIdx] : undefined,
      twitchGame: selectedPlatforms.has('twitch')
        ? twitchGameInput.value.trim() || undefined
        : undefined,
      kickCategory: selectedPlatforms.has('kick')
        ? kickCatInput.value.trim() || undefined
        : undefined,
      tags: rawTags.length > 0 ? rawTags : undefined,
      description: selectedPlatforms.has('youtube')
        ? descInput.value.trim() || undefined
        : undefined,
      notification: selectedPlatforms.has('twitch')
        ? notifInput.value.trim() || undefined
        : undefined,
    };

    const { changed, merged } = buildTargetedStreamMetadataUpdate(
      savedStream,
      selectedPlatforms,
      newMeta,
    );

    if (Object.keys(changed).length === 0) {
      lastMessages.push('[stream] No changes.');
      updateUI(lastMessages);
      return;
    }

    lastMessages.push(`[stream] Updating on: ${targetPlatforms.join(', ')}…`);
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
    if (!activeStreamModal) return false;
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
      if (sequence === '\x1b[D') {
        ytCatIdx = (ytCatIdx - 1 + YT_CATS.length) % YT_CATS.length;
        ytCatText.content = ytCatContent(true);
        return true;
      }
      if (sequence === '\x1b[C') {
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
    if (key.name === 'escape' && activeStreamModal) closeModal(false);
  };
  for (const input of [
    titleInput,
    subjectInput,
    twitchGameInput,
    kickCatInput,
    tagsInput,
    descInput,
    notifInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }

  function scheduleSubjectSearch(q: string, delayMs = 300): void {
    subjectSuggestions = [];
    subjectSelectedIdx = -1;
    if (subjectFetchTimer) { clearTimeout(subjectFetchTimer); subjectFetchTimer = null; }
    if (q.length < 2) { subjectHint.content = ''; subjectHint.visible = false; return; }
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
    if (catFetchTimer) { clearTimeout(catFetchTimer); catFetchTimer = null; }
    if (q.length < 2) { twitchCatHint.content = ''; twitchCatHint.visible = false; return; }
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
    if (kickCatFetchTimer) { clearTimeout(kickCatFetchTimer); kickCatFetchTimer = null; }
    if (q.length < 2) { kickCatHint.content = ''; kickCatHint.visible = false; return; }
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
    if (isNavigatingSubject) { isNavigatingSubject = false; return; }
    scheduleSubjectSearch(subjectInput.value.trim());
  });

  twitchGameInput.on(InputRenderableEvents.INPUT, () => {
    if (isNavigatingTwitch) { isNavigatingTwitch = false; return; }
    scheduleTwitchSearch(twitchGameInput.value.trim());
  });

  kickCatInput.on(InputRenderableEvents.INPUT, () => {
    if (isNavigatingKick) { isNavigatingKick = false; return; }
    scheduleKickSearch(kickCatInput.value.trim());
  });
}

// Keys of this object are the single source of truth for TUI command names —
// initTuiCommands() below syncs them into the autocomplete module at startup.
const commandHandlers: Record<
  string,
  (parts: string[], emit: (line: string) => void) => Promise<void>
> = {
  '/connect': async (parts, emit) => {
    const platform = (parts[1] ?? '').toLowerCase();
    if (!platform) {
      emit('[system] Usage: /connect <youtube|twitch|kick|obs>');
      return;
    }
    if (platform === 'obs') {
      openObsConnectModal();
      return;
    }
    const provider =
      platform === 'youtube'
        ? youtube
        : platform === 'twitch'
          ? twitch
          : platform === 'kick'
            ? kick
            : null;
    if (provider) {
      emit(`[system] Authenticating ${platform}...`);
      try {
        const res = await provider.authenticate();
        if (res?.success) {
          emit(`[system] ${platform} authentication succeeded`);
          updateUI(lastMessages);
          if (platform === 'youtube' && !youtube.getStreamKey()) {
            openYouTubeStreamPickerModal();
            return;
          }
        } else if (res?.error?.startsWith('oauth_required:')) {
          const authUrl = res.error.slice('oauth_required:'.length);
          const fallbackUrl = `http://localhost:${process.env.YASH_PORT || 3000}/api/${platform}/auth`;
          emit(`[system] Opening browser for ${platform} OAuth...`);
          const proc = Bun.spawn(['xdg-open', authUrl]);
          proc.exited.then((code) => {
            if (code !== 0) {
              lastMessages.push(`[system] Browser failed to open — visit ${fallbackUrl} manually`);
              updateUI(lastMessages);
            }
          });
        } else if (platform === 'twitch' && res?.error === 'Twitch credentials not configured') {
          openTwitchSetupModal();
        } else if (platform === 'kick' && res?.error === 'Kick credentials not configured') {
          openKickSetupModal();
        } else if (platform === 'youtube' && res?.error === 'YouTube credentials not configured') {
          openYouTubeCredentialsModal();
        } else {
          emit(`[system] ${platform} authentication failed: ${res?.error ?? 'unknown error'}`);
        }
      } catch (err) {
        emit(`[system] ${platform} authentication error: ${String(err)}`);
      }
    } else {
      emit(`[system] Unknown platform: ${platform}`);
    }
  },

  '/msg': async (parts, emit) => {
    const target = parts[1]?.toLowerCase();
    const text = parts.slice(2).join(' ');
    const validTargets = ['all', 'youtube', 'twitch', 'kick'];
    if (target && validTargets.includes(target) && text) {
      const targetPlatforms = target === 'all' ? [] : [target];
      try {
        await chatService.sendMessage(text, targetPlatforms);
        emit(`[you → ${target}] ${text}`);
      } catch (err) {
        emit(`[system] Failed to send message: ${String(err)}`);
      }
    } else {
      emit('[system] Usage: /msg <all|youtube|twitch|kick> <text>');
    }
  },

  '/marker': async (parts, emit) => {
    const rawParts = parts.slice(1);
    const rawArgs = rawParts.join(' ');
    const pipeIdx = rawArgs.indexOf('|');
    if (pipeIdx !== -1) {
      const tsRaw = rawArgs.slice(pipeIdx + 1).trim();
      if (tsRaw && Number.isNaN(Number.parseFloat(tsRaw))) {
        emit(`[marker] Invalid timestamp "${tsRaw}" — must be a non-negative number`);
        updateUI(lastMessages);
        return;
      }
    }
    const { description, timestamp } = parseMarkerArgs(rawParts);

    try {
      const results = await Promise.allSettled([
        youtube.createMarker(description, timestamp),
        twitch.createMarker(description, timestamp),
        kick.createMarker(description, timestamp),
      ]);
      const labels = ['youtube', 'twitch', 'kick'];
      const summary = formatMarkerCreationSummary(
        results.map((result, index) => ({
          platform: labels[index] ?? `provider-${index + 1}`,
          marker: result.status === 'fulfilled' ? result.value : null,
          error: result.status === 'rejected' ? `error: ${String(result.reason)}` : undefined,
        })),
      );
      emit(`[marker] ${summary}`);
    } catch (err) {
      emit(`[marker] Error: ${String(err)}`);
    }
    updateUI(lastMessages);
  },

  '/markers': async (parts, emit) => {
    if ((parts[1] ?? '').toLowerCase() === 'clear') {
      if (parts.length > 2) {
        emit('[markers] Usage: /markers clear | [all|youtube|twitch|kick] [limit]');
        updateUI(lastMessages);
        return;
      }

      try {
        await youtube.clearPersistedMarkers();
        emit('[markers] youtube: cleared persisted markers');
      } catch (err) {
        emit(`[markers] youtube: clear error: ${String(err)}`);
      }
      updateUI(lastMessages);
      return;
    }

    const firstArg = (parts[1] ?? '').toLowerCase();
    const hasExplicitPlatform = ['all', 'youtube', 'twitch', 'kick'].includes(firstArg);
    const platformArg = hasExplicitPlatform ? firstArg : 'all';
    const limitToken = hasExplicitPlatform ? parts[2] : parts[1];
    const limit = limitToken ? Number.parseInt(limitToken, 10) : 20;

    if (limitToken && (Number.isNaN(limit) || limit <= 0)) {
      emit('[markers] Usage: /markers clear | [all|youtube|twitch|kick] [limit]');
      updateUI(lastMessages);
      return;
    }

    const targets = platformArg === 'all' ? ['youtube', 'twitch', 'kick'] : [platformArg];
    for (const target of targets) {
      try {
        const provider = target === 'youtube' ? youtube : target === 'twitch' ? twitch : kick;
        const markers = await provider.getMarkers({ limit });
        if (markers.length === 0) {
          emit(`[markers] ${target}: none`);
          continue;
        }
        emit(`[markers] ${target}:`);
        for (const marker of markers) {
          emit(
            `[markers]   ${formatMarkerPosition(marker.positionInSeconds)}  ${marker.description || '(untitled)'}  [${marker.id}]`,
          );
        }
      } catch (err) {
        emit(`[markers] ${target}: error: ${String(err)}`);
      }
    }
  },

  '/settings': async (parts, emit) => {
    const op = parts[1];
    if (!op) {
      openSettingsModal();
    } else if (op === 'get' && parts[2]) {
      const key = parts[2];
      const val = getSettingValue(key);
      emit(`[settings] ${key} = ${JSON.stringify(val)}`);
    } else if (op === 'set' && parts[2] && parts[3]) {
      const key = parts[2];
      const rawValue = parts.slice(3).join(' ');
      const value = parseSettingsValue(rawValue);
      const changedKeys = await persistSettingEntries([{ key, value }]);
      if (changedKeys.length === 0) emit('[settings] No changes.');
      else emit(`[settings] set ${key} = ${JSON.stringify(value)}`);
    } else {
      emit('[system] Usage: /settings | /settings get <key> | /settings set <key> <json-value>');
      emit(
        '[system] Common keys: stream.title, stream.description, chat.maxHistorySize, demo, title.visible, logs.visible, logs.height, logs.tail, viewers.visible, viewers.mode, messages.position, chat.timestamps.visible, events.visible, events.tail, events.width, platforms.<provider>.showViewers, platforms.youtube.setup.*',
      );
    }
  },

  '/chat': async (parts, emit) => {
    const result = runChatClearCommand(parts, {
      lastMessages,
      lastRawMessages,
      classifyLine: classifyChatLine,
      resetBrowseSelection: () => {
        browseModeActive = false;
        browseSelectedIdx = null;
      },
    });
    emit(result);
    updateUI(lastMessages);
  },

  '/logs': async (parts, emit) => {
    const op = parts[1];
    if (op === 'clear') {
      try {
        logCollector.clear();
        emit('[logs] cleared');
      } catch {
        emit('[logs] failed to clear');
      }
    } else if (op === 'tail' && parts[2]) {
      const n = parseInt(parts[2], 10) || 0;
      if (n > 0) {
        await settings.set('logs.tail', n);
        emit(`[logs] tail set to ${n}`);
      } else {
        emit('[logs] Usage: /logs tail <n>');
      }
    } else if (op === 'visible' && parts[2]) {
      const v = String(parts[2]).toLowerCase();
      if (v === 'true' || v === 'false') {
        await settings.set('logs.visible', v === 'true');
        emit(`[logs] visible set to ${v}`);
      } else {
        emit('[logs] Usage: /logs visible <true|false>');
      }
    } else {
      emit('[logs] Usage: /logs clear | /logs tail <n>');
    }
  },

  '/stream': async (parts, _emit) => {
    const specified = parts.slice(1).filter((p) => platforms.includes(p));
    const youtubeTargeted = specified.length === 0 || specified.includes('youtube');
    if (youtubeTargeted && youtube.isAuthenticated() && !youtube.getStreamKey()) {
      openYouTubeStreamPickerModal(() => openStreamModal(specified));
    } else {
      openStreamModal(specified);
    }
  },

  '/activity': async (_parts, _emit) => {
    openActivityModal();
  },

  '/setup-youtube': async (_parts, emit) => {
    if (!youtube.isAuthenticated()) {
      emit('[system] YouTube is not authenticated. Run /connect youtube first.');
      updateUI(lastMessages);
    } else {
      openYouTubeSetupModal();
    }
  },

  '/exit': async (_parts, _emit) => {
    isRunning = false;
    authService.stopAutoRefresh();
    await obsService.disconnect();
    cliRenderer?.destroy();
    process.exit(0);
  },

  '/help': async (_parts, emit) => {
    emit('[help] Available commands:');
    emit(
      '[help] Status symbols: ✓ = authenticated and online, ○ = authenticated but offline, ✗ = not authenticated',
    );
    emit('[help]   /connect <youtube|twitch|kick|obs>  — authenticate a platform or configure OBS');
    emit('[help]   /stream [platform…]  — edit stream info (opens modal, persists to settings)');
    emit(
      '[help]   /setup-youtube  — configure YouTube stream options (playlists, tags, chapters, description)',
    );
    emit('[help]   /msg <all|youtube|twitch|kick> <text>  — send a message');
    emit(
      '[help]   /marker [description] [| timestamp_s]  — place a stream marker on all platforms',
    );
    emit('[help]       e.g.  /marker Intro | 0');
    emit('[help]       e.g.  /marker Q&A | 3723    (timestamp in seconds, YouTube only)');
    emit(
      '[help]   /markers clear | [all|youtube|twitch|kick] [limit]  — list markers or clear YouTube chapters',
    );
    emit('[help]   /info  — show current stream/channel info from all providers');
    emit(
      '[help]   /inject <twitch|youtube|kick> <username> <message>  — inject a fake chat message for offline testing',
    );
    emit(
      '[help]   /chatter <@username>  — open chatter info modal for the most recent message from that user',
    );
    emit(
      '[help]   /chat clear <all|messages|events|logs>  — clear matching entries from Chat only',
    );
    emit('[help]   /activity  — open the activity bar modal (follows, subs, cheers, raids)');
    emit('[help]   /history  — browse all stream broadcasts and search message history');
    emit('[help]   /history search <query>  — open history with search pre-filled');
    emit('[help]   /history user <@name>  — search history filtered to a user');
    emit('[help]   /settings  — open the settings modal');
    emit('[help]   /settings get <key>  — get a setting value');
    emit('[help]   /settings set <key> <value>  — set a setting value');
    emit('[help]   /logs clear | tail <n> | visible <true|false>  — manage logs');
    emit('[help]   /exit  — exit the app');
    emit('[help]   /help  — show this help');
  },

  '/info': async (_parts, emit) => {
    for (const platform of ['youtube', 'twitch', 'kick']) {
      try {
        const info = await fetchPlatformInfo(platform);
        emit(`[system] ${platform}: ${formatInfoValue(info)}`);
      } catch (err) {
        emit(`[system] ${platform}: error: ${String(err)}`);
      }
    }
  },

  '/chatter': async (parts, emit) => {
    const target = (parts[1] ?? '').replace(/^@/, '').toLowerCase();
    if (!target) {
      emit('[chatter] Usage: /chatter <@username>');
    } else {
      const rawMsg = [...lastRawMessages]
        .reverse()
        .find((m) => m.username.toLowerCase() === target);
      if (!rawMsg) {
        emit(`[chatter] No recent message found from @${target}`);
      } else {
        openChatterInfoModal(rawMsg);
      }
    }
  },

  '/history': async (parts, emit) => {
    const sub = parts[1]?.toLowerCase();
    if (sub === 'search') {
      const query = parts.slice(2).join(' ');
      openHistoryModal({ query });
    } else if (sub === 'user') {
      const username = parts.slice(2).join(' ').replace(/^@/, '');
      openHistoryModal({ query: username });
    } else if (!sub) {
      openHistoryModal();
    } else {
      emit('[history] Usage: /history  |  /history search <query>  |  /history user <@name>');
    }
  },

  '/inject': async (parts, emit) => {
    const INJECT_PLATFORMS = ['twitch', 'youtube', 'kick'];
    const platform = (parts[1] ?? '').toLowerCase();
    const username = parts[2] ?? '';
    const messageText = parts.slice(3).join(' ');

    if (!platform || !INJECT_PLATFORMS.includes(platform)) {
      emit(
        `[inject] Invalid or missing platform. Usage: /inject <twitch|youtube|kick> <username> <message>`,
      );
    } else if (!username) {
      emit('[inject] Missing username. Usage: /inject <platform> <username> <message>');
    } else if (!messageText) {
      emit('[inject] Missing message text. Usage: /inject <platform> <username> <message>');
    } else {
      const INJECT_COLORS = ['#FF7F50', '#9370DB', '#3CB371', '#FF69B4', '#00CED1', '#FFD700'];
      const color = INJECT_COLORS[username.length % INJECT_COLORS.length];
      chatService.injectMessage({
        id: `inject_${Date.now()}`,
        platform,
        userId: `${platform}_test_${username.toLowerCase()}`,
        username,
        message: messageText,
        timestamp: Date.now(),
        color,
      });
    }
  },
};
initTuiCommands(Object.keys(commandHandlers).sort());

async function handleCommand(trimmed: string): Promise<void> {
  if (!trimmed.startsWith('/')) {
    const targetPlatforms = selectedMessageTarget === 'all' ? [] : [selectedMessageTarget];
    try {
      await chatService.sendMessage(trimmed, targetPlatforms);
      lastMessages.push(transformOutgoingMessage(selectedMessageTarget, trimmed));
    } catch (err) {
      lastMessages.push(`[system] Failed to send message: ${String(err)}`);
    }
    return;
  }

  const emit = (line: string) => lastMessages.push(line);
  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const handler = commandHandlers[cmd];
  if (handler) {
    await handler(parts, emit);
  } else {
    emit(`[system] Unknown command: ${trimmed}`);
  }
}

async function handleCommandForCli(trimmed: string): Promise<string> {
  return runIpcCommand(trimmed, commandHandlers, pushEvent);
}

function openSettingsModal(): void {
  if (!uiNodes || activeStreamModal || activeModal || activeSettingsModal) return;
  const { renderer } = uiNodes;

  const draft = {
    demo: boolSetting(settings.get('demo', false), false),
    titleVisible: boolSetting(settings.get('title.visible', false), false),
    viewersVisible: boolSetting(settings.get('viewers.visible', true), true),
    viewersMode: String(settings.get('viewers.mode', 'per-platform') ?? 'per-platform'),
    messagesPosition: String(settings.get('messages.position', 'bottom') ?? 'bottom'),
    chatTimestampsVisible: boolSetting(settings.get('chat.timestamps.visible', true), true),
    chatMaxHistorySize: String(numSetting(settings.get('chat.maxHistorySize', 1000), 1000)),
    eventsVisible: boolSetting(settings.get('events.visible', true), true),
    eventsTail: String(numSetting(settings.get('events.tail', 15), 15)),
    eventsWidth: String(settings.get('events.width', '30%') ?? '30%'),
    logsVisible: boolSetting(settings.get('logs.visible', true), true),
    logsHeight: String(numSetting(settings.get('logs.height', 15), 15)),
    logsTail: String(numSetting(settings.get('logs.tail', 20), 20)),
    youtubeShowViewers: boolSetting(settings.get('platforms.youtube.showViewers', true), true),
    twitchShowViewers: boolSetting(settings.get('platforms.twitch.showViewers', true), true),
    kickShowViewers: boolSetting(settings.get('platforms.kick.showViewers', true), true),
    activityVisible: boolSetting(settings.get('activity.visible', true), true),
    activityMode: String(settings.get('activity.mode', 'permanent') ?? 'permanent'),
    activityTimeout: String(numSetting(settings.get('activity.timeout', 10), 10)),
  };
  const initialSettingsResult = validateTuiSettingsDraft(draft);
  const initialEntries = initialSettingsResult.values
    ? buildTuiSettingsEntries(initialSettingsResult.values)
    : [];
  const initialValueByKey = new Map(initialEntries.map((entry) => [entry.key, entry.value]));

  function makeLabel(text: string): TextRenderable {
    return new TextRenderable(renderer, { content: text, fg: 'gray' });
  }

  function makeToggleRow(label: string, value: boolean, focused: boolean): string {
    return `${focused ? '▶' : ' '} ${label}: ${value ? 'ON' : 'OFF'}`;
  }

  function makeEnumRow(label: string, value: string, focused: boolean): string {
    return `${focused ? '▶' : ' '} ${label}: ${value}`;
  }

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '4%',
    left: '8%',
    width: '84%',
    height: '90%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 0,
    title: ' Settings ',
  });

  // Scrollable content area — everything below the intro header lives here
  const contentScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
  });
  const contentBox = new BoxRenderable(renderer, {
    flexDirection: 'column',
    gap: 1,
    width: '100%',
  });

  const intro = new TextRenderable(renderer, {
    content:
      ' Tab/Shift+Tab move focus. Space or ◄/► toggles/cycles rows. Enter saves all changes. Esc cancels.',
    fg: 'gray',
  });
  const displayHeading = new TextRenderable(renderer, {
    content: ' Display',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const demoRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const titleVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const viewersVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const viewersModeRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const messagesPositionRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const chatTimestampsRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const historySizeLabel = makeLabel('  chat.maxHistorySize: keep the last N chat lines in memory');
  const historySizeInput = new InputRenderable(renderer, {
    placeholder: '1000',
    width: '100%',
  });
  const historySizeInputRow = createIndentedInputRow(renderer, historySizeInput, '    ');
  historySizeInput.value = draft.chatMaxHistorySize;

  const sidebarHeading = new TextRenderable(renderer, {
    content: ' Sidebar',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const eventsVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const eventsTailLabel = makeLabel('  events.tail: how many event rows to show in the sidebar');
  const eventsTailInput = new InputRenderable(renderer, {
    placeholder: '15',
    width: '100%',
  });
  const eventsTailInputRow = createIndentedInputRow(renderer, eventsTailInput, '    ');
  eventsTailInput.value = draft.eventsTail;
  const eventsWidthRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const logsVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const logsHeightLabel = makeLabel(
    '  logs.height: reserved log area height when logs are visible',
  );
  const logsHeightInput = new InputRenderable(renderer, {
    placeholder: '15',
    width: '100%',
  });
  const logsHeightInputRow = createIndentedInputRow(renderer, logsHeightInput, '    ');
  logsHeightInput.value = draft.logsHeight;
  const logsTailLabel = makeLabel('  logs.tail: how many recent log lines to keep visible');
  const logsTailInput = new InputRenderable(renderer, {
    placeholder: '20',
    width: '100%',
  });
  const logsTailInputRow = createIndentedInputRow(renderer, logsTailInput, '    ');
  logsTailInput.value = draft.logsTail;

  const providerHeading = new TextRenderable(renderer, {
    content: ' Per-platform viewers',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const ytViewersRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const twitchViewersRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const kickViewersRow = new TextRenderable(renderer, { content: '', fg: 'white' });

  const activityHeading = new TextRenderable(renderer, {
    content: ' Activity bar',
    fg: 'cyan',
    attributes: TextAttributes.BOLD,
  });
  const activityVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const activityModeRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const activityTimeoutLabel = makeLabel(
    '  activity.timeout: seconds each event stays visible in timed mode',
  );
  const activityTimeoutInput = new InputRenderable(renderer, {
    placeholder: '10',
    width: '100%',
  });
  const activityTimeoutInputRow = createIndentedInputRow(renderer, activityTimeoutInput, '    ');
  activityTimeoutInput.value = draft.activityTimeout;

  // Fixed header
  box.add(intro);
  box.add(new TextRenderable(renderer, { content: '', fg: 'gray' })); // spacer

  // Scrollable content
  contentBox.add(displayHeading);
  contentBox.add(demoRow);
  contentBox.add(titleVisibleRow);
  contentBox.add(viewersVisibleRow);
  contentBox.add(viewersModeRow);
  contentBox.add(messagesPositionRow);
  contentBox.add(chatTimestampsRow);
  contentBox.add(historySizeLabel);
  contentBox.add(historySizeInputRow);
  contentBox.add(sidebarHeading);
  contentBox.add(eventsVisibleRow);
  contentBox.add(eventsTailLabel);
  contentBox.add(eventsTailInputRow);
  contentBox.add(eventsWidthRow);
  contentBox.add(logsVisibleRow);
  contentBox.add(logsHeightLabel);
  contentBox.add(logsHeightInputRow);
  contentBox.add(logsTailLabel);
  contentBox.add(logsTailInputRow);
  contentBox.add(providerHeading);
  contentBox.add(ytViewersRow);
  contentBox.add(twitchViewersRow);
  contentBox.add(kickViewersRow);
  contentBox.add(activityHeading);
  contentBox.add(activityVisibleRow);
  contentBox.add(activityModeRow);
  contentBox.add(activityTimeoutLabel);
  contentBox.add(activityTimeoutInputRow);
  contentScroll.add(contentBox);
  box.add(contentScroll);
  renderer.root.add(box);

  type SettingsFocusItem =
    | {
        kind: 'toggle';
        node: TextRenderable;
        render: (focused: boolean) => void;
        toggle: () => void;
      }
    | {
        kind: 'enum';
        node: TextRenderable;
        render: (focused: boolean) => void;
        cycle: (direction: 1 | -1) => void;
      }
    | { kind: 'input'; node: InputRenderable };

  function cycleOption(current: string, options: readonly string[], direction: 1 | -1): string {
    const currentIndex = Math.max(0, options.indexOf(current));
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    return options[nextIndex] ?? options[0] ?? current;
  }

  // Approximate scroll-line target for each focusable item.
  // contentBox has gap:1, so each child is 2 lines wide (content + gap).
  // Non-focusable items (headings, labels) each consume 2 lines and shift subsequent offsets.
  // items: [demo, title, viewers, viewersMode, msgPos, chatTs, histSize,
  //         eventsVis, eventsTail, eventsW, logsVis, logsH, logsT,
  //         ytV, twitchV, kickV, actVis, actMode, actTimeout]
  const FOCUS_SCROLL_TARGETS = [
    2, 4, 6, 8, 10, 12,   // Display section (displayHeading=0, then items at 2..12)
    16,                    // historySizeInput (historySizeLabel at 14)
    20,                    // eventsVisible (sidebarHeading at 18)
    24, 26, 28,            // eventsTailInput, eventsWidth, logsVisible (eventsTailLabel at 22)
    32, 36,                // logsHeightInput, logsTailInput (labels at 30, 34)
    40, 42, 44,            // per-platform viewers (providerHeading at 38)
    48, 50, 54,            // activity section (activityHeading at 46, label at 52)
  ] as const;

  let settingsScrollLine = 0;

  function scrollToFocusItem(idx: number): void {
    const target = FOCUS_SCROLL_TARGETS[idx] ?? 0;
    const delta = target - settingsScrollLine;
    if (delta !== 0) {
      contentScroll.scrollBy(delta);
      settingsScrollLine = target;
    }
  }

  const items: SettingsFocusItem[] = [
    {
      kind: 'toggle',
      node: demoRow,
      render: (focused) => {
        demoRow.content = makeToggleRow('demo', draft.demo, focused).concat(
          '  - fake connected providers for local testing',
        );
        demoRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.demo = !draft.demo;
      },
    },
    {
      kind: 'toggle',
      node: titleVisibleRow,
      render: (focused) => {
        titleVisibleRow.content = makeToggleRow(
          'title.visible',
          draft.titleVisible,
          focused,
        ).concat('  - show or hide the YASH header');
        titleVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.titleVisible = !draft.titleVisible;
      },
    },
    {
      kind: 'toggle',
      node: viewersVisibleRow,
      render: (focused) => {
        viewersVisibleRow.content = makeToggleRow(
          'viewers.visible',
          draft.viewersVisible,
          focused,
        ).concat('  - master switch for viewer counters');
        viewersVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.viewersVisible = !draft.viewersVisible;
      },
    },
    {
      kind: 'enum',
      node: viewersModeRow,
      render: (focused) => {
        viewersModeRow.content = makeEnumRow('viewers.mode', draft.viewersMode, focused).concat(
          '  - per platform, total only, or both',
        );
        viewersModeRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.viewersMode = cycleOption(draft.viewersMode, SETTINGS_VIEWER_MODES, direction);
      },
    },
    {
      kind: 'enum',
      node: messagesPositionRow,
      render: (focused) => {
        messagesPositionRow.content = makeEnumRow(
          'messages.position',
          draft.messagesPosition,
          focused,
        ).concat('  - place the message box above, below, or hide it');
        messagesPositionRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.messagesPosition = cycleOption(
          draft.messagesPosition,
          SETTINGS_MESSAGE_POSITIONS,
          direction,
        );
      },
    },
    {
      kind: 'toggle',
      node: chatTimestampsRow,
      render: (focused) => {
        chatTimestampsRow.content = makeToggleRow(
          'chat.timestamps.visible',
          draft.chatTimestampsVisible,
          focused,
        ).concat('  - prefix chat lines with their timestamp');
        chatTimestampsRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.chatTimestampsVisible = !draft.chatTimestampsVisible;
      },
    },
    { kind: 'input', node: historySizeInput },
    {
      kind: 'toggle',
      node: eventsVisibleRow,
      render: (focused) => {
        eventsVisibleRow.content = makeToggleRow(
          'events.visible',
          draft.eventsVisible,
          focused,
        ).concat('  - show or hide event activity in the sidebar');
        eventsVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.eventsVisible = !draft.eventsVisible;
      },
    },
    { kind: 'input', node: eventsTailInput },
    {
      kind: 'enum',
      node: eventsWidthRow,
      render: (focused) => {
        eventsWidthRow.content = makeEnumRow('events.width', draft.eventsWidth, focused).concat(
          '  - choose how wide the right sidebar should be',
        );
        eventsWidthRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.eventsWidth = cycleOption(draft.eventsWidth, SETTINGS_WIDTH_OPTIONS, direction);
      },
    },
    {
      kind: 'toggle',
      node: logsVisibleRow,
      render: (focused) => {
        logsVisibleRow.content = makeToggleRow('logs.visible', draft.logsVisible, focused).concat(
          '  - show or hide application logs in the sidebar',
        );
        logsVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.logsVisible = !draft.logsVisible;
      },
    },
    { kind: 'input', node: logsHeightInput },
    { kind: 'input', node: logsTailInput },
    {
      kind: 'toggle',
      node: ytViewersRow,
      render: (focused) => {
        ytViewersRow.content = makeToggleRow(
          'platforms.youtube.showViewers',
          draft.youtubeShowViewers,
          focused,
        ).concat('  - allow YouTube viewers in the status bar');
        ytViewersRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.youtubeShowViewers = !draft.youtubeShowViewers;
      },
    },
    {
      kind: 'toggle',
      node: twitchViewersRow,
      render: (focused) => {
        twitchViewersRow.content = makeToggleRow(
          'platforms.twitch.showViewers',
          draft.twitchShowViewers,
          focused,
        ).concat('  - allow Twitch viewers in the status bar');
        twitchViewersRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.twitchShowViewers = !draft.twitchShowViewers;
      },
    },
    {
      kind: 'toggle',
      node: kickViewersRow,
      render: (focused) => {
        kickViewersRow.content = makeToggleRow(
          'platforms.kick.showViewers',
          draft.kickShowViewers,
          focused,
        ).concat('  - allow Kick viewers in the status bar');
        kickViewersRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.kickShowViewers = !draft.kickShowViewers;
      },
    },
    {
      kind: 'toggle',
      node: activityVisibleRow,
      render: (focused) => {
        activityVisibleRow.content = makeToggleRow(
          'activity.visible',
          draft.activityVisible,
          focused,
        ).concat('  - show or hide the activity bar row (follows, subs, cheers, raids)');
        activityVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.activityVisible = !draft.activityVisible;
      },
    },
    {
      kind: 'enum',
      node: activityModeRow,
      render: (focused) => {
        activityModeRow.content = makeEnumRow(
          'activity.mode',
          draft.activityMode,
          focused,
        ).concat('  - permanent: events stay until cleared; timed: each event expires after timeout');
        activityModeRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.activityMode = cycleOption(draft.activityMode, SETTINGS_ACTIVITY_MODES, direction);
      },
    },
    { kind: 'input', node: activityTimeoutInput },
  ];

  let focusIdx = 0;
  activeSettingsModal = { box, focusIndex: 0 };

  function blurCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') current.node.blur();
    else current.render(false);
  }

  function focusCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') current.node.focus();
    else current.render(true);
  }

  function renderRows(): void {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item || item.kind === 'input') continue;
      item.render(i === focusIdx);
    }
  }

  renderRows();
  focusCurrent();

  async function saveAndClose(): Promise<void> {
    const result = validateTuiSettingsDraft({
      ...draft,
      chatMaxHistorySize: historySizeInput.value,
      eventsTail: eventsTailInput.value,
      logsHeight: logsHeightInput.value,
      logsTail: logsTailInput.value,
      activityTimeout: activityTimeoutInput.value,
    });
    if (!result.values) {
      for (const error of result.errors) {
        lastMessages.push(`[settings] ${error}`);
      }
      updateUI(lastMessages);
      return;
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeSettingsModal = null;
    uiNodes?.inputEl.focus();

    try {
      const changedEntries = buildTuiSettingsEntries(result.values).filter(
        (entry) => !Object.is(initialValueByKey.get(entry.key), entry.value),
      );
      const changedKeys = await persistSettingEntries(changedEntries);
      if (changedKeys.length === 0) {
        lastMessages.push('[settings] No changes.');
      } else {
        lastMessages.push(`[settings] Updated: ${changedKeys.join(', ')}`);
        if (changedKeys.includes('chat.timestamps.visible')) {
          lastMessages.length = 0;
          for (const raw of lastRawMessages) lastMessages.push(transformMessage(raw));
        }
      }
    } catch (err) {
      lastMessages.push(`[settings] Error: ${String(err)}`);
    }
    updateUI(lastMessages);
  }

  function cancelAndClose(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeSettingsModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeSettingsModal) return false;
    const current = items[focusIdx];
    if (!current) return false;

    if (sequence === '\t' || sequence === '\x1b[Z') {
      blurCurrent();
      const direction = sequence === '\t' ? 1 : -1;
      const prevIdx = focusIdx;
      focusIdx = (focusIdx + direction + items.length) % items.length;
      activeSettingsModal.focusIndex = focusIdx;
      if (direction === 1 && focusIdx < prevIdx) {
        // Wrapped forward: scroll back to top
        contentScroll.scrollBy(-settingsScrollLine);
        settingsScrollLine = 0;
      } else if (direction === -1 && focusIdx > prevIdx) {
        // Wrapped backward: scroll to last item
        const lastTarget = FOCUS_SCROLL_TARGETS[items.length - 1] ?? 0;
        contentScroll.scrollBy(lastTarget - settingsScrollLine);
        settingsScrollLine = lastTarget;
      } else {
        scrollToFocusItem(focusIdx);
      }
      focusCurrent();
      return true;
    }

    if (
      sequence === ' ' ||
      (current.kind === 'enum' && (sequence === '\x1b[C' || sequence === '\x1b[D')) ||
      (current.kind === 'toggle' && (sequence === '\x1b[C' || sequence === '\x1b[D'))
    ) {
      if (current.kind === 'toggle') {
        current.toggle();
        current.render(true);
        return true;
      }
      if (current.kind === 'enum') {
        current.cycle(sequence === '\x1b[D' ? -1 : 1);
        current.render(true);
        return true;
      }
    }

    if (sequence === '\r' || sequence === '\n') {
      saveAndClose();
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      cancelAndClose();
      return true;
    }
    if (sequence === '\x1b[A') {
      contentScroll.scrollBy(-1);
      settingsScrollLine = Math.max(0, settingsScrollLine - 1);
      return true;
    }
    if (sequence === '\x1b[B') {
      contentScroll.scrollBy(1);
      settingsScrollLine += 1;
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeSettingsModal) cancelAndClose();
  };
  for (const input of [
    historySizeInput,
    eventsTailInput,
    logsHeightInput,
    logsTailInput,
    activityTimeoutInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

// ─── Chatter info modal ──────────────────────────────────────────────────────

function openChatterInfoModal(msg: ChatMessage): void {
  if (!uiNodes || activeModal || activeStreamModal || activeSettingsModal || activeChatterInfoModal)
    return;
  const { renderer } = uiNodes;

  const platColor = (p: string): string => {
    if (p === 'twitch') return '#9146FF';
    if (p === 'youtube') return '#FF0000';
    if (p === 'kick') return '#53FC18';
    return 'white';
  };

  // Tab state — declared first so they're in scope for renderTabBar and box setup
  let activeTab: 'session' | 'alltime' | 'context' = 'session';
  let tabSessionCount = 0;
  let tabAlltimeCount = 0;
  let tabContextCount = 0;

  // Alltime lazy-load state
  const ALLTIME_PAGE_SIZE = 100;
  let alltimeMessages: ChatMessage[] = [];
  let alltimePage = 0;
  let alltimeExhausted = false;
  let alltimeLoading = false;

  // Context lazy-load state
  let contextMessages: ChatMessage[] = [];
  let contextPage = 0;
  let contextExhausted = false;
  let contextLoading = false;

  function renderTabBar(
    sessionCount: number,
    alltimeCount: number,
    contextCount: number,
  ): StyledText {
    const sessionColor = activeTab === 'session' ? 'cyan' : '#555555';
    const alltimeColor = activeTab === 'alltime' ? 'cyan' : '#555555';
    const contextColor = activeTab === 'context' ? 'cyan' : '#555555';
    return new StyledText([
      fg(sessionColor)(`  [S] Session (${sessionCount})  `),
      fg(alltimeColor)(`[A] All time (${alltimeCount})  `),
      fg(contextColor)(`[C] Context (${contextCount})`),
    ]);
  }

  // Message scroll box — declared before box setup so box.add(msgScroll) is valid
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

  // All four structural nodes are added upfront so the yoga layout is
  // established once. The async callback only updates .content — no add/remove.
  const infoText = new TextRenderable(renderer, {
    content: `  Loading info for @${msg.username}...`,
    fg: 'cyan',
    wrapMode: 'none',
  });
  const tabBarTextNode = new TextRenderable(renderer, { content: '' });
  box.add(infoText);
  box.add(tabBarTextNode);
  box.add(msgScroll);
  box.add(
    new TextRenderable(renderer, {
      content:
        '  [S] session  [A] all-time  [C] context  [↑] scroll / load older  [↓] scroll  [Esc] close',
      fg: '#888888',
    }),
  );
  renderer.root.add(box);
  activeChatterInfoModal = { box };

  // ── Alltime tab helpers ────────────────────────────────────────────────────

  function fmtTimestamp(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}  `;
  }

  function makeMessageRow(m: ChatMessage): BoxRenderable {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    row.add(new TextRenderable(renderer, { content: fmtTimestamp(m.timestamp), fg: '#888888' }));
    row.add(new TextRenderable(renderer, { content: m.message, fg: 'white' }));
    return row;
  }

  function makeStreamSeparator(timestamp: number): TextRenderable {
    return new TextRenderable(renderer, {
      content: `── stream starting ${fmtTimestamp(timestamp).trim()} ──`,
      fg: '#4a9eff',
    });
  }

  function makeContextMessageRow(m: ChatMessage, isTargetUser: boolean): BoxRenderable {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    row.add(new TextRenderable(renderer, { content: fmtTimestamp(m.timestamp), fg: '#888888' }));
    if (isTargetUser) {
      row.add(new TextRenderable(renderer, { content: '★ ', fg: 'cyan' }));
      row.add(
        new TextRenderable(renderer, {
          content: `${m.username}: `,
          fg: m.color ?? platColor(m.platform),
        }),
      );
      row.add(new TextRenderable(renderer, { content: m.message, fg: 'white' }));
    } else {
      row.add(
        new TextRenderable(renderer, { content: `[${m.platform}] `, fg: platColor(m.platform) }),
      );
      row.add(new TextRenderable(renderer, { content: `${m.username}: `, fg: '#888888' }));
      row.add(new TextRenderable(renderer, { content: m.message, fg: '#aaaaaa' }));
    }
    return row;
  }

  // Render all of alltimeMessages into the (already-cleared) scroll box.
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

  // Prepend one page of older messages into the scroll box.
  // Called when the user scrolls to the top of the alltime tab.
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

      const chronoBatch = batch.slice().reverse(); // oldest first
      alltimePage++;
      if (batch.length < ALLTIME_PAGE_SIZE) alltimeExhausted = true;

      // If the newest message in the batch shares a stream with the oldest
      // currently displayed message, the existing first separator is a duplicate
      // of what we're about to prepend — remove it.
      const lastInBatch = chronoBatch[chronoBatch.length - 1];
      const firstInExisting = alltimeMessages[0];
      if (lastInBatch?.streamId === firstInExisting?.streamId) {
        const children = msgScroll.getChildren();
        if (children.length > 0) msgScroll.remove(children[0].id);
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
        if (children.length > 0) msgScroll.remove(children[0].id);
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

  // ── Fill scroll helper ─────────────────────────────────────────────────────

  function fillMessageScroll(
    tab: 'session' | 'alltime' | 'context',
    platform: string,
    userId: string,
  ): void {
    for (const child of msgScroll.getChildren()) {
      msgScroll.remove(child.id);
    }

    if (tab === 'session') {
      const messages = chatService
        .getMessageHistory()
        .filter((m) => m.platform === platform && m.userId === userId);
      if (messages.length === 0) {
        msgScroll.add(new TextRenderable(renderer, { content: '  (no messages)', fg: '#888888' }));
        return;
      }
      for (const m of messages) {
        msgScroll.add(makeMessageRow(m));
      }
    } else if (tab === 'alltime') {
      // Initial DB load (also re-runs on tab switch to restore content)
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
      // Defer scroll until after layout is computed (two ticks to be safe)
      setTimeout(() => {
        msgScroll.scrollTo(99999);
      }, 32);
    } else {
      // Context tab — all messages from streams where the chatter participated
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

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeChatterInfoModal) return false;
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      renderer.removeInputHandler(modalKeyHandler);
      renderer.root.remove(box.id);
      activeChatterInfoModal = null;
      ensureMainInputFocus();
      return true;
    }
    // Tab switching
    if (sequence === 's' || sequence === 'S') {
      if (activeTab !== 'session') {
        activeTab = 'session';
        tabBarTextNode.content = renderTabBar(tabSessionCount, tabAlltimeCount, tabContextCount);
        fillMessageScroll('session', msg.platform, msg.userId);
      }
      return true;
    }
    if (sequence === 'a' || sequence === 'A') {
      if (activeTab !== 'alltime') {
        activeTab = 'alltime';
        tabBarTextNode.content = renderTabBar(tabSessionCount, tabAlltimeCount, tabContextCount);
        fillMessageScroll('alltime', msg.platform, msg.userId);
      }
      return true;
    }
    if (sequence === 'c' || sequence === 'C') {
      if (activeTab !== 'context') {
        activeTab = 'context';
        tabBarTextNode.content = renderTabBar(tabSessionCount, tabAlltimeCount, tabContextCount);
        fillMessageScroll('context', msg.platform, msg.userId);
      }
      return true;
    }
    // Arrow key scrolling; ↑ at top of alltime/context tab loads older messages
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

  // Async fetch & render
  void (async () => {
    try {
      // Try cache first
      let info = chatterCache.get(msg.platform, msg.userId);

      if (!info) {
        // Fetch from provider
        let provider: {
          fetchChatterInfo?: (
            userId: string,
            username: string,
          ) => Promise<import('./platforms/base').ChatterInfo | null>;
        } | null = null;
        if (msg.platform === 'twitch') provider = twitch;
        else if (msg.platform === 'youtube') provider = youtube;
        else if (msg.platform === 'kick') provider = kick;

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

        const stats = chatterCache.computeSessionStats(
          msg.platform,
          msg.userId,
          chatService.getMessageHistory(),
        );
        info.sessionMessageCount = stats.count;
        if (stats.firstSeenAt) info.sessionFirstSeenAt = stats.firstSeenAt;

        chatterCache.set(msg.platform, msg.userId, info);
      } else {
        const stats = chatterCache.computeSessionStats(
          msg.platform,
          msg.userId,
          chatService.getMessageHistory(),
        );
        info.sessionMessageCount = stats.count;
        if (stats.firstSeenAt) info.sessionFirstSeenAt = stats.firstSeenAt;
      }

      if (!activeChatterInfoModal) return;

      // Build all info rows as a single multi-line StyledText so the yoga layout
      // only needs to measure one node (avoids dynamic add/remove invalidation bugs).
      const userColor = info.color ?? 'white';
      const pColor = platColor(info.platform);

      type InfoRow = [string, string, string]; // [label, value, valueFg]
      const rows: InfoRow[] = [
        ['Platform:', info.platform, pColor],
        ['Username:', `@${info.username}`, userColor],
      ];

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
        rows.push(['Badges:', Object.keys(info.badges).join(', '), 'white']);
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

      // Update tab bar
      tabSessionCount = info.sessionMessageCount;
      tabAlltimeCount = messageLog.countForUser(msg.platform, msg.userId);
      tabContextCount = messageLog.countContextForUser(msg.platform, msg.userId);
      tabBarTextNode.content = renderTabBar(tabSessionCount, tabAlltimeCount, tabContextCount);

      fillMessageScroll('session', msg.platform, msg.userId);
    } catch (err) {
      if (!activeChatterInfoModal) return;
      infoText.content = `  Error loading info: ${String(err)}`;
      infoText.fg = 'red';
    }
  })();
}

// ─── History modal ───────────────────────────────────────────────────────────

function openHistoryModal(opts?: { query?: string }): void {
  if (
    !uiNodes ||
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeChatterInfoModal ||
    activeHistoryModal
  )
    return;
  const { renderer } = uiNodes;

  const platColor = (p: string): string => {
    if (p === 'twitch') return '#9146FF';
    if (p === 'youtube') return '#FF0000';
    if (p === 'kick') return '#53FC18';
    return 'white';
  };

  function fmtTimestamp(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}  `;
  }

  function fmtDate(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

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
  activeHistoryModal = { box };

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
    const s = streams[i];
    const cursor = selected ? '▶' : ' ';
    const idStr = s.streamId.length > 20 ? `${s.streamId.slice(0, 17)}...` : s.streamId.padEnd(20);
    const platStr = s.platforms.join(',').padEnd(14);
    return `  ${cursor}  ${idStr}  ${platStr}  ${String(s.messageCount).padStart(6)} msgs  ${String(s.userCount).padStart(4)} users  ${fmtDate(s.startTime)}`;
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
        ` · ${stream.platforms.join(',')} · ${stream.messageCount.toLocaleString()} msgs · ${stream.userCount} users · ${fmtDate(stream.startTime)}`,
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
      const batch = messageLog.getForStream(
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
          new TextRenderable(renderer, { content: fmtTimestamp(m.timestamp), fg: '#888888' }),
        );
        row.add(
          new TextRenderable(renderer, { content: `[${m.platform}] `, fg: platColor(m.platform) }),
        );
        row.add(
          new TextRenderable(renderer, {
            content: `${m.username}: `,
            fg: m.color ?? platColor(m.platform),
          }),
        );
        row.add(new TextRenderable(renderer, { content: m.message, fg: 'white' }));
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

    const results = messageLog.searchMessages(q, { limit: 200 });
    const countLabel =
      results.length >= 200
        ? '200+ results (first 200 shown):'
        : `${results.length} result${results.length !== 1 ? 's' : ''}:`;
    contentScroll.add(new TextRenderable(renderer, { content: `  ${countLabel}`, fg: '#888888' }));

    for (const m of results) {
      const streamLabel = m.streamId ? ` [${m.streamId.slice(0, 8)}]` : '';
      const row = new BoxRenderable(renderer, { flexDirection: 'row' });
      row.add(new TextRenderable(renderer, { content: fmtTimestamp(m.timestamp), fg: '#888888' }));
      row.add(
        new TextRenderable(renderer, {
          content: `[${m.platform}${streamLabel}] `,
          fg: platColor(m.platform),
        }),
      );
      row.add(
        new TextRenderable(renderer, {
          content: `${m.username}: `,
          fg: m.color ?? platColor(m.platform),
        }),
      );
      row.add(new TextRenderable(renderer, { content: m.message, fg: 'white' }));
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

  // ── Key handler ────────────────────────────────────────────────────────────

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeHistoryModal) return false;

    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      renderer.removeInputHandler(modalKeyHandler);
      renderer.root.remove(box.id);
      activeHistoryModal = null;
      ensureMainInputFocus();
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
      renderer.removeInputHandler(modalKeyHandler);
      renderer.root.remove(box.id);
      activeHistoryModal = null;
      ensureMainInputFocus();
    }
  }) as any;

  // ── Initial render ─────────────────────────────────────────────────────────

  streams = messageLog.getStreams();
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

// ─── Main ────────────────────────────────────────────────────────────────────

let isRunning = true;
type ChatLinePart = { content: string; fg: string };
type ChatLine =
  | string
  | (ChatLinePart & { rawMsg?: ChatMessage })
  | { parts: ChatLinePart[]; rawMsg?: ChatMessage };
const lastMessages: ChatLine[] = [];
let cliRenderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;
const inputHistory: string[] = [];
let historyIndex = -1;

// ─── Browse mode state ───────────────────────────────────────────────────────
let browseModeActive = false;
let browseSelectedIdx: number | null = null; // index into lastMessages
const lastRawMessages: ChatMessage[] = []; // parallel to lastMessages (only chat platform messages)

function platformColor(platform: string): string {
  if (platform === 'youtube') return 'red';
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'kick') return 'green';
  return 'white';
}

function transformMessage(msg: ChatMessage): ChatLine {
  const platColor = platformColor(msg.platform);
  const userColor = msg.color ?? platColor;
  const showTs = boolSetting(settings.get('chat.timestamps.visible', true), true);
  let tsStr = '';
  if (showTs) {
    const d = new Date(msg.timestamp);
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    tsStr = ` ${hh}:${mi}:${ss}`;
  }
  if (userColor === platColor) {
    return {
      content: `[${msg.platform}]${tsStr} ${msg.username}: ${msg.message}`,
      fg: platColor,
      rawMsg: msg,
    };
  }
  return {
    parts: [
      { content: `[${msg.platform}]${tsStr} `, fg: platColor },
      { content: `${msg.username}: ${msg.message}`, fg: userColor },
    ],
    rawMsg: msg,
  };
}

function transformOutgoingMessage(target: MessageTarget, message: string): ChatLine {
  return {
    parts: [
      { content: '[you → ', fg: 'white' },
      { content: `${target}`, fg: getMessageTargetColor(target) },
      { content: `] ${message}`, fg: 'white' },
    ],
  };
}

function getChatLineText(msg: ChatLine): string {
  if (typeof msg === 'string') return msg;
  if ('parts' in msg) return msg.parts.map((part) => part.content).join('');
  return msg.content;
}

function classifyChatLine(msg: ChatLine): ChatClearLineKind {
  if (typeof msg !== 'string' && 'rawMsg' in msg && msg.rawMsg) {
    return 'messages';
  }

  const text = getChatLineText(msg);
  if (text.startsWith('[you')) return 'messages';

  if (
    text.startsWith('[logs]') ||
    /^\[(INFO|WARN|ERROR|DEBUG|STDERR)\]/.test(text) ||
    /\[(INFO|WARN|ERROR|DEBUG|STDERR)\]/.test(text)
  ) {
    return 'logs';
  }

  return 'events';
}

function renderChatLine(renderer: CliRenderer, msg: ChatLine): TextRenderable | BoxRenderable {
  if (typeof msg === 'string') {
    return new TextRenderable(renderer, { content: msg, fg: 'white' });
  }
  if ('parts' in msg) {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    for (const part of msg.parts) {
      row.add(new TextRenderable(renderer, { content: part.content, fg: part.fg }));
    }
    return row;
  }
  return new TextRenderable(renderer, { content: msg.content, fg: msg.fg });
}

function renderHighlightedChatLine(
  renderer: CliRenderer,
  msg: ChatLine,
): TextRenderable | BoxRenderable {
  // Prefix the line with "> " indicator in cyan to show selection
  const row = new BoxRenderable(renderer, { flexDirection: 'row' });
  row.add(
    new TextRenderable(renderer, { content: '> ', fg: 'cyan', attributes: TextAttributes.BOLD }),
  );
  row.add(renderChatLine(renderer, msg));
  return row;
}

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));
}

function formatInfoValue(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function fetchYoutubeInfo(): Promise<Record<string, unknown>> {
  if (!youtube.isAuthenticated()) return { error: 'not authenticated' };

  const provider = youtube as any;
  const baseInfo = provider.getChannelInfo?.() ?? {};
  const target =
    (await provider._resolveMetadataTargetBroadcast?.({}, { allowFallback: false })) ??
    (baseInfo.broadcastId ? { id: baseInfo.broadcastId, liveChatId: baseInfo.liveChatId } : null);

  if (!target?.id || !provider._request) {
    return compactObject({
      ...baseInfo,
      streamStatus: youtube.getStreamStatus(),
      viewerCount: youtube.getViewerCount(),
    });
  }

  const [broadcastResp, videoResp] = await Promise.all([
    provider._request(
      `${'https://www.googleapis.com/youtube/v3'}/liveBroadcasts?part=id,snippet,status,contentDetails&id=${target.id}`,
    ),
    provider._request(
      `${'https://www.googleapis.com/youtube/v3'}/videos?part=snippet&id=${target.id}`,
    ),
  ]);

  const broadcastData = broadcastResp.ok ? await broadcastResp.json() : { items: [] };
  const videoData = videoResp.ok ? await videoResp.json() : { items: [] };
  const broadcast = broadcastData.items?.[0];
  const video = videoData.items?.[0];

  return compactObject({
    ...baseInfo,
    streamStatus: youtube.getStreamStatus(),
    viewerCount: youtube.getViewerCount(),
    title: video?.snippet?.title ?? broadcast?.snippet?.title,
    description: video?.snippet?.description ?? broadcast?.snippet?.description,
    lifeCycleStatus: broadcast?.status?.lifeCycleStatus,
    scheduledStartTime: broadcast?.snippet?.scheduledStartTime,
    actualStartTime: broadcast?.snippet?.actualStartTime,
    boundStreamId: broadcast?.contentDetails?.boundStreamId,
    categoryId: video?.snippet?.categoryId,
    tags: video?.snippet?.tags,
  });
}

async function fetchTwitchInfo(): Promise<Record<string, unknown>> {
  if (!twitch.isAuthenticated()) return { error: 'not authenticated' };

  const provider = twitch as any;
  if (!provider.apiClient || !provider.userId) return { error: 'api client not ready' };

  const channel = await provider.apiClient.channels.getChannelInfoById(provider.userId);
  return compactObject({
    title: channel?.title,
    game: channel?.gameName,
    gameId: channel?.gameId,
    tags: channel?.tags ?? [],
    language: channel?.language,
    delay: channel?.delay,
    streamStatus: twitch.getStreamStatus(),
    viewerCount: twitch.getViewerCount(),
  });
}

async function fetchKickInfo(): Promise<Record<string, unknown>> {
  if (!kick.isAuthenticated()) return { error: 'not authenticated' };

  const provider = kick as any;
  if (!provider.client || !provider.channelSlug) return { error: 'api client not ready' };

  const [channel, eventSubscriptions] = await Promise.all([
    provider.client.channels.getChannel(provider.channelSlug),
    provider.getEventSubscriptions?.().catch?.(() => []),
  ]);
  return compactObject({
    title: channel?.stream_title ?? channel?.user?.username,
    slug: channel?.slug,
    category: channel?.category?.name ?? null,
    categoryId: channel?.category?.id ?? null,
    tags: channel?.recent_categories?.map?.((c: any) => c?.name).filter(Boolean),
    followers: channel?.followers_count ?? 0,
    verified: channel?.verified ?? false,
    eventSubscriptions,
    streamStatus: kick.getStreamStatus(),
    viewerCount: kick.getViewerCount(),
  });
}

async function fetchPlatformInfo(platform: string): Promise<Record<string, unknown>> {
  if (platform === 'youtube') return fetchYoutubeInfo();
  if (platform === 'twitch') return fetchTwitchInfo();
  if (platform === 'kick') return fetchKickInfo();
  return { error: `unsupported platform: ${platform}` };
}

function loadChatHistory(): { lines: ChatLine[]; rawMsgs: ChatMessage[] } {
  const rawMax = Number(settings.get('chat.maxHistorySize', 1000));
  const maxHistory = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 1000;
  const streamIds: string[] = [];

  const ytInfo = youtube.getChannelInfo();
  if (ytInfo.broadcastId) streamIds.push(ytInfo.broadcastId);

  const twitchStart = twitch.getStreamStartTime();
  if (twitchStart) streamIds.push(twitchStart.toISOString());

  const kickStart = kick.getStreamStartTime();
  if (kickStart) streamIds.push(kickStart.toISOString());

  // Allow explicit override via settings (useful for demos / dev without live streams)
  const overrideIds = settings.get('chat.historyStreamIds', []);
  if (Array.isArray(overrideIds)) {
    for (const id of overrideIds) {
      if (typeof id === 'string' && !streamIds.includes(id)) streamIds.push(id);
    }
  }

  const rawMsgs = buildChatHistoryMessages(
    streamIds,
    (id, limit, offset) => messageLog.getForStream(id, limit, offset),
    maxHistory,
  );
  return { lines: rawMsgs.map(transformMessage), rawMsgs };
}

async function main() {
  const renderer = await createCliRenderer({
    screenMode:
      (process.env.YASH_SCREEN_MODE as 'main-screen' | 'alternate-screen') ?? 'main-screen',
    consoleMode: 'disabled',
    useKittyKeyboard: null,
    useMouse: true,
    // Intercept Tab/Up/Down at raw sequence level.
    // Tab → autocomplete; Up/Down → history navigation.
    prependInputHandlers: [
      (sequence: string): boolean => {
        if (!uiNodes) return false;
        ensureMainInputFocus();

        // Raw mode swallows Ctrl+C — re-raise as SIGINT so one C-c exits cleanly
        if (sequence === '\x03') {
          process.kill(process.pid, 'SIGINT');
          return true;
        }

        if (sequence === '\t') {
          const val = uiNodes.inputEl.value;
          if (!val.startsWith('/')) {
            cycleMessageTarget();
            updateInputAssist();
            return true;
          }

          const continuing = autocycleIndex >= 0 && autocycleSuggestions[autocycleIndex] === val;

          if (continuing) {
            autocycleIndex = (autocycleIndex + 1) % autocycleSuggestions.length;
          } else {
            const { completions, hints } = getAutocomplete(val);
            if (completions.length === 0) return true;
            autocycleSuggestions = completions;
            autocycleHints = hints;
            autocycleIndex = 0;
          }

          uiNodes.inputEl.value = autocycleSuggestions[autocycleIndex] ?? val;

          if (autocycleSuggestions.length > 1) {
            const hintStr = autocycleHints
              .map((h, i) => (i === autocycleIndex ? `[${h}]` : h))
              .join('  ');
            uiNodes.autocompleteHint.content = `  ${hintStr}`;
            uiNodes.autocompleteHint.visible = true;
          } else {
            uiNodes.autocompleteHint.visible = false;
          }

          return true;
        }

        // Shift+Up (\x1b[1;2A) — enter browse mode
        if (
          sequence === '\x1b[1;2A' &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal
        ) {
          browseModeActive = true;
          browseSelectedIdx = lastMessages.length > 0 ? lastMessages.length - 1 : null;
          updateUI(lastMessages);
          return true;
        }

        // Shift+Down (\x1b[1;2B) — exit browse mode
        if (
          sequence === '\x1b[1;2B' &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal
        ) {
          browseModeActive = false;
          browseSelectedIdx = null;
          updateUI(lastMessages);
          return true;
        }

        if (sequence === '\x1b[A') {
          // Up arrow — in browse mode: navigate up; otherwise: go back in history
          if (browseModeActive) {
            if (browseSelectedIdx !== null) {
              browseSelectedIdx = Math.max(0, browseSelectedIdx - 1);
            }
            updateUI(lastMessages);
            return true;
          }
          if (inputHistory.length === 0) return true;
          if (historyIndex === -1) historyIndex = inputHistory.length - 1;
          else if (historyIndex > 0) historyIndex--;
          const entry = inputHistory[historyIndex] ?? '';
          uiNodes.inputEl.value = entry;
          updateInputAssist();
          return true;
        }

        if (sequence === '\x1b[B') {
          // Down arrow — in browse mode: navigate down; otherwise: go forward in history
          if (browseModeActive) {
            if (browseSelectedIdx !== null) {
              browseSelectedIdx = Math.min(lastMessages.length - 1, browseSelectedIdx + 1);
            }
            updateUI(lastMessages);
            return true;
          }
          if (historyIndex === -1) return true;
          historyIndex++;
          if (historyIndex >= inputHistory.length) {
            historyIndex = -1;
            uiNodes.inputEl.value = '';
          } else {
            const entry = inputHistory[historyIndex] ?? '';
            uiNodes.inputEl.value = entry;
          }
          updateInputAssist();
          return true;
        }

        // Escape — exit browse mode if active
        if ((sequence === '\x1b' || sequence === '\x1b\x1b') && browseModeActive) {
          browseModeActive = false;
          browseSelectedIdx = null;
          updateUI(lastMessages);
          return true;
        }

        // Ctrl+L / Ctrl+Shift+L — cycle sidebar visibility
        // Both send \x0c in this terminal; can't be distinguished without kitty support
        if (sequence === '\x0c' && !activeModal && !activeStreamModal && !activeSettingsModal) {
          const ev = boolSetting(settings.get('events.visible', true), true);
          const lg = boolSetting(settings.get('logs.visible', true), true);
          // Cycle: (T,T)→(F,T)→(F,F)→(T,F)→(T,T)
          if (ev && lg) {
            settings.set('events.visible', false);
          } else if (!ev && lg) {
            settings.set('logs.visible', false);
          } else if (!ev && !lg) {
            settings.set('events.visible', true);
          } else {
            settings.set('logs.visible', true);
          }
          updateUI(lastMessages);
          return true;
        }

        return false;
      },
    ],
  });
  cliRenderer = renderer;

  // opentui overrides console.* to route output through its capture buffer, which
  // flushStdoutCache then writes onto the terminal — causing Bun's server logs
  // (e.g. "Bundled page in Xms") to bleed into the TUI.  Replace those overrides
  // with no-ops after the renderer is up; all TUI output goes through logCollector.
  const noop = () => {};
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
  console.debug = noop;

  if (process.env.YASH_TEST_MESSAGES) {
    const fakeMsg = {
      id: 'test-1',
      platform: 'twitch',
      userId: 'u123',
      username: 'testuser',
      message: 'Hello this is a test message click me!',
      timestamp: Date.now(),
      color: '#FF6B6B',
    };
    lastMessages.push(transformMessage(fakeMsg));
    lastRawMessages.push(fakeMsg);
    updateUI(lastMessages);
  }

  chatService.subscribeToMessages((msg) => {
    lastMessages.push(transformMessage(msg));
    lastRawMessages.push(msg);
  });

  obsService.subscribeToMessages((event) => {
    const type = event?.eventType as string | undefined;
    if (type === 'CurrentProgramSceneChanged') {
      const scene = (event?.eventData?.sceneName as string) ?? 'unknown';
      pushEvent('obs', 'scene', scene);
    } else if (type === 'StreamStateChanged') {
      const active = event?.eventData?.outputActive as boolean;
      pushEvent('obs', 'stream', active ? 'started' : 'stopped');
    } else if (type === 'RecordStateChanged') {
      const active = event?.eventData?.outputActive as boolean;
      pushEvent('obs', 'recording', active ? 'started' : 'stopped');
    } else {
      return;
    }
    updateUI(lastMessages);
  });

  // Register activity callbacks before starting services so events emitted
  // during initialization (first webhook poll, first chat page) are not dropped.
  twitch.onActivityEvent(({ type, message }) => {
    pushActivityEvent('twitch', type, message);
  });
  kick.onActivityEvent(({ type, message }) => {
    pushActivityEvent('kick', type, message);
  });
  youtube.onActivityEvent(({ type, message }) => {
    pushActivityEvent('youtube', type, message);
  });

  await initializeServices();
  startIpcServer(handleCommandForCli);

  // Establish session identity — reuse the persisted ID if present (same session/restart),
  // otherwise generate a fresh one (first launch or explicit clear).
  const savedSessionId = settings.get('activity.sessionId', null) as string | null;
  if (savedSessionId) {
    currentActivitySessionId = savedSessionId;
  } else {
    currentActivitySessionId = crypto.randomUUID();
    await settings.set('activity.sessionId', currentActivitySessionId);
  }

  // Load persisted activity events — only those matching the current session
  const restoredActivity = _loadActivityEvents();
  if (restoredActivity.length > 0) {
    activityEvents.push(...restoredActivity);
  }
  _scheduleActivityBarRefresh();

  if (youtube.isAuthenticated()) pushEvent('youtube', 'auth', 'Authenticated');
  if (twitch.isAuthenticated()) pushEvent('twitch', 'auth', 'Authenticated');
  if (kick.isAuthenticated()) pushEvent('kick', 'auth', 'Authenticated');
  pushEvent(
    'system',
    'obs.connect',
    obsService.isConnected() ? 'OBS connected' : 'OBS unavailable',
  );

  const { lines: histLines, rawMsgs: histRaw } = loadChatHistory();
  if (histRaw.length > 0) {
    const seenIds = new Set(lastRawMessages.map((m) => m.id));
    const newLines = histLines.filter((_, i) => !seenIds.has(histRaw[i]!.id));
    const newRaw = histRaw.filter((m) => !seenIds.has(m.id));
    if (newLines.length > 0) {
      lastMessages.push('[system] --- chat history ---');
      lastMessages.push(...newLines);
      lastRawMessages.push(...newRaw);
    }
  }

  // Build UI tree once — no flicker on periodic updates
  uiNodes = initUI(renderer, lastMessages);

  // Focus input and wire ENTER + INPUT handlers once
  ensureMainInputFocus();

  uiNodes.inputEl.on(InputRenderableEvents.INPUT, () => {
    updateInputAssist();
  });

  uiNodes.inputEl.on(InputRenderableEvents.ENTER, async () => {
    // Browse mode: Enter opens chatter info for the selected message
    if (browseModeActive && browseSelectedIdx !== null) {
      const rawMsg = lastRawMessages[browseSelectedIdx];
      if (rawMsg !== undefined) {
        openChatterInfoModal(rawMsg);
      }
      return;
    }

    const rawValue = uiNodes!.inputEl.value;
    let trimmed = rawValue.trim();
    if (trimmed.startsWith('/')) {
      const { completion, hints } = getAutocomplete(trimmed);
      if (hints.length === 1 && completion) trimmed = completion;
    }
    uiNodes!.inputEl.value = '';
    uiNodes!.autocompleteHint.visible = false;
    if (!trimmed) return;
    inputHistory.push(trimmed);
    historyIndex = -1;
    await handleCommand(trimmed);
    selectedMessageTarget = 'all';
    updateInputAssist();
    updateUI(lastMessages);
  });

  updateInputAssist();

  // Track Twitch stream status to detect OFFLINE→ONLINE transitions (new broadcast)
  let lastTwitchStreamStatus = twitch.getStreamStatus();

  // Periodic refresh — in-place mutations only, no flicker
  const updateLoop = setInterval(async () => {
    if (!isRunning) return;
    // Detect new Twitch broadcast going live → rotate activity session
    const nowTwitchStatus = twitch.getStreamStatus();
    if (lastTwitchStreamStatus !== nowTwitchStatus && String(nowTwitchStatus) === 'ONLINE') {
      _rotateActivitySession();
    }
    lastTwitchStreamStatus = nowTwitchStatus;
    // If a platform isn't authenticated, retry silently — it may have been
    // authorized via the web OAuth flow while the TUI was running.
    for (const [name, provider] of [
      ['twitch', twitch],
      ['youtube', youtube],
      ['kick', kick],
    ] as const) {
      if (!provider.isAuthenticated()) {
        const res = await provider.authenticate();
        if (res?.success) {
          lastMessages.push(`[system] ${name} connected`);
        }
      }
    }
    try {
      updateUI(lastMessages);
    } catch {
      // Renderer was destroyed outside the SIGINT path — stop the loop cleanly
      isRunning = false;
      clearInterval(updateLoop);
    }
  }, 2000);

  const shutdown = async () => {
    isRunning = false;
    clearInterval(updateLoop);
    authService.stopAutoRefresh();
    await obsService.disconnect();
    renderer.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => defaultLogger.error('TUI main failed', err));
