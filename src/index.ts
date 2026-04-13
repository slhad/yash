import index from '../index.html';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { defaultLogger } from './utils/logger';
import { AuthService } from './services/auth.service';
import { authorizeMetrics } from './utils/metricsAuth';

export const youtube = new YouTubeProvider();
export const twitch = new TwitchProvider();
export const kick = new KickProvider();

export const chatService = new ChatService();
export const streamService = new StreamService();
export const obsService = new ObsService('localhost', 4455, null);
export const authService = new AuthService();

chatService.registerProvider('youtube', youtube);
chatService.registerProvider('twitch', twitch);
chatService.registerProvider('kick', kick);

streamService.registerProvider('youtube', youtube);
streamService.registerProvider('twitch', twitch);
streamService.registerProvider('kick', kick);

export const platforms = ['youtube', 'twitch', 'kick'];

async function authenticateAll() {
  await Promise.all([youtube.authenticate(), twitch.authenticate(), kick.authenticate()]);
}

async function connectObs() {
  try {
    await obsService.connect();
    defaultLogger.info('OBS connected');
  } catch {
    defaultLogger.info('OBS not available');
  }
}

export async function initializeServices() {
  await authenticateAll();
  // Start background token auto-refresh after initial authentication
  try {
    authService.startAutoRefresh({ youtube, twitch, kick }, 60_000);
    defaultLogger.info('AuthService auto-refresh started');
  } catch (err) {
    defaultLogger.warn('Failed to start AuthService auto-refresh', err);
  }
  await connectObs();
  defaultLogger.info('All services initialized');
}

initializeServices().catch((err) => defaultLogger.error('Failed to initialize services', err));

Bun.serve({
  routes: {
    '/': index,
    '/api/status': {
      GET: () => {
        const status = platforms.reduce(
          (acc, platform) => {
            const provider = { youtube, twitch, kick }[platform];
            acc[platform] = provider ? provider.getStatus() : null;
            return acc;
          },
          {} as Record<string, any>,
        );
        return new Response(JSON.stringify(status), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/chat/history': {
      GET: () => {
        return new Response(JSON.stringify(chatService.getMessageHistory()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/chat/send': {
      POST: async (req) => {
        const { message, platforms: targetPlatforms } = await req.json();
        await chatService.sendMessage(message, targetPlatforms || []);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/stream/start': {
      POST: async (req) => {
        const { platforms: targetPlatforms, metadata } = await req.json();
        await streamService.startStream(targetPlatforms, metadata || {});
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/stream/stop': {
      POST: async (req) => {
        const { platforms: targetPlatforms } = await req.json();
        await streamService.stopStream(targetPlatforms || []);
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/stream/update': {
      POST: async (req) => {
        const { platforms: targetPlatforms, metadata } = await req.json();
        await streamService.updateStreamMetadata(targetPlatforms || [], metadata || {});
        return new Response(JSON.stringify({ success: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/obs/status': {
      GET: () => {
        return new Response(
          JSON.stringify({
            connected: obsService.isConnected(),
            // expose a few lightweight metrics for CI debugging
            metrics: require('./utils/metrics').metrics.getAll
              ? require('./utils/metrics').metrics.getAll()
              : {},
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    },
    '/api/metrics': {
      // Protect metrics endpoints when YASH_METRICS_TOKEN is set. Accepts:
      // - Authorization: Bearer <token>
      // - x-api-key: <token>
      // - query parameter: ?token=<token>
      GET: (req) => {
        // Delegate authorization to the central helper so both endpoints
        // behave the same when YASH_METRICS_TOKEN is set.
        if (!authorizeMetrics((name: string) => req.headers.get(name), req.url)) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // Return the full metrics snapshot collected in-memory.
        const metricsModule = require('./utils/metrics');
        const snapshot =
          metricsModule && metricsModule.metrics && metricsModule.metrics.getAll
            ? metricsModule.metrics.getAll()
            : {};
        return new Response(JSON.stringify(snapshot), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    // Prometheus text exposition endpoint. This mirrors /api/metrics but
    // returns plain-text in Prometheus exposition format so CI or Prometheus
    // can scrape it directly.
    '/metrics': {
      GET: (req) => {
        // Protect Prometheus exposition the same way as /api/metrics when a
        // metrics token is configured.
        if (!authorizeMetrics((name: string) => req.headers.get(name), req.url)) {
          return new Response(JSON.stringify({ error: 'unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        try {
          const metricsModule = require('./utils/metrics');
          const body =
            metricsModule && metricsModule.toPrometheusText ? metricsModule.toPrometheusText() : '';
          return new Response(body, { headers: { 'Content-Type': 'text/plain; version=0.0.4' } });
        } catch (err) {
          return new Response('', { status: 500 });
        }
      },
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

defaultLogger.info('YASH server running at http://localhost:3000');
