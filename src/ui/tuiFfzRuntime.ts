import { fg, StyledText } from '@opentui/core';
import { parseMessageWithFfzEmotes } from '../utils/ffz';
import { getFfzEmotePayload, type SharedTwitchEmoteDefinition } from '../utils/ffz-fetch';
import { type PlatformStatusIconPlatform } from '../utils/platformStatusIcons';
import { ensurePlatformStatusIcon } from '../utils/platformStatusIcons.server';
import {
  buildTuiFfzUploadSequences,
  getTuiFfzColumnSpan,
  getTuiFfzPlaceholderCells,
  getTuiFfzUploadUrl,
  imageIdToColorHex,
  isTuiFfzPassthroughEnabled,
  parsePngDimensions,
  supportsTuiFfzClientTerm,
} from '../utils/tuiFfz';
import {
  formatPlatformStatusLabel,
  getPlatformStatusColor,
  type PlatformStatusLike,
} from '../utils/tuiStatusPresentation';

export type TwitchProviderEmoteContext = {
  getUserLogin?: () => string | null;
  userId?: string | null;
  apiClient?: { chat?: unknown } | null;
};

export type TuiFfzRuntimeStats = {
  imageCacheSize: number;
  uploadCount: number;
  uploadBytes: number;
  lastUploadBytes: number;
  clearCount: number;
  refreshCount: number;
  imageIdHighWaterMark: number;
};

export type TuiFfzRuntimeOptions = {
  maxImages: number;
  defaultScalePercent: number;
  getSetting: (key: string, fallback: unknown) => unknown;
  getTwitchContext: () => TwitchProviderEmoteContext;
  statusPlatformIconsEnabled: () => boolean;
  getPlatformStatusIconSizePx: (platform: PlatformStatusIconPlatform) => number;
  getPlatformStatusIconColumns: (sizePx: number) => number;
  onUiRefresh: () => void;
  rerenderRawChatLines: () => void;
  warn: (message: string) => void;
  writeStdout?: (sequence: string) => void;
  fetchImpl?: typeof fetch;
  tmuxEnv?: () => string | undefined;
  termEnv?: () => string | undefined;
  spawnSync?: typeof Bun.spawnSync;
};

export class TuiFfzRuntime {
  readonly emotes: Record<string, SharedTwitchEmoteDefinition> = {};
  readonly imageIdsByName: Record<string, number> = {};

  private readonly imageIdsByUrl = new Map<string, number>();
  private readonly platformStatusIconImageIds = new Map<PlatformStatusIconPlatform, number>();
  private readonly pendingPlatformStatusIconUploads = new Set<PlatformStatusIconPlatform>();
  private nextImageId = 1;
  private nextPlatformStatusIconImageId = 10001;
  private refreshPromise: Promise<void> | null = null;
  private supported: boolean | null = null;
  private lastChannel: string | null = null;
  private uploadCount = 0;
  private uploadBytes = 0;
  private clearCount = 0;
  private refreshCount = 0;
  private lastUploadBytes = 0;
  private imageIdHighWaterMark = 0;
  private readonly pendingUploadUrls = new Set<string>();
  private uploadQueue: Promise<void> = Promise.resolve();
  private platformStatusIconUploadQueue: Promise<void> = Promise.resolve();

  constructor(private readonly options: TuiFfzRuntimeOptions) {}

  getEmoteScalePercent(): number {
    const raw = Number(
      this.options.getSetting('tui.emotes.scale', this.options.defaultScalePercent),
    );
    return Number.isFinite(raw) && raw > 0 ? raw : this.options.defaultScalePercent;
  }

  getEmoteColumns(): number {
    return getTuiFfzColumnSpan(this.getEmoteScalePercent());
  }

  getPlatformStatusIconImageId(platform: PlatformStatusIconPlatform): number | undefined {
    return this.platformStatusIconImageIds.get(platform);
  }

  buildPlatformStatusContent(
    platform: string,
    status: PlatformStatusLike,
    viewers: string,
  ): string | StyledText {
    const label = `: ${formatPlatformStatusLabel(status, viewers)}  `;
    if (!this.options.statusPlatformIconsEnabled() || !this.detectSupport()) {
      return `${platform}${label}`;
    }
    const statusIconPlatform = platform as PlatformStatusIconPlatform;
    const imageId = this.getPlatformStatusIconImageId(statusIconPlatform);
    if (!imageId) {
      this.schedulePlatformStatusIconUpload(statusIconPlatform);
      return `${platform}${label}`;
    }
    return new StyledText([
      fg(imageIdToColorHex(imageId))(
        getTuiFfzPlaceholderCells(
          this.options.getPlatformStatusIconColumns(
            this.options.getPlatformStatusIconSizePx(statusIconPlatform),
          ),
        ),
      ),
      fg(getPlatformStatusColor(status))(label),
    ]);
  }

