// Suppress EventTarget MaxListeners warning from OpenTUI's CliRenderer
process.setMaxListeners(0);

import {
  BoxRenderable,
  type CliRenderer,
  createCliRenderer,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  TextAttributes,
  TextRenderable,
} from '@opentui/core';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { isDemoMode } from './utils/config';
import logCollector from './utils/logCollector';
import { defaultLogger } from './utils/logger';
import SettingsStore from './utils/settings';
import { getAutocomplete } from './utils/tuiCommands';
import { parseMarkerArgs, parseSettingsValue } from './utils/webCommands';

const youtube = new YouTubeProvider();
const twitch = new TwitchProvider();
const kick = new KickProvider();

const chatService = new ChatService();
const streamService = new StreamService();
const obsService = new ObsService('localhost', 4455, null);

chatService.registerProvider('youtube', youtube);
chatService.registerProvider('twitch', twitch);
chatService.registerProvider('kick', kick);

streamService.registerProvider('youtube', youtube);
streamService.registerProvider('twitch', twitch);
streamService.registerProvider('kick', kick);

const platforms = ['youtube', 'twitch', 'kick'];
const settings = new SettingsStore();

// In-memory event log for the sidebar
const eventLog: Array<{ ts: number; platform: string; type: string; message: string }> = [];
function pushEvent(platform: string, type: string, message: string): void {
  eventLog.push({ ts: Date.now(), platform, type, message });
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

function clearScrollBox(scroll: ScrollBoxRenderable): void {
  for (const child of scroll.getChildren()) {
    scroll.remove(child.id);
  }
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
  chatScroll: ScrollBoxRenderable;
  sidebarBox: BoxRenderable;
  sidebarScroll: ScrollBoxRenderable;
  inputEl: InputRenderable;
  autocompleteHint: TextRenderable;
}

let uiNodes: UINodes | null = null;

// ─── initUI ─────────────────────────────────────────────────────────────────
// Builds the complete layout tree once and attaches it to renderer.root.
// Called once at startup; called again only on structural settings changes.

function initUI(renderer: CliRenderer, messages: string[]): UINodes {
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
  const statusBox = new BoxRenderable(renderer, {
    marginTop: 1,
    borderStyle: 'rounded',
    border: true,
    padding: 1,
    title: ' Status ',
  });

  // All platforms on a single horizontal row
  const platformRow = new BoxRenderable(renderer, { flexDirection: 'row' });
  const platformTexts = new Map<string, TextRenderable>();
  let totalViewers = 0;
  for (const platform of platforms) {
    const provider = platform === 'youtube' ? youtube : platform === 'twitch' ? twitch : kick;
    const status = provider.getStatus();
    const viewerCount = provider.getViewerCount();
    totalViewers += viewerCount;
    let content = ` ${platform}: ${status.authenticated ? '[OK]' : '[--]'} ${status.streamStatus} `;
    if (viewersVisible && (viewersMode === 'per-platform' || viewersMode === 'both')) {
      content += `(${viewerCount}) `;
    }
    const t = new TextRenderable(renderer, {
      content,
      fg: status.authenticated ? 'green' : 'red',
    });
    platformTexts.set(platform, t);
    platformRow.add(t);
  }
  statusBox.add(platformRow);

  const totalViewersText = new TextRenderable(renderer, {
    content: `  Total viewers: ${totalViewers}`,
    fg: 'cyan',
  });
  totalViewersText.visible =
    viewersVisible && (viewersMode === 'cumulative' || viewersMode === 'both');
  platformRow.add(totalViewersText);

  const obsText = new TextRenderable(renderer, {
    content: `  OBS: ${obsService.isConnected() ? '[Connected]' : '[Disconnected]'}`,
    fg: obsService.isConnected() ? 'green' : 'gray',
  });
  platformRow.add(obsText);

  const demoText = new TextRenderable(renderer, {
    content: '  [DEMO MODE]',
    fg: 'yellow',
    attributes: TextAttributes.BOLD,
  });
  demoText.visible = isDemoMode();
  platformRow.add(demoText);

  // ── Content row: chat (center, grows) + sidebar (right) ─────────
  const contentRow = new BoxRenderable(renderer, {
    flexDirection: 'row',
    width: '100%',
    marginTop: 1,
  });

  const chatScroll = new ScrollBoxRenderable(renderer, {
    height: 15,
    stickyScroll: true,
    stickyStart: 'bottom',
  });
  for (const msg of messages.slice(-15)) {
    chatScroll.add(new TextRenderable(renderer, { content: msg, fg: 'white' }));
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
    height: Math.max(logsHeight, 15),
    stickyScroll: true,
    stickyStart: 'bottom',
  });
  _fillSidebar(renderer, sidebarScroll, eventsVisible, logsVisible, eventsTail, logsTail);

  const sidebarBox = new BoxRenderable(renderer, {
    borderStyle: 'rounded',
    border: true,
    padding: 1,
    width: sidebarWidth as `${number}%`,
    flexDirection: 'column',
    marginLeft: 1,
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
      placeholder: '> type a command or message…',
      width: '100%',
    });

  const inputBox = new BoxRenderable(renderer, {
    marginTop: 1,
    borderStyle: 'rounded',
    border: true,
    padding: 1,
    width: '100%',
    title: ' Message ',
  });
  inputBox.add(inputEl);

  // Autocomplete hint — hidden until user types a '/'
  // Re-use singleton so it survives initUI rebuilds
  const autocompleteHint =
    uiNodes?.autocompleteHint ?? new TextRenderable(renderer, { content: '', fg: 'gray' });
  autocompleteHint.visible = false;
  inputBox.add(autocompleteHint);

  // ── Assemble ─────────────────────────────────────────────────────
  if (messagesPosition === 'top') {
    mainBox.add(contentRow);
    mainBox.add(statusBox);
  } else {
    mainBox.add(statusBox);
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
    chatScroll,
    sidebarBox,
    sidebarScroll,
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

// ─── updateUI ────────────────────────────────────────────────────────────────
// Mutates existing nodes in-place — never removes/re-adds root, so no flicker.

function updateUI(messages: string[]): void {
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
      let content = ` ${platform}: ${status.authenticated ? '[OK]' : '[--]'} ${status.streamStatus} `;
      if (viewersVisible && (viewersMode === 'per-platform' || viewersMode === 'both')) {
        content += `(${viewerCount}) `;
      }
      node.content = content;
      node.fg = status.authenticated ? 'green' : 'red';
    }
  }

  obsText.content = `  OBS: ${obsService.isConnected() ? '[Connected]' : '[Disconnected]'}`;
  obsText.fg = obsService.isConnected() ? 'green' : 'gray';
  demoText.visible = isDemoMode();
  totalViewersText.content = `  Total viewers: ${totalViewers}`;
  totalViewersText.visible =
    viewersVisible && (viewersMode === 'cumulative' || viewersMode === 'both');

  // Chat: clear and refill
  clearScrollBox(chatScroll);
  for (const msg of messages.slice(-15)) {
    chatScroll.add(new TextRenderable(renderer, { content: msg, fg: 'white' }));
  }

  // Sidebar: clear and refill
  const eventsVisible = boolSetting(settings.get('events.visible', true), true);
  const logsVisible = boolSetting(settings.get('logs.visible', true), true);
  const eventsTail = numSetting(settings.get('events.tail', 15), 15);
  const logsTail = numSetting(settings.get('logs.tail', 20), 20);
  sidebarBox.visible = eventsVisible || logsVisible;
  clearScrollBox(sidebarScroll);
  _fillSidebar(renderer, sidebarScroll, eventsVisible, logsVisible, eventsTail, logsTail);
}

