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

function isTruthyEnv(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

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

  const disableYoutubeStartup = isTruthyEnv(process.env.YASH_DISABLE_YOUTUBE_STARTUP);
  const disableTwitchStartup = isTruthyEnv(process.env.YASH_DISABLE_TWITCH_STARTUP);
  const disableKickStartup = isTruthyEnv(process.env.YASH_DISABLE_KICK_STARTUP);
  const disableAuthAutoRefresh = isTruthyEnv(process.env.YASH_DISABLE_AUTH_AUTO_REFRESH);

  // Seed live stream status by calling setupWebhooks for authenticated platforms.
  // YouTube and Twitch only check their APIs here; Kick already polls from _initFromToken.
  const webhookCfg = { url: '', topics: [] };
  await Promise.allSettled([
    !disableYoutubeStartup && youtube.isAuthenticated()
      ? youtube.setupWebhooks(webhookCfg)
      : Promise.resolve(),
    !disableTwitchStartup && twitch.isAuthenticated()
      ? twitch.setupWebhooks(webhookCfg)
      : Promise.resolve(),
    !disableKickStartup && kick.isAuthenticated()
      ? kick.setupWebhooks(webhookCfg)
      : Promise.resolve(),
  ]);
  if (disableYoutubeStartup) defaultLogger.info('YouTube startup hooks disabled by env');
  if (disableTwitchStartup) defaultLogger.info('Twitch startup hooks disabled by env');
  if (disableKickStartup) defaultLogger.info('Kick startup hooks disabled by env');

  try {
    if (disableAuthAutoRefresh) {
      authService.stopAutoRefresh();
      defaultLogger.info('AuthService auto-refresh disabled by env');
    } else {
      authService.startAutoRefresh({ youtube, twitch, kick }, 60_000);
      defaultLogger.info('AuthService auto-refresh started');
    }
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
