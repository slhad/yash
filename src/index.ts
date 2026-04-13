import index from '../index.html';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { defaultLogger } from './utils/logger';
import { AuthService } from './services/auth.service';
import AdminService from './services/admin.service';
import { authorizeAdmin } from './utils/adminAuth';
import { apiMetricsHandler, prometheusMetricsHandler } from './utils/metricsHandlers';

export const youtube = new YouTubeProvider();
export const twitch = new TwitchProvider();
export const kick = new KickProvider();

export const chatService = new ChatService();
export const streamService = new StreamService();
export const obsService = new ObsService('localhost', 4455, null);
export const authService = new AuthService();
export const adminService = new AdminService();

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
      // Delegate to the testable handler which centralizes authorization and
      // response formatting. The handler accepts a header getter and URL string.
      GET: (req) => apiMetricsHandler((name: string) => req.headers.get(name), req.url),
    },
    // Admin-only endpoint to rotate encryption key used by AuthService.
    // Protected by an ADMIN_TOKEN environment variable. This endpoint is
    // intentionally simple: it accepts an optional JSON body { key: "..." }
    // to set a specific key (not recommended). Use POST and include the
    // header Authorization: Bearer <ADMIN_TOKEN>.
    '/api/admin/rotate-key': {
      POST: async (req) => {
        // Centralize admin authorization checks (IP allowlist, rate limiting,
        // and ADMIN_TOKEN when configured).
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        let body = null;
        try {
          body = await req.json();
        } catch (_) {
          // ignore parse errors; allow empty body
        }

        try {
          await authService.rotateEncryptionKey(body?.key);
          // Audit the operation if audit helper is available
          try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const Audit = require('./utils/audit').default;
            const audit = new Audit();
            // Do not record secrets in audit payload; include actor and caller IP
            await audit.append('rotate-key', {
              actor: 'admin-endpoint',
              clientIp: (auth as any).clientIp || 'unknown',
              note: 'rotation invoked',
            });
          } catch (e) {
            // Non-fatal: audit best-effort
            defaultLogger.info('Audit append failed (non-fatal):', e);
          }

          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          defaultLogger.error('Admin rotate-key failed:', err);
          return new Response(JSON.stringify({ error: 'failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },
    '/api/admin/keys': {
      POST: async (req) => {
        // Create new admin key (returns plaintext token once). Use centralized
        // authorization to enforce allowlist/rate-limiting.
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        const body = await req.json().catch(() => ({}));
        const label = body?.label;
        await adminService.init();
        const created = await adminService.createKey(label);

        // Audit creation (do not include the plaintext token)
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Audit = require('./utils/audit').default;
          const audit = new Audit();
          await audit.append('admin-key-created', {
            actor: 'admin-endpoint',
            clientIp: (auth as any).clientIp || 'unknown',
            id: created.id,
            label: label || null,
          });
        } catch (e) {
          defaultLogger.info('Audit append failed (non-fatal):', e);
        }

        return new Response(JSON.stringify(created), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      GET: async (req) => {
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        await adminService.init();
        const list = adminService.listKeys();
        return new Response(JSON.stringify({ keys: list }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/admin/keys/revoke': {
      POST: async (req) => {
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        const body = await req.json().catch(() => ({}));
        const id = body?.id;
        if (!id)
          return new Response(JSON.stringify({ error: 'id required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        await adminService.init();
        const ok = await adminService.revokeKey(id);

        // Audit revocation (best-effort)
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Audit = require('./utils/audit').default;
          const audit = new Audit();
          await audit.append('admin-key-revoked', {
            actor: 'admin-endpoint',
            clientIp: (auth as any).clientIp || 'unknown',
            id,
            success: !!ok,
          });
        } catch (e) {
          defaultLogger.info('Audit append failed (non-fatal):', e);
        }

        return new Response(JSON.stringify({ success: ok }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/admin/export-key': {
      POST: async (req) => {
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        let body = null;
        try {
          body = await req.json();
        } catch (_) {}

        const publicKey = body?.publicKeyPem;
        if (!publicKey)
          return new Response(JSON.stringify({ error: 'publicKeyPem missing' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });

        try {
          // If caller requests tokens export, return hybrid-encrypted tokens package
          if (body?.export === 'tokens') {
            const packageData = await authService.exportEncryptedTokens(publicKey);
            try {
              const Audit = require('./utils/audit').default;
              const audit = new Audit();
              await audit.append('export-tokens', {
                actor: 'admin-endpoint',
                clientIp: (auth as any).clientIp || 'unknown',
                note: 'exported encrypted tokens',
              });
            } catch (e) {
              defaultLogger.info('Audit append failed (non-fatal):', e);
            }
            return new Response(JSON.stringify(packageData), {
              headers: { 'Content-Type': 'application/json' },
            });
          }

          const exported = await authService.exportEncryptionKey(publicKey);
          // Audit export event
          try {
            const Audit = require('./utils/audit').default;
            const audit = new Audit();
            await audit.append('export-key', {
              actor: 'admin-endpoint',
              clientIp: (auth as any).clientIp || 'unknown',
              note: 'exported encryption key (encrypted)',
            });
          } catch (e) {
            defaultLogger.info('Audit append failed (non-fatal):', e);
          }

          return new Response(JSON.stringify({ key: exported }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          defaultLogger.error('Export-key failed:', err);
          return new Response(JSON.stringify({ error: 'failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },
    '/api/admin/audit/tail': {
      GET: async (req) => {
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        // Optional query param ?lines=N
        try {
          const url = new URL(req.url);
          const lines = parseInt(url.searchParams.get('lines') || '100', 10) || 100;
          const Audit = require('./utils/audit').default;
          const audit = new Audit();
          const tail = await audit.tailLines(lines);

          // Audit that an audit tail was viewed (do not include the content)
          try {
            await audit.append('audit-tail-viewed', {
              actor: 'admin-endpoint',
              clientIp: (auth as any).clientIp || 'unknown',
              linesRequested: lines,
            });
          } catch (e) {
            defaultLogger.info('Audit append failed (non-fatal):', e);
          }

          return new Response(JSON.stringify({ lines: tail }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: 'failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    '/api/admin/audit/verify': {
      GET: async (req) => {
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        try {
          const Audit = require('./utils/audit').default;
          const audit = new Audit();
          const result = await audit.verifyAll();

          // Record that a verification was run (do not include sensitive content)
          try {
            await audit.append('audit-verify-run', {
              actor: 'admin-endpoint',
              clientIp: (auth as any).clientIp || 'unknown',
              ok: !!result.ok,
              badIndex: result.badIndex || null,
            });
          } catch (e) {
            defaultLogger.info('Audit append failed (non-fatal):', e);
          }

          return new Response(JSON.stringify({ result }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (e) {
          defaultLogger.error('Audit verify failed:', e);
          return new Response(JSON.stringify({ error: 'failed' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },
    // Prometheus text exposition endpoint. This mirrors /api/metrics but
    // returns plain-text in Prometheus exposition format so CI or Prometheus
    // can scrape it directly.
    '/metrics': {
      // Use the centralized prometheus handler which applies the same auth rules
      // and formatting as the JSON handler.
      GET: (req) => prometheusMetricsHandler((name: string) => req.headers.get(name), req.url),
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

defaultLogger.info('YASH server running at http://localhost:3000');
