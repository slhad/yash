import { type FfzEmoteDefinition, renderMessageWithFfzEmotes } from './utils/ffz';
import { getWebAutocomplete, handleWebCommand } from './utils/webCommands';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el as T;
}

function formatElapsed(isoStart: string): string {
  const secs = Math.floor((Date.now() - new Date(isoStart).getTime()) / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return h > 0 ? `${h}h${m}m${s}s` : `${m}m${s}s`;
}

type ChatMessage = {
  id: string;
  platform: string;
  userId: string;
  username: string;
  message: string;
  badges?: Record<string, string>;
  profileImageUrl?: string | null;
};

type StatusInfo = {
  streamStatus?: string;
  viewerCount?: number;
  streamStartTime?: string | null;
};

const STORAGE_KEY = 'yash_msgbox_position';
const POSITIONS = ['bottom', 'top', 'hide'] as const;
const VALID_PLATFORMS = ['all', 'youtube', 'twitch', 'kick'] as const;
const FFZ_RETRY_INTERVAL_MS = 5_000;
const FFZ_REFRESH_INTERVAL_MS = 5 * 60_000;

const messagesEl = byId<HTMLDivElement>('messages');
const msgboxEl = byId<HTMLDivElement>('msgbox');
const positionBtn = byId<HTMLButtonElement>('position-btn');
const platformSelect = byId<HTMLSelectElement>('platform-select');
const messageInput = byId<HTMLTextAreaElement>('message-input');
const sendBtn = byId<HTMLButtonElement>('send-btn');
const autocompleteHint = byId<HTMLDivElement>('autocomplete-hint');
const statusPlatformsEl = byId<HTMLSpanElement>('status-platforms');

const inputHistory: string[] = [];
let historyIdx = -1;
const knownIds = new Set<string>();
const renderedMessages = new Map<string, HTMLDivElement>();
let isAtBottom = true;
let ffzEmotes: Record<string, FfzEmoteDefinition> = {};

const qs = new URLSearchParams(location.search);
const qsPosition = qs.get('position');
const qsPlatform = qs.get('platform');

let currentPosition: (typeof POSITIONS)[number] =
  qsPosition && POSITIONS.includes(qsPosition as (typeof POSITIONS)[number])
    ? (qsPosition as (typeof POSITIONS)[number])
    : ((localStorage.getItem(STORAGE_KEY) || 'bottom') as (typeof POSITIONS)[number]);

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set('position', currentPosition);
  params.set('platform', platformSelect.value);
  history.replaceState(null, '', `?${params.toString()}`);
}

function applyPosition(pos: (typeof POSITIONS)[number]): void {
  currentPosition = pos;
  localStorage.setItem(STORAGE_KEY, pos);

  msgboxEl.classList.remove('position-top');

  if (pos === 'hide') {
    msgboxEl.style.display = 'none';
    positionBtn.textContent = 'position: hide ●';
  } else if (pos === 'top') {
    msgboxEl.style.display = 'flex';
    msgboxEl.classList.add('position-top');
    positionBtn.textContent = 'position: top ▲';
  } else {
    msgboxEl.style.display = 'flex';
    positionBtn.textContent = 'position: bottom ▼';
  }
  syncUrl();
}

function platformTag(platform: string): string {
  const cls = ['youtube', 'twitch', 'kick'].includes(platform) ? `tag-${platform}` : 'tag-unknown';
  return `<span class="platform-tag ${cls}">${platform}</span>`;
}