  getStats(): TuiFfzRuntimeStats {
    return {
      imageCacheSize: this.imageIdsByUrl.size,
      uploadCount: this.uploadCount,
      uploadBytes: this.uploadBytes,
      lastUploadBytes: this.lastUploadBytes,
      clearCount: this.clearCount,
      refreshCount: this.refreshCount,
      imageIdHighWaterMark: this.imageIdHighWaterMark,
    };
  }

  resetPlatformStatusIconState(): void {
    this.platformStatusIconImageIds.clear();
    this.pendingPlatformStatusIconUploads.clear();
    this.nextPlatformStatusIconImageId = 10001;
  }

  detectSupport(): boolean {
    if (this.supported !== null) return this.supported;

    const termName = (() => {
      if (!this.options.tmuxEnv?.()) return this.options.termEnv?.() ?? null;
      try {
        const proc = (this.options.spawnSync ?? Bun.spawnSync)([
          'tmux',
          'display-message',
          '-p',
          '#{client_termname}',
        ]);
        const name = proc.stdout.toString().trim();
        return name.length > 0 ? name : null;
      } catch {
        return null;
      }
    })();

    const passthroughEnabled = (() => {
      if (!this.options.tmuxEnv?.()) return true;
      try {
        const proc = (this.options.spawnSync ?? Bun.spawnSync)([
          'tmux',
          'show-options',
          '-gsv',
          'allow-passthrough',
        ]);
        return isTuiFfzPassthroughEnabled(proc.stdout.toString());
      } catch {
        return false;
      }
    })();

    this.supported = passthroughEnabled && supportsTuiFfzClientTerm(termName);
    return this.supported;
  }

  clearState(): void {
    this.clearCount += 1;
    this.lastChannel = null;
    for (const key of Object.keys(this.emotes)) delete this.emotes[key];
    for (const key of Object.keys(this.imageIdsByName)) delete this.imageIdsByName[key];
    this.imageIdsByUrl.clear();
    this.nextImageId = 1;
  }

  schedulePlatformStatusIconUpload(platform: PlatformStatusIconPlatform): void {
    if (!this.options.statusPlatformIconsEnabled() || !this.detectSupport()) return;
    if (
      this.platformStatusIconImageIds.has(platform) ||
      this.pendingPlatformStatusIconUploads.has(platform)
    ) {
      return;
    }
    this.pendingPlatformStatusIconUploads.add(platform);
    this.platformStatusIconUploadQueue = this.platformStatusIconUploadQueue
      .catch(() => {})
      .then(async () => {
        if (this.platformStatusIconImageIds.has(platform)) return;
        const imageId = this.nextPlatformStatusIconImageId++;
        await this.uploadPlatformStatusIcon(platform, imageId);
        this.platformStatusIconImageIds.set(platform, imageId);
        this.options.onUiRefresh();
      })
      .catch((error) => {
        this.options.warn(`[status-icons] TUI upload failed for ${platform}: ${String(error)}`);
      })
      .finally(() => {
        this.pendingPlatformStatusIconUploads.delete(platform);
      });
  }

  scheduleUploadsForMessage(platform: string, message: string): void {
    if (platform !== 'twitch' || Object.keys(this.emotes).length === 0) return;
    for (const part of parseMessageWithFfzEmotes(message, this.emotes)) {
      if (part.type !== 'emote') continue;
      const emote = this.emotes[part.emote.name];
      if (!emote) continue;
      const cacheKey = this.getCacheKey(emote);
      const imageId = this.imageIdsByUrl.get(cacheKey);
      if (imageId) {
        this.imageIdsByName[emote.name] = imageId;
        continue;
      }
      this.scheduleUploadForEmote(emote);
    }
  }

