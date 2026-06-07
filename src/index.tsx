// Suppress EventTarget MaxListeners warning from OpenTUI's CliRenderer
process.setMaxListeners(0);

import * as v8 from 'node:v8';
import {
  BoxRenderable,
  bold,
  type CliRenderer,
  createCliRenderer,
  fg,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextAttributes,
  TextRenderable,
  underline,
} from '@opentui/core';
import type { ActivityEventPayload, ChatMessage } from './platforms/base';
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
import { formatActionHelp, parseActionArgs } from './utils/actionArgs';
import {
  clearActionAutocompleteCaches,
  invalidateActionAutocompleteForObsEvent,
  setActionAutocompleteRuntime,
  subscribeToActionAutocompleteRefresh,
} from './utils/actionAutocomplete';
import { type ChatClearLineKind, runChatClearCommand } from './utils/chatClear';
import {
  buildChatHistoryMessages,
  getChatHistoryStreamIds,
  getChatHistoryLimit as readChatHistoryLimit,
} from './utils/chatHistoryLoader';
import {
  applySessionStatsToChatterInfo,
  doesIncomingMessageAffectChatterAllTime,
  doesIncomingMessageAffectChatterContext,
  doesIncomingMessageAffectChatterSession,
  getChatterSessionMessages,
  getChatterSessionStats,
} from './utils/chatterInfoSession';
import { getDataDir, isDemoMode, saveConfig } from './utils/config';
import { parseMessageWithFfzEmotes } from './utils/ffz';
import { getFfzEmotePayload, type SharedTwitchEmoteDefinition } from './utils/ffz-fetch';
import { renderTuiHelpLines } from './utils/help';
import { runIpcCommand } from './utils/ipcCommandRunner';
import logCollector from './utils/logCollector';
import { defaultLogger, parseLoggerLevelName, setDefaultLoggerLevel } from './utils/logger';
import {
  buildMemoryInsightSummary,
  DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
  DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
  DEFAULT_MEMORY_STATUS_RED_MIN_MB,
  DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
  formatMemoryStatusDisplay,
  readMemoryStatusSettings,
  readMemoryTelemetrySettings,
} from './utils/memoryStatus';
import {
  applyObsShutdownConfigPatch,
  buildObsShutdownConfigDraft,
  loadObsShutdownEffectiveConfig,
  type ObsShutdownConfigDraft,
  validateObsShutdownConfigDraft,
} from './utils/obsShutdownConfig';
import {
  DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
  getPlatformStatusIconColumns,
  getPlatformStatusIconPlatformSizeSettingKey,
  PLATFORM_STATUS_ICON_SETTING_KEY,
  type PlatformStatusIconPlatform,
  readPlatformStatusIconSizePxForPlatform,
  readPlatformStatusIconsEnabled,
} from './utils/platformStatusIcons';
import {
  ensurePlatformStatusIcon,
  warmPlatformStatusIcons,
} from './utils/platformStatusIcons.server';
import { formatRuntimeStatusLines, runtimeMonitor } from './utils/runtime-monitor';
import { buildTargetedStreamMetadataUpdate } from './utils/streamMetadata';
import { getAutocomplete, initTuiCommands, setActionRegistry } from './utils/tuiCommands';
import { installTuiErrorCapture } from './utils/tuiErrorCapture';
import {
  buildTuiFfzMessageParts,
  buildTuiFfzUploadSequences,
  getTuiFfzColumnSpan,
  getTuiFfzPlaceholderCells,
  getTuiFfzUploadUrl,
  imageIdToColorHex,
  isTuiFfzPassthroughEnabled,
  parsePngDimensions,
  supportsTuiFfzClientTerm,
} from './utils/tuiFfz';
import { getNextAutocompleteCycleIndex, type MessageTarget } from './utils/tuiMessageInput';
import {
  buildTuiSettingsEntries,
  SETTINGS_ACTIVITY_MODES,
  SETTINGS_LOG_LEVELS,
  SETTINGS_MESSAGE_POSITIONS,
  SETTINGS_VIEWER_MODES,
  SETTINGS_WIDTH_OPTIONS,
  validateTuiSettingsDraft,
} from './utils/tuiSettings';
import { parseMarkerArgs, parseMarkersArgs, parseSettingsValue } from './utils/webCommands';
import './index.ts'; // start Bun.serve web server in the same process
import { IpcActionError, registry } from './actions/registry';
import type { ScriptConfigModalField, ScriptConfigModalSpec } from './actions/types';
import { startIpcServer } from './ipc/server';
import { handleScriptsCommand } from './scripts/commands';
import { loadUserScripts } from './scripts/loader';
import './actions/markers';
import './actions/chat';
import './scripts/obs-shutdown';

const settings = settingsStore;

type TwitchProviderEmoteContext = {
  getUserLogin?: () => string | null;
  userId?: string | null;
  apiClient?: { chat?: unknown } | null;
};

const DEFAULT_TUI_EMOTE_SCALE_PERCENT = 100;
const MAX_EVENT_LOG_ENTRIES = 500;
const MAX_ACTIVITY_EVENTS = 500;
const MAX_TUI_FFZ_IMAGES = 512;
const TUI_UPDATE_LOOP_DISABLED =
  process.env.YASH_DISABLE_TUI_UPDATE_LOOP === '1' ||
  process.env.YASH_DISABLE_TUI_UPDATE_LOOP === 'true';

installTuiErrorCapture();

function getChatHistoryLimit(): number {
  return readChatHistoryLimit((key, fallback) => settings.get(key, fallback));
}

function trimArrayTail<T>(items: T[], maxEntries: number): void {
  if (items.length <= maxEntries) return;
  items.splice(0, items.length - maxEntries);
}

// In-memory event log for the sidebar
const eventLog: Array<{ ts: number; platform: string; type: string; message: string }> = [];
function pushEvent(platform: string, type: string, message: string): void {
  eventLog.push({ ts: Date.now(), platform, type, message });
  trimArrayTail(eventLog, MAX_EVENT_LOG_ENTRIES);
}

// ─── Activity log ────────────────────────────────────────────────────────────
// Persisted to disk; tracks sub/follow/cheer/raid events from live platforms.

interface ActivityEvent {
  ts: number;
  platform: string;
  type: string;
  message: string;
  userId?: string;
  username?: string;
  sessionId?: string;
}

const activityEvents: ActivityEvent[] = [];
let activityRefreshTimer: ReturnType<typeof setTimeout> | null = null;
let activityBarHovered = false;
let currentActivitySessionId = '';
const INPUT_HISTORY_LIMIT = 200;

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
    pruneActivityEvents();
    require('node:fs').writeFileSync(_getActivityLogPath(), JSON.stringify(activityEvents), 'utf8');
  } catch {
    /* ignore */
  }
}

function _getInputHistoryPath(): string {
  return `${getDataDir()}/input-history.json`;
}

