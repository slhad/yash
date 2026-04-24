// Suppress EventTarget MaxListeners warning from OpenTUI's CliRenderer
process.setMaxListeners(0);

// Silence stderr so logger output doesn't bleed into the TUI.
// Log entries are still captured by logCollector for the sidebar.
process.stderr.write = () => true;

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
import {
  authService,
  chatService,
  initializeServices,
  kick,
  obsService,
  platforms,
  streamService,
  twitch,
  youtube,
} from './services';
import { getConfig, isDemoMode, saveConfig } from './utils/config';
import logCollector from './utils/logCollector';
import { defaultLogger } from './utils/logger';
import SettingsStore from './utils/settings';
import { getAutocomplete } from './utils/tuiCommands';
import { parseMarkerArgs, parseSettingsValue } from './utils/webCommands';
import './index.ts'; // start Bun.serve web server in the same process

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

interface TwitchSetupModal {
  box: BoxRenderable;
  clientIdInput: InputRenderable;
  clientSecretInput: InputRenderable;
  focusIndex: number;
}

interface StreamModal {
  box: BoxRenderable;
  inputs: InputRenderable[];
  focusIndex: number;
  selectedPlatforms: Set<string>;
  op: 'start' | 'stop' | 'update';
}

let activeModal: TwitchSetupModal | null = null;
let activeStreamModal: StreamModal | null = null;

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
  const platformRow = new BoxRenderable(renderer, { flexDirection: 'row' });

  platformRow.add(new TextRenderable(renderer, { content: 'Status  ', fg: 'gray' }));

  const platformTexts = new Map<string, TextRenderable>();
  let totalViewers = 0;
  for (const platform of platforms) {
    const provider = platform === 'youtube' ? youtube : platform === 'twitch' ? twitch : kick;
    const status = provider.getStatus();
    const viewerCount = provider.getViewerCount();
    totalViewers += viewerCount;
    const showViewers = getConfig()?.platforms?.[platform]?.showViewers !== false;
    const isOnline = status.streamStatus === 'ONLINE';
    const viewers = isOnline && showViewers && viewersVisible ? ` (${viewerCount})` : '';
    const t = new TextRenderable(renderer, {
      content: `${platform}: ${status.streamStatus}${viewers}  `,
      fg: status.authenticated ? 'green' : 'red',
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
    content: `OBS: ${obsService.isConnected() ? 'Connected' : 'Disconnected'}  `,
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
    mainBox.add(platformRow);
  } else {
    mainBox.add(platformRow);
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
      const showViewers = getConfig()?.platforms?.[platform]?.showViewers !== false;
      const isOnline = status.streamStatus === 'ONLINE';
      const viewers = isOnline && showViewers && viewersVisible ? ` (${viewerCount})` : '';
      node.content = `${platform}: ${status.streamStatus}${viewers}  `;
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

  const modal: TwitchSetupModal = {
    box,
    clientIdInput,
    clientSecretInput,
    focusIndex: 0,
  };
  activeModal = modal;

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

  const modal: TwitchSetupModal = {
    box,
    clientIdInput,
    clientSecretInput,
    focusIndex: 0,
  };
  activeModal = modal;

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
        lastMessages.push(
          '[system] Kick credentials saved. Run /connect kick to authenticate.',
        );
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

function openStreamModal(preselected: string[]): void {
  if (!uiNodes || activeStreamModal || activeModal) return;
  const { renderer } = uiNodes;

  const selectedPlatforms = new Set(preselected.length > 0 ? preselected : [...platforms]);

  // Pre-fill from persisted config
  const savedStream = getConfig().stream ?? {};

  function makeLabel(text: string): TextRenderable {
    return new TextRenderable(renderer, { content: text, fg: 'gray' });
  }

  // ── Platform toggle row ──────────────────────────────────────────
  // focusIndex === -1 means the platform row itself is focused.
  // 1/2/3 only toggle platforms when focusIndex === -1, so digits typed
  // in text fields (e.g. "Destiny 2") are never consumed.
  function platformToggleContent(focused: boolean): string {
    const indicator = focused ? '> ' : '  ';
    return (
      indicator +
      platforms.map((p) => (selectedPlatforms.has(p) ? `[x] ${p}` : `[ ] ${p}`)).join('   ')
    );
  }

  const platformToggleLabel = makeLabel(' Platforms ([Tab] to focus, Space/Enter to toggle):');
  const platformToggleText = new TextRenderable(renderer, {
    content: platformToggleContent(true),
    fg: 'cyan',
  });

  // ── Metadata inputs ──────────────────────────────────────────────
  const titleLabel = makeLabel(' Title (all platforms):');
  const titleInput = new InputRenderable(renderer, { placeholder: 'Stream title', width: '100%' });
  titleInput.value = savedStream.title ?? '';

  const gameLabel = makeLabel(' Subject / Category / Game (all platforms):');
  const gameInput = new InputRenderable(renderer, {
    placeholder: 'Game or category',
    width: '100%',
  });
  gameInput.value = savedStream.game ?? '';

  // Twitch tags: no spaces, max 25 chars each. Spaces are stripped on submit.
  const tagsLabel = makeLabel(' Tags — comma-separated (no spaces, Twitch max 25 chars each):');
  const tagsInput = new InputRenderable(renderer, {
    placeholder: 'gaming, fps, variety',
    width: '100%',
  });
  tagsInput.value = Array.isArray(savedStream.tags) ? savedStream.tags.join(', ') : (savedStream.tags ?? '');

  const descLabel = makeLabel(' Description (YouTube):');
  const descInput = new InputRenderable(renderer, {
    placeholder: 'Stream description',
    width: '100%',
  });
  descInput.value = savedStream.description ?? '';

  const notifLabel = makeLabel(' Notification (Twitch):');
  const notifInput = new InputRenderable(renderer, {
    placeholder: 'Going live notification message',
    width: '100%',
  });
  notifInput.value = savedStream.notification ?? '';

  const hint = new TextRenderable(renderer, {
    content: ' [Tab] next field   [Enter] confirm   [Esc] cancel',
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
  box.add(titleInput);
  box.add(gameLabel);
  box.add(gameInput);
  box.add(tagsLabel);
  box.add(tagsInput);
  box.add(descLabel);
  box.add(descInput);
  box.add(notifLabel);
  box.add(notifInput);
  box.add(hint);
  renderer.root.add(box);

  const allInputs = [titleInput, gameInput, tagsInput, descInput, notifInput];

  // focusIndex = -1 → platform row focused; >= 0 → modal.inputs[focusIndex] focused
  const modal: StreamModal = {
    box,
    inputs: allInputs,
    focusIndex: -1,
    selectedPlatforms,
    op: 'update',
  };
  activeStreamModal = modal;

  function updateConditionalVisibility(): void {
    platformToggleText.content = platformToggleContent(modal.focusIndex === -1);
    const hasYoutube = selectedPlatforms.has('youtube');
    const hasTwitch = selectedPlatforms.has('twitch');
    descLabel.visible = hasYoutube;
    descInput.visible = hasYoutube;
    notifLabel.visible = hasTwitch;
    notifInput.visible = hasTwitch;

    const visible = [titleInput, gameInput, tagsInput];
    if (hasYoutube) visible.push(descInput);
    if (hasTwitch) visible.push(notifInput);
    modal.inputs = visible;
    if (modal.focusIndex >= modal.inputs.length) modal.focusIndex = 0;
  }

  function togglePlatform(idx: number): void {
    const p = platforms[idx];
    if (!p) return;
    if (selectedPlatforms.has(p)) selectedPlatforms.delete(p);
    else selectedPlatforms.add(p);
    updateConditionalVisibility();
  }

  updateConditionalVisibility();

  async function closeModal(confirm: boolean): Promise<void> {
    if (!activeStreamModal) return;
    renderer.removeInputHandler(modalKeyHandler);
    renderer.root.remove(box.id);
    activeStreamModal = null;
    uiNodes?.inputEl.focus();

    if (!confirm) {
      lastMessages.push('[stream] Cancelled.');
      updateUI(lastMessages);
      return;
    }

    const targetPlatforms = [...selectedPlatforms];
    if (targetPlatforms.length === 0) {
      lastMessages.push('[stream] No platforms selected.');
      updateUI(lastMessages);
      return;
    }

    // Strip spaces from tags — Twitch forbids spaces in tags
    const rawTags = tagsInput.value
      .split(',')
      .map((t) => t.trim().replace(/\s+/g, ''))
      .filter(Boolean);

    const newMeta: Record<string, any> = {
      title: titleInput.value.trim() || undefined,
      game: gameInput.value.trim() || undefined,
      tags: rawTags.length > 0 ? rawTags : undefined,
      description: selectedPlatforms.has('youtube')
        ? descInput.value.trim() || undefined
        : undefined,
      notification: selectedPlatforms.has('twitch')
        ? notifInput.value.trim() || undefined
        : undefined,
    };

    // Only apply fields that actually changed
    const changed: Record<string, any> = {};
    for (const key of Object.keys(newMeta)) {
      if (JSON.stringify(newMeta[key]) !== JSON.stringify(savedStream[key])) {
        changed[key] = newMeta[key];
      }
    }

    if (Object.keys(changed).length === 0) {
      lastMessages.push('[stream] No changes.');
      updateUI(lastMessages);
      return;
    }

    lastMessages.push(`[stream] Updating on: ${targetPlatforms.join(', ')}…`);
    updateUI(lastMessages);
    try {
      const merged = { ...savedStream, ...changed };
      await saveConfig({ stream: merged });
      await streamService.setStreamMetadata(targetPlatforms, merged);
      lastMessages.push('[stream] Updated.');
    } catch (err) {
      lastMessages.push(`[stream] Error: ${String(err)}`);
    }
    updateUI(lastMessages);
  }

  const modalKeyHandler = (sequence: string): boolean => {
    if (!activeStreamModal) return false;

    if (modal.focusIndex === -1) {
      if (sequence === '1') { togglePlatform(0); return true; }
      if (sequence === '2') { togglePlatform(1); return true; }
      if (sequence === '3') { togglePlatform(2); return true; }
    }

    if (sequence === '\t' || sequence === '\x1b[Z') {
      const forward = sequence === '\t';
      if (modal.focusIndex === -1) {
        const nextIdx = forward ? 0 : modal.inputs.length - 1;
        if (modal.inputs.length > 0) {
          modal.focusIndex = nextIdx;
          modal.inputs[nextIdx].focus();
          platformToggleText.content = platformToggleContent(false);
        }
      } else {
        modal.inputs[modal.focusIndex].blur();
        const total = modal.inputs.length + 1; // +1 for platform row
        const next = forward
          ? (modal.focusIndex + 1) % total
          : (modal.focusIndex - 1 + total) % total;
        modal.focusIndex = next === modal.inputs.length ? -1 : next;
        if (modal.focusIndex === -1) {
          platformToggleText.content = platformToggleContent(true);
        } else {
          modal.inputs[modal.focusIndex].focus();
        }
      }
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
    return false;
  };

  renderer.prependInputHandler(modalKeyHandler);

  const escapeViaKeyDown = (key: { name: string }) => {
    if (key.name === 'escape' && activeStreamModal) closeModal(false);
  };
  for (const input of allInputs) {
    input.onKeyDown = escapeViaKeyDown as any;
  }
}

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
        if (res?.success) {
          lastMessages.push(`[system] ${platform} authentication succeeded`);
        } else if (res?.error?.startsWith('oauth_required:')) {
          const authUrl = res.error.slice('oauth_required:'.length);
          const fallbackUrl = `http://localhost:3000/api/${platform}/auth`;
          lastMessages.push(`[system] Opening browser for ${platform} OAuth...`);
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
        } else {
          lastMessages.push(
            `[system] ${platform} authentication failed: ${res?.error ?? 'unknown error'}`,
          );
        }
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
  } else if (cmd === '/stream') {
    // Optional platform filter: /stream [youtube] [twitch] [kick]
    const specified = parts.slice(1).filter((p) => platforms.includes(p));
    openStreamModal(specified);
  } else if (cmd === '/exit') {
    isRunning = false;
    authService.stopAutoRefresh();
    await obsService.disconnect();
    cliRenderer?.destroy();
    process.exit(0);
  } else if (cmd === '/help') {
    lastMessages.push('[help] Available commands:');
    lastMessages.push('[help]   /connect <youtube|twitch|kick>  — authenticate a platform');
    lastMessages.push('[help]   /stream [platform…]  — edit stream info (opens modal, persists to config)');
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
const inputHistory: string[] = [];
let historyIndex = -1;

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
    // Intercept Tab/Up/Down at raw sequence level.
    // Tab → autocomplete; Up/Down → history navigation.
    prependInputHandlers: [
      (sequence: string): boolean => {
        if (!uiNodes) return false;

        if (sequence === '\t') {
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
          return true;
        }

        if (sequence === '\x1b[A') {
          // Up arrow — go back in history
          if (inputHistory.length === 0) return true;
          if (historyIndex === -1) historyIndex = inputHistory.length - 1;
          else if (historyIndex > 0) historyIndex--;
          uiNodes.inputEl.value = inputHistory[historyIndex];
          uiNodes.autocompleteHint.visible = false;
          return true;
        }

        if (sequence === '\x1b[B') {
          // Down arrow — go forward in history
          if (historyIndex === -1) return true;
          historyIndex++;
          if (historyIndex >= inputHistory.length) {
            historyIndex = -1;
            uiNodes.inputEl.value = '';
          } else {
            uiNodes.inputEl.value = inputHistory[historyIndex];
          }
          uiNodes.autocompleteHint.visible = false;
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

  chatService.subscribeToMessages((msg) => {
    lastMessages.push(transformMessage(msg));
    pushEvent(msg.platform, 'chat', `${msg.username} sent a message`);
  });

  await initializeServices();
  pushEvent('youtube', 'auth', 'Authenticated');
  pushEvent('twitch', 'auth', 'Authenticated');
  pushEvent('kick', 'auth', 'Authenticated');
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
    let trimmed = uiNodes!.inputEl.value.trim();
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
    updateUI(lastMessages);
  });

  // Periodic refresh — in-place mutations only, no flicker
  const updateLoop = setInterval(async () => {
    if (!isRunning) return;
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

  process.on('SIGINT', async () => {
    isRunning = false;
    clearInterval(updateLoop);
    authService.stopAutoRefresh();
    await obsService.disconnect();
    renderer.destroy();
    process.exit(0);
  });
}

main().catch((err) => defaultLogger.error('TUI main failed', err));
