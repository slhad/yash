// Suppress EventTarget MaxListeners warning from OpenTUI's CliRenderer
process.setMaxListeners(0);

import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import type { ActivityEventPayload, ChatMessage } from './platforms/base';
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
import { messageLog } from './services/message-log';
import {
  clearActionAutocompleteCaches,
  invalidateActionAutocompleteForObsEvent,
  setActionAutocompleteRuntime,
  subscribeToActionAutocompleteRefresh,
} from './utils/actionAutocomplete';
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
import {
  INPUT_HISTORY_LIMIT,
  loadInputHistory,
  navigateInputHistory,
  saveInputHistory,
  trimInputHistory,
} from './utils/inputHistory';
import { runIpcCommand } from './utils/ipcCommandRunner';
import logCollector from './utils/logCollector';
import { defaultLogger, parseLoggerLevelName, setDefaultLoggerLevel } from './utils/logger';
import {
  formatMemoryStatusDisplay,
  readMemoryAutoSnapshotSettings,
  readMemoryStatusSettings,
  readMemoryTelemetrySettings,
} from './utils/memoryStatus';
import {
  applyObsShutdownConfigPatch,
  buildObsShutdownConfigDraft,
  loadObsShutdownEffectiveConfig,
  validateObsShutdownConfigDraft,
} from './utils/obsShutdownConfig';
import {
  getPlatformStatusIconColumns,
  getPlatformStatusIconPlatformSizeSettingKey,
  PLATFORM_STATUS_ICON_SETTING_KEY,
  type PlatformStatusIconPlatform,
  readPlatformStatusIconSizePxForPlatform,
  readPlatformStatusIconsEnabled,
} from './utils/platformStatusIcons';
import { warmPlatformStatusIcons } from './utils/platformStatusIcons.server';
import { runtimeMonitor } from './utils/runtime-monitor';
import { getAutocomplete, initTuiCommands, setActionRegistry } from './utils/tuiCommands';
import { installTuiErrorCapture } from './utils/tuiErrorCapture';
import { getNextAutocompleteCycleIndex, type MessageTarget } from './utils/tuiMessageInput';
import { formatElapsed, getPlatformStatusColor } from './utils/tuiStatusPresentation';
import './index.ts'; // start Bun.serve web server in the same process
import { IpcActionError, registry } from './actions/registry';
import { createTuiCommandHandlers } from './actions/tuiCommandHandlers';
import type { ScriptActionsModalSpec, ScriptConfigModalSpec } from './actions/types';
import { startIpcServer } from './ipc/server';
import { loadUserScripts } from './scripts/loader';
import {
  type ActivityEvent,
  openActivityEventsModal,
  openMemoryStatusModal as openMemoryStatusUiModal,
  updateActivityBarText,
} from './ui/activityMemoryModals';
import {
  type ChatterInfoModalState,
  openChatterInfoModal as openChatterInfoUiModal,
} from './ui/chatterInfoModal';
import {
  type ConnectionSetupModalState,
  openKickSetupModal as openKickSetupConnectionModal,
  openObsConnectModal as openObsConnectionModal,
  openTwitchSetupModal as openTwitchSetupConnectionModal,
  openYouTubeCredentialsModal as openYouTubeCredentialsConnectionModal,
} from './ui/connectionSetupModals';
import { type HistoryModalState, openHistoryModal as openHistoryUiModal } from './ui/historyModal';
import { initMainLayout, type UINodes } from './ui/mainLayout';
import {
  type MarkerEditModalContext,
  openMarkerEditModal as openMarkerEditUiModal,
} from './ui/markerEditModal';
import {
  type ObsShutdownConfigModalContext,
  type ObsShutdownConfigModalState,
  openObsShutdownConfigModal as openObsShutdownConfigUiModal,
} from './ui/obsShutdownConfigModal';
import {
  openScriptActionsModal as openScriptActionsUiModal,
  type ScriptActionsModalContext,
  type ScriptActionsModalState,
} from './ui/scriptActionsModal';
import {
  openScriptConfigModal as openScriptConfigUiModal,
  type ScriptConfigModalContext,
  type ScriptConfigModalState,
} from './ui/scriptConfigModal';
import {
  openSettingsModal as openSettingsUiModal,
  type SettingsModalContext,
} from './ui/settingsModal';
import {
  openStreamModal as openStreamUiModal,
  type StreamModalContext,
  type StreamModalState,
} from './ui/streamModal';
import {
  type ChatLine,
  classifyChatLine,
  getMessageTargetColor,
  renderChatLine,
  renderHighlightedChatLine,
  transformCommandFeedback,
  transformMessageToChatLine,
  transformOutgoingMessage,
} from './ui/tuiChatLines';
import { TuiFfzRuntime, type TwitchProviderEmoteContext } from './ui/tuiFfzRuntime';
import { buildTuiRuntimeProbeResult } from './ui/tuiRuntimeProbe';
import { openYouTubeSetupModal as openYouTubeSetupUiModal } from './ui/youtubeSetupModal';
import {
  openYouTubePlaylistPickerModal as openYouTubePlaylistPickerUiModal,
  openYouTubeStreamKeyModal as openYouTubeStreamKeyUiModal,
  openYouTubeStreamPickerModal as openYouTubeStreamPickerUiModal,
  type YouTubeStreamModalsContext,
} from './ui/youtubeStreamModals';
import './actions/markers';
import './actions/chat';
import './scripts/obs-shutdown';

