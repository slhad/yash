import * as readline from 'node:readline';
import {
  BoxRenderable,
  createCliRenderer,
  ScrollBoxRenderable,
  TextRenderable,
} from '@opentui/core';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { defaultLogger } from './utils/logger';
import logCollector from './utils/logCollector';
import SettingsStore from './utils/settings';

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
// Global settings instance used by the TUI. SettingsStore starts an async
// initialization in the constructor but is safe to instantiate eagerly.
const settings = new SettingsStore();

async function renderUI(
  renderer: Awaited<ReturnType<typeof createCliRenderer>>,
  messages: string[],
) {
  renderer.clear();

  const mainBox = new BoxRenderable(renderer, {
    border: { style: 'rounded' },
    padding: { top: 1, right: 2, bottom: 1, left: 2 },
    width: '100%',
  });

  const title = new TextRenderable(renderer, {
    content: 'YASH - Yet Another Streamer Helper',
    style: { bold: true, foreground: 'cyan' },
  });
  mainBox.add(title);

  const subtitle = new TextRenderable(renderer, {
    content: 'Unified platform management for YouTube, Twitch, and Kick',
    style: { foreground: 'gray' },
  });
  mainBox.add(subtitle);

  const statusBox = new BoxRenderable(renderer, {
    marginTop: 1,
    border: { style: 'rounded' },
    padding: 1,
  });
  statusBox.add(
    new TextRenderable(renderer, {
      content: 'Platform Status',
      style: { bold: true },
    }),
  );

  for (const platform of platforms) {
    const status =
      platform === 'youtube'
        ? youtube.getStatus()
        : platform === 'twitch'
          ? twitch.getStatus()
          : kick.getStatus();

    statusBox.add(
      new TextRenderable(renderer, {
        content: `  ${platform}: ${status.authenticated ? '[Authenticated]' : '[Not Authenticated]'} ${status.streamStatus}`,
        style: { foreground: status.authenticated ? 'green' : 'red' },
      }),
    );
  }

  statusBox.add(
    new TextRenderable(renderer, {
      content: `  OBS: ${obsService.isConnected() ? '[Connected]' : '[Disconnected]'}`,
      style: { foreground: obsService.isConnected() ? 'green' : 'gray' },
    }),
  );

  mainBox.add(statusBox);

  const chatBox = new BoxRenderable(renderer, {
    marginTop: 1,
    border: { style: 'rounded' },
    padding: 1,
    width: '50%',
  });

  chatBox.add(
    new TextRenderable(renderer, {
      content: 'Chat Messages',
      style: { bold: true },
    }),
  );

  const scrollBox = new ScrollBoxRenderable(renderer, {
    height: 10,
  });

  for (const msg of messages.slice(-10)) {
    scrollBox.add(
      new TextRenderable(renderer, {
        content: msg,
        style: { foreground: 'white' },
      }),
    );
  }

  chatBox.add(scrollBox);
  mainBox.add(chatBox);

  // Logs window (shows recent application logs collected by the logger).
  // Configurable via settings keys: logs.visible, logs.height, logs.width, logs.tail
  const logsVisibleSetting = settings.get('logs.visible', true) ?? true;
  const logsVisible =
    typeof logsVisibleSetting === 'boolean'
      ? logsVisibleSetting
      : String(logsVisibleSetting).toLowerCase() === 'true';

  if (logsVisible) {
    const logsWidth = settings.get('logs.width', '50%') || '50%';
    const logsHeightSetting = settings.get('logs.height', 10) ?? 10;
    const logsHeight =
      typeof logsHeightSetting === 'number'
        ? logsHeightSetting
        : parseInt(String(logsHeightSetting), 10) || 10;
    const logsTailSetting = settings.get('logs.tail', 20) ?? 20;
    const logsTail =
      typeof logsTailSetting === 'number'
        ? logsTailSetting
        : parseInt(String(logsTailSetting), 10) || 20;

    const logsBox = new BoxRenderable(renderer, {
      marginTop: 1,
      border: { style: 'rounded' },
      padding: 1,
      width: logsWidth,
    });

    logsBox.add(
      new TextRenderable(renderer, {
        content: `Logs (tail ${logsTail})`,
        style: { bold: true },
      }),
    );

    const logsScroll = new ScrollBoxRenderable(renderer, { height: logsHeight });
    try {
      const entries = logCollector.tail(logsTail);
      for (const e of entries) {
        const time = new Date(e.ts).toLocaleTimeString();
        const prefix = `[${time}] [${e.level}]`;
        const fg = e.level === 'ERROR' ? 'red' : e.level === 'WARN' ? 'yellow' : 'gray';
        logsScroll.add(
          new TextRenderable(renderer, {
            content: `${prefix} ${e.text}`,
            style: { foreground: fg },
          }),
        );
      }
    } catch (err) {
      // best-effort: don't fail the UI if logs can't be rendered
    }

    logsBox.add(logsScroll);
    mainBox.add(logsBox);
  }

  renderer.root.add(mainBox);
  await renderer.flush();
}