function createMessageText(message: string, platform: string): HTMLSpanElement {
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

function createBadgeList(badges: Record<string, string> | undefined): HTMLSpanElement | null {
  if (!badges || Object.keys(badges).length === 0) return null;
  const wrap = document.createElement('span');
  wrap.className = 'badge-list';
  for (const [name, value] of Object.entries(badges)) {
    const badge = document.createElement('span');
    badge.className = 'chat-badge';
    badge.textContent = value && value !== '1' ? `${name}:${value}` : name;
    badge.title = value ? `${name} (${value})` : name;
    wrap.appendChild(badge);
  }
  return wrap;
}

function syncRenderedMessage(div: HTMLDivElement, msg: ChatMessage): void {
  const existingAvatar = div.querySelector<HTMLImageElement>('.chat-avatar');
  if (msg.profileImageUrl) {
    if (existingAvatar) {
      if (existingAvatar.src !== msg.profileImageUrl) existingAvatar.src = msg.profileImageUrl;
      existingAvatar.alt = `${msg.username} avatar`;
    } else {
      const avatar = document.createElement('img');
      avatar.className = 'chat-avatar';
      avatar.src = msg.profileImageUrl;
      avatar.alt = `${msg.username} avatar`;
      avatar.loading = 'lazy';
      avatar.decoding = 'async';
      const platformTagEl = div.querySelector('.platform-tag');
      if (platformTagEl) {
        platformTagEl.insertAdjacentElement('afterend', avatar);
      } else {
        div.prepend(avatar);
      }
    }
  }

  const existingBadges = div.querySelector('.badge-list');
  const badges = createBadgeList(msg.badges);
  if (badges) {
    if (existingBadges) {
      existingBadges.replaceWith(badges);
    } else {
      const username = div.querySelector('.username');
      if (username) {
        username.insertAdjacentElement('beforebegin', badges);
      } else {
        div.appendChild(badges);
      }
    }
  }
}

function rerenderTwitchMessages(): void {
  for (const text of messagesEl.querySelectorAll<HTMLSpanElement>(
    '.msg[data-platform="twitch"] .text',
  )) {
    const message = text.dataset.message ?? text.textContent ?? '';
    renderMessageWithFfzEmotes(text, message, ffzEmotes);
  }
}

function renderMessage(msg: ChatMessage): HTMLDivElement {
  const div = document.createElement('div');
  div.className = 'msg';
  div.dataset.platform = msg.platform;
  div.innerHTML = platformTag(msg.platform);

  if (msg.profileImageUrl) {
    const avatar = document.createElement('img');
    avatar.className = 'chat-avatar';
    avatar.src = msg.profileImageUrl;
    avatar.alt = `${msg.username} avatar`;
    avatar.loading = 'lazy';
    avatar.decoding = 'async';
    div.appendChild(avatar);
  }

  const username = document.createElement('span');
  username.className = 'username';
  username.textContent = `${msg.username}:`;
  const badges = createBadgeList(msg.badges);
  if (badges) {
    div.appendChild(badges);
  }
  div.appendChild(username);
  div.appendChild(createMessageText(msg.message, msg.platform));
  return div;
}

function appendMessages(msgs: ChatMessage[]): void {
  let added = false;
  for (const msg of msgs) {
    if (knownIds.has(msg.id)) {
      const existing = renderedMessages.get(msg.id);
      if (existing) syncRenderedMessage(existing, msg);
      continue;
    }
    knownIds.add(msg.id);
    const rendered = renderMessage(msg);
    renderedMessages.set(msg.id, rendered);
    messagesEl.appendChild(rendered);
    added = true;
  }
  if (added && isAtBottom) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
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

async function fetchStatus(): Promise<void> {
  try {
    const res = await fetch('/api/status');
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, StatusInfo>;
    const parts: string[] = [];
    for (const [name, info] of Object.entries(data)) {
      if (!info || typeof info !== 'object') continue;
      const { streamStatus, viewerCount, streamStartTime } = info;
      const label = name.charAt(0).toUpperCase() + name.slice(1);
      if (streamStatus === 'ONLINE') {
        let detail = '';
        if (streamStartTime) detail += formatElapsed(streamStartTime);
        if (viewerCount != null) detail += `${detail ? ' / ' : ''}${viewerCount} viewers`;
        parts.push(`<span class="online">${label}: ONLINE${detail ? ` (${detail})` : ''}</span>`);
      } else {
        parts.push(`<span class="offline">${label}: offline</span>`);
      }
    }
    statusPlatformsEl.innerHTML =
      parts.join('<span class="yash-status-separator"> | </span>') || 'no platforms';
  } catch {}
}

function appendSystem(label: string, text: string): void {
  const div = document.createElement('div');
  div.className = 'msg';
  div.innerHTML = `<span class="platform-tag tag-unknown"></span>`;
  const tag = div.querySelector<HTMLSpanElement>('.platform-tag');
  if (tag) {
    tag.textContent = label;
  }
  div.appendChild(createMessageText(text, 'system'));
  messagesEl.appendChild(div);
  if (isAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
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

  const handled = await handleWebCommand(text, { platforms, feedback: appendSystem });
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
      await fetchHistory();
    }
  } catch {}

  sendBtn.disabled = false;
  messageInput.focus();
}

positionBtn.addEventListener('click', () => {
  const idx = POSITIONS.indexOf(currentPosition);
  applyPosition(POSITIONS[(idx + 1) % POSITIONS.length] ?? 'bottom');
});

messagesEl.addEventListener('scroll', () => {
  isAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 32;
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

messageInput.addEventListener('input', () => {
  historyIdx = -1;
  messageInput.style.height = 'auto';
  messageInput.style.height = `${Math.min(messageInput.scrollHeight, 80)}px`;
  const hint = getWebAutocomplete(messageInput.value);
  autocompleteHint.textContent = hint ?? '';
});

applyPosition(currentPosition);

if (qsPlatform && VALID_PLATFORMS.includes(qsPlatform as (typeof VALID_PLATFORMS)[number])) {
  platformSelect.value = qsPlatform;
}

syncUrl();
platformSelect.addEventListener('change', syncUrl);

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

void fetchStatus();
setInterval(() => {
  void fetchStatus();
}, 3000);