const settings = settingsStore;

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
    pruneActivityEvents();
    require('node:fs').writeFileSync(_getActivityLogPath(), JSON.stringify(activityEvents), 'utf8');
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
  const getter = (key: string, fallback: unknown) => settings.get(key, fallback);
  const telemetry = readMemoryTelemetrySettings(getter);
  runtimeMonitor.configureTelemetryLogging(telemetry.enabled, telemetry.intervalMinutes);
  runtimeMonitor.configureAutoHeapSnapshots(readMemoryAutoSnapshotSettings(getter));
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
  if (key.startsWith('memory.telemetry.') || key.startsWith('memory.autoSnapshot.')) {
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
    tuiFfzRuntime.resetPlatformStatusIconState();
    if (statusPlatformIconsEnabled()) {
      for (const platform of platforms) {
        tuiFfzRuntime.schedulePlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
      }
    }
  }
  if (key === PLATFORM_STATUS_ICON_SETTING_KEY) {
    tuiFfzRuntime.resetPlatformStatusIconState();
    if (String(value).toLowerCase() === 'true') {
      warmPlatformStatusIcons();
      for (const platform of platforms) {
        tuiFfzRuntime.schedulePlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
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

function statusPlatformIconsEnabled(): boolean {
  return readPlatformStatusIconsEnabled((key, fallback) => settings.get(key, fallback));
}

function getStatusPlatformIconSizePxForPlatform(platform: PlatformStatusIconPlatform): number {
  return readPlatformStatusIconSizePxForPlatform(platform, (key, fallback) =>
    settings.get(key, fallback),
  );
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

let uiNodes: UINodes | null = null;
let selectedMessageTarget: MessageTarget = 'all';

let autocycleSuggestions: string[] = [];
let autocycleHints: string[] = [];
let autocycleIndex = -1;

type StreamModal = StreamModalState;

interface SettingsModal {
  box: BoxRenderable;
  focusIndex: number;
}

let activeModal: ConnectionSetupModalState | null = null;
let activeStreamModal: StreamModal | null = null;
let activeSettingsModal: SettingsModal | null = null;
let activeObsShutdownConfigModal: ObsShutdownConfigModalState | null = null;
let activeScriptConfigModal: ScriptConfigModalState | null = null;
let activeScriptActionsModal: ScriptActionsModalState | null = null;
let activeChatterInfoModal: ChatterInfoModalState | null = null;
let activeHistoryModal: HistoryModalState | null = null;
let activeActivityModal: { box: BoxRenderable; close: () => void } | null = null;
let activeMemoryModal: { box: BoxRenderable; close: () => void } | null = null;

const STREAM_TEMPLATE_SETTINGS_KEY = 'streamTemplates';

const chatterCache = new ChatterCache();

function hasActiveModal(): boolean {
  return Boolean(
    activeModal ||
      activeStreamModal ||
      activeSettingsModal ||
      activeObsShutdownConfigModal ||
      activeScriptConfigModal ||
      activeScriptActionsModal ||
      activeChatterInfoModal ||
      activeHistoryModal ||
      activeActivityModal ||
      activeMemoryModal,
  );
}

function ensureMainInputFocus(): void {
  if (!uiNodes) return;
  if (hasActiveModal()) return;
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
      uiNodes.renderer.requestRender();
      return;
    }
    const { hints } = getAutocomplete(val);
    if (hints.length > 0) {
      hint.content = `  ${hints.join('  ')}`;
      hint.visible = true;
    } else {
      hint.visible = false;
    }
    uiNodes.renderer.requestRender();
    return;
  }

  hint.visible = false;
  composeTargetText.content = `${selectedMessageTarget} > `;
  composeTargetText.fg = getMessageTargetColor(selectedMessageTarget);
  composeTargetText.visible = true;
  uiNodes.inputEl.placeholder = 'type a message…';
  uiNodes.inputEl.fg = 'white';
  uiNodes.renderer.requestRender();
}

function prefillMainInput(value: string): void {
  if (!uiNodes) return;
  uiNodes.inputEl.value = value;
  updateInputAssist();
  uiNodes.inputEl.focus();
}

function openActivityModal(): void {
  if (!uiNodes) return;
  openActivityEventsModal({
    renderer: uiNodes.renderer,
    canOpen: () =>
      Boolean(
        uiNodes &&
          !activeActivityModal &&
          !activeMemoryModal &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal &&
          !activeScriptActionsModal &&
          !activeChatterInfoModal &&
          !activeHistoryModal,
      ),
    getActiveActivityModal: () => activeActivityModal,
    setActiveActivityModal: (modal) => {
      activeActivityModal = modal;
    },
    activityEvents,
    focusMainInput: ensureMainInputFocus,
    openChatterInfoModal,
    appendError: (message) => {
      lastMessages.push(message);
      updateUI(lastMessages);
    },
  });
}

function openMemoryStatusModal(): void {
  if (!uiNodes) return;
  openMemoryStatusUiModal({
    renderer: uiNodes.renderer,
    canOpen: () =>
      Boolean(
        uiNodes &&
          !activeMemoryModal &&
          !activeActivityModal &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal &&
          !activeScriptActionsModal &&
          !activeChatterInfoModal &&
          !activeHistoryModal,
      ),
    getActiveMemoryModal: () => activeMemoryModal,
    setActiveMemoryModal: (modal) => {
      activeMemoryModal = modal;
    },
    getSetting: (key, fallback) => settings.get(key, fallback),
    getRuntimeStatus: () => runtimeMonitor.getStatus(),
    focusMainInput: () => uiNodes?.inputEl.focus(),
  });
}

// ─── initUI ─────────────────────────────────────────────────────────────────
// Builds the complete layout tree once and attaches it to renderer.root.
// Called once at startup; called again only on structural settings changes.

function initUI(renderer: CliRenderer, messages: ChatLine[]): UINodes {
  return initMainLayout({
    renderer,
    previousUiNodes: uiNodes,
    messages,
    settings,
    platforms,
    providers: { youtube, twitch, kick },
    obsConnected: obsService.isConnected(),
    demoVisible: isDemoMode(),
    selectedMessageTarget,
    boolSetting,
    numSetting,
    formatElapsed,
    buildPlatformStatusContent: (platform, status, viewers) =>
      tuiFfzRuntime.buildPlatformStatusContent(platform, status, viewers),
    getPlatformStatusColor,
    getTuiMemoryStatusNodeState,
    openMemoryStatusModal,
    openActivityModal,
    onActivityBarMouseOver: () => {
      activityBarHovered = true;
      if (activityRefreshTimer) {
        clearTimeout(activityRefreshTimer);
        activityRefreshTimer = null;
      }
      updateUI(lastMessages);
    },
    onActivityBarMouseOut: () => {
      activityBarHovered = false;
      _scheduleActivityBarRefresh();
      updateUI(lastMessages);
    },
    updateActivityBarText: (node) =>
      updateActivityBarText(node, {
        mode: settings.get('activity.mode', 'permanent') as string,
        activityEvents,
        timedVisibleEvents: _timedVisibleEvents(),
      }),
    activityBarShouldBeVisible: _activityBarShouldBeVisible,
    renderChatLine,
    fillSidebar: _fillSidebar,
    getMessageTargetColor,
  });
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
      node.content = tuiFfzRuntime.buildPlatformStatusContent(platform, status, viewers);
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
  updateActivityBarText(activityBarText, {
    mode: settings.get('activity.mode', 'permanent') as string,
    activityEvents,
    timedVisibleEvents: _timedVisibleEvents(),
  });
}

// ─── Command dispatch ────────────────────────────────────────────────────────

function createConnectionSetupModalContext() {
  if (!uiNodes) throw new Error('connection setup modal requires initialized UI nodes');
  const { renderer } = uiNodes;
  return {
    renderer,
    getActiveModal: () => activeModal,
    setActiveModal: (modal: ConnectionSetupModalState | null) => {
      activeModal = modal;
    },
    focusMainInput: () => uiNodes?.inputEl.focus(),
    appendMessage: (message: string) => {
      lastMessages.push(message);
      updateUI(lastMessages);
    },
    saveConfig,
  };
}

function openTwitchSetupModal(): void {
  if (!uiNodes || activeModal) return;
  openTwitchSetupConnectionModal(createConnectionSetupModalContext());
}

function openKickSetupModal(): void {
  if (!uiNodes || activeModal) return;
  openKickSetupConnectionModal(createConnectionSetupModalContext());
}

function openYouTubeCredentialsModal(): void {
  if (!uiNodes || activeModal) return;
  openYouTubeCredentialsConnectionModal(createConnectionSetupModalContext());
}

function openObsConnectModal(): void {
  if (!uiNodes || activeModal) return;
  openObsConnectionModal(createConnectionSetupModalContext(), obsService);
}

function createYouTubeStreamModalsContext(): YouTubeStreamModalsContext {
  if (!uiNodes) throw new Error('YouTube stream modal requires initialized UI nodes');
  return {
    renderer: uiNodes.renderer,
    getActiveModal: () => activeModal,
    setActiveModal: (modal) => {
      activeModal = modal;
    },
    focusMainInput: () => uiNodes?.inputEl.focus(),
    appendAndRender: (message) => {
      lastMessages.push(message);
      updateUI(lastMessages);
    },
    saveStreamKey: async (streamKey) => {
      await saveConfig({ platforms: { youtube: { streamKey } } });
      youtube.setStreamKey(streamKey);
    },
    listStreams: () => youtube.listStreams(),
    listPlaylists: () => youtube.listPlaylists(),
  };
}

function openYouTubeStreamKeyModal(onSaved?: () => void): void {
  if (!uiNodes || activeModal) return;
  openYouTubeStreamKeyUiModal(createYouTubeStreamModalsContext(), onSaved);
}

function openYouTubeStreamPickerModal(onSaved?: () => void): void {
  if (!uiNodes || activeModal) return;
  openYouTubeStreamPickerUiModal(createYouTubeStreamModalsContext(), onSaved);
}

function openYouTubePlaylistPickerModal(
  onSelect: (id: string, title: string) => void,
  onCancel: () => void,
): void {
  if (!uiNodes || activeModal) return;
  openYouTubePlaylistPickerUiModal(createYouTubeStreamModalsContext(), onSelect, onCancel);
}

function openYouTubeSetupModal(): void {
  if (!uiNodes || activeModal) return;
  openYouTubeSetupUiModal({
    renderer: uiNodes.renderer,
    getActiveModal: () => activeModal,
    setActiveModal: (modal) => {
      activeModal = modal;
    },
    focusMainInput: () => uiNodes?.inputEl.focus(),
    appendAndRender: (message) => {
      lastMessages.push(message);
      updateUI(lastMessages);
    },
    getSetup: () => youtube.getSetup(),
    saveSetup: (setup) => settings.set('platforms.youtube.setup', setup),
    openPlaylistPicker: openYouTubePlaylistPickerModal,
  });
}

function createMarkerEditModalContext(): MarkerEditModalContext {
  return {
    renderer: uiNodes!.renderer,
    hasBlockingModal: () =>
      Boolean(
        !uiNodes ||
          activeModal ||
          activeStreamModal ||
          activeSettingsModal ||
          activeObsShutdownConfigModal ||
          activeScriptConfigModal,
      ),
    getActiveModal: () => activeModal,
    setActiveModal: (modal) => {
      activeModal = modal;
    },
    focusMainInput: () => uiNodes?.inputEl.focus(),
    appendAndRender: (message) => {
      lastMessages.push(message);
      updateUI(lastMessages);
    },
    createIndentedInputRow,
    getMarker: (selectionId) => youtube.getPersistedMarkerBySelectionId(selectionId),
    editMarker: (selectionId, text, timestamp) =>
      registry.invokeAction(
        'markers.edit',
        { selectionId, text, timestamp },
        { chatService, providers: { youtube, twitch, kick } },
      ),
    formatEditError: (err) =>
      err instanceof IpcActionError
        ? `[markers] ${err.message}`
        : `[markers] Error: ${String(err)}`,
  };
}

function openMarkerEditModal(selectionId: number): void {
  openMarkerEditUiModal(createMarkerEditModalContext(), selectionId);
}

function createStreamModalContext(): StreamModalContext {
  return {
    uiNodes,
    hasBlockingModal: () =>
      Boolean(
        activeModal ||
          activeSettingsModal ||
          activeObsShutdownConfigModal ||
          activeScriptConfigModal,
      ),
    getActiveStreamModal: () => activeStreamModal,
    setActiveStreamModal: (modal) => {
      activeStreamModal = modal;
    },
    platforms,
    providers: { youtube, twitch, kick },
    settings,
    streamService,
    lastMessages,
    updateUI,
    createIndentedInputRow,
  };
}

function openStreamModal(preselected: string[]): void {
  openStreamUiModal(createStreamModalContext(), preselected);
}

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

function createSettingsModalContext(): SettingsModalContext {
  return {
    uiNodes,
    hasBlockingModal: () =>
      Boolean(
        activeStreamModal || activeModal || activeObsShutdownConfigModal || activeScriptConfigModal,
      ),
    getActiveSettingsModal: () => activeSettingsModal,
    setActiveSettingsModal: (modal) => {
      activeSettingsModal = modal;
    },
    settings,
    defaultTuiEmoteScalePercent: DEFAULT_TUI_EMOTE_SCALE_PERCENT,
    lastMessages,
    lastRawMessages,
    updateUI,
    createIndentedInputRow,
    persistSettingEntries,
    transformMessage,
    reloadTuiFfzEmotes: (reason) => tuiFfzRuntime.reload(reason),
  };
}

function openSettingsModal(): void {
  openSettingsUiModal(createSettingsModalContext());
}

function createObsShutdownConfigModalContext(): ObsShutdownConfigModalContext {
  return {
    renderer: uiNodes!.renderer,
    hasBlockingModal: () =>
      Boolean(
        !uiNodes ||
          activeModal ||
          activeStreamModal ||
          activeSettingsModal ||
          activeObsShutdownConfigModal ||
          activeScriptConfigModal ||
          activeScriptActionsModal ||
          activeChatterInfoModal ||
          activeHistoryModal ||
          activeActivityModal,
      ),
    getActiveModal: () => activeObsShutdownConfigModal,
    setActiveModal: (modal) => {
      activeObsShutdownConfigModal = modal;
    },
    loadDraft: () => buildObsShutdownConfigDraft(loadObsShutdownEffectiveConfig()),
    validateDraft: validateObsShutdownConfigDraft,
    applyConfigPatch: applyObsShutdownConfigPatch,
    persistSettingEntries,
    createIndentedInputRow,
    appendMessage: (message) => lastMessages.push(message),
    update: () => updateUI(lastMessages),
    focusMainInput: () => uiNodes?.inputEl.focus(),
  };
}

function openObsShutdownConfigModal(): void {
  if (!uiNodes) return;
  openObsShutdownConfigUiModal(createObsShutdownConfigModalContext());
}

function createScriptConfigModalContext(): ScriptConfigModalContext {
  return {
    renderer: uiNodes!.renderer,
    hasBlockingModal: () =>
      Boolean(
        !uiNodes ||
          activeModal ||
          activeStreamModal ||
          activeSettingsModal ||
          activeObsShutdownConfigModal ||
          activeScriptConfigModal ||
          activeScriptActionsModal ||
          activeChatterInfoModal ||
          activeHistoryModal ||
          activeActivityModal,
      ),
    getActiveModal: () => activeScriptConfigModal,
    setActiveModal: (modal) => {
      activeScriptConfigModal = modal;
    },
    lastMessages,
    updateUI,
    focusMainInput: () => uiNodes?.inputEl.focus(),
    createIndentedInputRow,
  };
}

function openScriptConfigModal(spec: ScriptConfigModalSpec): void {
  if (!uiNodes) return;
  openScriptConfigUiModal(createScriptConfigModalContext(), spec);
}

function createScriptActionsModalContext(): ScriptActionsModalContext {
  return {
    renderer: uiNodes!.renderer,
    hasBlockingModal: () =>
      Boolean(
        !uiNodes ||
          activeMemoryModal ||
          activeModal ||
          activeStreamModal ||
          activeSettingsModal ||
          activeObsShutdownConfigModal ||
          activeScriptConfigModal ||
          activeScriptActionsModal ||
          activeChatterInfoModal ||
          activeHistoryModal ||
          activeActivityModal,
      ),
    getActiveModal: () => activeScriptActionsModal,
    setActiveModal: (modal) => {
      activeScriptActionsModal = modal;
    },
    listActions: () =>
      registry.listActions({ details: true }) as Array<{
        id: string;
        title: string;
        description: string;
        args: Record<string, unknown>;
        visibility: string;
        safety: string;
        scriptId?: string;
      }>,
    invokeActionFromTui,
    prefillMainInput,
    appendMessage: (message) => lastMessages.push(message),
    update: () => updateUI(lastMessages),
    focusMainInput: () => uiNodes?.inputEl.focus(),
  };
}

function openScriptActionsModal(spec: ScriptActionsModalSpec): void {
  if (!uiNodes) return;
  openScriptActionsUiModal(createScriptActionsModalContext(), spec);
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
    ui: { openObsShutdownConfigModal, openScriptConfigModal, openScriptActionsModal },
  });
  for (const line of result.output ?? []) emit(line);
  for (const warn of result.warnings ?? []) emit(`[warning] ${warn}`);
}

