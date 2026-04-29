import index from '../index.html';
import sidebyside from '../sidebyside.html';
import unified from '../unified.html';
import commandsJs from './utils/webCommands.bundle.js' with { type: 'text' };

// When launched as TUI companion (YASH_TUI_ONLY=1), skip HTML page routes —
// only OAuth callbacks and connect/API endpoints are needed.
const isTuiOnly = process.env.YASH_TUI_ONLY === '1';

import { importKeysHandler, updateRolesHandler } from './handlers/adminKeysHandlers';
import type { PlatformProvider } from './platforms/base';
import {
  adminService,
  authService,
  chatService,
  initializeServices,
  kick,
  obsService,
  platforms,
  settingsStore,
  streamService,
  twitch,
  youtube,
} from './services';
import { authorizeAdmin } from './utils/adminAuth';
import { getConfig, isDemoMode, saveConfig } from './utils/config';
import { defaultLogger } from './utils/logger';
import { apiMetricsHandler, prometheusMetricsHandler } from './utils/metricsHandlers';

export {
  adminService,
  authService,
  chatService,
  initializeServices,
  kick,
  obsService,
  platforms,
  streamService,
  twitch,
  youtube,
};

function getCommandsJs(): string {
  return commandsJs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const htmlRoutes: Record<string, any> = isTuiOnly
  ? {}
  : { '/': index, '/unified': unified, '/sidebyside': sidebyside };

Bun.serve({
  routes: {
    ...htmlRoutes,
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
    '/api/stream': {
      GET: () => {
        const cfg = getConfig();
        const meta = cfg.stream ?? {};
        return new Response(JSON.stringify(meta), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const { platforms: targetPlatforms, metadata } = await req.json();
        // Normalize tags to string[] regardless of whether the client sent a string
        if (metadata?.tags != null && typeof metadata.tags === 'string') {
          metadata.tags = metadata.tags
            .split(',')
            .map((t: string) => t.trim().replace(/\s+/g, ''))
            .filter(Boolean);
        }
        const cfg = getConfig();
        const current = cfg.stream ?? {};
        const changed: Record<string, any> = {};
        for (const key of Object.keys(metadata ?? {})) {
          if (JSON.stringify(metadata[key]) !== JSON.stringify(current[key])) {
            changed[key] = metadata[key];
          }
        }
        if (Object.keys(changed).length > 0) {
          await saveConfig({ stream: { ...current, ...changed } });
          await streamService.setStreamMetadata(targetPlatforms ?? platforms, metadata);
        }
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
    // Twitch category search — GET /api/twitch/categories?q=...
    // Returns up to 8 matching category names from the Helix search API.
    // ------------------------------------------------------------------
    '/api/twitch/categories': {
      GET: async (req) => {
        const url = new URL(req.url);
        const q = url.searchParams.get('q') ?? '';
        if (!twitch.isAuthenticated() || !q.trim()) {
          return new Response(JSON.stringify({ categories: [] }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const categories = await twitch.searchCategories(q);
        return new Response(JSON.stringify({ categories }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube OAuth — GET /api/youtube/auth  →  redirect to Google
    // ------------------------------------------------------------------
    '/api/youtube/auth': {
      GET: () => {
        const url = youtube.getAuthUrl();
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube OAuth — GET /api/youtube/callback?code=...
    // Google redirects here after the user approves the app.
    // ------------------------------------------------------------------
    '/api/youtube/callback': {
      GET: async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`<html><body><h2>YouTube auth error: ${error}</h2></body></html>`, {
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

        const result = await youtube.handleOAuthCallback(code);
        if (result.success) {
          return new Response(
            `<html><body><h2>✅ YouTube connected successfully!</h2><p>You can close this tab.</p></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }

        return new Response(
          `<html><body><h2>❌ YouTube auth failed</h2><pre>${result.error}</pre></body></html>`,
          { status: 400, headers: { 'Content-Type': 'text/html' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // YouTube chapter markers — GET /api/youtube/markers
    // Returns in-memory chapter list + the formatted description block.
    // ------------------------------------------------------------------
    '/api/youtube/markers': {
      GET: async () => {
        const markers = await youtube.getMarkers();
        const block = youtube.getChapterDescriptionBlock();
        return new Response(JSON.stringify({ markers, descriptionBlock: block }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube channel info — GET /api/youtube/channel
    // ------------------------------------------------------------------
    '/api/youtube/channel': {
      GET: () => {
        if (!youtube.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response(JSON.stringify(youtube.getChannelInfo()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube stream setup — GET/POST /api/youtube/setup
    // ------------------------------------------------------------------
    '/api/youtube/setup': {
      GET: () => {
        return new Response(JSON.stringify(youtube.getSetup()), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        await saveConfig({ platforms: { youtube: { setup: body } } });
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // YouTube playlists — GET /api/youtube/playlists
    // ------------------------------------------------------------------
    '/api/youtube/playlists': {
      GET: async () => {
        if (!youtube.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const playlists = await youtube.listPlaylists();
        return new Response(JSON.stringify(playlists), {
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

        const providerMap: Record<string, PlatformProvider> = { youtube, twitch, kick };
        const results = await Promise.allSettled(
          targetPlatforms.map(async (p) => {
            const provider = providerMap[p];
            if (!provider) return { platform: p, marker: null, error: 'unknown platform' };
            if (!provider.isAuthenticated())
              return { platform: p, marker: null, error: 'not authenticated' };
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
          const cfg = getConfig();
          const current = cfg.stream ?? {};
          await saveConfig({ stream: { ...current, ...body } });
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

    // ------------------------------------------------------------------
    // Settings — GET /api/settings?key=<k>  or  GET /api/settings (all)
    //            POST /api/settings  { key, value }
    // Allows WebUI to read/write persistent settings (same store as TUI).
    // ------------------------------------------------------------------
    '/api/settings': {
      GET: async (req) => {
        const url = new URL(req.url);
        const key = url.searchParams.get('key');
        if (key) {
          const val = settingsStore.get(key, null);
          return new Response(JSON.stringify({ key, value: val }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
        // Return all known setting keys
        const knownKeys = [
          'title.visible',
          'logs.visible',
          'logs.height',
          'logs.tail',
          'viewers.visible',
          'viewers.mode',
          'messages.position',
          'events.visible',
          'events.tail',
          'events.width',
        ];
        const all: Record<string, unknown> = {};
        for (const k of knownKeys) {
          all[k] = settingsStore.get(k, null);
        }
        return new Response(JSON.stringify(all), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const body = await req.json().catch(() => ({}));
        const { key, value } = body as { key?: string; value?: unknown };
        if (!key) {
          return new Response(JSON.stringify({ error: 'key required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        await settingsStore.set(key, value);
        return new Response(JSON.stringify({ success: true, key, value }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Connect — POST /api/connect/:platform
    // Triggers platform authentication from the WebUI.
    // For Twitch, redirects the caller to the OAuth consent screen.
    // For YouTube/Kick, calls authenticate() and returns the result.
    // ------------------------------------------------------------------
    '/api/connect/twitch': {
      POST: () => {
        const url = twitch.getAuthUrl();
        return new Response(JSON.stringify({ redirect: url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/connect/youtube': {
      POST: () => {
        const url = youtube.getAuthUrl();
        return new Response(JSON.stringify({ redirect: url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    '/api/connect/kick': {
      POST: async () => {
        const url = await kick.getAuthUrl();
        return new Response(JSON.stringify({ redirect: url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Kick OAuth — GET /api/kick/auth  →  redirect to Kick
    // ------------------------------------------------------------------
    '/api/kick/auth': {
      GET: async () => {
        const url = await kick.getAuthUrl();
        return new Response(null, {
          status: 302,
          headers: { Location: url },
        });
      },
    },

    // ------------------------------------------------------------------
    // Kick OAuth — GET /api/kick/callback?code=...
    // Kick redirects here after the user approves the app.
    // ------------------------------------------------------------------
    '/api/kick/callback': {
      GET: async (req) => {
        const url = new URL(req.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          return new Response(`<html><body><h2>Kick auth error: ${error}</h2></body></html>`, {
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

        const result = await kick.handleOAuthCallback(code);
        if (result.success) {
          return new Response(
            `<html><body><h2>✅ Kick connected successfully!</h2><p>You can close this tab.</p></body></html>`,
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }

        return new Response(
          `<html><body><h2>❌ Kick auth failed</h2><pre>${result.error}</pre></body></html>`,
          { status: 400, headers: { 'Content-Type': 'text/html' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // Kick channel info — GET /api/kick/channel
    // Returns current title, category, tags from the Kick channels API
    // ------------------------------------------------------------------
    '/api/kick/channel': {
      GET: async () => {
        if (!kick.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        const provider = kick as any;
        if (!provider.client || !provider.channelSlug) {
          return new Response(JSON.stringify({ error: 'api client not ready' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const channel = await provider.client.channels.getChannel(provider.channelSlug);
          return new Response(
            JSON.stringify({
              title: channel?.user?.username,
              slug: channel?.slug,
              category: channel?.category?.name ?? null,
              categoryId: channel?.category?.id ?? null,
              followers: channel?.followers_count ?? 0,
              verified: channel?.verified ?? false,
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
      // PATCH /api/kick/channel  { title?, game?, tags? }
      PATCH: async (req) => {
        if (!kick.isAuthenticated()) {
          return new Response(JSON.stringify({ error: 'not authenticated' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        try {
          const body = await req.json();
          await kick.updateStreamMetadata(body);
          const cfg = getConfig();
          const current = cfg.stream ?? {};
          await saveConfig({ stream: { ...current, ...body } });
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

    // ------------------------------------------------------------------
    // Kick webhook relay — GET /api/kick/webhook
    // Returns the smee.io URL to paste into Kick app settings.
    // POST /api/kick/webhook
    // Receives direct Kick webhook events (for non-smee tunnels, e.g. ngrok).
    // ------------------------------------------------------------------
    '/api/kick/webhook': {
      GET: () => {
        const url = (kick as any).getWebhookUrl?.() ?? null;
        return new Response(JSON.stringify({ url }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
      POST: async (req) => {
        const payload = await req.json().catch(() => null);
        if (payload) (kick as any).handleWebhookEvent(payload);
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },

    // ------------------------------------------------------------------
    // Help — GET /api/help
    // Returns the list of all available / commands for WebUI consumption.
    // ------------------------------------------------------------------
    '/api/help': {
      GET: () => {
        return new Response(
          JSON.stringify({
            commands: [
              {
                command: '/help',
                description: 'Show available commands',
                example: '/help',
              },
              {
                command: '/msg',
                description: 'Send a message to a specific platform or all',
                example: '/msg all Hello world',
                usage: '/msg <all|youtube|twitch|kick> <text>',
              },
              {
                command: '/marker',
                description: 'Place a stream marker on all platforms',
                example: '/marker Intro | 0',
                usage: '/marker [description] [| timestamp_s]',
              },
              {
                command: '/connect',
                description: 'Authenticate a platform',
                example: '/connect twitch',
                usage: '/connect <youtube|twitch|kick>',
              },
              {
                command: '/settings',
                description: 'Get or set a UI setting',
                example: '/settings set title.visible true',
                usage: '/settings get <key> | /settings set <key> <value>',
              },
            ],
          }),
          { headers: { 'Content-Type': 'application/json' } },
        );
      },
    },

    // ------------------------------------------------------------------
    // Shared WebUI command bundle — GET /api/js/commands.js
    // Lazy-builds src/utils/webCommands.ts to an ESM bundle on first request
    // and caches the result in memory. Consumed by unified.html and
    // sidebyside.html as `<script type="module">` imports.
    // ------------------------------------------------------------------
    '/api/js/commands.js': {
      GET: () => {
        try {
          const js = getCommandsJs();
          return new Response(js, {
            headers: { 'Content-Type': 'application/javascript' },
          });
        } catch (err) {
          defaultLogger.error('Failed to serve commands.js', err);
          return new Response(`console.error("commands.js failed: ${String(err)}");`, {
            status: 500,
            headers: { 'Content-Type': 'application/javascript' },
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
  development: false,
});

defaultLogger.info('YASH server running at http://localhost:3000');
