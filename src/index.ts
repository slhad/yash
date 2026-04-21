import index from '../index.html';
import sidebyside from '../sidebyside.html';
import unified from '../unified.html';
import { KickProvider } from './platforms/kick';
import { TwitchProvider } from './platforms/twitch';
import { YouTubeProvider } from './platforms/youtube';
import AdminService from './services/admin.service';
import { AuthService } from './services/auth.service';
import { ChatService } from './services/chat.service';
import { ObsService } from './services/obs.service';
import { StreamService } from './services/stream.service';
import { authorizeAdmin } from './utils/adminAuth';
import { isDemoMode } from './utils/config';
import { defaultLogger } from './utils/logger';
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
    '/unified': unified,
    '/sidebyside': sidebyside,
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
    // ------------------------------------------------------------------
    // Twitch OAuth — GET /api/twitch/auth  →  redirect to Twitch
    // ------------------------------------------------------------------
    '/api/twitch/auth': {
      GET: () => {
        const url = twitch.getAuthUrl();
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        });
      },
    },

    // ------------------------------------------------------------------
    // Twitch OAuth — GET /api/twitch/callback?code=...
    // Twitch redirects here after the user approves the app.
    // ------------------------------------------------------------------
    '/api/twitch/callback': {
      GET: async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`<html><body><h2>Twitch auth error: ${error}</h2></body></html>`, {
            status: 400,
            headers: { 'Content-Type': 'text/html' },
          });
        }

        if (!code) {
          return new Response(JSON.stringify({ error: 'missing code parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const result = await twitch.handleOAuthCallback(code);
        if (result.success) {
          return new Response(
            `<html><body><h2>✅ Twitch connected successfully!</h2><p>You can close this tab.</p></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }

        return new Response(
          `<html><body><h2>❌ Twitch auth failed</h2><pre>${result.error}</pre></body></html>`,
          { status: 400, headers: { 'Content-Type': 'text/html' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // Twitch stream marker — POST /api/twitch/marker
    // Body: { description?: string }   (max 140 chars; timestamp ignored)
    // Returns the created StreamMarker or { marker: null } if not live.
    // ------------------------------------------------------------------
    '/api/twitch/marker': {
      POST: async (req) => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const body = await req.json().catch(() => ({}));
        const description: string | undefined = body?.description;
        try {
          const marker = await twitch.createMarker(description);
          return new Response(JSON.stringify({ marker }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    // ------------------------------------------------------------------
    // YouTube chapter markers — GET /api/youtube/markers
    // Returns in-memory chapter list + the formatted description block.
    // ------------------------------------------------------------------
    '/api/youtube/markers': {
      GET: () => {
        const markers = (youtube as any).chapterMarkers ?? [];
        const block = typeof (youtube as any).getChapterDescriptionBlock === 'function'
          ? (youtube as any).getChapterDescriptionBlock()
          : '';
        return new Response(JSON.stringify({ markers, descriptionBlock: block }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Cross-platform marker — POST /api/stream/marker
    // Body: { platforms?: string[], description?: string, timestamp?: number }
    //   timestamp — seconds from stream start (used by YouTube for chapters;
    //               ignored by Twitch which sets position server-side)
    // Fires createMarker() on each requested platform concurrently.
    // ------------------------------------------------------------------
    '/api/stream/marker': {
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        const targetPlatforms: string[] = body?.platforms ?? ['youtube', 'twitch', 'kick'];
        const description: string | undefined = body?.description;
        const timestamp: number | undefined =
          typeof body?.timestamp === 'number' ? body.timestamp : undefined;

        const providerMap: Record<string, typeof twitch> = { youtube, twitch, kick };
        const results = await Promise.allSettled(
          targetPlatforms.map(async (p) => {
            const provider = providerMap[p];
            if (!provider) return { platform: p, marker: null, error: 'unknown platform' };
            if (!provider.isAuthenticated()) return { platform: p, marker: null, error: 'not authenticated' };
            const marker = await provider.createMarker(description, timestamp);
            return { platform: p, marker };
          }),
        );

        const payload = results.map((r, i) => {
          if (r.status === 'fulfilled') return r.value;
          return { platform: targetPlatforms[i], marker: null, error: String(r.reason) };
        });

        return new Response(JSON.stringify({ markers: payload }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Twitch stream markers — GET /api/twitch/markers
    // Query params: ?videoId=<id>&limit=<n>
    // Requires user:read:broadcast scope on the token.
    // ------------------------------------------------------------------
    '/api/twitch/markers': {
      GET: async (req) => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const url = new URL(req.url);
        const videoId = url.searchParams.get('videoId') ?? undefined;
        const limitRaw = url.searchParams.get('limit');
        const limit = limitRaw ? Math.min(Math.max(1, Number.parseInt(limitRaw, 10)), 100) : 20;
        try {
          const markers = await twitch.getMarkers({ videoId, limit });
          return new Response(JSON.stringify({ markers }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    // ------------------------------------------------------------------
    // Twitch channel info — GET /api/twitch/channel
    // Returns current title, game, tags from Helix
    // ------------------------------------------------------------------
    '/api/twitch/channel': {
      GET: async () => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Access internal apiClient via cast (provider exposes it for read ops)
        const provider = twitch as any;
        if (!provider.apiClient || !provider.userId) {
          return new Response(JSON.stringify({ error: 'api client not ready' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const channel = await provider.apiClient.channels.getChannelInfoById(provider.userId);
          return new Response(
            JSON.stringify({
              title: channel?.title,
              game: channel?.gameName,
              gameId: channel?.gameId,
              tags: channel?.tags ?? [],
              language: channel?.language,
              delay: channel?.delay,
            }),
            { headers: { 'Content-Type': 'application/json' } },
          );
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
      // PATCH /api/twitch/channel  { title?, game?, tags? }
      PATCH: async (req) => {
        if (!twitch.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const body = await req.json();
          await twitch.updateStreamMetadata(body);
          return new Response(JSON.stringify({ success: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        } catch (err) {
          return new Response(JSON.stringify({ error: String(err) }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      },
    },

    '/api/obs/status': {
      GET: () => {
        return new Response(
          JSON.stringify({
            connected: obsService.isConnected(),
            demo: isDemoMode(),
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
    // Admin rotate-key endpoint removed: rotation and encryption key operations
    // were intentionally removed from the codebase. Return a clear 501 response
    // so callers receive an explicit message instead of a runtime error.
    '/api/admin/rotate-key': {
      POST: async (_req) => {
        return new Response(
          JSON.stringify({
            error: 'rotation-removed',
            message: 'encryption key rotation feature has been removed',
          }),
          {
            status: 501,
            headers: { 'Content-Type': 'application/json' },
          },
        );
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
        const roles = Array.isArray(body?.roles) ? body.roles : undefined;

        // Require 'admin' role to create keys, unless ADMIN_TOKEN was used.
        try {
          const { hasAdminRole } = require('./utils/adminAuth');
          const allowed = await hasAdminRole(auth, 'admin');
          if (!allowed) {
            return new Response(JSON.stringify({ error: 'forbidden' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (e) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await adminService.init();
        const created = await adminService.createKey(label, roles);

        // Audit creation (do not include the plaintext token)
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Audit = require('./utils/audit').default;
          const audit = new Audit();
          await audit.append('admin-key-created', {
            actor: 'admin-endpoint',
            clientIp: (auth as any).clientIp || 'unknown',
            adminKeyId: (auth as any).adminKeyId || null,
            method: (auth as any).method || null,
            id: created.id,
            label: label || null,
            roles: roles || null,
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
        // Enforce RBAC: only keys with 'admin' role (or ADMIN_TOKEN) may revoke keys.
        try {
          // Import here to avoid circular issues
          const { hasAdminRole } = require('./utils/adminAuth');
          const okRole = await hasAdminRole(auth, 'admin');
          if (!okRole) {
            return new Response(JSON.stringify({ error: 'forbidden' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
          }
        } catch (e) {
          // If role check fails unexpectedly, deny for safety
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
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
            adminKeyId: (auth as any).adminKeyId || null,
            method: (auth as any).method || null,
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
    '/api/admin/keys/export': {
      POST: async (req) => {
        const auth = await authorizeAdmin(req);
        if (!auth.ok)
          return new Response(JSON.stringify(auth.body), {
            status: auth.status,
            headers: { 'Content-Type': 'application/json' },
          });

        try {
          const { hasAdminRole } = require('./utils/adminAuth');
          const allowed = await hasAdminRole(auth, 'admin');
          if (!allowed)
            return new Response(JSON.stringify({ error: 'forbidden' }), {
              status: 403,
              headers: { 'Content-Type': 'application/json' },
            });
        } catch (e) {
          return new Response(JSON.stringify({ error: 'forbidden' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }

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

        // Admin keys export (encrypted) removed. Respond with 501 to inform
        // callers that export/import of encrypted admin key packages is no
        // longer supported in this build.
        return new Response(
          JSON.stringify({
            error: 'admin-keys-export-removed',
            message: 'export of encrypted admin keys has been removed',
          }),
          {
            status: 501,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      },
    },
    '/api/admin/keys/update-roles': {
      POST: (req) => updateRolesHandler(req),
    },
    '/api/admin/keys/import': {
      POST: (req) => importKeysHandler(req),
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

        // Export-key and tokens export endpoints removed with the keyring/encryption
        // removal. Return 501 Not Implemented so callers receive a clear message.
        return new Response(
          JSON.stringify({
            error: 'export-removed',
            message: 'export of encryption keys or tokens has been removed',
          }),
          {
            status: 501,
            headers: { 'Content-Type': 'application/json' },
          },
        );
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
              adminKeyId: (auth as any).adminKeyId || null,
              method: (auth as any).method || null,
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
              adminKeyId: (auth as any).adminKeyId || null,
              method: (auth as any).method || null,
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
