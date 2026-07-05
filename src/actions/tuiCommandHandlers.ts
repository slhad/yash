import { handleScriptsCommand } from '../scripts/commands';
import { formatActionHelp, parseActionArgs, parseLooseActionArgs } from '../utils/actionArgs';
import { runChatClearCommand } from '../utils/chatClear';
import { getDataDir } from '../utils/config';
import { renderTuiHelpLines } from '../utils/help';
import { fetchPlatformInfo, formatInfoValue } from '../utils/platformInfo';
import { formatRuntimeStatusLines, runtimeMonitor } from '../utils/runtime-monitor';
import { writeHeapSnapshotFile } from '../utils/tuiFormatting';
import { parseMarkerArgs, parseMarkersArgs, parseSettingsValue } from '../utils/webCommands';
import { IpcActionError } from './registry';

export type TuiCommandHandler = (parts: string[], emit: (line: string) => void) => Promise<void>;
export type TuiCommandHandlers = Record<string, TuiCommandHandler>;

export type TuiCommandHandlersContext = Record<string, any>;

export function createTuiCommandHandlers(ctx: TuiCommandHandlersContext): TuiCommandHandlers {
  const {
    authService,
    chatService,
    registry,
    youtube,
    twitch,
    kick,
    platforms,
    settings,
    logCollector,
    obsService,
    cliRenderer,
    lastMessages,
    lastRawMessages,
    classifyChatLine,
    openObsConnectModal,
    openTwitchSetupModal,
    openKickSetupModal,
    openYouTubeCredentialsModal,
    openYouTubeStreamPickerModal,
    openStreamModal,
    openMarkerEditModal,
    openSettingsModal,
    openActivityModal,
    openYouTubeSetupModal,
    openMemoryStatusModal,
    openChatterInfoModal,
    openHistoryModal,
    updateUI,
    refreshTuiFfzEmotes,
    reloadTuiFfzEmotes,
    getSettingValue,
    persistSettingEntries,
    normalizeSettingValueForPersistence,
    deprecatedSettingsMessages,
    invokeActionFromTui,
    resetBrowseSelection,
    setRunning,
  } = ctx;

  return {
    '/connect': async (parts, emit) => {
      const platform = (parts[1] ?? '').toLowerCase();
      if (!platform) {
        emit('[system] Usage: /connect <youtube|twitch|kick|obs>');
        return;
      }
      if (platform === 'obs') {
        openObsConnectModal();
        return;
      }
      const provider =
        platform === 'youtube'
          ? youtube
          : platform === 'twitch'
            ? twitch
            : platform === 'kick'
              ? kick
              : null;
      if (provider) {
        emit(`[system] Authenticating ${platform}...`);
        try {
          const res = await provider.authenticate();
          if (res?.success) {
            emit(`[system] ${platform} authentication succeeded`);
            if (platform === 'twitch') {
              void refreshTuiFfzEmotes('twitch-authentication');
            }
            updateUI(lastMessages);
            if (platform === 'youtube' && !youtube.getStreamKey()) {
              openYouTubeStreamPickerModal();
              return;
            }
          } else if (res?.error?.startsWith('oauth_required:')) {
            const authUrl = res.error.slice('oauth_required:'.length);
            const fallbackUrl = `http://localhost:${process.env.YASH_PORT || 3000}/api/${platform}/auth`;
            emit(`[system] Opening browser for ${platform} OAuth...`);
            const proc = Bun.spawn(['xdg-open', authUrl]);
            proc.exited.then((code) => {
              if (code !== 0) {
                lastMessages.push(
                  `[system] Browser failed to open — visit ${fallbackUrl} manually`,
                );
                updateUI(lastMessages);
              }
            });
          } else if (platform === 'twitch' && res?.error === 'Twitch credentials not configured') {
            openTwitchSetupModal();
          } else if (platform === 'kick' && res?.error === 'Kick credentials not configured') {
            openKickSetupModal();
          } else if (
            platform === 'youtube' &&
            res?.error === 'YouTube credentials not configured'
          ) {
            openYouTubeCredentialsModal();
          } else {
            emit(`[system] ${platform} authentication failed: ${res?.error ?? 'unknown error'}`);
          }
        } catch (err) {
          emit(`[system] ${platform} authentication error: ${String(err)}`);
        }
      } else {
        emit(`[system] Unknown platform: ${platform}`);
      }
    },

    '/msg': async (parts, emit) => {
      const target = parts[1]?.toLowerCase();
      const text = parts.slice(2).join(' ');
      const validTargets = ['all', 'youtube', 'twitch', 'kick'];
      if (target && validTargets.includes(target) && text) {
        try {
          const ctx = { chatService, providers: { youtube, twitch, kick } };
          const result = await registry.invokeAction('chat.send', { platform: target, text }, ctx);
          for (const line of result.output ?? []) emit(line);
          for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
        } catch (err) {
          if (err instanceof IpcActionError) {
            emit(`[system] ${err.message}`);
          } else {
            emit(`[system] Failed to send message: ${String(err)}`);
          }
        }
      } else {
        emit('[system] Usage: /msg <all|youtube|twitch|kick> <text>');
      }
    },

    '/marker': async (parts, emit) => {
      const rawParts = parts.slice(1);
      const { description: text, timestamp } = parseMarkerArgs(rawParts);

      try {
        const ctx = { chatService, providers: { youtube, twitch, kick } };
        const markerArgs: Record<string, unknown> = { text, platform: 'all' };
        if (timestamp !== undefined) markerArgs.timestamp = timestamp;
        const result = await registry.invokeAction('marker.create', markerArgs, ctx);
        for (const line of result.output ?? []) emit(line);
        for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
      } catch (err) {
        if (err instanceof IpcActionError) {
          emit(`[marker] ${err.message}`);
        } else {
          emit(`[marker] Error: ${String(err)}`);
        }
      }
      updateUI(lastMessages);
    },

    '/markers': async (parts, emit) => {
      const parsed = parseMarkersArgs(parts.slice(1));
      if (parsed.error) {
        emit(
          `[markers] Usage: /markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit] (${parsed.error})`,
        );
        updateUI(lastMessages);
        return;
      }

      if (parsed.action === 'restore') {
        try {
          const ctx = { chatService, providers: { youtube, twitch, kick } };
          const result = await registry.invokeAction(
            'markers.restore',
            { source: parsed.restoreSource, limit: parsed.limit },
            ctx,
          );
          for (const line of result.output ?? []) emit(line);
          for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
        } catch (err) {
          if (err instanceof IpcActionError) {
            emit(`[markers] ${err.message}`);
          } else {
            emit(`[markers] restore error: ${String(err)}`);
          }
        }
        updateUI(lastMessages);
        return;
      }

      if (parsed.action === 'clear') {
        try {
          const result = await youtube.clearPersistedMarkers(parsed.clearSelectionIds);
          if (parsed.clearSelectionIds && parsed.clearSelectionIds.length > 0) {
            const clearedLabel =
              result.clearedSelectionIds.length > 0
                ? `cleared markers ${result.clearedSelectionIds.map((id: number) => `#${id}`).join(', ')}`
                : 'no matching markers cleared';
            const missingLabel =
              result.missingSelectionIds.length > 0
                ? ` (missing: ${result.missingSelectionIds.map((id: number) => `#${id}`).join(', ')})`
                : '';
            emit(`[markers] youtube: ${clearedLabel}${missingLabel}`);
          } else {
            emit('[markers] youtube: cleared all persisted markers');
          }
        } catch (err) {
          emit(`[markers] youtube: clear error: ${String(err)}`);
        }
        updateUI(lastMessages);
        return;
      }

      if (parsed.action === 'edit') {
        openMarkerEditModal(parsed.editSelectionId!);
        return;
      }

      try {
        const ctx = { chatService, providers: { youtube, twitch, kick } };
        const actionArgs: Record<string, unknown> = {
          platform: parsed.platforms?.[0] ?? 'all',
        };
        if (parsed.limit !== undefined) actionArgs.limit = parsed.limit;
        const result = await registry.invokeAction('markers.list', actionArgs, ctx);
        for (const line of result.output ?? []) emit(line);
        for (const warn of result.warnings ?? []) emit(`[system] ${warn}`);
      } catch (err) {
        if (err instanceof IpcActionError) {
          emit(`[markers] ${err.message}`);
        } else {
          emit(`[markers] Error: ${String(err)}`);
        }
      }
      updateUI(lastMessages);
    },

    '/settings': async (parts, emit) => {
      const op = parts[1];
      if (!op) {
        openSettingsModal();
      } else if (op === 'get' && parts[2]) {
        const key = parts[2];
        const deprecatedMessage = deprecatedSettingsMessages.get(key);
        if (deprecatedMessage) {
          emit(deprecatedMessage);
          return;
        }
        const val = getSettingValue(key);
        emit(`[settings] ${key} = ${JSON.stringify(val)}`);
      } else if (op === 'set' && parts[2] && parts[3]) {
        const key = parts[2];
        const deprecatedMessage = deprecatedSettingsMessages.get(key);
        if (deprecatedMessage) {
          emit(deprecatedMessage);
          return;
        }
        const rawValue = parts.slice(3).join(' ');
        const value = parseSettingsValue(rawValue);
        const changedKeys = await persistSettingEntries([{ key, value }]);
        if (changedKeys.length === 0) emit('[settings] No changes.');
        else {
          emit(
            `[settings] set ${key} = ${JSON.stringify(normalizeSettingValueForPersistence(key, value))}`,
          );
          if (changedKeys.includes('tui.emotes.scale')) {
            void reloadTuiFfzEmotes('tui-emote-scale-command');
          }
        }
      } else {
        emit('[system] Usage: /settings | /settings get <key> | /settings set <key> <json-value>');
        emit(
          '[system] Common keys: stream.title, stream.description, chat.maxHistorySize, demo, title.visible, logs.visible, logs.level, logs.height, logs.tail, viewers.visible, viewers.mode, status.platformIcons.visible, status.platformIcons.youtube.sizePx, status.platformIcons.twitch.sizePx, status.platformIcons.kick.sizePx, memory.status.visible, memory.status.greenMaxMb, memory.status.orangeMinMb, memory.status.redMinMb, memory.telemetry.enabled, memory.telemetry.intervalMinutes, messages.position, chat.timestamps.visible, tui.emotes.scale, events.visible, events.tail, events.width, platforms.<provider>.showViewers, platforms.youtube.setup.*',
        );
      }
    },

    '/scripts': async (parts, emit) => {
      await handleScriptsCommand(parts, emit, getDataDir());
    },

    '/chat': async (parts, emit) => {
      const result = runChatClearCommand(parts, {
        lastMessages,
        lastRawMessages,
        classifyLine: classifyChatLine,
        resetBrowseSelection,
      });
      emit(result);
      updateUI(lastMessages);
    },

    '/logs': async (parts, emit) => {
      const op = parts[1];
      if (op === 'clear') {
        try {
          logCollector.clear();
          emit('[logs] cleared');
        } catch {
          emit('[logs] failed to clear');
        }
      } else if (op === 'tail' && parts[2]) {
        const n = parseInt(parts[2], 10) || 0;
        if (n > 0) {
          await settings.set('logs.tail', n);
          emit(`[logs] tail set to ${n}`);
        } else {
          emit('[logs] Usage: /logs tail <n>');
        }
      } else if (op === 'visible' && parts[2]) {
        const v = String(parts[2]).toLowerCase();
        if (v === 'true' || v === 'false') {
          await settings.set('logs.visible', v === 'true');
          emit(`[logs] visible set to ${v}`);
        } else {
          emit('[logs] Usage: /logs visible <true|false>');
        }
      } else {
        emit('[logs] Usage: /logs clear | /logs tail <n>');
      }
    },

    '/stream': async (parts, _emit) => {
      const specified = parts.slice(1).filter((p) => platforms.includes(p));
      const youtubeTargeted = specified.length === 0 || specified.includes('youtube');
      if (youtubeTargeted && youtube.isAuthenticated() && !youtube.getStreamKey()) {
        openYouTubeStreamPickerModal(() => openStreamModal(specified));
      } else {
        openStreamModal(specified);
      }
    },

    '/activity': async (_parts, _emit) => {
      openActivityModal();
    },

    '/setup-youtube': async (_parts, emit) => {
      if (!youtube.isAuthenticated()) {
        emit('[system] YouTube is not authenticated. Run /connect youtube first.');
        updateUI(lastMessages);
      } else {
        openYouTubeSetupModal();
      }
    },

    '/exit': async (_parts, _emit) => {
      setRunning(false);
      authService.stopAutoRefresh();
      await obsService.disconnect();
      cliRenderer?.destroy();
      process.exit(0);
    },

    '/help': async (_parts, emit) => {
      for (const line of renderTuiHelpLines()) emit(line);
    },

    '/info': async (_parts, emit) => {
      for (const platform of ['youtube', 'twitch', 'kick']) {
        try {
          const info = await fetchPlatformInfo(platform, { youtube, twitch, kick });
          emit(`[system] ${platform}: ${formatInfoValue(info)}`);
        } catch (err) {
          emit(`[system] ${platform}: error: ${String(err)}`);
        }
      }
    },

    '/memory': async (_parts, emit) => {
      const sub = (_parts[1] ?? '').toLowerCase();
      if (sub === 'modal') {
        openMemoryStatusModal();
        return;
      }
      if (sub === 'snapshot') {
        const label = _parts.slice(2).join(' ').trim();
        emit(
          '[memory] writing heap snapshot; this can pause the process and temporarily increase memory use.',
        );
        const snapshotPath = writeHeapSnapshotFile(label || undefined);
        emit(`[memory] heap snapshot written to ${snapshotPath}`);
        return;
      }
      for (const line of formatRuntimeStatusLines(runtimeMonitor.getStatus())) {
        emit(line);
      }
      for (const line of youtube.getDebugNotes()) {
        emit(line);
      }
    },

    '/chatter': async (parts, emit) => {
      const target = (parts[1] ?? '').replace(/^@/, '').toLowerCase();
      if (!target) {
        emit('[chatter] Usage: /chatter <@username>');
      } else {
        const rawMsg = [...lastRawMessages]
          .reverse()
          .find((m) => m.username.toLowerCase() === target);
        if (!rawMsg) {
          emit(`[chatter] No recent message found from @${target}`);
        } else {
          openChatterInfoModal(rawMsg);
        }
      }
    },

    '/history': async (parts, emit) => {
      const sub = parts[1]?.toLowerCase();
      if (sub === 'search') {
        const query = parts.slice(2).join(' ');
        openHistoryModal({ query });
      } else if (sub === 'user') {
        const username = parts.slice(2).join(' ').replace(/^@/, '');
        openHistoryModal({ query: username });
      } else if (!sub) {
        openHistoryModal();
      } else {
        emit('[history] Usage: /history  |  /history search <query>  |  /history user <@name>');
      }
    },

    '/inject': async (parts, emit) => {
      const INJECT_PLATFORMS = ['twitch', 'youtube', 'kick'];
      const platform = (parts[1] ?? '').toLowerCase();
      const username = parts[2] ?? '';
      const messageText = parts.slice(3).join(' ');

      if (!platform || !INJECT_PLATFORMS.includes(platform)) {
        emit(
          `[inject] Invalid or missing platform. Usage: /inject <twitch|youtube|kick> <username> <message>`,
        );
      } else if (!username) {
        emit('[inject] Missing username. Usage: /inject <platform> <username> <message>');
      } else if (!messageText) {
        emit('[inject] Missing message text. Usage: /inject <platform> <username> <message>');
      } else {
        const INJECT_COLORS = ['#FF7F50', '#9370DB', '#3CB371', '#FF69B4', '#00CED1', '#FFD700'];
        const color = INJECT_COLORS[username.length % INJECT_COLORS.length];
        chatService.injectMessage({
          id: `inject_${Date.now()}`,
          platform,
          userId: `${platform}_test_${username.toLowerCase()}`,
          username,
          message: messageText,
          timestamp: Date.now(),
          color,
        });
      }
    },

    '/action': async (parts, emit) => {
      // Case 1 — no action id: list all public IPC-enabled actions grouped by domain
      if (parts.length <= 1) {
        const allActions = registry.listActions({ ipcOnly: true, details: true }) as Array<{
          id: string;
          title: string;
          domain: string;
          visibility: string;
          safety: string;
        }>;
        const publicActions = allActions.filter(
          (a) => a.visibility === 'public' && a.safety !== 'blocked',
        );
        const byDomain = new Map<string, typeof publicActions>();
        for (const action of publicActions) {
          const group = byDomain.get(action.domain) ?? [];
          group.push(action);
          byDomain.set(action.domain, group);
        }
        for (const [domain, actions] of byDomain) {
          emit(`${domain}:`);
          for (const action of actions) {
            emit(`  ${action.id.padEnd(30)}${action.title}`);
          }
        }
        return;
      }

      const id = parts[1] ?? '';

      // Case 2 — action id only, no args: invoke if no args are required, else show help
      if (parts.length === 2) {
        const def = registry.getAction(id);
        if (!def) {
          emit(`[action] Unknown action: ${id}`);
          return;
        }
        const hasRequiredArgs = Object.values(def.args).some(
          (schema: any) => schema.required === true,
        );
        if (!hasRequiredArgs) {
          // No required args — invoke with config/default-backed empty args
          try {
            await invokeActionFromTui(id, {}, emit);
          } catch (err) {
            const msg = err instanceof IpcActionError ? err.message : String(err);
            emit(`[action] Error: ${msg}`);
          }
          return;
        }
        for (const line of formatActionHelp(def)) emit(line);
        return;
      }

      // Case 3 — action id + arg tokens: parse and invoke
      const def = registry.getAction(id);
      if (!def) {
        emit(`[action] Unknown action: ${id}`);
        return;
      }

      const parsedArgs =
        def.argMode === 'kv_pairs' && Object.keys(def.args).length === 0
          ? { args: parseLooseActionArgs(parts.slice(2)), errors: [] as string[] }
          : parseActionArgs(parts.slice(2), def.args);
      const { args, errors } = parsedArgs;
      if (errors.length > 0) {
        for (const err of errors) emit(`[action] ${err}`);
        return;
      }

      try {
        await invokeActionFromTui(id, args, emit);
      } catch (err) {
        if (err instanceof IpcActionError) {
          emit(`[action] ${err.message}`);
        } else {
          emit(`[action] Internal error`);
        }
      }
    },
  };
}