// ─── Chatter info modal ──────────────────────────────────────────────────────

function openChatterInfoModal(msg: ChatMessage): void {
  openChatterInfoUiModal(
    {
      uiNodes,
      hasBlockingModal: () =>
        Boolean(
          activeModal ||
            activeStreamModal ||
            activeSettingsModal ||
            activeObsShutdownConfigModal ||
            activeScriptConfigModal ||
            activeScriptActionsModal,
        ),
      getActiveChatterInfoModal: () => activeChatterInfoModal,
      setActiveChatterInfoModal: (modal) => {
        activeChatterInfoModal = modal;
      },
      focusMainInput: ensureMainInputFocus,
      chatterCache,
      messageLog,
      chatService,
      sessionHelpers: {
        getChatterSessionMessages,
        getChatterSessionStats,
        applySessionStatsToChatterInfo,
        doesIncomingMessageAffectChatterSession,
        doesIncomingMessageAffectChatterAllTime,
        doesIncomingMessageAffectChatterContext,
      },
      providers: { twitch, youtube, kick },
      tuiFfzEmotes: tuiFfzRuntime.emotes,
      tuiFfzImageIdsByName: tuiFfzRuntime.imageIdsByName,
      getTuiEmoteColumns: () => tuiFfzRuntime.getEmoteColumns(),
    },
    msg,
  );
}

