import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { AuthService } from './services/auth.service';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { defaultLogger } from './utils/logger';
import { settingsStore } from './utils/settings';

export { settingsStore } from './utils/settings';

export const youtube = new YouTubeProvider();
export const twitch = new TwitchProvider();
export const kick = new KickProvider();

export const chatService = new ChatService();
export const streamService = new StreamService();
export const obsService = new ObsService(
  process.env.YASH_OBS_SERVER,
  process.env.YASH_OBS_PORT ? parseInt(process.env.YASH_OBS_PORT, 10) : undefined,
  process.env.YASH_OBS_PASSWORD,
  true, // real WebSocket transport (OBS WebSocket v5)
);
export const authService = new AuthService();

export const platforms = ['youtube', 'twitch', 'kick'];

const configuredHistorySize = Number(settingsStore.get('chat.maxHistorySize', 1000));
if (Number.isFinite(configuredHistorySize) && configuredHistorySize > 0) {
  chatService.setMaxHistorySize(configuredHistorySize);
}

chatService.registerProvider('youtube', youtube);
chatService.registerProvider('twitch', twitch);
chatService.registerProvider('kick', kick);

streamService.registerProvider('youtube', youtube);
streamService.registerProvider('twitch', twitch);
streamService.registerProvider('kick', kick);

export async function initializeServices() {
  await Promise.all([youtube.authenticate(), twitch.authenticate(), kick.authenticate()]);

  // Seed live stream status by calling setupWebhooks for authenticated platforms.
  // YouTube and Twitch only check their APIs here; Kick already polls from _initFromToken.
  const webhookCfg = { url: '', topics: [] };
  await Promise.allSettled([
    youtube.isAuthenticated() ? youtube.setupWebhooks(webhookCfg) : Promise.resolve(),
    twitch.isAuthenticated() ? twitch.setupWebhooks(webhookCfg) : Promise.resolve(),
    kick.isAuthenticated() ? kick.setupWebhooks(webhookCfg) : Promise.resolve(),
  ]);

  try {
    authService.startAutoRefresh({ youtube, twitch, kick }, 60_000);
    defaultLogger.info('AuthService auto-refresh started');
  } catch (err) {
    defaultLogger.warn('Failed to start AuthService auto-refresh', err);
  }
  try {
    await obsService.connect();
    defaultLogger.info('OBS connected');
  } catch {
    defaultLogger.info('OBS not available');
  }
  defaultLogger.info('All services initialized');
}