// ─── Command dispatch ────────────────────────────────────────────────────────

async function handleCommand(trimmed: string): Promise<void> {
  if (!trimmed.startsWith('/')) {
    try {
      await chatService.sendMessage(trimmed, []);
      lastMessages.push(`[you] ${trimmed}`);
    } catch (err) {
      lastMessages.push(`[system] Failed to send message: ${String(err)}`);
    }
    return;
  }

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0].toLowerCase();

  if (cmd === '/connect' && parts[1]) {
    const platform = parts[1].toLowerCase();
    const provider =
      platform === 'youtube'
        ? youtube
        : platform === 'twitch'
          ? twitch
          : platform === 'kick'
            ? kick
            : null;
    if (provider) {
      lastMessages.push(`[system] Authenticating ${platform}...`);
      try {
        const res = await provider.authenticate();
        lastMessages.push(
          `[system] ${platform} authentication ${res?.success ? 'succeeded' : 'failed'}`,
        );
      } catch (err) {
        lastMessages.push(`[system] ${platform} authentication error: ${String(err)}`);
      }
    } else {
      lastMessages.push(`[system] Unknown platform: ${platform}`);
    }
  } else if (cmd === '/msg') {
    // /msg all <text>     → sends to all platforms
    // /msg youtube <text> → sends only to youtube
    const target = parts[1]?.toLowerCase();
    const text = parts.slice(2).join(' ');
    const validTargets = ['all', 'youtube', 'twitch', 'kick'];
    if (target && validTargets.includes(target) && text) {
      const targetPlatforms = target === 'all' ? [] : [target];
      try {
        await chatService.sendMessage(text, targetPlatforms);
        lastMessages.push(`[you → ${target}] ${text}`);
      } catch (err) {
        lastMessages.push(`[system] Failed to send message: ${String(err)}`);
      }
    } else {
      lastMessages.push('[system] Usage: /msg <all|youtube|twitch|kick> <text>');
    }
  } else if (cmd === '/marker') {
    // Syntax:  /marker [description] [| timestamp_seconds]
    // Parsing delegated to the shared parseMarkerArgs util (src/utils/webCommands.ts).
    const rawParts = parts.slice(1);
    // TUI adds extra validation: reject a non-numeric pipe segment with a clear error.
    const rawArgs = rawParts.join(' ');
    const pipeIdx = rawArgs.indexOf('|');
    if (pipeIdx !== -1) {
      const tsRaw = rawArgs.slice(pipeIdx + 1).trim();
      if (tsRaw && Number.isNaN(Number.parseFloat(tsRaw))) {
        lastMessages.push(`[marker] Invalid timestamp "${tsRaw}" — must be a non-negative number`);
        updateUI(lastMessages);
        return;
      }
    }
    const { description, timestamp } = parseMarkerArgs(rawParts);

    lastMessages.push(
      `[marker] Creating on all platforms${description ? ` — "${description}"` : ''}${timestamp !== undefined ? ` @ ${timestamp}s` : ''}…`,
    );
    updateUI(lastMessages);

    try {
      const results = await Promise.allSettled([
        youtube.createMarker(description, timestamp),
        twitch.createMarker(description, timestamp),
        kick.createMarker(description, timestamp),
      ]);
      const labels = ['youtube', 'twitch', 'kick'];
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const label = labels[i];
        if (r.status === 'fulfilled') {
          if (r.value) {
            lastMessages.push(
              `[marker] ${label} ✓ pos=${r.value.positionInSeconds}s id=${r.value.id}`,
            );
          } else {
            lastMessages.push(`[marker] ${label} — not live / not supported`);
          }
        } else {
          lastMessages.push(`[marker] ${label} error: ${String(r.reason)}`);
        }
      }
    } catch (err) {
      lastMessages.push(`[marker] Error: ${String(err)}`);
    }
  } else if (cmd === '/settings') {
    const op = parts[1];
    if (op === 'get' && parts[2]) {
      const key = parts[2];
      const val = settings.get(key, null);
      lastMessages.push(`[settings] ${key} = ${JSON.stringify(val)}`);
    } else if (op === 'set' && parts[2] && parts[3]) {
      const key = parts[2];
      const rawValue = parts.slice(3).join(' ');
      const value = parseSettingsValue(rawValue);
      await settings.set(key, value);
      lastMessages.push(`[settings] set ${key} = ${JSON.stringify(value)}`);
      // Structural changes require a full layout rebuild
      const structuralKeys = ['messages.position', 'events.width', 'logs.height'];
      if (structuralKeys.some((k) => key === k) && cliRenderer && uiNodes) {
        uiNodes = initUI(cliRenderer, lastMessages);
        uiNodes.inputEl.focus();
      }
    } else {
      lastMessages.push('[system] Usage: /settings get <key> | /settings set <key> <json-value>');
      lastMessages.push(
        '[system] Keys: title.visible, logs.visible, logs.height, logs.tail, viewers.visible, viewers.mode, messages.position (top|bottom|hide), events.visible, events.tail, events.width',
      );
    }
  } else if (cmd === '/logs') {
    const op = parts[1];
    if (op === 'clear') {
      try {
        logCollector.clear();
        lastMessages.push('[logs] cleared');
      } catch {
        lastMessages.push('[logs] failed to clear');
      }
    } else if (op === 'tail' && parts[2]) {
      const n = parseInt(parts[2], 10) || 0;
      if (n > 0) {
        await settings.set('logs.tail', n);
        lastMessages.push(`[logs] tail set to ${n}`);
      } else {
        lastMessages.push('[logs] Usage: /logs tail <n>');
      }
    } else if (op === 'visible' && parts[2]) {
      const v = String(parts[2]).toLowerCase();
      if (v === 'true' || v === 'false') {
        await settings.set('logs.visible', v === 'true');
        lastMessages.push(`[logs] visible set to ${v}`);
      } else {
        lastMessages.push('[logs] Usage: /logs visible <true|false>');
      }
    } else {
      lastMessages.push('[logs] Usage: /logs clear | /logs tail <n>');
    }
  } else if (cmd === '/exit') {
    isRunning = false;
    await obsService.disconnect();
    killWebServer();
    cliRenderer?.destroy();
    process.exit(0);
  } else if (cmd === '/help') {
    lastMessages.push('[help] Available commands:');
    lastMessages.push('[help]   /connect <youtube|twitch|kick>  — authenticate a platform');
    lastMessages.push('[help]   /msg <all|youtube|twitch|kick> <text>  — send a message');
    lastMessages.push(
      '[help]   /marker [description] [| timestamp_s]  — place a stream marker on all platforms',
    );
    lastMessages.push('[help]       e.g.  /marker Intro | 0');
    lastMessages.push(
      '[help]       e.g.  /marker Q&A | 3723    (timestamp in seconds, YouTube only)',
    );
    lastMessages.push('[help]   /settings get <key>  — get a setting value');
    lastMessages.push('[help]   /settings set <key> <value>  — set a setting value');
    lastMessages.push('[help]   /logs clear | tail <n> | visible <true|false>  — manage logs');
    lastMessages.push('[help]   /exit  — exit the app');
    lastMessages.push('[help]   /help  — show this help');
  } else {
    lastMessages.push(`[system] Unknown command: ${trimmed}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

let isRunning = true;
const lastMessages: string[] = [];
let cliRenderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

// Kill the web server process started by `bun run start` (passed via YASH_WEB_PID)
function killWebServer(): void {
  const pid = process.env.YASH_WEB_PID ? parseInt(process.env.YASH_WEB_PID, 10) : null;
  if (pid) {
    try {
      process.kill(pid);
    } catch {
      // process may have already exited
    }
  }
}

function transformMessage(msg: { platform: string; username: string; message: string }) {
  return `[${msg.platform}] ${msg.username}: ${msg.message}`;
}

async function main() {
  const renderer = await createCliRenderer({
    screenMode:
      (process.env.YASH_SCREEN_MODE as 'main-screen' | 'alternate-screen') ?? 'main-screen',
    consoleMode: 'disabled',
    useKittyKeyboard: null,
    useMouse: false,
    // Intercept Tab at raw sequence level so it triggers autocomplete
    // instead of cycling focus or inserting a literal \t.
    prependInputHandlers: [
      (sequence: string): boolean => {
        if (sequence !== '\t' || !uiNodes) return false;
        const val = uiNodes.inputEl.value;
        const { completion, hints } = getAutocomplete(val);
        if (completion) {
          uiNodes.inputEl.value = completion;
        }
        if (hints.length > 1) {
          uiNodes.autocompleteHint.content = `  ${hints.join('  ')}`;
          uiNodes.autocompleteHint.visible = true;
        } else {
          uiNodes.autocompleteHint.visible = false;
        }
        return true; // consumed — do not pass Tab to InputRenderable
      },
    ],
  });
  cliRenderer = renderer;

  chatService.subscribeToMessages((msg) => {
    lastMessages.push(transformMessage(msg));
    pushEvent(msg.platform, 'chat', `${msg.username} sent a message`);
  });

  await Promise.all([youtube.authenticate(), twitch.authenticate(), kick.authenticate()]);
  defaultLogger.info('Platforms authenticated');
  pushEvent('youtube', 'auth', 'Authenticated');
  pushEvent('twitch', 'auth', 'Authenticated');
  pushEvent('kick', 'auth', 'Authenticated');

  await obsService.connect();
  defaultLogger.info('OBS connected');
  pushEvent('system', 'obs.connect', 'OBS connected');

  // Build UI tree once — no flicker on periodic updates
  uiNodes = initUI(renderer, lastMessages);

  // Focus input and wire ENTER + INPUT handlers once
  uiNodes.inputEl.focus();

  uiNodes.inputEl.on(InputRenderableEvents.INPUT, () => {
    const val = uiNodes!.inputEl.value;
    const hint = uiNodes!.autocompleteHint;

    // Live hint while typing a command
    if (val.startsWith('/') && val.length > 0) {
      const { hints } = getAutocomplete(val);
      if (hints.length > 0) {
        hint.content = `  ${hints.join('  ')}`;
        hint.visible = true;
      } else {
        hint.visible = false;
      }
    } else {
      hint.visible = false;
    }
  });

  uiNodes.inputEl.on(InputRenderableEvents.ENTER, async () => {
    const trimmed = uiNodes!.inputEl.value.trim();
    uiNodes!.inputEl.value = '';
    uiNodes!.autocompleteHint.visible = false;
    if (!trimmed) return;
    await handleCommand(trimmed);
    updateUI(lastMessages);
  });

  // Periodic refresh — in-place mutations only, no flicker
  const updateLoop = setInterval(() => {
    if (!isRunning) return;
    updateUI(lastMessages);
  }, 2000);

  process.on('SIGINT', async () => {
    isRunning = false;
    clearInterval(updateLoop);
    await obsService.disconnect();
    killWebServer();
    renderer.destroy();
    process.exit(0);
  });
}

main().catch((err) => defaultLogger.error('TUI main failed', err));