function _loadInputHistory(): string[] {
  try {
    const raw = require('node:fs').readFileSync(_getInputHistoryPath(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .slice(-INPUT_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

function _saveInputHistory(): void {
  try {
    require('node:fs').mkdirSync(getDataDir(), { recursive: true });
    require('node:fs').writeFileSync(
      _getInputHistoryPath(),
      `${JSON.stringify(inputHistory.slice(-INPUT_HISTORY_LIMIT), null, 2)}\n`,
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

function pruneActivityEvents(): void {
  const mode = settings.get('activity.mode', 'permanent') as string;
  if (mode === 'timed' && !activityBarHovered) {
    const secs = numSetting(settings.get('activity.timeout', 10), 10);
    const cutoff = Date.now() - secs * 1000;
    for (let i = activityEvents.length - 1; i >= 0; i--) {
      if (activityEvents[i]!.ts <= cutoff) {
        activityEvents.splice(i, 1);
      }
    }
  }
  trimArrayTail(activityEvents, MAX_ACTIVITY_EVENTS);
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
  activityRefreshTimer = setTimeout(
    () => {
      refreshDynamicUiNodes();
      _scheduleActivityBarRefresh();
    },
    nextExpiry - now + 50,
  );
}

function _rotateActivitySession(): void {
  currentActivitySessionId = crypto.randomUUID();
  settings.set('activity.sessionId', currentActivitySessionId).catch(() => {});
  activityEvents.length = 0;
  _saveActivityEvents();
  _scheduleActivityBarRefresh();
  refreshDynamicUiNodes();
}

function pushActivityEvent(platform: string, event: ActivityEventPayload): void {
  const ev: ActivityEvent = {
    ts: Date.now(),
    platform,
    type: event.type,
    message: event.message,
    userId: event.userId,
    username: event.username,
    sessionId: currentActivitySessionId,
  };
  activityEvents.push(ev);
  pruneActivityEvents();
  _saveActivityEvents();
  _scheduleActivityBarRefresh();
  refreshDynamicUiNodes();
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

function syncRuntimeMonitorTelemetrySettings(): void {
  const telemetry = readMemoryTelemetrySettings((key, fallback) => settings.get(key, fallback));
  runtimeMonitor.configureTelemetryLogging(telemetry.enabled, telemetry.intervalMinutes);
}

function syncDefaultLoggerLevelSetting(): void {
  setDefaultLoggerLevel(parseLoggerLevelName(settings.get('logs.level', 'info')));
}

function normalizeSettingValueForPersistence(key: string, value: unknown): unknown {
  if (key === 'logs.level') {
    return parseLoggerLevelName(value);
  }
  return value;
}

function applySettingSideEffects(key: string, value: unknown): void {
  if (key === 'chat.maxHistorySize') {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      chatService.setMaxHistorySize(parsed);
      trimUiChatMemory();
    }
  }
  if (key === 'memory.telemetry.enabled' || key === 'memory.telemetry.intervalMinutes') {
    syncRuntimeMonitorTelemetrySettings();
  }
  if (key === 'logs.level') {
    syncDefaultLoggerLevelSetting();
  }
  if (key === 'activity.mode') {
    pruneActivityEvents();
    _scheduleActivityBarRefresh();
  }
  if (
    key === getPlatformStatusIconPlatformSizeSettingKey('youtube') ||
    key === getPlatformStatusIconPlatformSizeSettingKey('twitch') ||
    key === getPlatformStatusIconPlatformSizeSettingKey('kick')
  ) {
    resetTuiPlatformStatusIconState();
    if (statusPlatformIconsEnabled()) {
      for (const platform of platforms) {
        scheduleTuiPlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
      }
    }
  }
  if (key === PLATFORM_STATUS_ICON_SETTING_KEY) {
    resetTuiPlatformStatusIconState();
    if (String(value).toLowerCase() === 'true') {
      warmPlatformStatusIcons();
      for (const platform of platforms) {
        scheduleTuiPlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
      }
    }
  }
}

const STRUCTURAL_SETTING_KEYS = new Set(['messages.position', 'events.width', 'logs.height']);
const DEPRECATED_SETTINGS_KEY_MESSAGES = new Map<string, string>([
  [
    'status.platformIcons.sizePx',
    '[settings] status.platformIcons.sizePx was removed; use status.platformIcons.youtube.sizePx, status.platformIcons.twitch.sizePx, and status.platformIcons.kick.sizePx instead.',
  ],
]);

async function persistSettingEntries(
  entries: Array<{ key: string; value: unknown }>,
): Promise<string[]> {
  const changedKeys: string[] = [];
  for (const entry of entries) {
    const normalizedValue = normalizeSettingValueForPersistence(entry.key, entry.value);
    if (Object.is(settings.get(entry.key, null), normalizedValue)) continue;
    await settings.set(entry.key, normalizedValue);
    applySettingSideEffects(entry.key, normalizedValue);
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

function sanitizeSnapshotLabel(raw: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return cleaned || 'manual';
}

function writeHeapSnapshotFile(label?: string): string {
  const dir = `${getDataDir()}/logs/heap-snapshots`;
  require('node:fs').mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = label ? `-${sanitizeSnapshotLabel(label)}` : '';
  const path = `${dir}/heap-${stamp}-pid${process.pid}${suffix}.heapsnapshot`;
  return v8.writeHeapSnapshot(path);
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

function statusPlatformIconsEnabled(): boolean {
  return readPlatformStatusIconsEnabled((key, fallback) => settings.get(key, fallback));
}

function getStatusPlatformIconSizePxForPlatform(platform: PlatformStatusIconPlatform): number {
  return readPlatformStatusIconSizePxForPlatform(platform, (key, fallback) =>
    settings.get(key, fallback),
  );
}

function buildPlatformStatusContent(
  platform: string,
  status: { authenticated: boolean; streamStatus: string },
  viewers: string,
): string | StyledText {
  const label = `: ${formatPlatformStatusLabel(status, viewers)}  `;
  if (!statusPlatformIconsEnabled() || !detectTuiFfzSupport()) {
    return `${platform}${label}`;
  }
  const imageId = tuiPlatformStatusIconImageIds.get(platform as PlatformStatusIconPlatform);
  if (!imageId) {
    scheduleTuiPlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
    return `${platform}${label}`;
  }
  return new StyledText([
    fg(imageIdToColorHex(imageId))(
      getTuiFfzPlaceholderCells(
        getPlatformStatusIconColumns(
          getStatusPlatformIconSizePxForPlatform(platform as PlatformStatusIconPlatform),
        ),
      ),
    ),
    fg(getPlatformStatusColor(status))(label),
  ]);
}

function getTuiMemoryStatusNodeState(): { visible: boolean; content: string; fg: string } {
  const memorySettings = readMemoryStatusSettings((key, fallback) => settings.get(key, fallback));
  if (!memorySettings.visible) {
    return { visible: false, content: '', fg: 'gray' };
  }
  const display = formatMemoryStatusDisplay(
    runtimeMonitor.getStatus().memory.rssBytes,
    memorySettings,
  );
  const fg =
    display.level === 'green'
      ? 'green'
      : display.level === 'yellow'
        ? 'yellow'
        : display.level === 'orange'
          ? '#f97316'
          : 'red';
  return {
    visible: true,
    content: `  ${display.text}`,
    fg,
  };
}

function getMemoryInsightToneColor(tone: 'default' | 'muted' | 'good' | 'warn' | 'danger'): string {
  switch (tone) {
    case 'muted':
      return 'gray';
    case 'good':
      return 'green';
    case 'warn':
      return 'yellow';
    case 'danger':
      return 'red';
    default:
      return 'white';
  }
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
  memoryText: TextRenderable;
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
let activeObsShutdownConfigModal: SettingsModal | null = null;
let activeScriptConfigModal: SettingsModal | null = null;
let activeChatterInfoModal: {
  box: BoxRenderable;
  refreshForMessage: (msg: ChatMessage) => void;
} | null = null;
let activeHistoryModal: { box: BoxRenderable } | null = null;
let activeActivityModal: { box: BoxRenderable; close: () => void } | null = null;
let activeMemoryModal: { box: BoxRenderable } | null = null;

const chatterCache = new ChatterCache();

function ensureMainInputFocus(): void {
  if (!uiNodes) return;
  if (
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal ||
    activeChatterInfoModal ||
    activeHistoryModal ||
    activeActivityModal
  )
    return;
  if (!uiNodes.inputEl.focused) {
    uiNodes.inputEl.focus();
  }
}

function closeActivityModal(): void {
  activeActivityModal?.close();
}

function toActivityChatterMessage(event: ActivityEvent): ChatMessage | null {
  if (!event.username) return null;
  return {
    id: `activity_${event.platform}_${event.userId ?? event.username}_${event.ts}`,
    platform: event.platform,
    userId: event.userId ?? event.username,
    username: event.username,
    message: event.message,
    timestamp: event.ts,
  };
}

function getConnectedMessageTargets(): MessageTarget[] {
  const targets: MessageTarget[] = ['all'];
  if (youtube.isAuthenticated()) targets.push('youtube');
  if (twitch.isAuthenticated()) targets.push('twitch');
  if (kick.isAuthenticated()) targets.push('kick');
  return targets;
}

function cycleMessageTarget(direction: 1 | -1 = 1): void {
  const targets = getConnectedMessageTargets();
  const currentIndex = targets.indexOf(selectedMessageTarget);
  if (targets.length === 0) {
    selectedMessageTarget = 'all';
    return;
  }
  const nextIndex =
    currentIndex === -1
      ? direction === -1
        ? targets.length - 1
        : 0
      : (currentIndex + direction + targets.length) % targets.length;
  selectedMessageTarget = targets[nextIndex] ?? 'all';
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
      content: buildPlatformStatusContent(platform, status, viewers),
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

  const initialMemoryState = getTuiMemoryStatusNodeState();
  const memoryText = new TextRenderable(renderer, {
    content: initialMemoryState.content,
    fg: initialMemoryState.fg,
  });
  memoryText.visible = initialMemoryState.visible;
  memoryText.onMouseDown = (e) => {
    if (e.button === 0) openMemoryStatusModal();
  };
  platformRow.add(memoryText);

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
  });
  const openActivityFromBar = (): void => openActivityModal();
  activityBar.add(activityBarLabel);
  activityBar.add(activityBarText);
  activityBar.onMouseDown = () => openActivityFromBar();
  activityBarLabel.onMouseDown = () => openActivityFromBar();
  activityBarText.onMouseDown = () => openActivityFromBar();
  activityBar.onMouseOver = () => {
    activityBarHovered = true;
    if (activityRefreshTimer) {
      clearTimeout(activityRefreshTimer);
      activityRefreshTimer = null;
    }
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
    memoryText,
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
  node.content = new StyledText(parts);
}

function openActivityModal(): void {
  try {
    if (
      !uiNodes ||
      activeActivityModal ||
      activeMemoryModal ||
      activeModal ||
      activeStreamModal ||
      activeSettingsModal ||
      activeObsShutdownConfigModal ||
      activeScriptConfigModal ||
      activeChatterInfoModal ||
      activeHistoryModal
    )
      return;
    const { renderer } = uiNodes;

    const box = new BoxRenderable(renderer, {
      position: 'absolute',
      top: '5%',
      left: '5%',
      width: '90%',
      height: '72%',
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
      scroll.add(
        new TextRenderable(renderer, { content: '  No activity events yet.', fg: 'gray' }),
      );
    } else {
      for (const ev of events) {
        const time = new Date(ev.ts).toLocaleTimeString();
        const row = new BoxRenderable(renderer, { flexDirection: 'row', width: '100%' });
        row.add(new TextRenderable(renderer, { content: `  [${time}] `, fg: 'gray' }));
        row.add(
          new TextRenderable(renderer, {
            content: `[${ev.platform}] ${ev.type}: `,
            fg: _activityPlatformColor(ev.platform),
          }),
        );
        const activityMessage = toActivityChatterMessage(ev);
        if (activityMessage) {
          const prefix = `${ev.username} `;
          const suffix = ev.message.startsWith(prefix)
            ? ev.message.slice(prefix.length)
            : ev.message;
          const usernameNode = new TextRenderable(renderer, {
            content: ev.username,
            fg: _activityPlatformColor(ev.platform),
            attributes: TextAttributes.UNDERLINE,
          });
          usernameNode.onMouseDown = (e) => {
            if (e.button !== 0) return;
            closeActivityModal();
            openChatterInfoModal(activityMessage);
          };
          row.add(usernameNode);
          row.add(
            new TextRenderable(renderer, {
              content: suffix ? ` ${suffix}` : '',
              fg: _activityPlatformColor(ev.platform),
            }),
          );
        } else {
          row.add(
            new TextRenderable(renderer, {
              content: ev.message,
              fg: _activityPlatformColor(ev.platform),
            }),
          );
        }
        scroll.add(row);
      }
    }

    box.add(scroll);
    renderer.root.add(box);
    const keyHandler = (sequence: string): boolean => {
      if (!activeActivityModal) return false;
      if (sequence === '\x1b' || sequence === '\x1b\x1b') {
        closeActivityModal();
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
    const close = (): void => {
      if (!activeActivityModal) return;
      renderer.removeInputHandler(keyHandler);
      renderer.root.remove(box.id);
      activeActivityModal = null;
      ensureMainInputFocus();
    };
    activeActivityModal = { box, close };
    renderer.prependInputHandler(keyHandler);
  } catch (err) {
    lastMessages.push(`[system] Failed to open activity modal: ${String(err)}`);
    updateUI(lastMessages);
  }
}

function openMemoryStatusModal(): void {
  if (
    !uiNodes ||
    activeMemoryModal ||
    activeActivityModal ||
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal ||
    activeChatterInfoModal ||
    activeHistoryModal
  )
    return;

  const memorySettings = readMemoryStatusSettings((key, fallback) => settings.get(key, fallback));
  if (!memorySettings.visible) return;

  const insight = buildMemoryInsightSummary(runtimeMonitor.getStatus(), memorySettings);
  const { renderer } = uiNodes;
  const statusColor =
    insight.statusLevel === 'green'
      ? 'green'
      : insight.statusLevel === 'yellow'
        ? 'yellow'
        : insight.statusLevel === 'orange'
          ? '#f97316'
          : 'red';

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '8%',
    left: '6%',
    width: '88%',
    height: '72%',
    zIndex: 110,
    border: true,
    borderStyle: 'rounded',
    borderColor: statusColor,
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 0,
    title: ` Memory Status ${insight.title} `,
  });

  box.add(
    new TextRenderable(renderer, {
      content: `  ${insight.statusText}  •  ↑↓ scroll  •  Esc close`,
      fg: statusColor,
      attributes: TextAttributes.BOLD,
    }),
  );
  box.add(new TextRenderable(renderer, { content: '', fg: 'gray' }));

  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
  });

  for (const line of insight.lines) {
    scroll.add(
      new TextRenderable(renderer, {
        content: `  ${line.text}`,
        fg: getMemoryInsightToneColor(line.tone),
      }),
    );
  }

  box.add(scroll);
  renderer.root.add(box);
  activeMemoryModal = { box };

  const keyHandler = (sequence: string): boolean => {
    if (!activeMemoryModal) return false;
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      renderer.removeInputHandler(keyHandler);
      renderer.root.remove(box.id);
      activeMemoryModal = null;
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
  const startedAt = performance.now();
  trimUiChatMemory();
  pruneActivityEvents();
  refreshDynamicUiNodes();
  const { renderer, chatScroll, sidebarBox, sidebarScroll } = uiNodes;

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

  // Sidebar: clear and refill
  const eventsVisible = boolSetting(settings.get('events.visible', true), true);
  const logsVisible = boolSetting(settings.get('logs.visible', true), true);
  const eventsTail = numSetting(settings.get('events.tail', 15), 15);
  const logsTail = numSetting(settings.get('logs.tail', 20), 20);
  sidebarBox.visible = eventsVisible || logsVisible;
  clearScrollBox(sidebarScroll);
  _fillSidebar(renderer, sidebarScroll, eventsVisible, logsVisible, eventsTail, logsTail);

  ensureMainInputFocus();
  lastUpdateLoopSignature = getUpdateLoopRefreshSignature();

  const durationMs = performance.now() - startedAt;
  updateUiCount += 1;
  updateUiTotalDurationMs += durationMs;
  updateUiLastDurationMs = durationMs;
  if (durationMs > updateUiMaxDurationMs) {
    updateUiMaxDurationMs = durationMs;
  }
  updateUiLastMessageCount = messages.length;
  const chatChildren = chatScroll.getChildren().length;
  const sidebarChildren = sidebarScroll.getChildren().length;
  if (chatChildren > updateUiChatChildrenHighWater) {
    updateUiChatChildrenHighWater = chatChildren;
  }
  if (sidebarChildren > updateUiSidebarChildrenHighWater) {
    updateUiSidebarChildrenHighWater = sidebarChildren;
  }
}

function refreshDynamicUiNodes(): void {
  if (!uiNodes) return;
  const {
    titleText,
    subtitleText,
    platformTexts,
    memoryText,
    obsText,
    demoText,
    totalViewersText,
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
      node.content = buildPlatformStatusContent(platform, status, viewers);
      node.fg = getPlatformStatusColor(status);
    }
  }

  obsText.content = `  OBS: ${obsService.isConnected() ? '✓' : '✗'}`;
  obsText.fg = obsService.isConnected() ? 'green' : 'red';
  demoText.visible = isDemoMode();
  totalViewersText.content = `  Total viewers: ${totalViewers}`;
  totalViewersText.visible =
    viewersVisible && (viewersMode === 'cumulative' || viewersMode === 'both');
  const memoryState = getTuiMemoryStatusNodeState();
  memoryText.content = memoryState.content;
  memoryText.fg = memoryState.fg;
  memoryText.visible = memoryState.visible;

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
    saved.markerSyncDelay.offsetSeconds !== 0 ? String(saved.markerSyncDelay.offsetSeconds) : '';
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

function openMarkerEditModal(selectionId: number): void {
  if (
    !uiNodes ||
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal
  )
    return;
  const marker = youtube.getPersistedMarkerBySelectionId(selectionId);
  if (!marker) {
    lastMessages.push(`[markers] Unknown persisted marker #${selectionId}`);
    updateUI(lastMessages);
    return;
  }

  const { renderer } = uiNodes;
  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '18%',
    left: '12%',
    width: '76%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ` Edit Marker #${selectionId} `,
  });

  const instructions = new TextRenderable(renderer, {
    content:
      ' Update the label and/or timestamp for this persisted YouTube marker. Enter saves, Esc cancels.',
    fg: 'gray',
  });
  const currentText = new TextRenderable(renderer, {
    content: ` Current: ${marker.description || '(untitled)'} @ ${marker.positionInSeconds}s`,
    fg: 'yellow',
  });
  const descriptionLabel = new TextRenderable(renderer, {
    content: ' Description:',
    fg: 'cyan',
  });
  const descriptionInput = new InputRenderable(renderer, {
    placeholder: 'marker label',
    width: '100%',
  });
  descriptionInput.value = marker.description;
  const descriptionRow = createIndentedInputRow(renderer, descriptionInput, '    ');

  const timestampLabel = new TextRenderable(renderer, {
    content: ' Timestamp (s):',
    fg: 'cyan',
  });
  const timestampInput = new InputRenderable(renderer, {
    placeholder: 'seconds from stream start',
    width: '100%',
  });
  timestampInput.value = String(marker.positionInSeconds);
  const timestampRow = createIndentedInputRow(renderer, timestampInput, '    ');

  const hint = new TextRenderable(renderer, {
    content: '  [Tab] navigate  [Enter] save  [Esc] cancel',
    fg: 'gray',
  });

  box.add(instructions);
  box.add(currentText);
  box.add(descriptionLabel);
  box.add(descriptionRow);
  box.add(timestampLabel);
  box.add(timestampRow);
  box.add(hint);
  renderer.root.add(box);

  const inputs = [descriptionInput, timestampInput];
  let focusIndex = 0;
  activeModal = { box, focusIndex };
  descriptionInput.focus();

  async function closeModal(save: boolean): Promise<void> {
    if (!activeModal) return;
    let parsedTimestamp: number | null = null;
    if (save) {
      parsedTimestamp = Number.parseInt(timestampInput.value.trim(), 10);
      if (!Number.isFinite(parsedTimestamp) || parsedTimestamp < 0) {
        lastMessages.push('[markers] Timestamp must be a non-negative integer.');
        updateUI(lastMessages);
        return;
      }
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeModal = null;
    uiNodes?.inputEl.focus();

    if (!save) {
      lastMessages.push(`[markers] edit cancelled for #${selectionId}`);
      updateUI(lastMessages);
      return;
    }

    try {
      const ctx = { chatService, providers: { youtube, twitch, kick } };
      const result = await registry.invokeAction(
        'markers.edit',
        {
          selectionId,
          text: descriptionInput.value,
          timestamp: parsedTimestamp,
        },
        ctx,
      );
      for (const line of result.output ?? []) lastMessages.push(line);
      for (const warn of result.warnings ?? []) lastMessages.push(`[system] ${warn}`);
    } catch (err) {
      if (err instanceof IpcActionError) {
        lastMessages.push(`[markers] ${err.message}`);
      } else {
        lastMessages.push(`[markers] Error: ${String(err)}`);
      }
    }
    updateUI(lastMessages);
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeModal) return false;
    if (sequence === '\t') {
      inputs[focusIndex]?.blur();
      focusIndex = (focusIndex + 1) % inputs.length;
      activeModal.focusIndex = focusIndex;
      inputs[focusIndex]?.focus();
      return true;
    }
    if (sequence === '\x1b[Z') {
      inputs[focusIndex]?.blur();
      focusIndex = (focusIndex - 1 + inputs.length) % inputs.length;
      activeModal.focusIndex = focusIndex;
      inputs[focusIndex]?.focus();
      return true;
    }
    if (sequence === '\r' || sequence === '\n') {
      void closeModal(true);
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      void closeModal(false);
      return true;
    }
    if (sequence === '\x1b[A' || sequence === '\x1b[B') return true;
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeModal) void closeModal(false);
  };
  for (const input of inputs) {
    input.onKeyDown = escapeViaKeyDown;
  }
}

function openStreamModal(preselected: string[]): void {
  if (
    !uiNodes ||
    activeStreamModal ||
    activeModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal
  )
    return;
  const { renderer } = uiNodes;

  const defaultSelectedPlatforms =
    preselected.length > 0
      ? preselected
      : platforms.filter((platform) => {
          const provider = platform === 'youtube' ? youtube : platform === 'twitch' ? twitch : kick;
          return provider.isAuthenticated();
        });
  const selectedPlatforms = new Set(
    defaultSelectedPlatforms.length > 0 ? defaultSelectedPlatforms : [...platforms],
  );
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
          if (platform === 'twitch') {
            void refreshTuiFfzEmotes('twitch-authentication');
          }
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
      try {
        const ctx = { chatService, providers: { youtube, twitch, kick } };
        const result = await registry.invokeAction('chat.send', { platform: target, text }, ctx);
        for (const line of result.output ?? []) emit(line);
        for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
      } catch (err) {
        if (err instanceof IpcActionError) {
          emit(`[system] ${err.message}`);
        } else {
          emit(`[system] Failed to send message: ${String(err)}`);
        }
      }
    } else {
      emit('[system] Usage: /msg <all|youtube|twitch|kick> <text>');
    }
  },

  '/marker': async (parts, emit) => {
    const rawParts = parts.slice(1);
    const { description: text, timestamp } = parseMarkerArgs(rawParts);

    try {
      const ctx = { chatService, providers: { youtube, twitch, kick } };
      const markerArgs: Record<string, unknown> = { text, platform: 'all' };
      if (timestamp !== undefined) markerArgs.timestamp = timestamp;
      const result = await registry.invokeAction('marker.create', markerArgs, ctx);
      for (const line of result.output ?? []) emit(line);
      for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
    } catch (err) {
      if (err instanceof IpcActionError) {
        emit(`[marker] ${err.message}`);
      } else {
        emit(`[marker] Error: ${String(err)}`);
      }
    }
    updateUI(lastMessages);
  },

  '/markers': async (parts, emit) => {
    const parsed = parseMarkersArgs(parts.slice(1));
    if (parsed.error) {
      emit(
        `[markers] Usage: /markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit] (${parsed.error})`,
      );
      updateUI(lastMessages);
      return;
    }

    if (parsed.action === 'restore') {
      try {
        const ctx = { chatService, providers: { youtube, twitch, kick } };
        const result = await registry.invokeAction(
          'markers.restore',
          { source: parsed.restoreSource, limit: parsed.limit },
          ctx,
        );
        for (const line of result.output ?? []) emit(line);
        for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
      } catch (err) {
        if (err instanceof IpcActionError) {
          emit(`[markers] ${err.message}`);
        } else {
          emit(`[markers] restore error: ${String(err)}`);
        }
      }
      updateUI(lastMessages);
      return;
    }

    if (parsed.action === 'clear') {
      try {
        const result = await youtube.clearPersistedMarkers(parsed.clearSelectionIds);
        if (parsed.clearSelectionIds && parsed.clearSelectionIds.length > 0) {
          const clearedLabel =
            result.clearedSelectionIds.length > 0
              ? `cleared markers ${result.clearedSelectionIds.map((id) => `#${id}`).join(', ')}`
              : 'no matching markers cleared';
          const missingLabel =
            result.missingSelectionIds.length > 0
              ? ` (missing: ${result.missingSelectionIds.map((id) => `#${id}`).join(', ')})`
              : '';
          emit(`[markers] youtube: ${clearedLabel}${missingLabel}`);
        } else {
          emit('[markers] youtube: cleared all persisted markers');
        }
      } catch (err) {
        emit(`[markers] youtube: clear error: ${String(err)}`);
      }
      updateUI(lastMessages);
      return;
    }

    if (parsed.action === 'edit') {
      openMarkerEditModal(parsed.editSelectionId!);
      return;
    }

    try {
      const ctx = { chatService, providers: { youtube, twitch, kick } };
      const actionArgs: Record<string, unknown> = {
        platform: parsed.platforms?.[0] ?? 'all',
      };
      if (parsed.limit !== undefined) actionArgs.limit = parsed.limit;
      const result = await registry.invokeAction('markers.list', actionArgs, ctx);
      for (const line of result.output ?? []) emit(line);
      for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
    } catch (err) {
      if (err instanceof IpcActionError) {
        emit(`[markers] ${err.message}`);
      } else {
        emit(`[markers] Error: ${String(err)}`);
      }
    }
    updateUI(lastMessages);
  },

  '/settings': async (parts, emit) => {
    const op = parts[1];
    if (!op) {
      openSettingsModal();
    } else if (op === 'get' && parts[2]) {
      const key = parts[2];
      const deprecatedMessage = DEPRECATED_SETTINGS_KEY_MESSAGES.get(key);
      if (deprecatedMessage) {
        emit(deprecatedMessage);
        return;
      }
      const val = getSettingValue(key);
      emit(`[settings] ${key} = ${JSON.stringify(val)}`);
    } else if (op === 'set' && parts[2] && parts[3]) {
      const key = parts[2];
      const deprecatedMessage = DEPRECATED_SETTINGS_KEY_MESSAGES.get(key);
      if (deprecatedMessage) {
        emit(deprecatedMessage);
        return;
      }
      const rawValue = parts.slice(3).join(' ');
      const value = parseSettingsValue(rawValue);
      const changedKeys = await persistSettingEntries([{ key, value }]);
      if (changedKeys.length === 0) emit('[settings] No changes.');
      else {
        emit(
          `[settings] set ${key} = ${JSON.stringify(normalizeSettingValueForPersistence(key, value))}`,
        );
        if (changedKeys.includes('tui.emotes.scale')) {
          void reloadTuiFfzEmotes('tui-emote-scale-command');
        }
      }
    } else {
      emit('[system] Usage: /settings | /settings get <key> | /settings set <key> <json-value>');
      emit(
        '[system] Common keys: stream.title, stream.description, chat.maxHistorySize, demo, title.visible, logs.visible, logs.level, logs.height, logs.tail, viewers.visible, viewers.mode, status.platformIcons.visible, status.platformIcons.youtube.sizePx, status.platformIcons.twitch.sizePx, status.platformIcons.kick.sizePx, memory.status.visible, memory.status.greenMaxMb, memory.status.orangeMinMb, memory.status.redMinMb, memory.telemetry.enabled, memory.telemetry.intervalMinutes, messages.position, chat.timestamps.visible, tui.emotes.scale, events.visible, events.tail, events.width, platforms.<provider>.showViewers, platforms.youtube.setup.*',
      );
    }
  },

  '/scripts': async (parts, emit) => {
    await handleScriptsCommand(parts, emit, getDataDir());
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
    for (const line of renderTuiHelpLines()) emit(line);
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

  '/memory': async (_parts, emit) => {
    const sub = (_parts[1] ?? '').toLowerCase();
    if (sub === 'modal') {
      openMemoryStatusModal();
      return;
    }
    if (sub === 'snapshot') {
      const label = _parts.slice(2).join(' ').trim();
      emit(
        '[memory] writing heap snapshot; this can pause the process and temporarily increase memory use.',
      );
      const snapshotPath = writeHeapSnapshotFile(label || undefined);
      emit(`[memory] heap snapshot written to ${snapshotPath}`);
      return;
    }
    for (const line of formatRuntimeStatusLines(runtimeMonitor.getStatus())) {
      emit(line);
    }
    for (const line of youtube.getDebugNotes()) {
      emit(line);
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

  '/action': async (parts, emit) => {
    // Case 1 — no action id: list all public IPC-enabled actions grouped by domain
    if (parts.length <= 1) {
      const allActions = registry.listActions({ ipcOnly: true, details: true }) as Array<{
        id: string;
        title: string;
        domain: string;
        visibility: string;
        safety: string;
      }>;
      const publicActions = allActions.filter(
        (a) => a.visibility === 'public' && a.safety !== 'blocked',
      );
      const byDomain = new Map<string, typeof publicActions>();
      for (const action of publicActions) {
        const group = byDomain.get(action.domain) ?? [];
        group.push(action);
        byDomain.set(action.domain, group);
      }
      for (const [domain, actions] of byDomain) {
        emit(`${domain}:`);
        for (const action of actions) {
          emit(`  ${action.id.padEnd(30)}${action.title}`);
        }
      }
      return;
    }

    const id = parts[1] ?? '';

    // Case 2 — action id only, no args: invoke if no args are required, else show help
    if (parts.length === 2) {
      const def = registry.getAction(id);
      if (!def) {
        emit(`[action] Unknown action: ${id}`);
        return;
      }
      const hasRequiredArgs = Object.values(def.args).some((schema) => schema.required === true);
      if (!hasRequiredArgs) {
        // No required args — invoke with config/default-backed empty args
        try {
          await invokeActionFromTui(id, {}, emit);
        } catch (err) {
          const msg = err instanceof IpcActionError ? err.message : String(err);
          emit(`[action] Error: ${msg}`);
        }
        return;
      }
      for (const line of formatActionHelp(def)) emit(line);
      return;
    }

    // Case 3 — action id + arg tokens: parse and invoke
    const def = registry.getAction(id);
    if (!def) {
      emit(`[action] Unknown action: ${id}`);
      return;
    }

    const { args, errors } = parseActionArgs(parts.slice(2), def.args);
    if (errors.length > 0) {
      for (const err of errors) emit(`[action] ${err}`);
      return;
    }

    try {
      await invokeActionFromTui(id, args, emit);
    } catch (err) {
      if (err instanceof IpcActionError) {
        emit(`[action] ${err.message}`);
      } else {
        emit(`[action] Internal error`);
      }
    }
  },
};
initTuiCommands(Object.keys(commandHandlers).sort());
setActionRegistry(registry);
setActionAutocompleteRuntime({
  getObsConnectionState: () => obsService.isConnected(),
  getObsCurrentScene: () => obsService.getCurrentScene(),
  getObsSceneList: () => obsService.getSceneList(),
  getObsSceneItemList: (sceneName) => obsService.getSceneItemList(sceneName),
});
obsService.subscribeToCurrentSceneChanges(() => {
  clearActionAutocompleteCaches();
});
obsService.subscribeToStatusChanges(() => {
  clearActionAutocompleteCaches();
});

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

  lastMessages.push(transformCommandFeedback('you', trimmed));
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
  const mirrored = true;
  lastMessages.push(transformCommandFeedback('ipc', trimmed));
  const output = await runIpcCommand(trimmed, commandHandlers, pushEvent, (line) => {
    lastMessages.push(line);
  });
  if (mirrored) updateUI(lastMessages);
  return output;
}

function openSettingsModal(): void {
  if (
    !uiNodes ||
    activeStreamModal ||
    activeModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal
  )
    return;
  const { renderer } = uiNodes;

  const draft = {
    demo: boolSetting(settings.get('demo', false), false),
    titleVisible: boolSetting(settings.get('title.visible', false), false),
    viewersVisible: boolSetting(settings.get('viewers.visible', true), true),
    viewersMode: String(settings.get('viewers.mode', 'per-platform') ?? 'per-platform'),
    platformIconsVisible: boolSetting(settings.get(PLATFORM_STATUS_ICON_SETTING_KEY, false), false),
    platformIconsYoutubeSizePx: String(
      numSetting(
        settings.get(
          getPlatformStatusIconPlatformSizeSettingKey('youtube'),
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
        ),
        DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
      ),
    ),
    platformIconsTwitchSizePx: String(
      numSetting(
        settings.get(
          getPlatformStatusIconPlatformSizeSettingKey('twitch'),
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
        ),
        DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
      ),
    ),
    platformIconsKickSizePx: String(
      numSetting(
        settings.get(
          getPlatformStatusIconPlatformSizeSettingKey('kick'),
          DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
        ),
        DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX,
      ),
    ),
    memoryStatusVisible: boolSetting(settings.get('memory.status.visible', false), false),
    memoryStatusGreenMaxMb: String(
      numSetting(
        settings.get('memory.status.greenMaxMb', DEFAULT_MEMORY_STATUS_GREEN_MAX_MB),
        DEFAULT_MEMORY_STATUS_GREEN_MAX_MB,
      ),
    ),
    memoryStatusOrangeMinMb: String(
      numSetting(
        settings.get('memory.status.orangeMinMb', DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB),
        DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB,
      ),
    ),
    memoryStatusRedMinMb: String(
      numSetting(
        settings.get('memory.status.redMinMb', DEFAULT_MEMORY_STATUS_RED_MIN_MB),
        DEFAULT_MEMORY_STATUS_RED_MIN_MB,
      ),
    ),
    memoryTelemetryEnabled: boolSetting(settings.get('memory.telemetry.enabled', false), false),
    memoryTelemetryIntervalMinutes: String(
      numSetting(
        settings.get('memory.telemetry.intervalMinutes', DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES),
        DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES,
      ),
    ),
    messagesPosition: String(settings.get('messages.position', 'bottom') ?? 'bottom'),
    chatTimestampsVisible: boolSetting(settings.get('chat.timestamps.visible', true), true),
    tuiEmotesScale: String(
      numSetting(
        settings.get('tui.emotes.scale', DEFAULT_TUI_EMOTE_SCALE_PERCENT),
        DEFAULT_TUI_EMOTE_SCALE_PERCENT,
      ),
    ),
    chatMaxHistorySize: String(numSetting(settings.get('chat.maxHistorySize', 1000), 1000)),
    eventsVisible: boolSetting(settings.get('events.visible', true), true),
    eventsTail: String(numSetting(settings.get('events.tail', 15), 15)),
    eventsWidth: String(settings.get('events.width', '30%') ?? '30%'),
    logsVisible: boolSetting(settings.get('logs.visible', true), true),
    logsLevel: parseLoggerLevelName(settings.get('logs.level', 'info')),
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
  const platformIconsVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const platformIconsYoutubeSizeLabel = makeLabel(
    '  status.platformIcons.youtube.sizePx: YouTube logo size override in pixels',
  );
  const platformIconsYoutubeSizeInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX),
    width: '100%',
  });
  const platformIconsYoutubeSizeInputRow = createIndentedInputRow(
    renderer,
    platformIconsYoutubeSizeInput,
    '    ',
  );
  platformIconsYoutubeSizeInput.value = draft.platformIconsYoutubeSizePx;
  const platformIconsTwitchSizeLabel = makeLabel(
    '  status.platformIcons.twitch.sizePx: Twitch logo size override in pixels',
  );
  const platformIconsTwitchSizeInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX),
    width: '100%',
  });
  const platformIconsTwitchSizeInputRow = createIndentedInputRow(
    renderer,
    platformIconsTwitchSizeInput,
    '    ',
  );
  platformIconsTwitchSizeInput.value = draft.platformIconsTwitchSizePx;
  const platformIconsKickSizeLabel = makeLabel(
    '  status.platformIcons.kick.sizePx: Kick logo size override in pixels',
  );
  const platformIconsKickSizeInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_PLATFORM_STATUS_ICON_SIZE_PX),
    width: '100%',
  });
  const platformIconsKickSizeInputRow = createIndentedInputRow(
    renderer,
    platformIconsKickSizeInput,
    '    ',
  );
  platformIconsKickSizeInput.value = draft.platformIconsKickSizePx;
  const memoryStatusVisibleRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const memoryStatusGreenMaxMbLabel = makeLabel(
    '  memory.status.greenMaxMb: green at or below this RSS threshold in MB',
  );
  const memoryStatusGreenMaxMbInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_STATUS_GREEN_MAX_MB),
    width: '100%',
  });
  const memoryStatusGreenMaxMbInputRow = createIndentedInputRow(
    renderer,
    memoryStatusGreenMaxMbInput,
    '    ',
  );
  memoryStatusGreenMaxMbInput.value = draft.memoryStatusGreenMaxMb;
  const memoryStatusOrangeMinMbLabel = makeLabel(
    '  memory.status.orangeMinMb: orange at or above this RSS threshold in MB',
  );
  const memoryStatusOrangeMinMbInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_STATUS_ORANGE_MIN_MB),
    width: '100%',
  });
  const memoryStatusOrangeMinMbInputRow = createIndentedInputRow(
    renderer,
    memoryStatusOrangeMinMbInput,
    '    ',
  );
  memoryStatusOrangeMinMbInput.value = draft.memoryStatusOrangeMinMb;
  const memoryStatusRedMinMbLabel = makeLabel(
    '  memory.status.redMinMb: red at or above this RSS threshold in MB',
  );
  const memoryStatusRedMinMbInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_STATUS_RED_MIN_MB),
    width: '100%',
  });
  const memoryStatusRedMinMbInputRow = createIndentedInputRow(
    renderer,
    memoryStatusRedMinMbInput,
    '    ',
  );
  memoryStatusRedMinMbInput.value = draft.memoryStatusRedMinMb;
  const memoryTelemetryEnabledRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const memoryTelemetryIntervalMinutesLabel = makeLabel(
    '  memory.telemetry.intervalMinutes: write RSS telemetry to YASH_DATA_DIR/logs every N minutes',
  );
  const memoryTelemetryIntervalMinutesInput = new InputRenderable(renderer, {
    placeholder: String(DEFAULT_MEMORY_TELEMETRY_INTERVAL_MINUTES),
    width: '100%',
  });
  const memoryTelemetryIntervalMinutesInputRow = createIndentedInputRow(
    renderer,
    memoryTelemetryIntervalMinutesInput,
    '    ',
  );
  memoryTelemetryIntervalMinutesInput.value = draft.memoryTelemetryIntervalMinutes;
  const messagesPositionRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const chatTimestampsRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const tuiEmotesScaleLabel = makeLabel(
    '  tui.emotes.scale: percent size for inline TUI emotes (100 = normal, 150 = larger)',
  );
  const tuiEmotesScaleInput = new InputRenderable(renderer, {
    placeholder: '100',
    width: '100%',
  });
  const tuiEmotesScaleInputRow = createIndentedInputRow(renderer, tuiEmotesScaleInput, '    ');
  tuiEmotesScaleInput.value = draft.tuiEmotesScale;
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
  const logsLevelRow = new TextRenderable(renderer, { content: '', fg: 'white' });
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
  contentBox.add(platformIconsVisibleRow);
  contentBox.add(platformIconsYoutubeSizeLabel);
  contentBox.add(platformIconsYoutubeSizeInputRow);
  contentBox.add(platformIconsTwitchSizeLabel);
  contentBox.add(platformIconsTwitchSizeInputRow);
  contentBox.add(platformIconsKickSizeLabel);
  contentBox.add(platformIconsKickSizeInputRow);
  contentBox.add(memoryStatusVisibleRow);
  contentBox.add(memoryStatusGreenMaxMbLabel);
  contentBox.add(memoryStatusGreenMaxMbInputRow);
  contentBox.add(memoryStatusOrangeMinMbLabel);
  contentBox.add(memoryStatusOrangeMinMbInputRow);
  contentBox.add(memoryStatusRedMinMbLabel);
  contentBox.add(memoryStatusRedMinMbInputRow);
  contentBox.add(memoryTelemetryEnabledRow);
  contentBox.add(memoryTelemetryIntervalMinutesLabel);
  contentBox.add(memoryTelemetryIntervalMinutesInputRow);
  contentBox.add(messagesPositionRow);
  contentBox.add(chatTimestampsRow);
  contentBox.add(tuiEmotesScaleLabel);
  contentBox.add(tuiEmotesScaleInputRow);
  contentBox.add(historySizeLabel);
  contentBox.add(historySizeInputRow);
  contentBox.add(sidebarHeading);
  contentBox.add(eventsVisibleRow);
  contentBox.add(eventsTailLabel);
  contentBox.add(eventsTailInputRow);
  contentBox.add(eventsWidthRow);
  contentBox.add(logsVisibleRow);
  contentBox.add(logsLevelRow);
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
        container: TextRenderable;
        render: (focused: boolean) => void;
        toggle: () => void;
      }
    | {
        kind: 'enum';
        node: TextRenderable;
        container: TextRenderable;
        render: (focused: boolean) => void;
        cycle: (direction: 1 | -1) => void;
      }
    | { kind: 'input'; node: InputRenderable; container: BoxRenderable };

  function cycleOption(current: string, options: readonly string[], direction: 1 | -1): string {
    const currentIndex = Math.max(0, options.indexOf(current));
    const nextIndex = (currentIndex + direction + options.length) % options.length;
    return options[nextIndex] ?? options[0] ?? current;
  }

  function scrollCurrentIntoView(): void {
    const current = items[focusIdx];
    if (!current) return;
    contentScroll.scrollChildIntoView(current.container.id);
  }

  const items: SettingsFocusItem[] = [
    {
      kind: 'toggle',
      node: demoRow,
      container: demoRow,
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
      container: titleVisibleRow,
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
      container: viewersVisibleRow,
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
      container: viewersModeRow,
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
      kind: 'toggle',
      node: platformIconsVisibleRow,
      container: platformIconsVisibleRow,
      render: (focused) => {
        platformIconsVisibleRow.content = makeToggleRow(
          'status.platformIcons.visible',
          draft.platformIconsVisible,
          focused,
        ).concat('  - swap YOUTUBE/TWITCH/KICK labels for lazily downloaded logos');
        platformIconsVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.platformIconsVisible = !draft.platformIconsVisible;
      },
    },
    {
      kind: 'input',
      node: platformIconsYoutubeSizeInput,
      container: platformIconsYoutubeSizeInputRow,
    },
    {
      kind: 'input',
      node: platformIconsTwitchSizeInput,
      container: platformIconsTwitchSizeInputRow,
    },
    {
      kind: 'input',
      node: platformIconsKickSizeInput,
      container: platformIconsKickSizeInputRow,
    },
    {
      kind: 'toggle',
      node: memoryStatusVisibleRow,
      container: memoryStatusVisibleRow,
      render: (focused) => {
        memoryStatusVisibleRow.content = makeToggleRow(
          'memory.status.visible',
          draft.memoryStatusVisible,
          focused,
        ).concat('  - show current YASH RSS in the status bar');
        memoryStatusVisibleRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.memoryStatusVisible = !draft.memoryStatusVisible;
      },
    },
    {
      kind: 'input',
      node: memoryStatusGreenMaxMbInput,
      container: memoryStatusGreenMaxMbInputRow,
    },
    {
      kind: 'input',
      node: memoryStatusOrangeMinMbInput,
      container: memoryStatusOrangeMinMbInputRow,
    },
    {
      kind: 'input',
      node: memoryStatusRedMinMbInput,
      container: memoryStatusRedMinMbInputRow,
    },
    {
      kind: 'toggle',
      node: memoryTelemetryEnabledRow,
      container: memoryTelemetryEnabledRow,
      render: (focused) => {
        memoryTelemetryEnabledRow.content = makeToggleRow(
          'memory.telemetry.enabled',
          draft.memoryTelemetryEnabled,
          focused,
        ).concat('  - append detailed memory telemetry JSONL under YASH_DATA_DIR/logs');
        memoryTelemetryEnabledRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.memoryTelemetryEnabled = !draft.memoryTelemetryEnabled;
      },
    },
    {
      kind: 'input',
      node: memoryTelemetryIntervalMinutesInput,
      container: memoryTelemetryIntervalMinutesInputRow,
    },
    {
      kind: 'enum',
      node: messagesPositionRow,
      container: messagesPositionRow,
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
      container: chatTimestampsRow,
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
    { kind: 'input', node: tuiEmotesScaleInput, container: tuiEmotesScaleInputRow },
    { kind: 'input', node: historySizeInput, container: historySizeInputRow },
    {
      kind: 'toggle',
      node: eventsVisibleRow,
      container: eventsVisibleRow,
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
    { kind: 'input', node: eventsTailInput, container: eventsTailInputRow },
    {
      kind: 'enum',
      node: eventsWidthRow,
      container: eventsWidthRow,
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
      container: logsVisibleRow,
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
    {
      kind: 'enum',
      node: logsLevelRow,
      container: logsLevelRow,
      render: (focused) => {
        logsLevelRow.content = makeEnumRow('logs.level', draft.logsLevel, focused).concat(
          '  - choose the minimum application log level kept and shown',
        );
        logsLevelRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.logsLevel = cycleOption(draft.logsLevel, SETTINGS_LOG_LEVELS, direction);
      },
    },
    { kind: 'input', node: logsHeightInput, container: logsHeightInputRow },
    { kind: 'input', node: logsTailInput, container: logsTailInputRow },
    {
      kind: 'toggle',
      node: ytViewersRow,
      container: ytViewersRow,
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
      container: twitchViewersRow,
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
      container: kickViewersRow,
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
      container: activityVisibleRow,
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
      container: activityModeRow,
      render: (focused) => {
        activityModeRow.content = makeEnumRow('activity.mode', draft.activityMode, focused).concat(
          '  - permanent: events stay until cleared; timed: each event expires after timeout',
        );
        activityModeRow.fg = focused ? 'cyan' : 'white';
      },
      cycle: (direction) => {
        draft.activityMode = cycleOption(draft.activityMode, SETTINGS_ACTIVITY_MODES, direction);
      },
    },
    { kind: 'input', node: activityTimeoutInput, container: activityTimeoutInputRow },
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
    scrollCurrentIntoView();
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
      platformIconsYoutubeSizePx: platformIconsYoutubeSizeInput.value,
      platformIconsTwitchSizePx: platformIconsTwitchSizeInput.value,
      platformIconsKickSizePx: platformIconsKickSizeInput.value,
      memoryStatusGreenMaxMb: memoryStatusGreenMaxMbInput.value,
      memoryStatusOrangeMinMb: memoryStatusOrangeMinMbInput.value,
      memoryStatusRedMinMb: memoryStatusRedMinMbInput.value,
      memoryTelemetryIntervalMinutes: memoryTelemetryIntervalMinutesInput.value,
      tuiEmotesScale: tuiEmotesScaleInput.value,
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
        if (changedKeys.includes('tui.emotes.scale')) {
          void reloadTuiFfzEmotes('tui-emote-scale-change');
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
      focusIdx = (focusIdx + direction + items.length) % items.length;
      activeSettingsModal.focusIndex = focusIdx;
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
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeSettingsModal) cancelAndClose();
  };
  for (const input of [
    platformIconsYoutubeSizeInput,
    platformIconsTwitchSizeInput,
    platformIconsKickSizeInput,
    memoryStatusGreenMaxMbInput,
    memoryStatusOrangeMinMbInput,
    memoryStatusRedMinMbInput,
    memoryTelemetryIntervalMinutesInput,
    historySizeInput,
    eventsTailInput,
    logsHeightInput,
    logsTailInput,
    activityTimeoutInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function openObsShutdownConfigModal(): void {
  if (
    !uiNodes ||
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal ||
    activeChatterInfoModal ||
    activeHistoryModal ||
    activeActivityModal
  )
    return;

  const { renderer } = uiNodes;
  const draft = buildObsShutdownConfigDraft(loadObsShutdownEffectiveConfig());

  function makeLabel(text: string): TextRenderable {
    return new TextRenderable(renderer, { content: text, fg: 'gray' });
  }

  function makeToggleRow(label: string, value: boolean, focused: boolean): string {
    return `${focused ? '▶' : ' '} ${label}: ${value ? 'ON' : 'OFF'}`;
  }

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '7%',
    left: '6%',
    width: '88%',
    height: '84%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ' OBS Shutdown Config ',
  });

  const intro = new TextRenderable(renderer, {
    content:
      ' Tab/Shift+Tab move focus. Space or ◄/► toggles stopStream. Enter saves all changes. Esc cancels.',
    fg: 'gray',
  });

  const sceneLabel = makeLabel('  scene: OBS scene to switch to before the countdown starts');
  const sceneInput = new InputRenderable(renderer, { placeholder: '[PS] End', width: '100%' });
  sceneInput.value = draft.scene;
  const delayLabel = makeLabel('  delay: countdown duration in seconds (10-3600)');
  const delayInput = new InputRenderable(renderer, { placeholder: '30', width: '100%' });
  delayInput.value = draft.delay;
  const messageLabel = makeLabel(
    '  message: chat template, use {remaining} for the countdown value',
  );
  const messageInput = new InputRenderable(renderer, {
    placeholder: 'Stream ending in {remaining}s!',
    width: '100%',
  });
  messageInput.value = draft.message;
  const chatIntervalLabel = makeLabel('  chatInterval: seconds between chat countdown updates');
  const chatIntervalInput = new InputRenderable(renderer, { placeholder: '10', width: '100%' });
  chatIntervalInput.value = draft.chatInterval;
  const stopStreamRow = new TextRenderable(renderer, { content: '', fg: 'white' });
  const sourceLabel = makeLabel(
    '  source: optional OBS text source to update during the countdown',
  );
  const sourceInput = new InputRenderable(renderer, {
    placeholder: '[TXT] Countdown',
    width: '100%',
  });
  sourceInput.value = draft.source;
  const sourceTextLabel = makeLabel(
    '  sourceText: source template, use {remaining} for the countdown value',
  );
  const sourceTextInput = new InputRenderable(renderer, {
    placeholder: '{remaining}',
    width: '100%',
  });
  sourceTextInput.value = draft.sourceText;
  const hideSourcesLabel = makeLabel(
    '  hideSources: comma-separated OBS sources to hide during shutdown',
  );
  const hideSourcesInput = new InputRenderable(renderer, {
    placeholder: 'Camera A, Camera B',
    width: '100%',
  });
  hideSourcesInput.value = draft.hideSources;
  const muteSourcesLabel = makeLabel(
    '  muteSources: comma-separated OBS inputs to mute during shutdown',
  );
  const muteSourcesInput = new InputRenderable(renderer, { placeholder: 'Mic/Aux', width: '100%' });
  muteSourcesInput.value = draft.muteSources;
  const finalCountdownLabel = makeLabel(
    '  finalCountdownAt: switch chat updates to every second from this value',
  );
  const finalCountdownInput = new InputRenderable(renderer, { placeholder: '0', width: '100%' });
  finalCountdownInput.value = draft.finalCountdownAt;

  const sceneRow = createIndentedInputRow(renderer, sceneInput, '    ');
  const delayRow = createIndentedInputRow(renderer, delayInput, '    ');
  const messageRow = createIndentedInputRow(renderer, messageInput, '    ');
  const chatIntervalRow = createIndentedInputRow(renderer, chatIntervalInput, '    ');
  const sourceRow = createIndentedInputRow(renderer, sourceInput, '    ');
  const sourceTextRow = createIndentedInputRow(renderer, sourceTextInput, '    ');
  const hideSourcesRow = createIndentedInputRow(renderer, hideSourcesInput, '    ');
  const muteSourcesRow = createIndentedInputRow(renderer, muteSourcesInput, '    ');
  const finalCountdownRow = createIndentedInputRow(renderer, finalCountdownInput, '    ');

  box.add(intro);
  box.add(sceneLabel);
  box.add(sceneRow);
  box.add(delayLabel);
  box.add(delayRow);
  box.add(messageLabel);
  box.add(messageRow);
  box.add(chatIntervalLabel);
  box.add(chatIntervalRow);
  box.add(stopStreamRow);
  box.add(sourceLabel);
  box.add(sourceRow);
  box.add(sourceTextLabel);
  box.add(sourceTextRow);
  box.add(hideSourcesLabel);
  box.add(hideSourcesRow);
  box.add(muteSourcesLabel);
  box.add(muteSourcesRow);
  box.add(finalCountdownLabel);
  box.add(finalCountdownRow);
  renderer.root.add(box);

  type ObsShutdownFocusItem =
    | { kind: 'input'; node: InputRenderable }
    | {
        kind: 'toggle';
        node: TextRenderable;
        render: (focused: boolean) => void;
        toggle: () => void;
      };

  const items: ObsShutdownFocusItem[] = [
    { kind: 'input', node: sceneInput },
    { kind: 'input', node: delayInput },
    { kind: 'input', node: messageInput },
    { kind: 'input', node: chatIntervalInput },
    {
      kind: 'toggle',
      node: stopStreamRow,
      render: (focused) => {
        stopStreamRow.content = makeToggleRow('stopStream', draft.stopStream, focused).concat(
          '  - stop the OBS stream when the countdown reaches zero',
        );
        stopStreamRow.fg = focused ? 'cyan' : 'white';
      },
      toggle: () => {
        draft.stopStream = !draft.stopStream;
      },
    },
    { kind: 'input', node: sourceInput },
    { kind: 'input', node: sourceTextInput },
    { kind: 'input', node: hideSourcesInput },
    { kind: 'input', node: muteSourcesInput },
    { kind: 'input', node: finalCountdownInput },
  ];

  let focusIdx = 0;
  activeObsShutdownConfigModal = { box, focusIndex: 0 };

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
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (!item || item.kind === 'input') continue;
      item.render(i === focusIdx);
    }
  }

  renderRows();
  focusCurrent();

  async function saveAndClose(): Promise<void> {
    const validation = validateObsShutdownConfigDraft({
      delay: delayInput.value,
      scene: sceneInput.value,
      message: messageInput.value,
      chatInterval: chatIntervalInput.value,
      stopStream: draft.stopStream,
      source: sourceInput.value,
      sourceText: sourceTextInput.value,
      hideSources: hideSourcesInput.value,
      muteSources: muteSourcesInput.value,
      finalCountdownAt: finalCountdownInput.value,
    } satisfies ObsShutdownConfigDraft);

    if (!validation.values) {
      for (const error of validation.errors) {
        lastMessages.push(`[obs-shutdown] ${error}`);
      }
      updateUI(lastMessages);
      return;
    }

    const result = applyObsShutdownConfigPatch(validation.values);
    if (result.errors.length > 0) {
      for (const error of result.errors) {
        lastMessages.push(`[obs-shutdown] ${error}`);
      }
      updateUI(lastMessages);
      return;
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeObsShutdownConfigModal = null;
    uiNodes?.inputEl.focus();

    if (result.changedKeys.length === 0) {
      lastMessages.push('[obs-shutdown] No changes.');
    } else {
      lastMessages.push(`[obs-shutdown] Updated: ${result.changedKeys.join(', ')}`);
    }
    updateUI(lastMessages);
  }

  function cancelAndClose(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeObsShutdownConfigModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeObsShutdownConfigModal) return false;
    const current = items[focusIdx];
    if (!current) return false;

    if (sequence === '\t' || sequence === '\x1b[Z') {
      blurCurrent();
      focusIdx = (focusIdx + (sequence === '\t' ? 1 : -1) + items.length) % items.length;
      activeObsShutdownConfigModal.focusIndex = focusIdx;
      focusCurrent();
      return true;
    }

    if (
      current.kind === 'toggle' &&
      (sequence === ' ' || sequence === '\x1b[C' || sequence === '\x1b[D')
    ) {
      current.toggle();
      current.render(true);
      return true;
    }

    if (sequence === '\r' || sequence === '\n') {
      void saveAndClose();
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      cancelAndClose();
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeObsShutdownConfigModal) cancelAndClose();
  };
  for (const input of [
    sceneInput,
    delayInput,
    messageInput,
    chatIntervalInput,
    sourceInput,
    sourceTextInput,
    hideSourcesInput,
    muteSourcesInput,
    finalCountdownInput,
  ]) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

function openScriptConfigModal(spec: ScriptConfigModalSpec): void {
  if (
    !uiNodes ||
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal ||
    activeChatterInfoModal ||
    activeHistoryModal ||
    activeActivityModal
  )
    return;

  const { renderer } = uiNodes;
  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '7%',
    left: '6%',
    width: '88%',
    height: '84%',
    zIndex: 100,
    border: true,
    borderStyle: 'rounded',
    borderColor: 'cyan',
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
    title: ` ${spec.title} `,
  });

  const contentScroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
    scrollX: false,
    scrollY: true,
  });
  const contentBox = new BoxRenderable(renderer, {
    flexDirection: 'column',
    gap: 0,
    width: '100%',
  });

  box.add(new TextRenderable(renderer, { content: spec.intro, fg: 'gray' }));
  box.add(new TextRenderable(renderer, { content: '', fg: 'gray' }));
  contentScroll.add(contentBox);
  box.add(contentScroll);

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const cloneValue = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
  const clearBox = (target: BoxRenderable): void => {
    for (const child of target.getChildren()) {
      target.remove(child.id);
    }
  };
  const UI_SCHEMA_KEY = '$ui';
  const isObjectConfigSpec = 'config' in spec;
  const draftConfig = isObjectConfigSpec ? cloneValue(spec.config) : null;
  type PathSegment = string | number;
  type ResolvedConfigField =
    | (Extract<ScriptConfigModalField, { kind: 'text' | 'toggle' }> & {
        pathSegments: PathSegment[];
        originalValue: unknown;
        depth: number;
        valueType: 'text' | 'number' | 'boolean' | 'null';
        helpText?: string;
      })
    | {
        key: string;
        kind: 'section';
        pathSegments: PathSegment[];
        label: string;
        description?: string;
        depth: number;
        nodeType: 'array' | 'object';
        editableArrayItem: boolean;
      };
  const pathKey = (segments: PathSegment[]) => segments.map((segment) => String(segment)).join('/');
  const splitSchemaPath = (schemaPath: string): string[] => schemaPath.split('/').filter(Boolean);
  const matchesSchemaPath = (schemaPath: string, segments: PathSegment[]): boolean => {
    const parts = splitSchemaPath(schemaPath);
    if (parts.length !== segments.length) return false;
    return parts.every((part, index) => part === '*' || part === String(segments[index]));
  };
  const schemaSpecificity = (schemaPath: string): number => {
    const parts = splitSchemaPath(schemaPath);
    return parts.reduce((score, part) => score + (part === '*' ? 0 : 2), 0) + parts.length;
  };
  const inferValueType = (value: unknown): 'text' | 'number' | 'boolean' | 'null' => {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (value === null) return 'null';
    return 'text';
  };
  const buildTemplateContext = (
    segments: PathSegment[],
    value: unknown,
  ): Record<string, string | number | boolean> => {
    const lastSegment = segments[segments.length - 1];
    const context: Record<string, string | number | boolean> = {
      key: String(lastSegment ?? ''),
      path: pathKey(segments),
      index: typeof lastSegment === 'number' ? lastSegment : '',
      type: Array.isArray(value) ? 'array' : isRecord(value) ? 'object' : inferValueType(value),
      length: Array.isArray(value) ? value.length : isRecord(value) ? Object.keys(value).length : 0,
    };
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      context.value = value;
    }
    if (isRecord(value)) {
      for (const [key, child] of Object.entries(value)) {
        if (typeof child === 'string' || typeof child === 'number' || typeof child === 'boolean') {
          context[key] = child;
        }
      }
    }
    return context;
  };
  const renderTemplate = (
    template: string | undefined,
    context: Record<string, string | number | boolean>,
  ): string | undefined => {
    if (!template) return undefined;
    return template.replaceAll(/\$\{([^}]+)\}/g, (_match, rawKey) => {
      const key = String(rawKey).trim();
      return String(context[key] ?? '');
    });
  };
  const getValueAtSegments = (data: unknown, segments: PathSegment[]): unknown => {
    let current = data;
    for (const segment of segments) {
      if (Array.isArray(current) && typeof segment === 'number') {
        current = current[segment];
        continue;
      }
      if (isRecord(current) && typeof segment === 'string' && segment in current) {
        current = current[segment];
        continue;
      }
      return undefined;
    }
    return current;
  };
  const setValueAtSegments = (
    data: Record<string, unknown>,
    segments: PathSegment[],
    value: unknown,
  ): void => {
    if (segments.length === 0) {
      throw new Error('config path required');
    }
    let current: unknown = data;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as PathSegment;
      const nextSegment = segments[i + 1] as PathSegment;
      if (typeof segment === 'number') {
        if (!Array.isArray(current)) {
          throw new Error(`invalid array path at ${pathKey(segments.slice(0, i + 1))}`);
        }
        if (current[segment] === undefined) {
          current[segment] = typeof nextSegment === 'number' ? [] : {};
        }
        current = current[segment];
        continue;
      }
      if (!isRecord(current)) {
        throw new Error(`invalid object path at ${pathKey(segments.slice(0, i + 1))}`);
      }
      const nextValue = current[segment];
      if (nextValue === undefined) {
        current[segment] = typeof nextSegment === 'number' ? [] : {};
      }
      current = current[segment];
    }
    const lastSegment = segments[segments.length - 1] as PathSegment;
    if (typeof lastSegment === 'number') {
      if (!Array.isArray(current)) {
        throw new Error(`invalid array path at ${pathKey(segments)}`);
      }
      current[lastSegment] = cloneValue(value);
      return;
    }
    if (!isRecord(current)) {
      throw new Error(`invalid object path at ${pathKey(segments)}`);
    }
    current[lastSegment] = cloneValue(value);
  };
  const moveArrayValue = (
    data: Record<string, unknown>,
    segments: PathSegment[],
    direction: -1 | 1,
  ): PathSegment[] | null => {
    if (segments.length === 0) return null;
    const currentIndex = segments[segments.length - 1];
    if (typeof currentIndex !== 'number') return null;
    const parent = getValueAtSegments(data, segments.slice(0, -1));
    if (!Array.isArray(parent)) return null;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= parent.length) return null;
    const currentValue = parent[currentIndex];
    parent[currentIndex] = parent[nextIndex];
    parent[nextIndex] = currentValue;
    return [...segments.slice(0, -1), nextIndex];
  };
  const deleteArrayValue = (
    data: Record<string, unknown>,
    segments: PathSegment[],
  ): PathSegment[] | null => {
    if (segments.length === 0) return null;
    const currentIndex = segments[segments.length - 1];
    if (typeof currentIndex !== 'number') return null;
    const parentPath = segments.slice(0, -1);
    const parent = getValueAtSegments(data, parentPath);
    if (!Array.isArray(parent)) return null;
    parent.splice(currentIndex, 1);
    if (parent.length === 0) return parentPath.length > 0 ? parentPath : null;
    return [...parentPath, Math.min(currentIndex, parent.length - 1)];
  };

  const buildResolvedFields = (configSource: Record<string, unknown>): ResolvedConfigField[] => {
    if (!isObjectConfigSpec) {
      return spec.fields.map((field) => ({
        ...field,
        pathSegments: [field.key],
        originalValue: field.kind === 'toggle' ? field.value : field.value,
        depth: 0,
        valueType: field.kind === 'toggle' ? 'boolean' : 'text',
        helpText: field.description,
      }));
    }

    const config = cloneValue(configSource);
    const rawSchema = isRecord(config[UI_SCHEMA_KEY]) ? config[UI_SCHEMA_KEY] : {};
    const schema = rawSchema as Record<
      string,
      {
        label?: string;
        description?: string;
        titleTemplate?: string;
        labelTemplate?: string;
        descriptionTemplate?: string;
        widget?: 'auto' | 'text' | 'toggle' | 'json';
        hidden?: boolean;
        placeholder?: string;
        order?: number;
      }
    >;
    const schemaEntries = Object.entries(schema).sort(
      ([leftPath], [rightPath]) => schemaSpecificity(rightPath) - schemaSpecificity(leftPath),
    );
    const resolvedFields: Array<ResolvedConfigField & { order: number }> = [];
    const resolveMeta = (segments: PathSegment[]) => {
      const exact = schema[pathKey(segments)];
      if (exact) return exact;
      return (
        schemaEntries.find(([schemaPath]) => matchesSchemaPath(schemaPath, segments))?.[1] ?? {}
      );
    };
    const pushScalarField = (
      segments: PathSegment[],
      value: unknown,
      depth: number,
      meta: (typeof schema)[string],
    ) => {
      if (meta.hidden) return;
      const key = pathKey(segments);
      const labelBase = String(segments[segments.length - 1] ?? key);
      const valueType = inferValueType(value);
      const context = buildTemplateContext(segments, value);
      const label = renderTemplate(meta.labelTemplate, context) ?? meta.label ?? labelBase;
      const helpText = renderTemplate(meta.descriptionTemplate, context) ?? meta.description;
      if (meta.widget === 'toggle' || (meta.widget !== 'text' && typeof value === 'boolean')) {
        resolvedFields.push({
          key,
          kind: 'toggle',
          label,
          description: helpText ?? 'boolean',
          value: Boolean(value),
          pathSegments: segments,
          originalValue: value,
          depth,
          valueType,
          helpText,
          order: meta.order ?? Number.MAX_SAFE_INTEGER,
        });
        return;
      }
      resolvedFields.push({
        key,
        kind: 'text',
        label,
        description: valueType,
        value: value === null ? 'null' : String(value ?? ''),
        placeholder: meta.placeholder,
        pathSegments: segments,
        originalValue: value,
        depth,
        valueType,
        helpText,
        order: meta.order ?? Number.MAX_SAFE_INTEGER,
      });
    };
    const walkConfig = (value: unknown, segments: PathSegment[], depth: number): void => {
      const meta = resolveMeta(segments);
      if (segments.length > 0 && !meta.hidden && (Array.isArray(value) || isRecord(value))) {
        const context = buildTemplateContext(segments, value);
        const renderedTitle = renderTemplate(meta.titleTemplate, context);
        const renderedLabel =
          renderTemplate(meta.labelTemplate, context) ??
          meta.label ??
          String(segments[segments.length - 1]);
        const renderedDescription =
          renderTemplate(meta.descriptionTemplate, context) ??
          meta.description ??
          (Array.isArray(value) ? `${value.length} item(s)` : 'object');
        resolvedFields.push({
          key: pathKey(segments),
          kind: 'section',
          pathSegments: segments,
          label: renderedTitle ?? renderedLabel,
          description: renderedTitle ? undefined : renderedDescription,
          depth: Math.max(depth - 1, 0),
          nodeType: Array.isArray(value) ? 'array' : 'object',
          editableArrayItem:
            typeof segments[segments.length - 1] === 'number' &&
            (Array.isArray(value) || isRecord(value)),
          order: meta.order ?? Number.MAX_SAFE_INTEGER,
        });
      }
      if (Array.isArray(value)) {
        value.forEach((entry, index) => walkConfig(entry, [...segments, index], depth + 1));
        return;
      }
      if (isRecord(value)) {
        for (const [key, child] of Object.entries(value)) {
          if (segments.length === 0 && key === UI_SCHEMA_KEY) continue;
          walkConfig(child, [...segments, key], depth + 1);
        }
        return;
      }
      pushScalarField(segments, value, Math.max(depth - 1, 0), meta);
    };
    for (const [key, value] of Object.entries(config)) {
      if (key === UI_SCHEMA_KEY) continue;
      walkConfig(value, [key], 0);
    }

    return resolvedFields
      .sort((a, b) => (a.order === b.order ? a.key.localeCompare(b.key) : a.order - b.order))
      .map(({ order: _order, ...field }) => field);
  };

  type ScriptConfigFocusItem =
    | {
        field: Extract<ResolvedConfigField, { kind: 'text' }>;
        kind: 'input';
        node: InputRenderable;
        container: BoxRenderable;
        prefixNode: TextRenderable;
      }
    | {
        field: Extract<ResolvedConfigField, { kind: 'toggle' }>;
        kind: 'toggle';
        node: TextRenderable;
        container: TextRenderable;
      }
    | {
        field: Extract<ResolvedConfigField, { kind: 'section' }>;
        kind: 'section';
        node: TextRenderable;
        container: TextRenderable;
      };

  let resolvedFields = buildResolvedFields(draftConfig ?? {});
  let items: ScriptConfigFocusItem[] = [];
  const rawValues: Record<string, unknown> = {};
  const compactIndent = (depth: number): string => ' '.repeat(Math.min(depth, 6) * 2);
  renderer.root.add(box);
  let focusIdx = 0;
  activeScriptConfigModal = { box, focusIndex: 0 };
  const scalarColor = (valueType: 'text' | 'number' | 'boolean' | 'null'): string => {
    if (valueType === 'boolean') return 'green';
    if (valueType === 'number') return 'yellow';
    if (valueType === 'null') return 'gray';
    return 'white';
  };
  const sectionColor = (nodeType: 'array' | 'object'): string =>
    nodeType === 'array' ? 'cyan' : 'magenta';

  function parseScalarValue(
    field: Extract<ResolvedConfigField, { kind: 'text' | 'toggle' }>,
    rawValue: unknown,
  ): unknown {
    if (field.kind === 'toggle') return Boolean(rawValue);
    if (typeof field.originalValue === 'number') {
      const num = Number(String(rawValue ?? '').trim());
      if (!Number.isFinite(num)) {
        throw new Error(`${field.label} must be a valid number`);
      }
      return num;
    }
    if (field.originalValue === null) {
      const text = String(rawValue ?? '').trim();
      return text === 'null' ? null : text;
    }
    return String(rawValue ?? '');
  }

  function syncDraftFromInputs(): { errors: string[] } {
    const errors: string[] = [];
    if (!isObjectConfigSpec || !draftConfig) return { errors };
    for (const item of items) {
      if (item.kind === 'section') continue;
      const rawValue = item.kind === 'input' ? item.node.value : rawValues[item.field.key];
      try {
        const parsedValue = parseScalarValue(item.field, rawValue);
        setValueAtSegments(draftConfig, item.field.pathSegments, parsedValue);
        rawValues[item.field.key] = parsedValue;
      } catch (error) {
        errors.push(String(error instanceof Error ? error.message : error));
      }
    }
    return { errors };
  }

  function renderSection(
    item: Extract<ScriptConfigFocusItem, { kind: 'section' }>,
    focused: boolean,
  ): void {
    const actionsHint = item.field.editableArrayItem ? '  - [ up, ] down, x delete' : '';
    item.node.content = `${focused ? '>' : ' '} ${compactIndent(item.field.depth)}${item.field.label}${item.field.description ? `  - ${item.field.description}` : ''}${actionsHint}`;
    item.node.fg = focused ? 'cyan' : sectionColor(item.field.nodeType);
    item.node.attributes = focused || item.field.depth === 0 ? TextAttributes.BOLD : undefined;
  }

  function renderToggle(
    item: Extract<ScriptConfigFocusItem, { kind: 'toggle' }>,
    focused: boolean,
  ): void {
    const value = Boolean(rawValues[item.field.key]);
    item.node.content = `${focused ? '>' : ' '} ${`${compactIndent(item.field.depth)}${item.field.label}: ${item.field.valueType} = `.padEnd(scalarPrefixWidth)}${value ? 'ON' : 'OFF'}${item.field.helpText ? `  - ${item.field.helpText}` : ''}`;
    item.node.fg = focused ? 'cyan' : scalarColor(item.field.valueType);
  }

  let scalarPrefixWidth = 0;
  function escapeViaKeyDown(key: { name: string }): void {
    if (key.name === 'escape' && activeScriptConfigModal) cancelAndClose();
  }

  function renderFields(focusPath?: string): void {
    clearBox(contentBox);
    items = [];
    for (const key of Object.keys(rawValues)) delete rawValues[key];
    resolvedFields = buildResolvedFields(draftConfig ?? {});
    scalarPrefixWidth = resolvedFields
      .filter(
        (field): field is Extract<ResolvedConfigField, { kind: 'text' | 'toggle' }> =>
          field.kind === 'text' || field.kind === 'toggle',
      )
      .reduce((maxWidth, field) => {
        const prefix = `${compactIndent(field.depth)}${field.label}: ${field.valueType} = `;
        return Math.max(maxWidth, prefix.length);
      }, 0);

    for (const field of resolvedFields) {
      if (field.kind === 'section') {
        const row = new TextRenderable(renderer, { content: '', fg: sectionColor(field.nodeType) });
        contentBox.add(row);
        if (field.editableArrayItem) {
          items.push({ field, kind: 'section', node: row, container: row });
        } else {
          renderSection({ field, kind: 'section', node: row, container: row }, false);
        }
        continue;
      }
      if (field.kind === 'toggle') {
        const row = new TextRenderable(renderer, { content: '', fg: scalarColor(field.valueType) });
        rawValues[field.key] = field.value;
        contentBox.add(row);
        items.push({ field, kind: 'toggle', node: row, container: row });
        continue;
      }
      const fieldRow = new BoxRenderable(renderer, {
        width: '100%',
        flexDirection: 'row',
        gap: 0,
      });
      const prefixNode = new TextRenderable(renderer, {
        content: `${compactIndent(field.depth)}${field.label}: ${field.valueType} = `.padEnd(
          scalarPrefixWidth,
        ),
        fg: scalarColor(field.valueType),
      });
      fieldRow.add(prefixNode);
      const inputBox = new BoxRenderable(renderer, {
        flexDirection: 'column',
        flexGrow: 1,
      });
      const input = new InputRenderable(renderer, {
        placeholder: field.placeholder ?? '',
        width: '100%',
      });
      input.value = field.value;
      rawValues[field.key] = field.value;
      inputBox.add(input);
      fieldRow.add(inputBox);
      contentBox.add(fieldRow);
      items.push({ field, kind: 'input', node: input, container: fieldRow, prefixNode });
    }

    if (items.length === 0) {
      focusIdx = 0;
      return;
    }
    if (focusPath) {
      const matchedIndex = items.findIndex(
        (item) => pathKey(item.field.pathSegments) === focusPath,
      );
      focusIdx = matchedIndex >= 0 ? matchedIndex : Math.min(focusIdx, items.length - 1);
    } else {
      focusIdx = Math.min(focusIdx, items.length - 1);
    }
    for (const item of items) {
      if (item.kind === 'toggle') renderToggle(item, false);
      else if (item.kind === 'section') renderSection(item, false);
      else item.node.onKeyDown = escapeViaKeyDown as any;
    }
  }

  function blurCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') {
      current.node.blur();
      current.prefixNode.fg = scalarColor(current.field.valueType);
    } else if (current.kind === 'toggle') renderToggle(current, false);
    else renderSection(current, false);
  }

  function scrollCurrentIntoView(): void {
    const current = items[focusIdx];
    if (!current) return;
    contentScroll.scrollChildIntoView(current.container.id);
  }

  function focusCurrent(): void {
    const current = items[focusIdx];
    if (!current) return;
    if (current.kind === 'input') {
      current.node.focus();
      current.prefixNode.fg = 'cyan';
    } else if (current.kind === 'toggle') {
      renderToggle(current, true);
    } else {
      renderSection(current, true);
    }
    scrollCurrentIntoView();
  }

  renderFields();
  focusCurrent();

  async function saveAndClose(): Promise<void> {
    let result: { changedKeys: string[]; errors?: string[] };
    if (isObjectConfigSpec) {
      const { errors } = syncDraftFromInputs();
      if (errors.length > 0) {
        for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
        updateUI(lastMessages);
        return;
      }
      result = await spec.onSaveConfig(cloneValue(draftConfig as Record<string, unknown>));
    } else {
      for (const item of items) {
        if (item.kind === 'input') rawValues[item.field.key] = item.node.value;
      }
      result = await spec.onSave(rawValues);
    }
    if (result.errors && result.errors.length > 0) {
      for (const error of result.errors) lastMessages.push(`${spec.prefix} ${error}`);
      updateUI(lastMessages);
      return;
    }

    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeScriptConfigModal = null;
    uiNodes?.inputEl.focus();
    lastMessages.push(
      result.changedKeys.length > 0
        ? `${spec.prefix} Updated: ${result.changedKeys.join(', ')}`
        : `${spec.prefix} No changes.`,
    );
    updateUI(lastMessages);
  }

  function cancelAndClose(): void {
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeScriptConfigModal = null;
    uiNodes?.inputEl.focus();
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeScriptConfigModal) return false;
    const current = items[focusIdx];
    if (!current) return false;

    if (sequence === '\t' || sequence === '\x1b[Z') {
      blurCurrent();
      focusIdx = (focusIdx + (sequence === '\t' ? 1 : -1) + items.length) % items.length;
      activeScriptConfigModal.focusIndex = focusIdx;
      focusCurrent();
      return true;
    }

    if (
      current.kind === 'section' &&
      current.field.editableArrayItem &&
      isObjectConfigSpec &&
      draftConfig
    ) {
      if (sequence === '[' || sequence === '\x1b[1;3A' || sequence === '\x1bk') {
        const { errors } = syncDraftFromInputs();
        if (errors.length > 0) {
          for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
          updateUI(lastMessages);
          return true;
        }
        const nextPath = moveArrayValue(draftConfig, current.field.pathSegments, -1);
        if (nextPath) {
          renderFields(pathKey(nextPath));
          focusCurrent();
        }
        return true;
      }
      if (sequence === ']' || sequence === '\x1b[1;3B' || sequence === '\x1bj') {
        const { errors } = syncDraftFromInputs();
        if (errors.length > 0) {
          for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
          updateUI(lastMessages);
          return true;
        }
        const nextPath = moveArrayValue(draftConfig, current.field.pathSegments, 1);
        if (nextPath) {
          renderFields(pathKey(nextPath));
          focusCurrent();
        }
        return true;
      }
      if (sequence === 'x' || sequence === '\x7f' || sequence === '\x1b[3~') {
        const { errors } = syncDraftFromInputs();
        if (errors.length > 0) {
          for (const error of errors) lastMessages.push(`${spec.prefix} ${error}`);
          updateUI(lastMessages);
          return true;
        }
        const nextPath = deleteArrayValue(draftConfig, current.field.pathSegments);
        renderFields(nextPath ? pathKey(nextPath) : undefined);
        focusCurrent();
        return true;
      }
    }

    if (
      current.kind === 'toggle' &&
      (sequence === ' ' || sequence === '\x1b[C' || sequence === '\x1b[D')
    ) {
      rawValues[current.field.key] = !rawValues[current.field.key];
      renderToggle(current, true);
      return true;
    }

    if (sequence === '\r' || sequence === '\n') {
      void saveAndClose();
      return true;
    }
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      cancelAndClose();
      return true;
    }
    if (sequence === '\x1b[A') {
      contentScroll.scrollBy(-1);
      return true;
    }
    if (sequence === '\x1b[B') {
      contentScroll.scrollBy(1);
      return true;
    }
    if (sequence === '\x1b[5~') {
      contentScroll.scrollBy(-0.5, 'viewport');
      return true;
    }
    if (sequence === '\x1b[6~') {
      contentScroll.scrollBy(0.5, 'viewport');
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);
}

