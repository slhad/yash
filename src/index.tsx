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

  renderer.root.add(mainBox);
  await renderer.flush();
}

let isRunning = true;
const lastMessages: string[] = [];

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
  await renderUI(renderer, lastMessages);

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
