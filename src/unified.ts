import { type FfzEmoteDefinition, renderMessageWithFfzEmotes } from './utils/ffz';
import { type ComposerPosition, setupWebChatHeader, startPagePoll } from './utils/webChatHeader';
import { getWebAutocomplete, handleWebCommand } from './utils/webCommands';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing element: ${id}`);
  }
  return el as T;
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

const STORAGE_KEY = 'yash_msgbox_position';
const VISIBLE_POSITION_STORAGE_KEY = 'yash_msgbox_visible_position';
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
const pageController = new AbortController();

const inputHistory: string[] = [];
let historyIdx = -1;
const knownIds = new Set<string>();
const renderedMessages = new Map<string, HTMLDivElement>();
let isAtBottom = true;
let ffzEmotes: Record<string, FfzEmoteDefinition> = {};

const qs = new URLSearchParams(location.search);
const qsPosition = qs.get('position');
const qsPlatform = qs.get('platform');
const storedPosition = localStorage.getItem(STORAGE_KEY);

let currentPosition: ComposerPosition =
  qsPosition && POSITIONS.includes(qsPosition as ComposerPosition)
    ? (qsPosition as ComposerPosition)
    : storedPosition && POSITIONS.includes(storedPosition as ComposerPosition)
      ? (storedPosition as ComposerPosition)
      : 'bottom';
let previousVisiblePosition: Exclude<ComposerPosition, 'hide'> =
  localStorage.getItem(VISIBLE_POSITION_STORAGE_KEY) === 'top' ? 'top' : 'bottom';

function syncUrl(): void {
  const params = new URLSearchParams();
  params.set('position', currentPosition);
  params.set('platform', platformSelect.value);
  history.replaceState(null, '', `?${params.toString()}`);
}

function applyPosition(pos: ComposerPosition): void {
  currentPosition = pos;
  localStorage.setItem(STORAGE_KEY, pos);

  msgboxEl.classList.remove('position-top');

  if (pos === 'hide') {
    msgboxEl.style.display = 'none';
    positionBtn.textContent = 'position: hide ●';
  } else {
    previousVisiblePosition = pos;
    localStorage.setItem(VISIBLE_POSITION_STORAGE_KEY, pos);
    msgboxEl.style.display = 'flex';
    if (pos === 'top') msgboxEl.classList.add('position-top');
    positionBtn.textContent = pos === 'top' ? 'position: top ▲' : 'position: bottom ▼';
  }
  document.querySelector('.header-summary')?.setAttribute('aria-expanded', String(pos !== 'hide'));
  syncUrl();
}

function createPlatformTag(platform: string): HTMLSpanElement {
  const tag = document.createElement('span');
  const knownPlatform = ['youtube', 'twitch', 'kick'].includes(platform);
  tag.className = `platform-tag ${knownPlatform ? `tag-${platform}` : 'tag-unknown'}`;
  tag.textContent = platform;
  return tag;
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
  div.appendChild(createPlatformTag(msg.platform));

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

async function fetchHistory(signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch('/api/chat/history', { signal });
    if (!res.ok) return;
    const msgs = (await res.json()) as ChatMessage[];
    appendMessages(msgs);
  } catch {}
}

function appendSystem(label: string, text: string): void {
  const div = document.createElement('div');
  div.className = 'msg';
  div.appendChild(createPlatformTag(label));
  div.appendChild(createMessageText(text, 'system'));
  messagesEl.appendChild(div);
  if (isAtBottom) messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function loadFfzEmotes(signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch('/api/twitch/ffz-emotes', { signal });
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
setupWebChatHeader({
  getComposerPosition: () => currentPosition,
  toggleComposer: () =>
    applyPosition(currentPosition === 'hide' ? previousVisiblePosition : 'hide'),
  signal: pageController.signal,
});

if (qsPlatform && VALID_PLATFORMS.includes(qsPlatform as (typeof VALID_PLATFORMS)[number])) {
  platformSelect.value = qsPlatform;
}

syncUrl();
platformSelect.addEventListener('change', syncUrl);

startPagePoll(fetchHistory, 2_000, pageController.signal);
startPagePoll(
  loadFfzEmotes,
  () => (Object.keys(ffzEmotes).length === 0 ? FFZ_RETRY_INTERVAL_MS : FFZ_REFRESH_INTERVAL_MS),
  pageController.signal,
);
window.addEventListener('pagehide', () => pageController.abort(), { once: true });
