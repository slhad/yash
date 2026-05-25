import { type FfzEmoteDefinition, renderMessageWithFfzEmotes } from './utils/ffz';
import { getWebAutocomplete, handleWebCommand } from './utils/webCommands';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el as T;
}

type Platform = 'youtube' | 'twitch' | 'kick';
type ChatMessage = {
  id: string;
  platform: Platform;
  username: string;
  message: string;
};

const PLATFORMS: Platform[] = ['youtube', 'twitch', 'kick'];
const STORAGE_KEYS: Record<Platform, string> = {
  youtube: 'yash_sbs_youtube',
  twitch: 'yash_sbs_twitch',
  kick: 'yash_sbs_kick',
};
const STORAGE_KEY_POS = 'yash_sbs_msgbox_position';
const POSITIONS = ['bottom', 'top', 'hide'] as const;
const FFZ_RETRY_INTERVAL_MS = 5_000;
const FFZ_REFRESH_INTERVAL_MS = 5 * 60_000;

const qs = new URLSearchParams(location.search);
const qsPosition = qs.get('position');
const qsPlatformsParam = qs.get('platforms');

const enabled = {} as Record<Platform, boolean>;
const knownIds: Record<Platform, Set<string>> = {
  youtube: new Set<string>(),
  twitch: new Set<string>(),
  kick: new Set<string>(),
};
const atBottom: Record<Platform, boolean> = {
  youtube: true,
  twitch: true,
  kick: true,
};

const msgboxEl = byId<HTMLDivElement>('msgbox');
const positionBtn = byId<HTMLButtonElement>('position-btn');
const platformSelect = byId<HTMLSelectElement>('platform-select');
const messageInput = byId<HTMLTextAreaElement>('message-input');
const sendBtn = byId<HTMLButtonElement>('send-btn');
const systemFeedEl = byId<HTMLDivElement>('system-feed');
const autocompleteHint = byId<HTMLDivElement>('autocomplete-hint');

const inputHistory: string[] = [];
let historyIdx = -1;
let currentPosition = (
  qsPosition && POSITIONS.includes(qsPosition as (typeof POSITIONS)[number])
    ? qsPosition
    : localStorage.getItem(STORAGE_KEY_POS) || 'bottom'
) as (typeof POSITIONS)[number] | string;
let ffzEmotes: Record<string, FfzEmoteDefinition> = {};

function createMessageText(message: string, platform: Platform): HTMLSpanElement {
  const text = document.createElement('span');
  text.className = 'text';
  text.dataset.message = message;
  if (platform === 'twitch') {
    renderMessageWithFfzEmotes(text, message, ffzEmotes);
  } else {
    text.textContent = message;
  }
  return text;
}

function rerenderTwitchMessages(): void {
  for (const text of document.querySelectorAll<HTMLSpanElement>('#msgs-twitch .text')) {
    const message = text.dataset.message ?? text.textContent ?? '';
    renderMessageWithFfzEmotes(text, message, ffzEmotes);
  }
}

function loadEnabled(platform: Platform): boolean {
  if (qsPlatformsParam !== null) {
    return qsPlatformsParam.split(',').includes(platform);
  }
  const stored = localStorage.getItem(STORAGE_KEYS[platform]);
  return stored === null ? true : stored === 'true';
}

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set('position', currentPosition);
  params.set('platforms', PLATFORMS.filter((p) => enabled[p]).join(','));
  history.replaceState(null, '', `?${params.toString()}`);
}

function applyToggle(platform: Platform): void {
  const col = byId<HTMLDivElement>(`col-${platform}`);
  const btn = byId<HTMLButtonElement>(`toggle-${platform}`);
  const label = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick' }[platform];
  if (enabled[platform]) {
    col.classList.remove('hidden');
    btn.textContent = `${label} ✓`;
    btn.className = `toggle-btn active-${platform}`;
  } else {
    col.classList.add('hidden');
    btn.textContent = `${label} ✗`;
    btn.className = 'toggle-btn';
  }
}

function appendMessages(msgs: ChatMessage[]): void {
  for (const platform of PLATFORMS) {
    const el = byId<HTMLDivElement>(`msgs-${platform}`);
    let added = false;
    for (const msg of msgs) {
      if (msg.platform !== platform) continue;
      if (knownIds[platform].has(msg.id)) continue;
      knownIds[platform].add(msg.id);
      const div = document.createElement('div');
      div.className = 'msg';
      div.dataset.platform = msg.platform;
      const username = document.createElement('span');
      username.className = 'username';
      username.textContent = `${msg.username}:`;
      div.appendChild(username);
      div.appendChild(createMessageText(msg.message, msg.platform));
      el.appendChild(div);
      added = true;
    }
    if (added && atBottom[platform]) {
      el.scrollTop = el.scrollHeight;
    }
  }
}