async function invokeActionFromTui(
  id: string,
  args: Record<string, unknown>,
  emit: (line: string) => void,
): Promise<void> {
  const result = await registry.invokeLocalAction(id, args, {
    chatService,
    providers: { youtube, twitch, kick },
    emit,
    ui: { openObsShutdownConfigModal, openScriptConfigModal },
  });
  for (const line of result.output ?? []) emit(line);
  for (const warn of result.warnings ?? []) emit(`[warning] ${warn}`);
}

// ─── Chatter info modal ──────────────────────────────────────────────────────

function openChatterInfoModal(msg: ChatMessage): void {
  if (
    !uiNodes ||
    activeModal ||
    activeStreamModal ||
    activeSettingsModal ||
    activeObsShutdownConfigModal ||
    activeScriptConfigModal ||
    activeChatterInfoModal
  )
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
    return getChatterSessionMessages(msg, {
      getPersistedMessages: (platform, userId, streamId) =>
        messageLog.getForUserInStream(platform, userId, streamId),
      getPersistedStats: (platform, userId, streamId) =>
        messageLog.getSessionStatsForUserInStream(platform, userId, streamId),
      getInMemoryMessages: () => chatService.getMessageHistory(),
      getInMemoryStats: (platform, userId, messages) =>
        chatterCache.computeSessionStats(platform, userId, messages),
    });
  }

  function getSessionStatsForModal(): { count: number; firstSeenAt?: Date } {
    return getChatterSessionStats(msg, {
      getPersistedMessages: (platform, userId, streamId) =>
        messageLog.getForUserInStream(platform, userId, streamId),
      getPersistedStats: (platform, userId, streamId) =>
        messageLog.getSessionStatsForUserInStream(platform, userId, streamId),
      getInMemoryMessages: () => chatService.getMessageHistory(),
      getInMemoryStats: (platform, userId, messages) =>
        chatterCache.computeSessionStats(platform, userId, messages),
    });
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
  let currentInfo: import('./platforms/base').ChatterInfo | null = null;
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

  function renderInfoSummary(info: import('./platforms/base').ChatterInfo): void {
    const userColor = info.color ?? 'white';
    const pColor = platColor(info.platform);

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
  activeChatterInfoModal = {
    box,
    refreshForMessage: (incomingMsg) => {
      if (!currentInfo || !activeChatterInfoModal) return;
      const sessionAffected = doesIncomingMessageAffectChatterSession(msg, incomingMsg);
      const alltimeAffected = doesIncomingMessageAffectChatterAllTime(msg, incomingMsg);
      const contextAffected = doesIncomingMessageAffectChatterContext(incomingMsg, (streamId) => {
        return (
          messageLog.getSessionStatsForUserInStream(msg.platform, msg.userId, streamId).count > 0
        );
      });

      if (!sessionAffected && !alltimeAffected && !contextAffected) return;

      if (sessionAffected) {
        currentInfo = applySessionStatsToChatterInfo(currentInfo, getSessionStatsForModal());
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
  };

  // ── Alltime tab helpers ────────────────────────────────────────────────────

  function fmtTimestamp(ts: number): string {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} - ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}  `;
  }

  function makeMessageRow(m: ChatMessage): BoxRenderable {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    row.add(new TextRenderable(renderer, { content: fmtTimestamp(m.timestamp), fg: '#888888' }));
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
      content: `── stream starting ${fmtTimestamp(timestamp).trim()} ──`,
      fg: '#4a9eff',
    });
  }

  function makeContextMessageRow(m: ChatMessage, isTargetUser: boolean): BoxRenderable {
    const row = new BoxRenderable(renderer, { flexDirection: 'row' });
    row.add(new TextRenderable(renderer, { content: fmtTimestamp(m.timestamp), fg: '#888888' }));
    if (isTargetUser) {
      row.add(new TextRenderable(renderer, { content: '★ ', fg: 'cyan' }));
      for (const badge of formatBadgeLabels(m.badges)) {
        row.add(new TextRenderable(renderer, { content: `[${badge}] `, fg: '#94a3b8' }));
      }
      row.add(
        new TextRenderable(renderer, {
          content: `${m.username}: `,
          fg: m.color ?? platColor(m.platform),
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
        new TextRenderable(renderer, { content: `[${m.platform}] `, fg: platColor(m.platform) }),
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
      const messages = getSessionMessagesForModal();
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

  function switchTab(tab: 'session' | 'alltime' | 'context'): void {
    if (activeTab === tab) return;
    activeTab = tab;
    updateTabBar();
    fillMessageScroll(tab, msg.platform, msg.userId);
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

        const stats = getSessionStatsForModal();
        info = applySessionStatsToChatterInfo(info, stats);

        chatterCache.set(msg.platform, msg.userId, info);
      } else {
        const stats = getSessionStatsForModal();
        info = applySessionStatsToChatterInfo(info, stats);
      }

      if (!activeChatterInfoModal) return;

      currentInfo = info;
      renderInfoSummary(info);

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
    activeObsShutdownConfigModal ||
    activeScriptConfigModal ||
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

function trimUiChatMemory(): void {
  const maxHistory = getChatHistoryLimit();
  trimArrayTail(lastMessages, maxHistory);
  trimArrayTail(lastRawMessages, maxHistory);
  if (browseSelectedIdx !== null && browseSelectedIdx >= lastMessages.length) {
    browseSelectedIdx = lastMessages.length > 0 ? lastMessages.length - 1 : null;
  }
}

runtimeMonitor.registerProbe('tui', () => {
  const maxHistory = getChatHistoryLimit();
  const chatterStats = chatterCache.getStats();
  const logStats = logCollector.getStats();
  return {
    metrics: {
      lastMessages: lastMessages.length,
      lastMessagesLimit: maxHistory,
      lastRawMessages: lastRawMessages.length,
      inputHistory: inputHistory.length,
      inputHistoryLimit: INPUT_HISTORY_LIMIT,
      browseModeActive,
      eventLog: eventLog.length,
      eventLogLimit: MAX_EVENT_LOG_ENTRIES,
      activityEvents: activityEvents.length,
      activityEventsLimit: MAX_ACTIVITY_EVENTS,
      ffzImageCache: tuiFfzImageIdsByUrl.size,
      ffzImageCacheLimit: MAX_TUI_FFZ_IMAGES,
      ffzUploadCount: tuiFfzUploadCount,
      ffzUploadBytes: tuiFfzUploadBytes,
      ffzLastUploadBytes: tuiFfzLastUploadBytes,
      ffzClearCount: tuiFfzClearCount,
      ffzRefreshCount: tuiFfzRefreshCount,
      ffzImageIdHighWaterMark: tuiFfzImageIdHighWaterMark,
      updateUiCount,
      updateUiLoopRefreshCount,
      updateUiNonLoopRefreshCount: Math.max(0, updateUiCount - updateUiLoopRefreshCount),
      updateUiLastDurationMs,
      updateUiAvgDurationMs: updateUiCount > 0 ? updateUiTotalDurationMs / updateUiCount : 0,
      updateUiMaxDurationMs,
      updateUiLastMessageCount,
      updateUiChatChildrenHighWater,
      updateUiSidebarChildrenHighWater,
      updateLoopTickCount,
      updateLoopEnabled: TUI_UPDATE_LOOP_DISABLED ? 0 : 1,
      updateLoopOverlapCount,
      updateLoopInFlight,
      updateLoopInFlightHighWater,
      updateLoopLastDurationMs,
      updateLoopMaxDurationMs,
      updateLoopSkippedRefreshCount,
      chatterCacheSize: chatterStats.size,
      chatterCacheLimit: chatterStats.maxEntries,
      logEntries: logStats.count,
      logEntriesLimit: logStats.max,
    },
    warnings: [
      ...(lastMessages.length >= maxHistory
        ? [
            'TUI chat history is at cap; lower chat.maxHistorySize if memory pressure tracks live message rate.',
          ]
        : []),
      ...(eventLog.length >= MAX_EVENT_LOG_ENTRIES
        ? [
            'Sidebar event log is at cap; frequent operational churn may be masking the true pressure source elsewhere.',
          ]
        : []),
      ...(activityEvents.length >= MAX_ACTIVITY_EVENTS
        ? [
            'Activity events is at cap; if this keeps refilling quickly, verify activity retention settings against live traffic.',
          ]
        : []),
      ...(tuiFfzImageIdsByUrl.size >= MAX_TUI_FFZ_IMAGES
        ? [
            'TUI FFZ image cache is at cap; if RSS stays high with chat traffic, compare runs with emote rendering disabled.',
          ]
        : []),
      ...(logStats.count >= logStats.max
        ? [
            'In-memory log collector is at cap; repeated reconnect/log spam may still pressure native allocations even though the JS list is bounded.',
          ]
        : []),
      ...(TUI_UPDATE_LOOP_DISABLED
        ? ['TUI periodic update loop is disabled for A/B soak mode.']
        : []),
    ],
  };
});

const tuiFfzEmotes: Record<string, SharedTwitchEmoteDefinition> = {};
const tuiFfzImageIdsByName: Record<string, number> = {};
const tuiFfzImageIdsByUrl = new Map<string, number>();
const tuiPlatformStatusIconImageIds = new Map<PlatformStatusIconPlatform, number>();
const tuiPendingPlatformStatusIconUploads = new Set<PlatformStatusIconPlatform>();
let nextTuiFfzImageId = 1;
let nextTuiPlatformStatusIconImageId = 10001;
let tuiFfzRefreshPromise: Promise<void> | null = null;
let tuiFfzSupported: boolean | null = null;
let tuiFfzLastChannel: string | null = null;
let tuiFfzUploadCount = 0;
let tuiFfzUploadBytes = 0;
let tuiFfzClearCount = 0;
let tuiFfzRefreshCount = 0;
let tuiFfzLastUploadBytes = 0;
let tuiFfzImageIdHighWaterMark = 0;
const tuiFfzPendingUploadUrls = new Set<string>();
let tuiFfzUploadQueue: Promise<void> = Promise.resolve();
let tuiPlatformStatusIconUploadQueue: Promise<void> = Promise.resolve();

function resetTuiPlatformStatusIconState(): void {
  tuiPlatformStatusIconImageIds.clear();
  tuiPendingPlatformStatusIconUploads.clear();
  nextTuiPlatformStatusIconImageId = 10001;
}
let updateUiCount = 0;
let updateUiTotalDurationMs = 0;
let updateUiLastDurationMs = 0;
let updateUiMaxDurationMs = 0;
let updateUiLastMessageCount = 0;
let updateUiChatChildrenHighWater = 0;
let updateUiSidebarChildrenHighWater = 0;
let updateUiLoopRefreshCount = 0;
let updateLoopTickCount = 0;
let updateLoopOverlapCount = 0;
let updateLoopInFlight = 0;
let updateLoopInFlightHighWater = 0;
let updateLoopLastDurationMs = 0;
let updateLoopMaxDurationMs = 0;
let updateLoopSkippedRefreshCount = 0;
let lastUpdateLoopSignature: string | null = null;

function platformColor(platform: string): string {
  if (platform === 'youtube') return 'red';
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'kick') return 'green';
  return 'white';
}

function getUpdateLoopRefreshSignature(now = Date.now()): string {
  const viewerMode = String(settings.get('viewers.mode', 'per-platform') ?? 'per-platform');
  const viewersVisible = boolSetting(settings.get('viewers.visible', true), true) ? 1 : 0;
  const titleVisible = boolSetting(settings.get('title.visible', false), false) ? 1 : 0;
  const obsConnected = obsService.isConnected() ? 1 : 0;
  const demoVisible = isDemoMode() ? 1 : 0;
  const providerState = platforms
    .map((platform) => {
      const provider = platform === 'youtube' ? youtube : platform === 'twitch' ? twitch : kick;
      const status = provider.getStatus();
      const viewerCount = provider.getViewerCount();
      const startTime = provider.getStreamStartTime();
      const elapsedBucket =
        status.streamStatus === 'ONLINE' && startTime
          ? Math.floor((now - startTime.getTime()) / 2000)
          : -1;
      return [
        platform,
        provider.isAuthenticated() ? 1 : 0,
        status.streamStatus,
        viewerCount,
        startTime?.getTime() ?? 0,
        elapsedBucket,
      ].join(':');
    })
    .join('|');
  return [
    providerState,
    `obs:${obsConnected}`,
    `demo:${demoVisible}`,
    `title:${titleVisible}`,
    `viewers:${viewersVisible}:${viewerMode}`,
  ].join('|');
}

function getTuiFfzPassthroughMode(): 'none' | 'tmux' {
  return process.env.TMUX ? 'tmux' : 'none';
}

function getTuiEmoteScalePercent(): number {
  const raw = Number(settings.get('tui.emotes.scale', DEFAULT_TUI_EMOTE_SCALE_PERCENT));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TUI_EMOTE_SCALE_PERCENT;
}

function getTuiEmoteColumns(): number {
  return getTuiFfzColumnSpan(getTuiEmoteScalePercent());
}

function detectTuiFfzSupport(): boolean {
  if (tuiFfzSupported !== null) return tuiFfzSupported;

  const termName = (() => {
    if (!process.env.TMUX) return process.env.TERM ?? null;
    try {
      const proc = Bun.spawnSync(['tmux', 'display-message', '-p', '#{client_termname}']);
      const name = proc.stdout.toString().trim();
      return name.length > 0 ? name : null;
    } catch {
      return null;
    }
  })();

  const passthroughEnabled = (() => {
    if (!process.env.TMUX) return true;
    try {
      const proc = Bun.spawnSync(['tmux', 'show-options', '-gsv', 'allow-passthrough']);
      return isTuiFfzPassthroughEnabled(proc.stdout.toString());
    } catch {
      return false;
    }
  })();

  tuiFfzSupported = passthroughEnabled && supportsTuiFfzClientTerm(termName);
  return tuiFfzSupported;
}

function clearTuiFfzState(): void {
  tuiFfzClearCount += 1;
  tuiFfzLastChannel = null;
  for (const key of Object.keys(tuiFfzEmotes)) delete tuiFfzEmotes[key];
  for (const key of Object.keys(tuiFfzImageIdsByName)) delete tuiFfzImageIdsByName[key];
  tuiFfzImageIdsByUrl.clear();
  nextTuiFfzImageId = 1;
}

async function uploadTuiPlatformStatusIcon(
  platform: PlatformStatusIconPlatform,
  imageId: number,
): Promise<void> {
  const icon = await ensurePlatformStatusIcon(platform);
  const bytes = new Uint8Array(await Bun.file(icon.pngPath).arrayBuffer());
  const parsed = parsePngDimensions(bytes);
  const columns = getPlatformStatusIconColumns(getStatusPlatformIconSizePxForPlatform(platform));
  for (const sequence of buildTuiFfzUploadSequences({
    imageId,
    pngBytes: bytes,
    width: parsed.width,
    height: parsed.height,
    columns,
    passthrough: getTuiFfzPassthroughMode(),
  })) {
    process.stdout.write(sequence);
  }
}

function scheduleTuiPlatformStatusIconUpload(platform: PlatformStatusIconPlatform): void {
  if (!statusPlatformIconsEnabled() || !detectTuiFfzSupport()) return;
  if (
    tuiPlatformStatusIconImageIds.has(platform) ||
    tuiPendingPlatformStatusIconUploads.has(platform)
  ) {
    return;
  }
  tuiPendingPlatformStatusIconUploads.add(platform);
  tuiPlatformStatusIconUploadQueue = tuiPlatformStatusIconUploadQueue
    .catch(() => {})
    .then(async () => {
      if (tuiPlatformStatusIconImageIds.has(platform)) return;
      const imageId = nextTuiPlatformStatusIconImageId++;
      await uploadTuiPlatformStatusIcon(platform, imageId);
      tuiPlatformStatusIconImageIds.set(platform, imageId);
      if (uiNodes) updateUI(lastMessages);
    })
    .catch((error) => {
      defaultLogger.warn(`[status-icons] TUI upload failed for ${platform}: ${String(error)}`);
    })
    .finally(() => {
      tuiPendingPlatformStatusIconUploads.delete(platform);
    });
}

async function uploadTuiFfzImage(
  emote: SharedTwitchEmoteDefinition,
  imageId: number,
): Promise<void> {
  const uploadUrl = getTuiFfzUploadUrl(emote);
  const response = await fetch(uploadUrl);
  if (!response.ok) {
    throw new Error(`FFZ image fetch returned ${response.status} for ${emote.name}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  tuiFfzUploadCount += 1;
  tuiFfzUploadBytes += bytes.byteLength;
  tuiFfzLastUploadBytes = bytes.byteLength;
  if (imageId > tuiFfzImageIdHighWaterMark) {
    tuiFfzImageIdHighWaterMark = imageId;
  }
  const parsed = parsePngDimensions(bytes);
  const width = emote.width ?? parsed.width;
  const height = emote.height ?? parsed.height;

  for (const sequence of buildTuiFfzUploadSequences({
    imageId,
    pngBytes: bytes,
    width,
    height,
    columns: getTuiEmoteColumns(),
    passthrough: getTuiFfzPassthroughMode(),
  })) {
    process.stdout.write(sequence);
  }
}

function rerenderRawChatLines(): void {
  let changed = false;
  for (let i = 0; i < lastMessages.length; i++) {
    const line = lastMessages[i];
    if (typeof line === 'string' || !line?.rawMsg) continue;
    lastMessages[i] = transformMessage(line.rawMsg);
    changed = true;
  }
  if (changed && uiNodes) updateUI(lastMessages);
}

function getTuiFfzCacheKey(emote: SharedTwitchEmoteDefinition): string {
  return emote.source === 'twitch' ? (emote.staticUrl ?? emote.url) : emote.url;
}

function deleteTuiFfzImageReferences(imageId: number): void {
  for (const [name, currentImageId] of Object.entries(tuiFfzImageIdsByName)) {
    if (currentImageId === imageId) delete tuiFfzImageIdsByName[name];
  }
}

function trimTuiFfzImageCache(): void {
  while (tuiFfzImageIdsByUrl.size > MAX_TUI_FFZ_IMAGES) {
    const oldestEntry = tuiFfzImageIdsByUrl.entries().next().value;
    if (!oldestEntry) return;
    const [oldestUrl, imageId] = oldestEntry;
    tuiFfzImageIdsByUrl.delete(oldestUrl);
    deleteTuiFfzImageReferences(imageId);
  }
}

function scheduleTuiFfzUploadForEmote(emote: SharedTwitchEmoteDefinition): void {
  const cacheKey = getTuiFfzCacheKey(emote);
  if (!cacheKey || tuiFfzImageIdsByUrl.has(cacheKey) || tuiFfzPendingUploadUrls.has(cacheKey)) {
    return;
  }

  tuiFfzPendingUploadUrls.add(cacheKey);
  tuiFfzUploadQueue = tuiFfzUploadQueue
    .catch(() => {})
    .then(async () => {
      if (tuiFfzImageIdsByUrl.has(cacheKey)) return;
      const imageId = nextTuiFfzImageId++;
      await uploadTuiFfzImage(emote, imageId);
      tuiFfzImageIdsByUrl.set(cacheKey, imageId);
      tuiFfzImageIdsByName[emote.name] = imageId;
      trimTuiFfzImageCache();
      rerenderRawChatLines();
    })
    .catch((error) => {
      defaultLogger.warn(`[FFZ:TUI] Lazy upload failed for ${emote.name}: ${String(error)}`);
    })
    .finally(() => {
      tuiFfzPendingUploadUrls.delete(cacheKey);
    });
}

function scheduleTuiFfzUploadsForMessage(platform: string, message: string): void {
  if (platform !== 'twitch' || Object.keys(tuiFfzEmotes).length === 0) return;
  for (const part of parseMessageWithFfzEmotes(message, tuiFfzEmotes)) {
    if (part.type !== 'emote') continue;
    const emote = tuiFfzEmotes[part.emote.name];
    if (!emote) continue;
    const cacheKey = getTuiFfzCacheKey(emote);
    const imageId = tuiFfzImageIdsByUrl.get(cacheKey);
    if (imageId) {
      tuiFfzImageIdsByName[emote.name] = imageId;
      continue;
    }
    scheduleTuiFfzUploadForEmote(emote);
  }
}

async function refreshTuiFfzEmotes(reason: string): Promise<void> {
  if (!detectTuiFfzSupport()) return;
  if (tuiFfzRefreshPromise) return tuiFfzRefreshPromise;

  const twitchWithEmoteContext = twitch as unknown as TwitchProviderEmoteContext;
  const channel =
    typeof twitchWithEmoteContext.getUserLogin === 'function'
      ? twitchWithEmoteContext.getUserLogin()
      : null;

  if (!channel) {
    clearTuiFfzState();
    return;
  }

  tuiFfzRefreshPromise = (async () => {
    tuiFfzRefreshCount += 1;
    try {
      const payload = await getFfzEmotePayload(channel, {
        apiClient: twitchWithEmoteContext.apiClient ?? null,
        userId: twitchWithEmoteContext.userId ?? null,
      });
      if (payload.channel !== channel) return;
      if (payload.channel !== tuiFfzLastChannel) {
        clearTuiFfzState();
      }
      tuiFfzLastChannel = payload.channel;

      const activeNames = new Set(Object.keys(payload.emotes));
      const activeUrls = new Set(
        Object.values(payload.emotes).map((emote) =>
          emote.source === 'twitch' ? (emote.staticUrl ?? emote.url) : emote.url,
        ),
      );
      for (const name of Object.keys(tuiFfzEmotes)) {
        if (!activeNames.has(name)) delete tuiFfzEmotes[name];
      }
      for (const name of Object.keys(tuiFfzImageIdsByName)) {
        if (!activeNames.has(name)) delete tuiFfzImageIdsByName[name];
      }
      for (const cachedUrl of Array.from(tuiFfzImageIdsByUrl.keys())) {
        if (!activeUrls.has(cachedUrl)) {
          const imageId = tuiFfzImageIdsByUrl.get(cachedUrl);
          tuiFfzImageIdsByUrl.delete(cachedUrl);
          if (imageId) deleteTuiFfzImageReferences(imageId);
        }
      }

      for (const [name, emote] of Object.entries(payload.emotes)) {
        tuiFfzEmotes[name] = emote;
        const cacheKey = getTuiFfzCacheKey(emote);
        const imageId = tuiFfzImageIdsByUrl.get(cacheKey);
        if (imageId) {
          tuiFfzImageIdsByName[name] = imageId;
        } else {
          delete tuiFfzImageIdsByName[name];
        }
      }

      rerenderRawChatLines();
    } catch (error) {
      defaultLogger.warn(`[FFZ:TUI] ${reason}: ${String(error)}`);
    } finally {
      tuiFfzRefreshPromise = null;
    }
  })();

  return tuiFfzRefreshPromise;
}

async function reloadTuiFfzEmotes(reason: string): Promise<void> {
  clearTuiFfzState();
  await refreshTuiFfzEmotes(reason);
}

function transformMessage(msg: ChatMessage): ChatLine {
  scheduleTuiFfzUploadsForMessage(msg.platform, msg.message);
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

  const parts: ChatLinePart[] = [];
  parts.push({ content: `[${msg.platform}]${tsStr} `, fg: platColor });
  for (const badge of formatBadgeLabels(msg.badges)) {
    parts.push({ content: `[${badge}]`, fg: '#94a3b8' });
    parts.push({ content: ' ', fg: 'white' });
  }
  parts.push({ content: `${msg.username}: `, fg: userColor });
  parts.push(
    ...buildTuiFfzMessageParts(
      msg.platform,
      msg.message,
      userColor === platColor ? platColor : 'white',
      tuiFfzEmotes,
      tuiFfzImageIdsByName,
      getTuiEmoteColumns(),
    ),
  );

  return {
    parts,
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

function transformCommandFeedback(origin: 'you' | 'ipc', command: string): ChatLine {
  return {
    parts: [
      { content: `[${origin} → `, fg: 'white' },
      { content: 'cmd', fg: 'cyan' },
      { content: `] ${command}`, fg: 'white' },
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

function formatBadgeLabels(badges?: Record<string, string>): string[] {
  if (!badges) return [];
  return Object.entries(badges).map(([name, value]) =>
    value && value !== '1' ? `${name}:${value}` : name,
  );
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
  const maxHistory = getChatHistoryLimit();
  const ytInfo = youtube.getChannelInfo();
  const streamIds = getChatHistoryStreamIds({
    youtubeBroadcastId: ytInfo.broadcastId,
    twitchStreamStartTime: twitch.getStreamStartTime(),
    kickStreamStartTime: kick.getStreamStartTime(),
    overrideIds: settings.get('chat.historyStreamIds', []),
  });

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
    openConsoleOnError: false,
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

        if (sequence === '\t' || sequence === '\x1b[Z') {
          const direction: 1 | -1 = sequence === '\x1b[Z' ? -1 : 1;
          const val = uiNodes.inputEl.value;
          if (!val.startsWith('/')) {
            cycleMessageTarget(direction);
            updateInputAssist();
            return true;
          }

          const continuing = autocycleIndex >= 0 && autocycleSuggestions[autocycleIndex] === val;

          if (continuing) {
            autocycleIndex = getNextAutocompleteCycleIndex(
              autocycleIndex,
              autocycleSuggestions.length,
              direction,
            );
          } else {
            const { completions, hints } = getAutocomplete(val);
            if (completions.length === 0) return true;
            autocycleSuggestions = completions;
            autocycleHints = hints;
            autocycleIndex = getNextAutocompleteCycleIndex(
              -1,
              autocycleSuggestions.length,
              direction,
            );
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
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal
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
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal
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
        if (
          sequence === '\x0c' &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal
        ) {
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

        // Ctrl+G — open the activity modal from the keyboard
        if (
          sequence === '\x07' &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal &&
          !activeHistoryModal &&
          !activeChatterInfoModal &&
          !activeMemoryModal
        ) {
          openActivityModal();
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
  renderer.console.hide();
  renderer.console.show = noop;
  renderer.console.hide = noop;
  renderer.console.toggle = noop;
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
    trimUiChatMemory();
    activeChatterInfoModal?.refreshForMessage(msg);
    if (msg.platform === 'twitch' && Object.keys(tuiFfzEmotes).length === 0) {
      void refreshTuiFfzEmotes('incoming-twitch-message');
    }
    if (uiNodes) updateUI(lastMessages);
  });

  obsService.subscribeToMessages((event) => {
    invalidateActionAutocompleteForObsEvent(event);
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
  twitch.onActivityEvent((event) => {
    pushActivityEvent('twitch', event);
  });
  kick.onActivityEvent((event) => {
    pushActivityEvent('kick', event);
  });
  youtube.onActivityEvent((event) => {
    pushActivityEvent('youtube', event);
  });
  youtube.onStartupNotice(({ line }) => {
    lastMessages.push(line);
    if (uiNodes) updateUI(lastMessages);
  });

  await initializeServices();
  await loadUserScripts(getDataDir(), {
    chat: (line) => {
      lastMessages.push(line);
      updateUI(lastMessages);
    },
    event: (platform, type, message) => {
      pushEvent(platform, type, message);
      updateUI(lastMessages);
    },
  });
  if (statusPlatformIconsEnabled()) {
    warmPlatformStatusIcons();
  }
  startIpcServer(handleCommandForCli, chatService, { youtube, twitch, kick }, (line) => {
    lastMessages.push(line);
    updateUI(lastMessages);
  });

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
    pruneActivityEvents();
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
      trimUiChatMemory();
    }
  }

  inputHistory.push(..._loadInputHistory());

  // Build UI tree once — no flicker on periodic updates
  uiNodes = initUI(renderer, lastMessages);
  if (statusPlatformIconsEnabled()) {
    for (const platform of platforms) {
      scheduleTuiPlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
    }
  }
  lastUpdateLoopSignature = getUpdateLoopRefreshSignature();
  void refreshTuiFfzEmotes('startup');
  subscribeToActionAutocompleteRefresh(() => {
    if (!uiNodes) return;
    updateInputAssist();
    updateUI(lastMessages);
  });

  // Focus input and wire ENTER + INPUT handlers once
  ensureMainInputFocus();

  uiNodes.inputEl.on(InputRenderableEvents.INPUT, () => {
    updateInputAssist();
  });

  uiNodes.inputEl.on(InputRenderableEvents.ENTER, async () => {
    // Browse mode: Enter opens chatter info for the selected message
    if (browseModeActive && browseSelectedIdx !== null) {
      const selectedLine = lastMessages[browseSelectedIdx];
      const rawMsg =
        typeof selectedLine === 'string'
          ? undefined
          : 'rawMsg' in selectedLine
            ? selectedLine.rawMsg
            : undefined;
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
    if (inputHistory.length > INPUT_HISTORY_LIMIT) {
      inputHistory.splice(0, inputHistory.length - INPUT_HISTORY_LIMIT);
    }
    _saveInputHistory();
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
  const runUpdateLoopPass = async () => {
    if (!isRunning) return;
    updateLoopTickCount += 1;
    updateLoopInFlight += 1;
    if (updateLoopInFlight > 1) {
      updateLoopOverlapCount += 1;
    }
    if (updateLoopInFlight > updateLoopInFlightHighWater) {
      updateLoopInFlightHighWater = updateLoopInFlight;
    }
    const startedAt = performance.now();
    try {
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
      const nextRefreshSignature = getUpdateLoopRefreshSignature();
      if (nextRefreshSignature !== lastUpdateLoopSignature) {
        lastUpdateLoopSignature = nextRefreshSignature;
        updateUiLoopRefreshCount += 1;
        refreshDynamicUiNodes();
      } else {
        updateLoopSkippedRefreshCount += 1;
      }
    } catch {
      // Renderer was destroyed outside the SIGINT path — stop the loop cleanly
      isRunning = false;
      if (updateLoop) clearInterval(updateLoop);
    } finally {
      const durationMs = performance.now() - startedAt;
      updateLoopLastDurationMs = durationMs;
      if (durationMs > updateLoopMaxDurationMs) {
        updateLoopMaxDurationMs = durationMs;
      }
      updateLoopInFlight = Math.max(0, updateLoopInFlight - 1);
    }
  };

  const updateLoop = TUI_UPDATE_LOOP_DISABLED ? null : setInterval(runUpdateLoopPass, 2000);

  const shutdown = async () => {
    isRunning = false;
    if (updateLoop) clearInterval(updateLoop);
    authService.stopAutoRefresh();
    await obsService.disconnect();
    renderer.destroy();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => defaultLogger.error('TUI main failed', err));