  async refresh(reason: string): Promise<void> {
    if (!this.detectSupport()) return;
    if (this.refreshPromise) return this.refreshPromise;

    const twitchWithEmoteContext = this.options.getTwitchContext();
    const channel =
      typeof twitchWithEmoteContext.getUserLogin === 'function'
        ? twitchWithEmoteContext.getUserLogin()
        : null;

    if (!channel) {
      this.clearState();
      return;
    }

    this.refreshPromise = (async () => {
      this.refreshCount += 1;
      try {
        const payload = await getFfzEmotePayload(channel, {
          apiClient: (twitchWithEmoteContext.apiClient as any) ?? null,
          userId: twitchWithEmoteContext.userId ?? null,
        });
        if (payload.channel !== channel) return;
        if (payload.channel !== this.lastChannel) {
          this.clearState();
        }
        this.lastChannel = payload.channel;

        const activeNames = new Set(Object.keys(payload.emotes));
        const activeUrls = new Set(
          Object.values(payload.emotes).map((emote) =>
            emote.source === 'twitch' ? (emote.staticUrl ?? emote.url) : emote.url,
          ),
        );
        for (const name of Object.keys(this.emotes)) {
          if (!activeNames.has(name)) delete this.emotes[name];
        }
        for (const name of Object.keys(this.imageIdsByName)) {
          if (!activeNames.has(name)) delete this.imageIdsByName[name];
        }
        for (const cachedUrl of Array.from(this.imageIdsByUrl.keys())) {
          if (!activeUrls.has(cachedUrl)) {
            const imageId = this.imageIdsByUrl.get(cachedUrl);
            this.imageIdsByUrl.delete(cachedUrl);
            if (imageId) this.deleteImageReferences(imageId);
          }
        }

        for (const [name, emote] of Object.entries(payload.emotes)) {
          this.emotes[name] = emote;
          const cacheKey = this.getCacheKey(emote);
          const imageId = this.imageIdsByUrl.get(cacheKey);
          if (imageId) {
            this.imageIdsByName[name] = imageId;
          } else {
            delete this.imageIdsByName[name];
          }
        }

        this.options.rerenderRawChatLines();
      } catch (error) {
        this.options.warn(`[FFZ:TUI] ${reason}: ${String(error)}`);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async reload(reason: string): Promise<void> {
    this.clearState();
    await this.refresh(reason);
  }

  private getPassthroughMode(): 'none' | 'tmux' {
    return this.options.tmuxEnv?.() ? 'tmux' : 'none';
  }

  private async uploadPlatformStatusIcon(
    platform: PlatformStatusIconPlatform,
    imageId: number,
  ): Promise<void> {
    const icon = await ensurePlatformStatusIcon(platform);
    const bytes = new Uint8Array(await Bun.file(icon.pngPath).arrayBuffer());
    const parsed = parsePngDimensions(bytes);
    const columns = this.options.getPlatformStatusIconColumns(
      this.options.getPlatformStatusIconSizePx(platform),
    );
    for (const sequence of buildTuiFfzUploadSequences({
      imageId,
      pngBytes: bytes,
      width: parsed.width,
      height: parsed.height,
      columns,
      passthrough: this.getPassthroughMode(),
    })) {
      (this.options.writeStdout ?? process.stdout.write.bind(process.stdout))(sequence);
    }
  }

  private async uploadImage(emote: SharedTwitchEmoteDefinition, imageId: number): Promise<void> {
    const uploadUrl = getTuiFfzUploadUrl(emote);
    const response = await (this.options.fetchImpl ?? fetch)(uploadUrl);
    if (!response.ok) {
      throw new Error(`FFZ image fetch returned ${response.status} for ${emote.name}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    this.uploadCount += 1;
    this.uploadBytes += bytes.byteLength;
    this.lastUploadBytes = bytes.byteLength;
    if (imageId > this.imageIdHighWaterMark) {
      this.imageIdHighWaterMark = imageId;
    }
    const parsed = parsePngDimensions(bytes);
    const width = emote.width ?? parsed.width;
    const height = emote.height ?? parsed.height;

    for (const sequence of buildTuiFfzUploadSequences({
      imageId,
      pngBytes: bytes,
      width,
      height,
      columns: this.getEmoteColumns(),
      passthrough: this.getPassthroughMode(),
    })) {
      (this.options.writeStdout ?? process.stdout.write.bind(process.stdout))(sequence);
    }
  }

  private getCacheKey(emote: SharedTwitchEmoteDefinition): string {
    return emote.source === 'twitch' ? (emote.staticUrl ?? emote.url) : emote.url;
  }

  private deleteImageReferences(imageId: number): void {
    for (const [name, currentImageId] of Object.entries(this.imageIdsByName)) {
      if (currentImageId === imageId) delete this.imageIdsByName[name];
    }
  }

  private trimImageCache(): void {
    while (this.imageIdsByUrl.size > this.options.maxImages) {
      const oldestEntry = this.imageIdsByUrl.entries().next().value;
      if (!oldestEntry) return;
      const [oldestUrl, imageId] = oldestEntry;
      this.imageIdsByUrl.delete(oldestUrl);
      this.deleteImageReferences(imageId);
    }
  }

  private scheduleUploadForEmote(emote: SharedTwitchEmoteDefinition): void {
    const cacheKey = this.getCacheKey(emote);
    if (!cacheKey || this.imageIdsByUrl.has(cacheKey) || this.pendingUploadUrls.has(cacheKey)) {
      return;
    }

    this.pendingUploadUrls.add(cacheKey);
    this.uploadQueue = this.uploadQueue
      .catch(() => {})
      .then(async () => {
        if (this.imageIdsByUrl.has(cacheKey)) return;
        const imageId = this.nextImageId++;
        await this.uploadImage(emote, imageId);
        this.imageIdsByUrl.set(cacheKey, imageId);
        this.imageIdsByName[emote.name] = imageId;
        this.trimImageCache();
        this.options.rerenderRawChatLines();
      })
      .catch((error) => {
        this.options.warn(`[FFZ:TUI] Lazy upload failed for ${emote.name}: ${String(error)}`);
      })
      .finally(() => {
        this.pendingUploadUrls.delete(cacheKey);
      });
  }
}