let isRunning = true;
const lastMessages: string[] = [];
let cliRenderer: Awaited<ReturnType<typeof createCliRenderer>> | null = null;

function transformMessage(msg: { platform: string; username: string; message: string }) {
  return `[${msg.platform}] ${msg.username}: ${msg.message}`;
}

async function main() {
  await Promise.all([youtube.authenticate(), twitch.authenticate(), kick.authenticate()]);

  defaultLogger.info('Platforms authenticated');

  await obsService.connect();
  defaultLogger.info('OBS connected');

  chatService.subscribeToMessages((msg) => {
    lastMessages.push(transformMessage(msg));
  });

  const renderer = await createCliRenderer();
  cliRenderer = renderer;
  await renderUI(renderer, lastMessages);

  // Simple stdin command handler for TUI -- supports /connect and /settings
  try {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.on('line', async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      if (trimmed.startsWith('/')) {
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
        } else if (cmd === '/settings') {
          // /settings get <key>
          // /settings set <key> <value>
          const op = parts[1];
          if (op === 'get' && parts[2]) {
            const key = parts[2];
            const val = settings.get(key, null);
            lastMessages.push(`[settings] ${key} = ${JSON.stringify(val)}`);
          } else if (op === 'set' && parts[2] && parts[3]) {
            const key = parts[2];
            const value = parts.slice(3).join(' ');
            try {
              await settings.set(key, JSON.parse(value));
              lastMessages.push(`[settings] set ${key} = ${value}`);
            } catch {
              // if JSON parse fails, store as string
              await settings.set(key, value);
              lastMessages.push(`[settings] set ${key} = "${value}"`);
            }
          } else {
            lastMessages.push(
              '[system] Usage: /settings get <key> | /settings set <key> <json-value>',
            );
          }
        } else if (cmd === '/logs') {
          // /logs clear
          // /logs tail <n>
          const op = parts[1];
          if (op === 'clear') {
            try {
              logCollector.clear();
              lastMessages.push('[logs] cleared');
            } catch (e) {
              lastMessages.push('[logs] failed to clear');
            }
          } else if (op === 'tail' && parts[2]) {
            const n = parseInt(parts[2], 10) || 0;
            if (n > 0) {
              // save default tail in settings so UI respects it
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
        } else {
          lastMessages.push(`[system] Unknown command: ${trimmed}`);
        }
      } else {
        // Regular chat message: broadcast to all providers
        try {
          await chatService.sendMessage(trimmed, []);
          lastMessages.push(`[you] ${trimmed}`);
        } catch (err) {
          lastMessages.push(`[system] Failed to send message: ${String(err)}`);
        }
      }

      // Re-render immediately after processing input
      try {
        if (cliRenderer) await renderUI(cliRenderer, lastMessages);
      } catch {
        // ignore render errors
      }
    });
  } catch (err) {
    // If readline isn't available, TUI will still refresh periodically
  }

  const updateLoop = setInterval(async () => {
    if (!isRunning) return;

    try {
      await renderUI(renderer, lastMessages);
    } catch {
      // ignore
    }
  }, 2000);

  process.on('SIGINT', async () => {
    isRunning = false;
    clearInterval(updateLoop);
    await obsService.disconnect();
    process.exit(0);
  });
}

main().catch((err) => defaultLogger.error('TUI main failed', err));
