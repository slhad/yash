import index from '../index.html';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { defaultLogger } from './utils/logger';
import { AuthService } from './services/auth.service';

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
      GET: () => {
        // Return the full metrics snapshot collected in-memory. Consumers (CI or local)
        // can poll this endpoint to retrieve counters, gauges, and timestamps.
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
      GET: () => {
        try {
          const metricsModule = require('./utils/metrics');
          const snapshot =
            metricsModule && metricsModule.metrics && metricsModule.metrics.getAll
              ? metricsModule.metrics.getAll()
              : { counters: {}, gauges: {}, timestamps: {} };

          const lines: string[] = [];

          // Counters
          for (const [name, value] of Object.entries(snapshot.counters || {})) {
            lines.push(`# TYPE ${name} counter`);
            lines.push(`${name} ${value}`);
          }

          // Gauges
          for (const [name, value] of Object.entries(snapshot.gauges || {})) {
            lines.push(`# TYPE ${name} gauge`);
            lines.push(`${name} ${value}`);
          }

          // Timestamps (export as gauge in seconds)
          for (const [name, value] of Object.entries(snapshot.timestamps || {})) {
            lines.push(`# TYPE ${name} gauge`);
            // convert ms -> seconds with fractional part
            const seconds = Number(value) / 1000;
            lines.push(`${name} ${seconds}`);
          }

          const body = lines.join('\n') + '\n';
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