// ─── History modal ───────────────────────────────────────────────────────────

function openHistoryModal(opts?: { query?: string }): void {
  openHistoryUiModal(
    {
      uiNodes,
      hasBlockingModal: () =>
        Boolean(
          activeModal ||
            activeStreamModal ||
            activeSettingsModal ||
            activeObsShutdownConfigModal ||
            activeScriptConfigModal ||
            activeScriptActionsModal ||
            activeChatterInfoModal ||
            activeHistoryModal,
        ),
      getActiveHistoryModal: () => activeHistoryModal,
      setActiveHistoryModal: (modal) => {
        activeHistoryModal = modal;
      },
      focusMainInput: ensureMainInputFocus,
      messageLog,
      tuiFfzEmotes: tuiFfzRuntime.emotes,
      tuiFfzImageIdsByName: tuiFfzRuntime.imageIdsByName,
      getTuiEmoteColumns: () => tuiFfzRuntime.getEmoteColumns(),
    },
    opts,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

let isRunning = true;
const lastMessages: ChatLine[] = [];
let cliRenderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;
const inputHistory: string[] = [];
let historyIndex = -1;

// ─── Browse mode state ───────────────────────────────────────────────────────
let browseModeActive = false;
let browseSelectedIdx: number | null = null; // index into lastMessages
const lastRawMessages: ChatMessage[] = []; // parallel to lastMessages (only chat platform messages)

const tuiFfzRuntime = new TuiFfzRuntime({
  maxImages: MAX_TUI_FFZ_IMAGES,
  defaultScalePercent: DEFAULT_TUI_EMOTE_SCALE_PERCENT,
  getSetting: (key, fallback) => settings.get(key, fallback),
  getTwitchContext: () => twitch as unknown as TwitchProviderEmoteContext,
  statusPlatformIconsEnabled,
  getPlatformStatusIconSizePx: getStatusPlatformIconSizePxForPlatform,
  getPlatformStatusIconColumns,
  onUiRefresh: () => {
    if (uiNodes) updateUI(lastMessages);
  },
  rerenderRawChatLines,
  warn: (message) => defaultLogger.warn(message),
  tmuxEnv: () => process.env.TMUX,
  termEnv: () => process.env.TERM,
  spawnSync: Bun.spawnSync,
});

function trimUiChatMemory(): void {
  const maxHistory = getChatHistoryLimit();
  trimArrayTail(lastMessages, maxHistory);
  trimArrayTail(lastRawMessages, maxHistory);
  if (browseSelectedIdx !== null && browseSelectedIdx >= lastMessages.length) {
    browseSelectedIdx = lastMessages.length > 0 ? lastMessages.length - 1 : null;
  }
}

runtimeMonitor.registerProbe('tui', () => {
  const chatterStats = chatterCache.getStats();
  const logStats = logCollector.getStats();
  const ffzStats = tuiFfzRuntime.getStats();
  return buildTuiRuntimeProbeResult({
    maxHistory: getChatHistoryLimit(),
    inputHistoryLimit: INPUT_HISTORY_LIMIT,
    eventLogLimit: MAX_EVENT_LOG_ENTRIES,
    activityEventsLimit: MAX_ACTIVITY_EVENTS,
    ffzImageCacheLimit: MAX_TUI_FFZ_IMAGES,
    updateLoopDisabled: TUI_UPDATE_LOOP_DISABLED,
    lastMessagesLength: lastMessages.length,
    lastRawMessagesLength: lastRawMessages.length,
    inputHistoryLength: inputHistory.length,
    browseModeActive,
    eventLogLength: eventLog.length,
    activityEventsLength: activityEvents.length,
    ffzImageCacheSize: ffzStats.imageCacheSize,
    ffzUploadCount: ffzStats.uploadCount,
    ffzUploadBytes: ffzStats.uploadBytes,
    ffzLastUploadBytes: ffzStats.lastUploadBytes,
    ffzClearCount: ffzStats.clearCount,
    ffzRefreshCount: ffzStats.refreshCount,
    ffzImageIdHighWaterMark: ffzStats.imageIdHighWaterMark,
    updateUiCount,
    updateUiLoopRefreshCount,
    updateUiLastDurationMs,
    updateUiTotalDurationMs,
    updateUiMaxDurationMs,
    updateUiLastMessageCount,
    updateUiChatChildrenHighWater,
    updateUiSidebarChildrenHighWater,
    updateLoopTickCount,
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
  });
});

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

function transformMessage(msg: ChatMessage): ChatLine {
  return transformMessageToChatLine(msg, {
    showTimestamps: boolSetting(settings.get('chat.timestamps.visible', true), true),
    emotes: tuiFfzRuntime.emotes,
    imageIdsByName: tuiFfzRuntime.imageIdsByName,
    emoteColumns: tuiFfzRuntime.getEmoteColumns(),
    scheduleUploadsForMessage: (platform, message) =>
      tuiFfzRuntime.scheduleUploadsForMessage(platform, message),
  });
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

// Keys of this object are the single source of truth for TUI command names —
// initTuiCommands() below syncs them into the autocomplete module at startup.
const commandHandlers = createTuiCommandHandlers({
  authService,
  chatService,
  registry,
  youtube,
  twitch,
  kick,
  platforms,
  settings,
  logCollector,
  obsService,
  getCliRenderer: () => cliRenderer,
  lastMessages,
  lastRawMessages,
  classifyChatLine,
  openObsConnectModal,
  openTwitchSetupModal,
  openKickSetupModal,
  openYouTubeCredentialsModal,
  openYouTubeStreamPickerModal,
  openStreamModal,
  openMarkerEditModal,
  openSettingsModal,
  openActivityModal,
  openYouTubeSetupModal,
  openMemoryStatusModal,
  openChatterInfoModal,
  openHistoryModal,
  updateUI,
  refreshTuiFfzEmotes: (reason: string) => tuiFfzRuntime.refresh(reason),
  reloadTuiFfzEmotes: (reason: string) => tuiFfzRuntime.reload(reason),
  getSettingValue,
  persistSettingEntries,
  normalizeSettingValueForPersistence,
  deprecatedSettingsMessages: DEPRECATED_SETTINGS_KEY_MESSAGES,
  invokeActionFromTui,
  resetBrowseSelection: () => {
    browseModeActive = false;
    browseSelectedIdx = null;
  },
  setRunning: (value: boolean) => {
    isRunning = value;
  },
});
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

let mainInputSubmitInFlight = false;

function recallInputHistory(direction: 'previous' | 'next'): boolean {
  if (!uiNodes || hasActiveModal() || browseModeActive) return false;
  const next = navigateInputHistory(inputHistory, historyIndex, direction);
  historyIndex = next.historyIndex;
  if (next.value !== undefined) {
    uiNodes.inputEl.value = next.value;
    updateInputAssist();
  }
  return true;
}

function enterBrowseMode(): void {
  browseModeActive = true;
  browseSelectedIdx = lastMessages.length > 0 ? lastMessages.length - 1 : null;
  updateUI(lastMessages);
}

function exitBrowseMode(): void {
  browseModeActive = false;
  browseSelectedIdx = null;
  updateUI(lastMessages);
}

function handleMainInputEscape(): boolean {
  if (!uiNodes || hasActiveModal()) return false;
  if (browseModeActive) {
    exitBrowseMode();
    return true;
  }
  if (uiNodes.inputEl.value.length > 0) {
    uiNodes.inputEl.value = '';
    historyIndex = -1;
    updateInputAssist();
    return true;
  }
  enterBrowseMode();
  return true;
}

async function submitMainInput(): Promise<void> {
  if (!uiNodes || mainInputSubmitInFlight) return;
  mainInputSubmitInFlight = true;
  try {
    // Browse mode: Enter opens chatter info for the selected message.
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

    const rawValue = uiNodes.inputEl.value;
    let trimmed = rawValue.trim();
    if (trimmed.startsWith('/')) {
      const { completion, hints } = getAutocomplete(trimmed);
      if (hints.length === 1 && completion) trimmed = completion;
    }
    uiNodes.inputEl.value = '';
    uiNodes.autocompleteHint.visible = false;
    if (!trimmed) return;
    inputHistory.push(trimmed);
    trimInputHistory(inputHistory);
    saveInputHistory(getDataDir(), inputHistory);
    historyIndex = -1;
    await handleCommand(trimmed);
    selectedMessageTarget = 'all';
    updateInputAssist();
    updateUI(lastMessages);
  } finally {
    mainInputSubmitInFlight = false;
  }
}

async function main() {
  let shutdownStarted = false;
  let shutdown: () => Promise<void>;
  const earlyStdinCtrlCHandler = (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (text.includes('\x03')) {
      if (shutdown) void shutdown();
      else process.exit(0);
    }
  };
  process.stdin.on('data', earlyStdinCtrlCHandler);
  syncRuntimeMonitorTelemetrySettings();
  runtimeMonitor.start();
  const renderer = await createCliRenderer({
    screenMode:
      (process.env.YASH_SCREEN_MODE as 'main-screen' | 'alternate-screen') ?? 'main-screen',
    consoleMode: 'disabled',
    openConsoleOnError: false,
    useKittyKeyboard: null,
    useMouse: true,
    exitOnCtrlC: true,
    exitSignals: [],
    onDestroy: () => {
      if (!shutdownStarted) void shutdown();
    },
    // Intercept Tab/Up/Down at raw sequence level.
    // Tab → autocomplete; Up/Down → history navigation.
    prependInputHandlers: [
      (sequence: string): boolean => {
        if (!uiNodes) return false;

        // Raw mode swallows Ctrl+C — shut down directly so one C-c exits cleanly.
        if (sequence === '\x03') {
          void shutdown();
          return true;
        }

        if (hasActiveModal()) {
          if (sequence === '\x1b' || sequence === '\x1b\x1b') {
            const closedFallbackModal = Boolean(activeMemoryModal || activeChatterInfoModal);
            activeMemoryModal?.close();
            activeChatterInfoModal?.close();
            if (closedFallbackModal) return true;
          }
          return false;
        }

        ensureMainInputFocus();

        // Some terminals/tmux paths deliver Enter only to the raw prepend handler.
        // Submit main input here so slash commands still execute even when the
        // InputRenderable ENTER event is not emitted.
        if ((sequence === '\r' || sequence === '\n') && !hasActiveModal()) {
          void submitMainInput();
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
        if (sequence === '\x1b[1;2A') {
          enterBrowseMode();
          return true;
        }

        // Shift+Down (\x1b[1;2B) — exit browse mode
        if (sequence === '\x1b[1;2B') {
          exitBrowseMode();
          return true;
        }

        if (sequence === '\x1b[A' || sequence === '\x1bOA') {
          // Up arrow — in browse mode: navigate up; otherwise: go back in history
          if (browseModeActive) {
            if (browseSelectedIdx !== null) {
              browseSelectedIdx = Math.max(0, browseSelectedIdx - 1);
            }
            updateUI(lastMessages);
            return true;
          }
          return recallInputHistory('previous');
        }

        if (sequence === '\x1b[B' || sequence === '\x1bOB') {
          // Down arrow — in browse mode: navigate down; otherwise: go forward in history
          if (browseModeActive) {
            if (browseSelectedIdx !== null) {
              browseSelectedIdx = Math.min(lastMessages.length - 1, browseSelectedIdx + 1);
            }
            updateUI(lastMessages);
            return true;
          }
          return recallInputHistory('next');
        }

        // Escape — clear input first, then enter message browse mode; Escape again exits browse mode.
        if (sequence === '\x1b' || sequence === '\x1b\x1b') {
          return handleMainInputEscape();
        }

        // Ctrl+L / Ctrl+Shift+L — cycle sidebar visibility
        // Both send \x0c in this terminal; can't be distinguished without kitty support
        if (
          sequence === '\x0c' &&
          !activeModal &&
          !activeStreamModal &&
          !activeSettingsModal &&
          !activeObsShutdownConfigModal &&
          !activeScriptConfigModal &&
          !activeScriptActionsModal
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
          !activeScriptActionsModal &&
          !activeHistoryModal &&
          !activeChatterInfoModal &&
          !activeMemoryModal
        ) {
          openActivityModal();
          return true;
        }

        if (!hasActiveModal()) {
          queueMicrotask(() => updateInputAssist());
        }
        return false;
      },
    ],
  });
  process.stdin.off('data', earlyStdinCtrlCHandler);
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
    if (msg.platform === 'twitch' && Object.keys(tuiFfzRuntime.emotes).length === 0) {
      void tuiFfzRuntime.refresh('incoming-twitch-message');
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

  inputHistory.push(...loadInputHistory(getDataDir()));

  // Build UI tree once — no flicker on periodic updates
  uiNodes = initUI(renderer, lastMessages);
  if (statusPlatformIconsEnabled()) {
    for (const platform of platforms) {
      scheduleTuiPlatformStatusIconUpload(platform as PlatformStatusIconPlatform);
    }
  }
  lastUpdateLoopSignature = getUpdateLoopRefreshSignature();
  void tuiFfzRuntime.refresh('startup');
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

  uiNodes.inputEl.onKeyDown = ((key: {
    name?: string;
    ctrl?: boolean;
    sequence?: string;
    raw?: string;
    preventDefault?: () => void;
    stopPropagation?: () => void;
  }) => {
    if ((key.ctrl && key.name === 'c') || key.sequence === '\x03' || key.raw === '\x03') {
      key.preventDefault?.();
      key.stopPropagation?.();
      void shutdown();
      return;
    }
    if (key.name === 'escape') {
      key.preventDefault?.();
      handleMainInputEscape();
      return;
    }
    if (key.name === 'up') {
      key.preventDefault?.();
      recallInputHistory('previous');
      return;
    }
    if (key.name === 'down') {
      key.preventDefault?.();
      recallInputHistory('next');
    }
  }) as any;

  uiNodes.inputEl.on(InputRenderableEvents.ENTER, async () => {
    await submitMainInput();
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

  shutdown = async () => {
    if (shutdownStarted) {
      process.exit(0);
    }
    shutdownStarted = true;
    const forceExit = setTimeout(() => process.exit(0), 750);
    forceExit.unref?.();
    isRunning = false;
    if (updateLoop) clearInterval(updateLoop);
    runtimeMonitor.stop();
    authService.stopAutoRefresh();
    try {
      renderer.destroy();
    } catch {
      // best-effort shutdown
    }
    try {
      await obsService.disconnect();
    } catch {
      // best-effort shutdown
    }
    clearTimeout(forceExit);
    process.exit(0);
  };

  (renderer as any)._keyHandler?.on?.(
    'keypress',
    (key: { name?: string; ctrl?: boolean; sequence?: string; raw?: string }) => {
      if ((key.ctrl && key.name === 'c') || key.sequence === '\x03' || key.raw === '\x03') {
        void shutdown();
      }
    },
  );
  (renderer as any).keyHandler?.on?.(
    'keypress',
    (key: { name?: string; ctrl?: boolean; sequence?: string; raw?: string }) => {
      if ((key.ctrl && key.name === 'c') || key.sequence === '\x03' || key.raw === '\x03') {
        void shutdown();
      }
    },
  );
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((err) => defaultLogger.error('TUI main failed', err));