async function fetchHistory(): Promise<void> {
  try {
    const res = await fetch('/api/chat/history');
    if (!res.ok) return;
    const msgs = (await res.json()) as ChatMessage[];
    appendMessages(msgs);
  } catch {}
}

function applyPosition(pos: (typeof POSITIONS)[number]): void {
  currentPosition = pos;
  localStorage.setItem(STORAGE_KEY_POS, pos);
  msgboxEl.classList.remove('position-top');
  if (pos === 'hide') {
    msgboxEl.style.display = 'none';
    positionBtn.textContent = 'msgbox: hide ●';
  } else if (pos === 'top') {
    msgboxEl.style.display = 'flex';
    msgboxEl.classList.add('position-top');
    positionBtn.textContent = 'msgbox: top ▲';
  } else {
    msgboxEl.style.display = 'flex';
    positionBtn.textContent = 'msgbox: bottom ▼';
  }
  syncUrl();
}

function appendSys(label: string, text: string): void {
  systemFeedEl.classList.add('visible');
  const line = document.createElement('div');
  line.className = 'sys-line';
  line.textContent = `[${label}] ${text}`;
  systemFeedEl.appendChild(line);
  systemFeedEl.scrollTop = systemFeedEl.scrollHeight;
}

async function loadFfzEmotes(): Promise<void> {
  try {
    const res = await fetch('/api/twitch/ffz-emotes');
    if (!res.ok) return;
    const data = (await res.json()) as { emotes?: Record<string, FfzEmoteDefinition> };
    ffzEmotes = data.emotes ?? {};
    rerenderTwitchMessages();
  } catch {}
}

async function sendMessage(): Promise<void> {
  const text = messageInput.value.trim();
  if (!text) return;

  const platform = platformSelect.value;
  const platforms = platform === 'all' ? [] : [platform];

  inputHistory.push(text);
  historyIdx = -1;
  sendBtn.disabled = true;

  const handled = await handleWebCommand(text, { platforms, feedback: appendSys });
  if (handled) {
    messageInput.value = '';
    messageInput.style.height = 'auto';
    autocompleteHint.textContent = '';
    sendBtn.disabled = false;
    messageInput.focus();
    return;
  }

  try {
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, platforms }),
    });
    if (res.ok) {
      messageInput.value = '';
      messageInput.style.height = 'auto';
      autocompleteHint.textContent = '';
    }
  } catch {}

  sendBtn.disabled = false;
  messageInput.focus();
}

for (const platform of PLATFORMS) {
  enabled[platform] = loadEnabled(platform);
  applyToggle(platform);

  byId<HTMLButtonElement>(`toggle-${platform}`).addEventListener('click', () => {
    enabled[platform] = !enabled[platform];
    localStorage.setItem(STORAGE_KEYS[platform], String(enabled[platform]));
    applyToggle(platform);
    syncUrl();
  });

  byId<HTMLDivElement>(`msgs-${platform}`).addEventListener('scroll', () => {
    const el = byId<HTMLDivElement>(`msgs-${platform}`);
    atBottom[platform] = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  });
}

positionBtn.addEventListener('click', () => {
  const idx = POSITIONS.indexOf(currentPosition as (typeof POSITIONS)[number]);
  applyPosition(POSITIONS[(idx + 1) % POSITIONS.length] ?? 'bottom');
});

messageInput.addEventListener('input', () => {
  historyIdx = -1;
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 80)}px`;
  const hint = getWebAutocomplete(messageInput.value);
  autocompleteHint.textContent = hint ?? '';
});

sendBtn.addEventListener('click', () => {
  void sendMessage();
});

messageInput.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (inputHistory.length === 0) return;
    if (historyIdx === -1) historyIdx = inputHistory.length - 1;
    else if (historyIdx > 0) historyIdx--;
    messageInput.value = inputHistory[historyIdx] ?? '';
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 80)}px`;
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (historyIdx === -1) return;
    historyIdx++;
    if (historyIdx >= inputHistory.length) {
      historyIdx = -1;
      messageInput.value = '';
    } else {
      messageInput.value = inputHistory[historyIdx] ?? '';
    }
    messageInput.style.height = 'auto';
    messageInput.style.height = `${Math.min(messageInput.scrollHeight, 80)}px`;
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void sendMessage();
  }
});

applyPosition(
  POSITIONS.includes(currentPosition as (typeof POSITIONS)[number])
    ? (currentPosition as (typeof POSITIONS)[number])
    : 'bottom',
);

void fetchHistory();
void loadFfzEmotes();
setInterval(() => {
  void fetchHistory();
}, 2000);
setInterval(() => {
  if (Object.keys(ffzEmotes).length > 0) return;
  void loadFfzEmotes();
}, FFZ_RETRY_INTERVAL_MS);
setInterval(() => {
  void loadFfzEmotes();
}, FFZ_REFRESH_INTERVAL_MS);
