import * as path from 'node:path';
import type { ScriptApi, UserScriptAction, UserScriptArgSchema, UserScriptDefinition } from './types';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_ROUTE_COOLDOWN_MS = 5000;
const MAX_RECENT_OUTCOMES = 50;
const MAX_CANDIDATES = 100;
const MISSING_SETTINGS_KEY = Symbol('missing-settings-key');

type RouteRuleMatch = {
  windowClass?: string;
  windowTitleRegex?: string;
  processBinary?: string;
  childProcessBinary?: string;
  applicationName?: string;
  mediaName?: string;
  sourceSinkName?: string;
};

type RouteRule = {
  id: string;
  enabled: boolean;
  match: RouteRuleMatch;
  notes?: string;
};

type ExclusionRule = {
  id: string;
  enabled: boolean;
  match: RouteRuleMatch;
  reason?: string;
};

type ObsAudioRoutingConfig = {
  enabled: boolean;
  streamTargets: RouteRule[];
  musicTargets: RouteRule[];
  exclusions: ExclusionRule[];
  discovery: {
    enabled: boolean;
    minHitsBeforeCandidate: number;
    fullscreenCandidate: {
      enabled: boolean;
      minAreaRatio: number;
      requireFocused: boolean;
      excludeFloating: boolean;
    };
  };
  feedback: {
    chat: {
      enabled: boolean;
    };
    eventsAndLogs: {
      enabled: boolean;
    };
  };
  routing: {
    pollIntervalMs: number;
    cooldownMs: number;
    linkWhenSourceSinkMatches: string[];
  };
  obsStreaming: {
    enableOnStreamStart: boolean;
    disableOnStreamStop: boolean;
    enableOnObsConnect: boolean;
    disableOnObsDisconnect: boolean;
  };
  $ui: Record<string, unknown>;
};

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type FocusedWindow = {
  class: string;
  title: string;
  pid: number;
  floating: boolean;
  monitor: number | null;
  fullscreen: number;
  areaRatio: number | null;
};

type ProcessInfo = {
  pid: number;
  ppid: number;
  comm: string;
  args: string;
};

type LiveStream = {
  id: number;
  sinkIndex: number;
  sinkName: string;
  applicationName: string;
  applicationProcessBinary: string;
  applicationProcessId: number | null;
  mediaName: string;
  nodeName: string;
  derivedBinary: string;
};

type RuntimeCandidate = {
  id: string;
  firstSeenAt: number;
  lastSeenAt: number;
  hitCount: number;
  suggestedSink: 'Stream' | 'Music' | null;
  detectionReasons: string[];
  windowClass: string;
  windowTitleSamples: string[];
  processBinary: string;
  childProcessBinary: string;
  applicationName: string;
  mediaName: string;
  observedSink: string;
  visible: boolean;
};

type RuntimeOutcome = {
  ts: number;
  kind: 'moved' | 'noop' | 'excluded' | 'candidate' | 'warning';
  message: string;
};

type RuntimeState = {
  candidates: Map<string, RuntimeCandidate>;
  recentOutcomes: RuntimeOutcome[];
  lastFocusedWindow: FocusedWindow | null;
  lastSupportReasons: string[];
  lastRoutedAtByStream: Map<number, number>;
  lastRouteAttemptSignatureByStream: Map<number, string>;
  lastFeedbackAtByKey: Map<string, number>;
  movedStreams: Map<
    number,
    {
      previousSinkName: string;
      targetSinkName: string;
      label: string;
    }
  >;
  linkedStreams: Map<
    number,
    {
      targetSinkName: string;
      links: Array<{ outputPort: string; inputPort: string }>;
      label: string;
    }
  >;
  lastEnabledState: boolean | null;
  persistedDefaultsEnsured: boolean;
};

type Snapshot = {
  focusedWindow: FocusedWindow | null;
  focusedMonitorName: string | null;
  descendants: ProcessInfo[];
  descendantPidSet: Set<number>;
  descendantBinarySet: Set<string>;
  streams: LiveStream[];
  sinks: Array<{ index: number; name: string }>;
  supportReasons: string[];
};

type SearchResult =
  | { type: 'stream'; stream: LiveStream }
  | { type: 'process'; process: ProcessInfo }
  | { type: 'window'; window: FocusedWindow & { matchLabel: string } };

type CommandRunner = (cmd: string[], label: string) => Promise<CommandResult>;

const DEFAULT_CONFIG: ObsAudioRoutingConfig = {
  enabled: true,
  streamTargets: [
  ],
  musicTargets: [
    {
      id: 'cliamp-music',
      enabled: true,
      match: {
        processBinary: 'cliamp',
      },
      notes: 'Example terminal-hosted music app routed to Music.',
    },
  ],
  exclusions: [
    {
      id: 'exclude-obs',
      enabled: true,
      match: {
        applicationName: 'OBS',
      },
      reason: 'Never move OBS monitor/control-plane streams automatically.',
    },
    {
      id: 'exclude-routing-helpers',
      enabled: true,
      match: {
        processBinary: 'pactl',
      },
      reason: 'Avoid routing helper commands.',
    },
    {
      id: 'exclude-wpctl',
      enabled: true,
      match: {
        processBinary: 'wpctl',
      },
      reason: 'Avoid routing helper commands.',
    },
  ],
  discovery: {
    enabled: true,
    minHitsBeforeCandidate: 3,
    fullscreenCandidate: {
      enabled: true,
      minAreaRatio: 0.9,
      requireFocused: true,
      excludeFloating: true,
    },
  },
  feedback: {
    chat: {
      enabled: true,
    },
    eventsAndLogs: {
      enabled: true,
    },
  },
  routing: {
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
    cooldownMs: DEFAULT_ROUTE_COOLDOWN_MS,
    linkWhenSourceSinkMatches: ['easyeffects_sink'],
  },
  obsStreaming: {
    enableOnStreamStart: false,
    disableOnStreamStop: false,
    enableOnObsConnect: false,
    disableOnObsDisconnect: false,
  },
  $ui: {
    enabled: {
      widget: 'toggle',
      label: 'enabled',
      description: 'enable or disable automatic OBS audio routing entirely',
      order: 10,
    },
    streamTargets: {
      widget: 'json',
      label: 'streamTargets',
      description: 'persisted approved rules routed to the Stream sink',
      order: 20,
    },
    musicTargets: {
      widget: 'json',
      label: 'musicTargets',
      description: 'persisted approved rules routed to the Music sink',
      order: 30,
    },
    exclusions: {
      widget: 'json',
      label: 'exclusions',
      description: 'persisted deny rules that prevent automatic routing',
      order: 40,
    },
    discovery: {
      widget: 'json',
      label: 'discovery',
      description: 'runtime candidate heuristics and visibility thresholds',
      order: 50,
    },
    feedback: {
      widget: 'json',
      label: 'feedback',
      description: 'runtime feedback toggles for Chat and Events & Logs',
      order: 60,
    },
    routing: {
      widget: 'json',
      label: 'routing',
      description: 'polling cadence, route cooldown controls, and automatic link-mode source sinks',
      order: 70,
    },
    obsStreaming: {
      widget: 'json',
      label: 'obsStreaming',
      description: 'optional OBS stream-state automation for enable/disable behavior',
      order: 80,
    },
    'streamTargets/*': {
      titleTemplate: '${index} - ${id}',
    },
    'musicTargets/*': {
      titleTemplate: '${index} - ${id}',
    },
    'exclusions/*': {
      titleTemplate: '${index} - ${id}',
    },
  },
};

const DURATION_ARG = {
  type: 'string',
  required: false,
  minLength: 1,
  maxLength: 32,
} as const satisfies UserScriptArgSchema;

export const scriptDefinition = {
  actionPrefix: 'obs-audio-routing',
  title: 'OBS Audio Routing',
} satisfies UserScriptDefinition;

let commandRunner: CommandRunner = async (cmd, label) => {
  const proc = Bun.spawn({
    cmd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return {
    exitCode,
    stdout,
    stderr,
  };
};

export function __setCommandRunnerForTests(nextRunner: CommandRunner): void {
  commandRunner = nextRunner;
}

function getDataDir(): string {
  return (
    process.env.YASH_DATA_DIR ||
    path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME || '.', '.config'), 'yash')
  );
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeNumber(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => normalizeString(entry)).filter(Boolean)
    : [];
}

function normalizeMatch(value: unknown): RouteRuleMatch {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    windowClass: normalizeString((raw as Record<string, unknown>).windowClass),
    windowTitleRegex: normalizeString((raw as Record<string, unknown>).windowTitleRegex),
    processBinary: normalizeString((raw as Record<string, unknown>).processBinary),
    childProcessBinary: normalizeString((raw as Record<string, unknown>).childProcessBinary),
    applicationName: normalizeString((raw as Record<string, unknown>).applicationName),
    mediaName: normalizeString((raw as Record<string, unknown>).mediaName),
    sourceSinkName: normalizeString((raw as Record<string, unknown>).sourceSinkName),
  };
}

function normalizeRule(value: unknown, index: number, prefix: string): RouteRule {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    id: normalizeString((raw as Record<string, unknown>).id) || `${prefix}-${index + 1}`,
    enabled: normalizeBoolean((raw as Record<string, unknown>).enabled, true),
    match: normalizeMatch((raw as Record<string, unknown>).match),
    notes: normalizeString((raw as Record<string, unknown>).notes) || undefined,
  };
}

function normalizeExclusion(value: unknown, index: number): ExclusionRule {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    id: normalizeString((raw as Record<string, unknown>).id) || `exclusion-${index + 1}`,
    enabled: normalizeBoolean((raw as Record<string, unknown>).enabled, true),
    match: normalizeMatch((raw as Record<string, unknown>).match),
    reason: normalizeString((raw as Record<string, unknown>).reason) || undefined,
  };
}

function normalizeRuleArray(value: unknown, prefix: string): RouteRule[] {
  return Array.isArray(value) ? value.map((entry, index) => normalizeRule(entry, index, prefix)) : [];
}

function normalizeExclusionArray(value: unknown): ExclusionRule[] {
  return Array.isArray(value) ? value.map((entry, index) => normalizeExclusion(entry, index)) : [];
}

function normalizeConfig(raw: Record<string, unknown>): ObsAudioRoutingConfig {
  const discoveryRaw =
    raw.discovery && typeof raw.discovery === 'object' && !Array.isArray(raw.discovery)
      ? (raw.discovery as Record<string, unknown>)
      : {};
  const fullscreenRaw =
    discoveryRaw.fullscreenCandidate &&
    typeof discoveryRaw.fullscreenCandidate === 'object' &&
    !Array.isArray(discoveryRaw.fullscreenCandidate)
      ? (discoveryRaw.fullscreenCandidate as Record<string, unknown>)
      : {};
  const feedbackRaw =
    raw.feedback && typeof raw.feedback === 'object' && !Array.isArray(raw.feedback)
      ? (raw.feedback as Record<string, unknown>)
      : {};
  const chatFeedbackRaw =
    feedbackRaw.chat && typeof feedbackRaw.chat === 'object' && !Array.isArray(feedbackRaw.chat)
      ? (feedbackRaw.chat as Record<string, unknown>)
      : {};
  const eventsFeedbackRaw =
    feedbackRaw.eventsAndLogs &&
    typeof feedbackRaw.eventsAndLogs === 'object' &&
    !Array.isArray(feedbackRaw.eventsAndLogs)
      ? (feedbackRaw.eventsAndLogs as Record<string, unknown>)
      : {};
  const routingRaw =
    raw.routing && typeof raw.routing === 'object' && !Array.isArray(raw.routing)
      ? (raw.routing as Record<string, unknown>)
      : {};
  const obsStreamingRaw =
    raw.obsStreaming && typeof raw.obsStreaming === 'object' && !Array.isArray(raw.obsStreaming)
      ? (raw.obsStreaming as Record<string, unknown>)
      : {};
  const uiRaw =
    raw.$ui && typeof raw.$ui === 'object' && !Array.isArray(raw.$ui)
      ? (raw.$ui as Record<string, unknown>)
      : DEFAULT_CONFIG.$ui;

  return {
    enabled: normalizeBoolean(raw.enabled, DEFAULT_CONFIG.enabled),
    streamTargets: normalizeRuleArray(raw.streamTargets, 'stream-target'),
    musicTargets: normalizeRuleArray(raw.musicTargets, 'music-target'),
    exclusions: normalizeExclusionArray(raw.exclusions),
    discovery: {
      enabled: normalizeBoolean(discoveryRaw.enabled, DEFAULT_CONFIG.discovery.enabled),
      minHitsBeforeCandidate: normalizeNumber(
        discoveryRaw.minHitsBeforeCandidate,
        DEFAULT_CONFIG.discovery.minHitsBeforeCandidate,
        1,
        100,
      ),
      fullscreenCandidate: {
        enabled: normalizeBoolean(
          fullscreenRaw.enabled,
          DEFAULT_CONFIG.discovery.fullscreenCandidate.enabled,
        ),
        minAreaRatio: Number(
          typeof fullscreenRaw.minAreaRatio === 'number'
            ? fullscreenRaw.minAreaRatio
            : DEFAULT_CONFIG.discovery.fullscreenCandidate.minAreaRatio,
        ),
        requireFocused: normalizeBoolean(
          fullscreenRaw.requireFocused,
          DEFAULT_CONFIG.discovery.fullscreenCandidate.requireFocused,
        ),
        excludeFloating: normalizeBoolean(
          fullscreenRaw.excludeFloating,
          DEFAULT_CONFIG.discovery.fullscreenCandidate.excludeFloating,
        ),
      },
    },
    feedback: {
      chat: {
        enabled: normalizeBoolean(chatFeedbackRaw.enabled, DEFAULT_CONFIG.feedback.chat.enabled),
      },
      eventsAndLogs: {
        enabled: normalizeBoolean(
          eventsFeedbackRaw.enabled,
          DEFAULT_CONFIG.feedback.eventsAndLogs.enabled,
        ),
      },
    },
    routing: {
      pollIntervalMs: normalizeNumber(
        routingRaw.pollIntervalMs,
        DEFAULT_CONFIG.routing.pollIntervalMs,
        250,
        60000,
      ),
      cooldownMs: normalizeNumber(
        routingRaw.cooldownMs,
        DEFAULT_CONFIG.routing.cooldownMs,
        0,
        300000,
      ),
      linkWhenSourceSinkMatches: normalizeStringArray(
        routingRaw.linkWhenSourceSinkMatches ?? DEFAULT_CONFIG.routing.linkWhenSourceSinkMatches,
      ),
    },
    obsStreaming: {
      enableOnStreamStart: normalizeBoolean(
        obsStreamingRaw.enableOnStreamStart,
        DEFAULT_CONFIG.obsStreaming.enableOnStreamStart,
      ),
      disableOnStreamStop: normalizeBoolean(
        obsStreamingRaw.disableOnStreamStop,
        DEFAULT_CONFIG.obsStreaming.disableOnStreamStop,
      ),
      enableOnObsConnect: normalizeBoolean(
        obsStreamingRaw.enableOnObsConnect,
        DEFAULT_CONFIG.obsStreaming.enableOnObsConnect,
      ),
      disableOnObsDisconnect: normalizeBoolean(
        obsStreamingRaw.disableOnObsDisconnect,
        DEFAULT_CONFIG.obsStreaming.disableOnObsDisconnect,
      ),
    },
    $ui: uiRaw,
  };
}

function readConfig(api: ScriptApi): ObsAudioRoutingConfig {
  const raw = {
    enabled: api.settings.get('enabled', DEFAULT_CONFIG.enabled),
    streamTargets: api.settings.get('streamTargets', DEFAULT_CONFIG.streamTargets),
    musicTargets: api.settings.get('musicTargets', DEFAULT_CONFIG.musicTargets),
    exclusions: api.settings.get('exclusions', DEFAULT_CONFIG.exclusions),
    discovery: api.settings.get('discovery', DEFAULT_CONFIG.discovery),
    feedback: api.settings.get('feedback', DEFAULT_CONFIG.feedback),
    routing: api.settings.get('routing', DEFAULT_CONFIG.routing),
    obsStreaming: api.settings.get('obsStreaming', DEFAULT_CONFIG.obsStreaming),
    $ui: api.settings.get('$ui', DEFAULT_CONFIG.$ui),
  } as Record<string, unknown>;

  return normalizeConfig(raw);
}

async function writeConfig(api: ScriptApi, nextConfig: ObsAudioRoutingConfig): Promise<string[]> {
  const current = readConfig(api);
  const changedKeys: string[] = [];
  for (const key of ['enabled', 'streamTargets', 'musicTargets', 'exclusions', 'discovery', 'feedback', 'routing', 'obsStreaming', '$ui'] as const) {
    if (JSON.stringify(current[key]) === JSON.stringify(nextConfig[key])) continue;
    await api.settings.set(key, nextConfig[key]);
    changedKeys.push(key);
  }
  return changedKeys;
}

async function ensurePersistedRoutingDefaults(api: ScriptApi): Promise<boolean> {
  const missingRoutingLinkDefaults = api.settings.get<symbol | string[]>(
    'routing.linkWhenSourceSinkMatches',
    MISSING_SETTINGS_KEY,
  );
  if (missingRoutingLinkDefaults !== MISSING_SETTINGS_KEY) {
    return false;
  }
  await api.settings.set(
    'routing.linkWhenSourceSinkMatches',
    DEFAULT_CONFIG.routing.linkWhenSourceSinkMatches,
  );
  api.logger.info(
    `persisted missing routing.linkWhenSourceSinkMatches default: ${JSON.stringify(DEFAULT_CONFIG.routing.linkWhenSourceSinkMatches)}`,
  );
  return true;
}

async function runJsonCommand<T>(cmd: string[], label: string): Promise<T> {
  const result = await commandRunner(cmd, label);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`);
  }
  return JSON.parse(result.stdout) as T;
}

async function runTextCommand(cmd: string[], label: string): Promise<string> {
  const result = await commandRunner(cmd, label);
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`);
  }
  return result.stdout;
}

function buildSupportReasons(): string[] {
  const reasons: string[] = [];
  if (process.platform !== 'linux') {
    reasons.push(`unsupported platform: ${process.platform}`);
  }
  if (!process.env.HYPRLAND_INSTANCE_SIGNATURE) {
    reasons.push('Hyprland session not detected');
  }
  return reasons;
}

function deriveBinaryFromNodeName(nodeName: string): string {
  const normalized = normalizeString(nodeName);
  if (!normalized) return '';
  const suffix = normalized.split('.').pop() ?? normalized;
  return suffix.replace(/[^a-zA-Z0-9._-]/g, '').trim();
}

function stringMatches(value: string, expected: string): boolean {
  if (!expected) return true;
  if (!value) return false;
  return value.toLowerCase() === expected.toLowerCase();
}

function regexMatches(value: string, pattern: string): boolean {
  if (!pattern) return true;
  if (!value) return false;
  try {
    return new RegExp(pattern, 'i').test(value);
  } catch {
    return false;
  }
}

function matchRuleAgainstContext(
  match: RouteRuleMatch,
  focusedWindow: FocusedWindow | null,
  descendantBinarySet: Set<string>,
  stream: LiveStream,
): boolean {
  if (match.windowClass && !stringMatches(focusedWindow?.class ?? '', match.windowClass)) {
    return false;
  }
  if (match.windowTitleRegex && !regexMatches(focusedWindow?.title ?? '', match.windowTitleRegex)) {
    return false;
  }
  if (match.processBinary) {
    const streamBinaryCandidates = [
      stream.applicationProcessBinary,
      stream.derivedBinary,
      deriveBinaryFromNodeName(stream.applicationName),
    ].filter(Boolean);
    if (!streamBinaryCandidates.some((candidate) => stringMatches(candidate, match.processBinary ?? ''))) {
      return false;
    }
  }
  if (match.childProcessBinary) {
    const expected = match.childProcessBinary.toLowerCase();
    if (![...descendantBinarySet].some((binary) => binary.toLowerCase() === expected)) {
      return false;
    }
  }
  if (match.applicationName && !stringMatches(stream.applicationName, match.applicationName)) {
    return false;
  }
  if (match.mediaName && !stringMatches(stream.mediaName, match.mediaName)) {
    return false;
  }
  if (match.sourceSinkName && !stringMatches(stream.sinkName, match.sourceSinkName)) {
    return false;
  }
  return true;
}

function findMatchingRule(
  rules: RouteRule[],
  focusedWindow: FocusedWindow | null,
  descendantBinarySet: Set<string>,
  stream: LiveStream,
): RouteRule | null {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    if (matchRuleAgainstContext(rule.match, focusedWindow, descendantBinarySet, stream)) {
      return rule;
    }
  }
  return null;
}

function findMatchingExclusion(
  exclusions: ExclusionRule[],
  focusedWindow: FocusedWindow | null,
  descendantBinarySet: Set<string>,
  stream: LiveStream,
): ExclusionRule | null {
  for (const exclusion of exclusions) {
    if (!exclusion.enabled) continue;
    if (matchRuleAgainstContext(exclusion.match, focusedWindow, descendantBinarySet, stream)) {
      return exclusion;
    }
  }
  return null;
}

async function getFocusedWindow(): Promise<FocusedWindow | null> {
  const windowInfo = await runJsonCommand<Record<string, unknown>>(
    ['hyprctl', '-j', 'activewindow'],
    'hyprctl activewindow',
  );
  const windowClass = normalizeString(windowInfo.class);
  const pid = normalizeNumber(windowInfo.pid, 0, 0, Number.MAX_SAFE_INTEGER);
  if (!windowClass || pid <= 0) return null;

  const monitorId = typeof windowInfo.monitor === 'number' ? windowInfo.monitor : null;
  const monitors = await runJsonCommand<Array<Record<string, unknown>>>(
    ['hyprctl', '-j', 'monitors'],
    'hyprctl monitors',
  );
  const monitor = monitors.find((entry) => entry.id === monitorId || entry.focused === true);
  const size = Array.isArray(windowInfo.size) ? windowInfo.size : [];
  const width = typeof size[0] === 'number' ? size[0] : 0;
  const height = typeof size[1] === 'number' ? size[1] : 0;
  const monitorWidth = monitor && typeof monitor.width === 'number' ? monitor.width : 0;
  const monitorHeight = monitor && typeof monitor.height === 'number' ? monitor.height : 0;
  const areaRatio =
    width > 0 && height > 0 && monitorWidth > 0 && monitorHeight > 0
      ? (width * height) / (monitorWidth * monitorHeight)
      : null;

  return {
    class: windowClass,
    title: normalizeString(windowInfo.title),
    pid,
    floating: Boolean(windowInfo.floating),
    monitor: monitorId,
    fullscreen: normalizeNumber(windowInfo.fullscreen, 0, 0, 10),
    areaRatio,
  };
}

async function getProcessTable(): Promise<ProcessInfo[]> {
  const output = await runTextCommand(['ps', '-eo', 'pid=,ppid=,comm=,args='], 'ps process list');
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        ppid: Number(match[2]),
        comm: match[3],
        args: match[4] ?? '',
      } satisfies ProcessInfo;
    })
    .filter((value): value is ProcessInfo => value !== null);
}

function getDescendants(processTable: ProcessInfo[], rootPid: number): ProcessInfo[] {
  const byParent = new Map<number, ProcessInfo[]>();
  for (const processInfo of processTable) {
    const existing = byParent.get(processInfo.ppid) ?? [];
    existing.push(processInfo);
    byParent.set(processInfo.ppid, existing);
  }
  const descendants: ProcessInfo[] = [];
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const pid = queue.shift()!;
    for (const child of byParent.get(pid) ?? []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      descendants.push(child);
      queue.push(child.pid);
    }
  }
  return descendants;
}

async function getLiveStreams(): Promise<{ streams: LiveStream[]; sinks: Array<{ index: number; name: string }> }> {
  const [sinkInputs, sinks] = await Promise.all([
    runJsonCommand<Array<Record<string, unknown>>>(['pactl', '--format=json', 'list', 'sink-inputs'], 'pactl sink-inputs'),
    runJsonCommand<Array<Record<string, unknown>>>(['pactl', '--format=json', 'list', 'sinks', 'short'], 'pactl sinks'),
  ]);
  const sinkNameByIndex = new Map<number, string>();
  const sinkEntries = sinks.map((sink) => {
    const index = normalizeNumber(sink.index, 0, 0, Number.MAX_SAFE_INTEGER);
    const name = normalizeString(sink.name);
    sinkNameByIndex.set(index, name);
    return { index, name };
  });
  const streams = sinkInputs.map((entry) => {
    const properties =
      entry.properties && typeof entry.properties === 'object' && !Array.isArray(entry.properties)
        ? (entry.properties as Record<string, unknown>)
        : {};
    const nodeName = normalizeString(properties['node.name']);
    const sinkIndex = normalizeNumber(entry.sink, 0, 0, Number.MAX_SAFE_INTEGER);
    return {
      id: normalizeNumber(entry.index, 0, 0, Number.MAX_SAFE_INTEGER),
      sinkIndex,
      sinkName: sinkNameByIndex.get(sinkIndex) ?? `#${sinkIndex}`,
      applicationName: normalizeString(properties['application.name']),
      applicationProcessBinary: normalizeString(properties['application.process.binary']),
      applicationProcessId:
        properties['application.process.id'] === undefined
          ? null
          : normalizeNumber(properties['application.process.id'], 0, 0, Number.MAX_SAFE_INTEGER),
      mediaName: normalizeString(properties['media.name']),
      nodeName,
      derivedBinary: deriveBinaryFromNodeName(nodeName),
    } satisfies LiveStream;
  });

  return { streams, sinks: sinkEntries };
}

async function collectSnapshot(): Promise<Snapshot> {
  const supportReasons = buildSupportReasons();
  if (supportReasons.length > 0) {
    return {
      focusedWindow: null,
      focusedMonitorName: null,
      descendants: [],
      descendantPidSet: new Set<number>(),
      descendantBinarySet: new Set<string>(),
      streams: [],
      sinks: [],
      supportReasons,
    };
  }

  try {
    const [focusedWindow, processTable, streamState] = await Promise.all([
      getFocusedWindow(),
      getProcessTable(),
      getLiveStreams(),
    ]);
    const descendants = focusedWindow ? getDescendants(processTable, focusedWindow.pid) : [];
    const descendantPidSet = new Set<number>(
      focusedWindow ? [focusedWindow.pid, ...descendants.map((entry) => entry.pid)] : [],
    );
    const descendantBinarySet = new Set<string>(
      descendants.map((entry) => normalizeString(entry.comm)).filter(Boolean),
    );
    return {
      focusedWindow,
      focusedMonitorName: focusedWindow?.monitor === null ? null : String(focusedWindow?.monitor ?? ''),
      descendants,
      descendantPidSet,
      descendantBinarySet,
      streams: streamState.streams,
      sinks: streamState.sinks,
      supportReasons: [],
    };
  } catch (error) {
    return {
      focusedWindow: null,
      focusedMonitorName: null,
      descendants: [],
      descendantPidSet: new Set<number>(),
      descendantBinarySet: new Set<string>(),
      streams: [],
      sinks: [],
      supportReasons: [String(error)],
    };
  }
}

function pushOutcome(runtime: RuntimeState, kind: RuntimeOutcome['kind'], message: string): void {
  const now = Date.now();
  const lastOutcome = runtime.recentOutcomes[runtime.recentOutcomes.length - 1];
  if (lastOutcome && lastOutcome.kind === kind && lastOutcome.message === message) {
    lastOutcome.ts = now;
    return;
  }
  runtime.recentOutcomes.push({
    ts: now,
    kind,
    message,
  });
  if (runtime.recentOutcomes.length > MAX_RECENT_OUTCOMES) {
    runtime.recentOutcomes.splice(0, runtime.recentOutcomes.length - MAX_RECENT_OUTCOMES);
  }
}

function shouldSendFeedback(runtime: RuntimeState, feedbackKey: string, cooldownMs = 30000): boolean {
  const now = Date.now();
  const last = runtime.lastFeedbackAtByKey.get(feedbackKey) ?? 0;
  if (now - last < cooldownMs) return false;
  runtime.lastFeedbackAtByKey.set(feedbackKey, now);
  return true;
}

function sendFeedback(
  api: ScriptApi,
  runtime: RuntimeState,
  config: ObsAudioRoutingConfig,
  type: string,
  line: string,
  throttleKey?: string,
): void {
  const key = throttleKey ?? `${type}:${line}`;
  if (!shouldSendFeedback(runtime, key)) return;
  if (config.feedback.chat.enabled) {
    api.feedback.chat(line);
  }
  if (config.feedback.eventsAndLogs.enabled) {
    api.feedback.event(type, line.replace(/^\[obs-audio-routing\]\s*/, ''));
  }
}

function suggestSink(
  config: ObsAudioRoutingConfig,
  focusedWindow: FocusedWindow | null,
  stream: LiveStream,
): { sink: 'Stream' | 'Music' | null; reasons: string[] } {
  const reasons: string[] = [];
  const combined = [
    stream.applicationName,
    stream.applicationProcessBinary,
    stream.derivedBinary,
    stream.mediaName,
    focusedWindow?.title ?? '',
    focusedWindow?.class ?? '',
  ]
    .join(' ')
    .toLowerCase();

  const musicHints = ['spotify', 'music', 'mpv', 'vlc', 'rhythmbox', 'deezer'];
  if (musicHints.some((hint) => combined.includes(hint))) {
    reasons.push('music keyword heuristic');
    return { sink: 'Music', reasons };
  }

  if (
    config.discovery.fullscreenCandidate.enabled &&
    focusedWindow &&
    (!config.discovery.fullscreenCandidate.requireFocused || focusedWindow !== null) &&
    (!config.discovery.fullscreenCandidate.excludeFloating || !focusedWindow.floating) &&
    typeof focusedWindow.areaRatio === 'number' &&
    focusedWindow.areaRatio >= config.discovery.fullscreenCandidate.minAreaRatio
  ) {
    reasons.push('near-fullscreen focused window');
    return { sink: 'Stream', reasons };
  }

  return { sink: null, reasons };
}

function updateCandidate(
  runtime: RuntimeState,
  config: ObsAudioRoutingConfig,
  focusedWindow: FocusedWindow | null,
  descendants: ProcessInfo[],
  stream: LiveStream,
): RuntimeCandidate | null {
  if (!config.discovery.enabled) return null;
  const childProcessBinary =
    descendants.find((entry) => stringMatches(entry.comm, stream.derivedBinary))?.comm ??
    descendants[0]?.comm ??
    '';
  const suggested = suggestSink(config, focusedWindow, stream);
  const candidateId = [
    focusedWindow?.class ?? '',
    childProcessBinary,
    stream.applicationName,
    stream.derivedBinary,
    stream.mediaName,
  ]
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .join('|');
  if (!candidateId) return null;

  const now = Date.now();
  const existing = runtime.candidates.get(candidateId);
  const titleSamples = new Set(existing?.windowTitleSamples ?? []);
  if (focusedWindow?.title) {
    titleSamples.add(focusedWindow.title);
  }
  const next: RuntimeCandidate = {
    id: candidateId,
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastSeenAt: now,
    hitCount: (existing?.hitCount ?? 0) + 1,
    suggestedSink: suggested.sink,
    detectionReasons: Array.from(new Set([...(existing?.detectionReasons ?? []), ...suggested.reasons])),
    windowClass: focusedWindow?.class ?? existing?.windowClass ?? '',
    windowTitleSamples: [...titleSamples].slice(0, 4),
    processBinary: stream.derivedBinary || stream.applicationProcessBinary,
    childProcessBinary,
    applicationName: stream.applicationName,
    mediaName: stream.mediaName,
    observedSink: stream.sinkName,
    visible: false,
  };
  next.visible = next.hitCount >= config.discovery.minHitsBeforeCandidate;
  runtime.candidates.set(candidateId, next);

  if (runtime.candidates.size > MAX_CANDIDATES) {
    const oldest = [...runtime.candidates.values()].sort((a, b) => a.lastSeenAt - b.lastSeenAt)[0];
    if (oldest) runtime.candidates.delete(oldest.id);
  }
  return next;
}

async function moveStreamToSink(streamId: number, targetSinkName: string): Promise<void> {
  const result = await commandRunner(
    ['pactl', 'move-sink-input', String(streamId), targetSinkName],
    'pactl move-sink-input',
  );
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`);
  }
}

type PipewireLinkPair = {
  outputPort: string;
  inputPort: string;
};

async function listPipewirePorts(direction: 'output' | 'input'): Promise<string[]> {
  const cmd =
    direction === 'output'
      ? ['pw-link', '-o']
      : ['pw-link', '-i'];
  const output = await runTextCommand(cmd, `pw-link ${direction} ports`);
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function listPipewireLinks(): Promise<Set<string>> {
  const output = await runTextCommand(['pw-link', '-l'], 'pw-link list');
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const links = new Set<string>();
  let currentPort = '';
  for (const line of lines) {
    if (line.startsWith('|->')) {
      const target = line.slice(3).trim();
      if (currentPort && target) links.add(`${currentPort}\u0000${target}`);
      continue;
    }
    if (line.startsWith('|<-')) {
      const source = line.slice(3).trim();
      if (source && currentPort) links.add(`${source}\u0000${currentPort}`);
      continue;
    }
    currentPort = line;
  }
  return links;
}

function extractSinkNameFromPort(port: string): string {
  const separatorIndex = port.indexOf(':');
  return separatorIndex >= 0 ? port.slice(0, separatorIndex) : port;
}

function getLinkedTargetSinksForStream(
  stream: LiveStream,
  links: Set<string>,
): string[] {
  const prefix = `${stream.nodeName}:`;
  const targets = new Set<string>();
  for (const link of links) {
    const [outputPort, inputPort] = link.split('\u0000');
    if (!outputPort?.startsWith(prefix) || !inputPort) continue;
    const sinkName = extractSinkNameFromPort(inputPort);
    if (sinkName) targets.add(sinkName);
  }
  return [...targets];
}

function trackedPipewireLinksStillExist(
  trackedLinks: PipewireLinkPair[],
  currentLinks: Set<string>,
): boolean {
  return trackedLinks.every((link) => currentLinks.has(`${link.outputPort}\u0000${link.inputPort}`));
}

function extractPortChannelSuffix(port: string): string {
  const alias = port.split(':').pop() ?? port;
  const underscoreIndex = alias.lastIndexOf('_');
  return underscoreIndex >= 0 ? alias.slice(underscoreIndex + 1) : alias;
}

function buildLinkPairs(
  outputPorts: string[],
  inputPorts: string[],
): PipewireLinkPair[] {
  const inputBySuffix = new Map<string, string>();
  for (const inputPort of inputPorts) {
    inputBySuffix.set(extractPortChannelSuffix(inputPort), inputPort);
  }
  const exactPairs = outputPorts
    .map((outputPort) => ({
      outputPort,
      inputPort: inputBySuffix.get(extractPortChannelSuffix(outputPort)) ?? '',
    }))
    .filter((pair) => pair.inputPort);
  if (exactPairs.length === outputPorts.length && exactPairs.length > 0) {
    return exactPairs;
  }
  const fallbackCount = Math.min(outputPorts.length, inputPorts.length);
  return outputPorts.slice(0, fallbackCount).map((outputPort, index) => ({
    outputPort,
    inputPort: inputPorts[index]!,
  }));
}

async function createPipewireLinksForStream(
  stream: LiveStream,
  targetSinkName: string,
): Promise<PipewireLinkPair[]> {
  const [outputPorts, inputPorts, existingLinks] = await Promise.all([
    listPipewirePorts('output'),
    listPipewirePorts('input'),
    listPipewireLinks(),
  ]);
  const streamOutputPorts = outputPorts.filter((port) => port.startsWith(`${stream.nodeName}:`));
  const targetInputPorts = inputPorts.filter((port) => port.startsWith(`${targetSinkName}:`));
  if (streamOutputPorts.length === 0) {
    throw new Error(`No PipeWire output ports found for ${stream.nodeName}`);
  }
  if (targetInputPorts.length === 0) {
    throw new Error(`No PipeWire input ports found for sink ${targetSinkName}`);
  }
  const pairs = buildLinkPairs(streamOutputPorts, targetInputPorts);
  const createdPairs: PipewireLinkPair[] = [];
  for (const pair of pairs) {
    if (existingLinks.has(`${pair.outputPort}\u0000${pair.inputPort}`)) continue;
    const result = await commandRunner(
      ['pw-link', '-w', pair.outputPort, pair.inputPort],
      'pw-link connect',
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`);
    }
    createdPairs.push(pair);
  }
  return createdPairs;
}

async function removePipewireLinks(
  links: PipewireLinkPair[],
): Promise<void> {
  for (const link of links) {
    const result = await commandRunner(
      ['pw-link', '-d', link.outputPort, link.inputPort],
      'pw-link disconnect',
    );
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`);
    }
  }
}

function matchesSearchQuery(query: string, candidates: string[]): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return false;
  return candidates.some((candidate) => candidate.toLowerCase().includes(normalized));
}

function formatRule(rule: RouteRule): string {
  const parts = Object.entries(rule.match)
    .filter(([, value]) => normalizeString(value))
    .map(([key, value]) => `${key}=${value}`);
  return `${rule.id}${rule.enabled ? '' : ' (disabled)'}${parts.length > 0 ? ` [${parts.join(', ')}]` : ''}`;
}

function formatExclusion(rule: ExclusionRule): string {
  const parts = Object.entries(rule.match)
    .filter(([, value]) => normalizeString(value))
    .map(([key, value]) => `${key}=${value}`);
  const reason = normalizeString(rule.reason);
  const suffix = reason ? ` reason="${reason}"` : '';
  return `${rule.id}${rule.enabled ? '' : ' (disabled)'}${parts.length > 0 ? ` [${parts.join(', ')}]` : ''}${suffix}`;
}

function formatLiveStreamWiring(stream: LiveStream, linkedTargetSinks: string[] = []): string {
  const appLabel =
    stream.applicationName || stream.applicationProcessBinary || stream.derivedBinary || `stream #${stream.id}`;
  const displayedTargets =
    linkedTargetSinks.length > 0 ? linkedTargetSinks.join(' + ') : stream.sinkName;
  const details = [
    `sink=${stream.sinkName}#${stream.sinkIndex}`,
    linkedTargetSinks.length > 1 ? `links=${linkedTargetSinks.join(', ')}` : '',
    stream.applicationProcessId === null ? '' : `pid=${stream.applicationProcessId}`,
    stream.applicationProcessBinary ? `process=${stream.applicationProcessBinary}` : '',
    stream.derivedBinary && stream.derivedBinary !== stream.applicationProcessBinary
      ? `derived=${stream.derivedBinary}`
      : '',
    stream.mediaName ? `media=${stream.mediaName}` : '',
  ].filter(Boolean);
  return `${appLabel} -> ${displayedTargets}${details.length > 0 ? ` [${details.join(', ')}]` : ''}`;
}

function shouldLinkMatchedStream(
  config: ObsAudioRoutingConfig,
  stream: LiveStream,
): boolean {
  return config.routing.linkWhenSourceSinkMatches.some((sinkName) =>
    stringMatches(stream.sinkName, sinkName),
  );
}

function parseWaitDurationMs(raw: string): number {
  const normalized = normalizeString(raw).toLowerCase();
  if (!normalized) return 0;
  const match = normalized.match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!match) {
    throw new Error(`Invalid wait duration "${raw}". Use values like 500ms or 5s.`);
  }
  const value = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid wait duration "${raw}".`);
  }
  const ms = unit === 's' ? value * 1000 : value;
  return Math.max(0, Math.round(ms));
}

function getDefaultExclusions(): ExclusionRule[] {
  return DEFAULT_CONFIG.exclusions.map((rule, index) =>
    normalizeExclusion(
      {
        ...rule,
        match: { ...rule.match },
      },
      index,
    ),
  );
}

function restoreMissingDefaultExclusions(current: ObsAudioRoutingConfig): {
  nextConfig: ObsAudioRoutingConfig;
  added: ExclusionRule[];
} {
  const defaults = getDefaultExclusions();
  const existingIds = new Set(current.exclusions.map((rule) => rule.id));
  const added = defaults.filter((rule) => !existingIds.has(rule.id));
  if (added.length === 0) {
    return { nextConfig: current, added: [] };
  }
  return {
    nextConfig: normalizeConfig({
      ...current,
      exclusions: [...current.exclusions, ...added],
    }),
    added,
  };
}

function repairDefaultExclusions(current: ObsAudioRoutingConfig): {
  nextConfig: ObsAudioRoutingConfig;
  added: ExclusionRule[];
  repaired: ExclusionRule[];
} {
  const defaults = getDefaultExclusions();
  const defaultsById = new Map(defaults.map((rule) => [rule.id, rule]));
  const currentById = new Map(current.exclusions.map((rule) => [rule.id, rule]));
  const nextExclusions = [...current.exclusions];
  const added: ExclusionRule[] = [];
  const repaired: ExclusionRule[] = [];

  for (const defaultRule of defaults) {
    const currentRule = currentById.get(defaultRule.id);
    if (!currentRule) {
      nextExclusions.push(defaultRule);
      added.push(defaultRule);
      continue;
    }

    const nextRule = normalizeExclusion(
      {
        ...defaultRule,
        enabled: currentRule.enabled,
      },
      0,
    );
    if (JSON.stringify(currentRule) === JSON.stringify(nextRule)) continue;
    const index = nextExclusions.findIndex((rule) => rule.id === defaultRule.id);
    if (index >= 0) nextExclusions[index] = nextRule;
    repaired.push(nextRule);
  }

  if (added.length === 0 && repaired.length === 0) {
    return { nextConfig: current, added, repaired };
  }

  return {
    nextConfig: normalizeConfig({
      ...current,
      exclusions: nextExclusions,
    }),
    added,
    repaired,
  };
}

async function getWindowsForSearch(): Promise<Array<FocusedWindow & { matchLabel: string }>> {
  const clients = await runJsonCommand<Array<Record<string, unknown>>>(['hyprctl', '-j', 'clients'], 'hyprctl clients');
  return clients
    .map((client) => ({
      class: normalizeString(client.class),
      title: normalizeString(client.title),
      pid: normalizeNumber(client.pid, 0, 0, Number.MAX_SAFE_INTEGER),
      floating: Boolean(client.floating),
      monitor: typeof client.monitor === 'number' ? client.monitor : null,
      fullscreen: normalizeNumber(client.fullscreen, 0, 0, 10),
      areaRatio: null,
      matchLabel: `${normalizeString(client.class)} | ${normalizeString(client.title)}`,
    }))
    .filter((entry) => entry.class || entry.title);
}

async function restoreMovedStreams(
  api: ScriptApi,
  runtime: RuntimeState,
  config: ObsAudioRoutingConfig,
  reason: string,
): Promise<void> {
  for (const [streamId, tracked] of [...runtime.linkedStreams.entries()]) {
    try {
      await removePipewireLinks(tracked.links);
      const line = `[obs-audio-routing] unlinked ${tracked.label} -> ${tracked.targetSinkName} (${reason})`;
      pushOutcome(runtime, 'moved', line);
      sendFeedback(api, runtime, config, 'route', line, `unlink:${streamId}:${tracked.targetSinkName}`);
    } catch (error) {
      const line = `[obs-audio-routing] failed to unlink ${tracked.label} -> ${tracked.targetSinkName}: ${String(error)}`;
      pushOutcome(runtime, 'warning', line);
      sendFeedback(api, runtime, config, 'route', line, `unlink-error:${streamId}:${tracked.targetSinkName}`);
      continue;
    }
    runtime.linkedStreams.delete(streamId);
    runtime.lastRouteAttemptSignatureByStream.delete(streamId);
    runtime.lastRoutedAtByStream.delete(streamId);
  }

  if (runtime.movedStreams.size === 0) return;
  const snapshot = await collectSnapshot();
  if (snapshot.supportReasons.length > 0) return;

  for (const [streamId, tracked] of [...runtime.movedStreams.entries()]) {
    const stream = snapshot.streams.find((entry) => entry.id === streamId);
    if (!stream) {
      runtime.movedStreams.delete(streamId);
      runtime.lastRouteAttemptSignatureByStream.delete(streamId);
      runtime.lastRoutedAtByStream.delete(streamId);
      continue;
    }
    if (stream.sinkName === tracked.previousSinkName) {
      runtime.movedStreams.delete(streamId);
      runtime.lastRouteAttemptSignatureByStream.delete(streamId);
      runtime.lastRoutedAtByStream.delete(streamId);
      continue;
    }
    if (stream.sinkName !== tracked.targetSinkName) {
      // Respect manual changes that already moved the stream away from the script-owned target.
      runtime.movedStreams.delete(streamId);
      runtime.lastRouteAttemptSignatureByStream.delete(streamId);
      runtime.lastRoutedAtByStream.delete(streamId);
      continue;
    }

    try {
      await moveStreamToSink(stream.id, tracked.previousSinkName);
      const line = `[obs-audio-routing] restored ${tracked.label} -> ${tracked.previousSinkName} (${reason})`;
      pushOutcome(runtime, 'moved', line);
      sendFeedback(api, runtime, config, 'route', line, `restore:${stream.id}:${tracked.previousSinkName}`);
    } catch (error) {
      const line = `[obs-audio-routing] failed to restore ${tracked.label} -> ${tracked.previousSinkName}: ${String(error)}`;
      pushOutcome(runtime, 'warning', line);
      sendFeedback(api, runtime, config, 'route', line, `restore-error:${stream.id}:${tracked.previousSinkName}`);
      continue;
    }

    runtime.movedStreams.delete(streamId);
    runtime.lastRouteAttemptSignatureByStream.delete(streamId);
    runtime.lastRoutedAtByStream.delete(streamId);
  }
}

export default function setup(api: ScriptApi): () => void {
  const runtime: RuntimeState = {
    candidates: new Map<string, RuntimeCandidate>(),
    recentOutcomes: [],
    lastFocusedWindow: null,
    lastSupportReasons: [],
    lastRoutedAtByStream: new Map<number, number>(),
    lastRouteAttemptSignatureByStream: new Map<number, string>(),
    lastFeedbackAtByKey: new Map<string, number>(),
    movedStreams: new Map(),
    linkedStreams: new Map(),
    lastEnabledState: null,
    persistedDefaultsEnsured: false,
  };

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const resetScheduledTick = (delayMs: number) => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = null;
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delayMs);
  };

  const setEnabledPersisted = async (nextEnabled: boolean, reason: string) => {
    const current = readConfig(api);
    if (current.enabled === nextEnabled) return;
    await api.settings.set('enabled', nextEnabled);
    runtime.lastEnabledState = nextEnabled;
    const nextConfig = readConfig(api);
    if (!nextEnabled) {
      await restoreMovedStreams(api, runtime, nextConfig, reason);
    }
    const line = `[obs-audio-routing] enabled -> ${nextEnabled} (${reason})`;
    pushOutcome(runtime, 'warning', line);
    sendFeedback(api, runtime, nextConfig, 'status', line, `enabled:${nextEnabled}:${reason}`);
    if (nextEnabled) {
      resetScheduledTick(0);
    }
  };

  const scheduleTick = (delayMs: number) => {
    if (disposed) return;
    timer = setTimeout(() => {
      void tick();
    }, delayMs);
  };

  const tick = async () => {
    if (disposed) return;
    if (!runtime.persistedDefaultsEnsured) {
      try {
        await ensurePersistedRoutingDefaults(api);
      } catch (error) {
        api.logger.warn(
          `failed to persist routing defaults: ${String(error)}`,
        );
      }
      runtime.persistedDefaultsEnsured = true;
    }
    const config = readConfig(api);
    if (runtime.lastEnabledState === null) {
      runtime.lastEnabledState = config.enabled;
    } else if (runtime.lastEnabledState !== config.enabled) {
      if (!config.enabled) {
        await restoreMovedStreams(api, runtime, config, 'disabled');
      }
      runtime.lastEnabledState = config.enabled;
    }
    if (!config.enabled) {
      scheduleTick(config.routing.pollIntervalMs);
      return;
    }

    const snapshot = await collectSnapshot();
    runtime.lastFocusedWindow = snapshot.focusedWindow;
    runtime.lastSupportReasons = snapshot.supportReasons;
    let pipewireLinksCache: Set<string> | null = null;

    if (snapshot.supportReasons.length > 0) {
      const message = `[obs-audio-routing] unsupported: ${snapshot.supportReasons.join('; ')}`;
      pushOutcome(runtime, 'warning', message);
      sendFeedback(api, runtime, config, 'status', message, `unsupported:${snapshot.supportReasons.join('|')}`);
      scheduleTick(config.routing.pollIntervalMs);
      return;
    }

    for (const stream of snapshot.streams) {
      const exclusion = findMatchingExclusion(
        config.exclusions,
        snapshot.focusedWindow,
        snapshot.descendantBinarySet,
        stream,
      );
      if (exclusion) {
        const message = `[obs-audio-routing] ignored ${stream.applicationName || stream.derivedBinary || `stream #${stream.id}`} (excluded)`;
        pushOutcome(runtime, 'excluded', message);
        continue;
      }

      const streamRule = findMatchingRule(
        config.streamTargets,
        snapshot.focusedWindow,
        snapshot.descendantBinarySet,
        stream,
      );
      const musicRule = streamRule
        ? null
        : findMatchingRule(
            config.musicTargets,
            snapshot.focusedWindow,
            snapshot.descendantBinarySet,
            stream,
          );
      const targetSinkName = streamRule ? 'Stream' : musicRule ? 'Music' : null;
      const matchedRule = streamRule ?? musicRule;

      if (!targetSinkName || !matchedRule) {
        const candidate = updateCandidate(
          runtime,
          config,
          snapshot.focusedWindow,
          snapshot.descendants,
          stream,
        );
        if (candidate?.visible) {
          const line = `[obs-audio-routing] candidate updated: ${candidate.processBinary || candidate.applicationName} -> ${candidate.suggestedSink ?? 'unknown'}`;
          pushOutcome(runtime, 'candidate', line);
        }
        continue;
      }

      if (stream.sinkName === targetSinkName) {
        runtime.lastRouteAttemptSignatureByStream.delete(stream.id);
        continue;
      }

      const linkMode = shouldLinkMatchedStream(config, stream);
      if (linkMode) {
        const trackedLinkState = runtime.linkedStreams.get(stream.id);
        if (trackedLinkState) {
          pipewireLinksCache ??= await listPipewireLinks().catch(() => new Set<string>());
          if (trackedPipewireLinksStillExist(trackedLinkState.links, pipewireLinksCache)) {
            runtime.lastRouteAttemptSignatureByStream.delete(stream.id);
            continue;
          }
          runtime.linkedStreams.delete(stream.id);
          runtime.lastRouteAttemptSignatureByStream.delete(stream.id);
          runtime.lastRoutedAtByStream.delete(stream.id);
        }
      }

      const now = Date.now();
      const routeMode = linkMode ? 'link' : 'move';
      const routeAttemptSignature = `${routeMode}:${stream.sinkName}->${targetSinkName}`;
      const lastRouteAttemptSignature =
        runtime.lastRouteAttemptSignatureByStream.get(stream.id) ?? '';
      const lastMovedAt = runtime.lastRoutedAtByStream.get(stream.id) ?? 0;
      const retryCooldownMs = Math.max(config.routing.cooldownMs, 30000);
      if (
        lastRouteAttemptSignature === routeAttemptSignature &&
        now - lastMovedAt < retryCooldownMs
      ) {
        continue;
      }
      if (now - lastMovedAt < config.routing.cooldownMs) {
        continue;
      }

      try {
        runtime.lastRouteAttemptSignatureByStream.set(stream.id, routeAttemptSignature);
        runtime.lastRoutedAtByStream.set(stream.id, now);
        const label = stream.applicationName || stream.derivedBinary || `stream #${stream.id}`;
        if (linkMode) {
          const createdLinks = await createPipewireLinksForStream(stream, targetSinkName);
          if (createdLinks.length > 0) {
            runtime.linkedStreams.set(stream.id, {
              targetSinkName,
              links: createdLinks,
              label,
            });
          }
          const line =
            createdLinks.length > 0
              ? `[obs-audio-routing] linked ${label} -> ${targetSinkName} (${matchedRule.id})`
              : `[obs-audio-routing] already linked ${label} -> ${targetSinkName} (${matchedRule.id})`;
          pushOutcome(runtime, 'moved', line);
          sendFeedback(api, runtime, config, 'route', line, `link:${stream.id}:${targetSinkName}`);
          continue;
        }

        await moveStreamToSink(stream.id, targetSinkName);
        runtime.movedStreams.set(stream.id, {
          previousSinkName: stream.sinkName,
          targetSinkName,
          label,
        });
        const line = `[obs-audio-routing] moved ${label} -> ${targetSinkName} (${matchedRule.id})`;
        pushOutcome(runtime, 'moved', line);
        sendFeedback(api, runtime, config, 'route', line, `move:${stream.id}:${targetSinkName}`);
      } catch (error) {
        runtime.lastRouteAttemptSignatureByStream.set(stream.id, routeAttemptSignature);
        const action = linkMode ? 'link' : 'move';
        const line = `[obs-audio-routing] failed to ${action} stream #${stream.id} -> ${targetSinkName}: ${String(error)}`;
        pushOutcome(runtime, 'warning', line);
        sendFeedback(api, runtime, config, 'route', line, `${action}-error:${stream.id}:${targetSinkName}`);
      }
    }

    scheduleTick(config.routing.pollIntervalMs);
  };

  const actions: UserScriptAction[] = [
    {
      id: 'obs-audio-routing.restoreDefaultExclusions',
      title: 'Restore missing default exclusions',
      description:
        'Re-adds shipped default exclusions that are missing, without touching user exclusions or existing default entries.',
      domain: 'obs',
      readOnly: false,
      args: {},
      examples: [{ args: {}, description: 'Restore any missing shipped default exclusions' }],
      invoke: async () => {
        const current = readConfig(api);
        const { nextConfig, added } = restoreMissingDefaultExclusions(current);
        if (added.length === 0) {
          return {
            output: ['[obs-audio-routing] no default exclusions were missing'],
            data: {
              added: [],
              exclusions: current.exclusions,
            },
          };
        }
        await writeConfig(api, nextConfig);
        return {
          output: [
            `[obs-audio-routing] restored ${added.length} missing default exclusion(s)`,
            ...added.map((rule) => `[obs-audio-routing] restored exclusion -> ${formatExclusion(rule)}`),
          ],
          data: {
            added,
            exclusions: nextConfig.exclusions,
          },
        };
      },
    },
    {
      id: 'obs-audio-routing.repairDefaultExclusions',
      title: 'Repair default exclusions in place',
      description:
        'Repairs shipped default exclusions by reserved id, re-adding missing ones and restoring default match/reason fields while preserving the current enabled state.',
      domain: 'obs',
      readOnly: false,
      args: {},
      examples: [{ args: {}, description: 'Repair shipped default exclusions without touching user exclusions' }],
      invoke: async () => {
        const current = readConfig(api);
        const { nextConfig, added, repaired } = repairDefaultExclusions(current);
        if (added.length === 0 && repaired.length === 0) {
          return {
            output: ['[obs-audio-routing] default exclusions already match shipped defaults'],
            data: {
              added: [],
              repaired: [],
              exclusions: current.exclusions,
            },
          };
        }
        await writeConfig(api, nextConfig);
        return {
          output: [
            `[obs-audio-routing] repaired default exclusions (added=${added.length}, repaired=${repaired.length})`,
            ...added.map((rule) => `[obs-audio-routing] added exclusion -> ${formatExclusion(rule)}`),
            ...repaired.map((rule) => `[obs-audio-routing] repaired exclusion -> ${formatExclusion(rule)}`),
          ],
          data: {
            added,
            repaired,
            exclusions: nextConfig.exclusions,
          },
        };
      },
    },
    {
      id: 'obs-audio-routing.status',
      title: 'Show OBS audio routing runtime status',
      description: 'Summarizes support state, current sinks, enabled rules, and recent routing outcomes.',
      domain: 'obs',
      readOnly: true,
      args: {},
      examples: [{ args: {}, description: 'Show current runtime audio-routing status' }],
      invoke: async () => {
        const config = readConfig(api);
        const snapshot = await collectSnapshot();
        const visibleCandidates = [...runtime.candidates.values()].filter((candidate) => candidate.visible);
        const lines = [
          `[obs-audio-routing] enabled -> ${config.enabled}`,
          `[obs-audio-routing] support -> ${snapshot.supportReasons.length === 0 ? 'ok' : snapshot.supportReasons.join('; ')}`,
          `[obs-audio-routing] focused window -> ${snapshot.focusedWindow ? `${snapshot.focusedWindow.class} | ${snapshot.focusedWindow.title}` : '(none)'}`,
          `[obs-audio-routing] sinks -> ${snapshot.sinks.map((sink) => `${sink.name}#${sink.index}`).join(', ') || '(none)'}`,
          `[obs-audio-routing] live audio streams -> ${snapshot.streams.length}`,
          `[obs-audio-routing] streamTargets -> ${config.streamTargets.length}`,
          `[obs-audio-routing] musicTargets -> ${config.musicTargets.length}`,
          `[obs-audio-routing] exclusions -> ${config.exclusions.length}`,
          `[obs-audio-routing] visible candidates -> ${visibleCandidates.length}`,
          `[obs-audio-routing] tracked moved streams -> ${runtime.movedStreams.size}`,
        ];
        for (const outcome of runtime.recentOutcomes.slice(-5)) {
          lines.push(`[obs-audio-routing] recent -> ${outcome.message}`);
        }
        return {
          output: lines,
          data: {
            config,
            focusedWindow: snapshot.focusedWindow,
            sinks: snapshot.sinks,
            streams: snapshot.streams,
            visibleCandidates,
            recentOutcomes: runtime.recentOutcomes.slice(-10),
          },
        };
      },
    },
    {
      id: 'obs-audio-routing.wiring',
      title: 'Show live app-to-sink wiring',
      description:
        'Lists current live playback streams and the audio output sink each app is wired to, so the user can understand the current system routing.',
      domain: 'obs',
      readOnly: true,
      args: {
        wait: DURATION_ARG,
      },
      examples: [
        { args: {}, description: 'Show the current live audio wiring between apps and sinks' },
        { args: { wait: '5s' }, description: 'Wait 5 seconds so you can change focus before sampling wiring' },
      ],
      invoke: async (args) => {
        const waitMs = typeof args.wait === 'string' ? parseWaitDurationMs(args.wait) : 0;
        if (waitMs > 0) {
          await Bun.sleep(waitMs);
        }
        const config = readConfig(api);
        const snapshot = await collectSnapshot();
        const pipewireLinks = await listPipewireLinks().catch(() => new Set<string>());
        if (snapshot.supportReasons.length > 0) {
          return {
            output: [`[obs-audio-routing] unsupported: ${snapshot.supportReasons.join('; ')}`],
            data: {
              supportReasons: snapshot.supportReasons,
            },
          };
        }

        const lines = [
          waitMs > 0 ? `[obs-audio-routing] waited -> ${waitMs}ms` : '',
          `[obs-audio-routing] focused window -> ${snapshot.focusedWindow ? `${snapshot.focusedWindow.class} | ${snapshot.focusedWindow.title}` : '(none)'}`,
          `[obs-audio-routing] sinks -> ${snapshot.sinks.map((sink) => `${sink.name}#${sink.index}`).join(', ') || '(none)'}`,
          `[obs-audio-routing] live audio streams -> ${snapshot.streams.length}`,
        ].filter(Boolean);

        if (snapshot.streams.length === 0) {
          lines.push('[obs-audio-routing] no live playback streams found');
        } else {
          for (const stream of snapshot.streams) {
            const linkedTargetSinks = getLinkedTargetSinksForStream(stream, pipewireLinks);
            lines.push(
              `[obs-audio-routing] wiring -> ${formatLiveStreamWiring(stream, linkedTargetSinks)}`,
            );
          }
        }

        return {
          output: lines,
          data: {
            focusedWindow: snapshot.focusedWindow,
            sinks: snapshot.sinks,
            streams: snapshot.streams,
          },
        };
      },
    },
    {
      id: 'obs-audio-routing.candidates',
      title: 'Show runtime OBS audio routing candidates',
      description: 'Lists in-memory candidate discoveries accumulated during the current runtime session.',
      domain: 'obs',
      readOnly: true,
      args: {},
      examples: [{ args: {}, description: 'List the current runtime routing candidates' }],
      invoke: async () => {
        const visibleCandidates = [...runtime.candidates.values()]
          .filter((candidate) => candidate.visible)
          .sort((left, right) => right.hitCount - left.hitCount);
        if (visibleCandidates.length === 0) {
          return {
            output: ['[obs-audio-routing] no visible runtime candidates yet'],
            data: {
              candidates: [],
            },
          };
        }
        return {
          output: visibleCandidates.map((candidate) => {
            const label = candidate.processBinary || candidate.applicationName || candidate.id;
            return `[obs-audio-routing] candidate ${label} -> ${candidate.suggestedSink ?? 'unknown'} (hits=${candidate.hitCount}, sink=${candidate.observedSink})`;
          }),
          data: {
            candidates: visibleCandidates,
          },
        };
      },
    },
    {
      id: 'obs-audio-routing.search',
      title: 'Search for an app/window/process to route',
      description: 'Searches live audio streams first, then processes and windows, to explain whether routing is possible yet.',
      domain: 'obs',
      readOnly: true,
      args: {
        query: {
          type: 'string',
          required: true,
          minLength: 1,
          maxLength: 200,
        },
      },
      examples: [
        { args: { query: 'cliamp' }, description: 'Search live audio streams and processes for cliamp' },
      ],
      invoke: async (args) => {
        const query = normalizeString(args.query);
        if (!query) {
          throw new Error('Missing required arg: query');
        }
        const snapshot = await collectSnapshot();
        if (snapshot.supportReasons.length > 0) {
          return {
            output: [`[obs-audio-routing] unsupported: ${snapshot.supportReasons.join('; ')}`],
            data: {
              supportReasons: snapshot.supportReasons,
            },
          };
        }

        const streamMatch = snapshot.streams.find((stream) =>
          matchesSearchQuery(query, [
            stream.applicationName,
            stream.applicationProcessBinary,
            stream.derivedBinary,
            stream.mediaName,
            stream.sinkName,
          ]),
        );
        if (streamMatch) {
          return {
            output: [
              `[obs-audio-routing] matched live audio stream: ${streamMatch.applicationName || streamMatch.derivedBinary}`,
              `[obs-audio-routing] current sink -> ${streamMatch.sinkName}`,
              '[obs-audio-routing] routing is possible now because the app is producing audio',
            ],
            data: {
              type: 'stream',
              stream: streamMatch,
              routePossible: true,
            },
          };
        }

        const processTable = await getProcessTable();
        const processMatch = processTable.find((processInfo) =>
          matchesSearchQuery(query, [processInfo.comm, processInfo.args, String(processInfo.pid)]),
        );
        if (processMatch) {
          return {
            output: [
              `[obs-audio-routing] matched process: ${processMatch.comm} (pid=${processMatch.pid})`,
              '[obs-audio-routing] app found, but it is not producing audio yet, so routing is not possible yet',
            ],
            data: {
              type: 'process',
              process: processMatch,
              routePossible: false,
            },
          };
        }

        const windows = await getWindowsForSearch();
        const windowMatch = windows.find((window) =>
          matchesSearchQuery(query, [window.class, window.title, window.matchLabel, String(window.pid)]),
        );
        if (windowMatch) {
          return {
            output: [
              `[obs-audio-routing] matched window: ${windowMatch.class} | ${windowMatch.title}`,
              '[obs-audio-routing] app found, but it is not producing audio yet, so routing is not possible yet',
            ],
            data: {
              type: 'window',
              window: windowMatch,
              routePossible: false,
            },
          };
        }

        return {
          output: [`[obs-audio-routing] no stream, process, or window matched "${query}"`],
          data: {
            type: 'none',
            routePossible: false,
          },
        };
      },
    },
  ];

  for (const action of actions) {
    api.registerAction(action);
  }

  const unsubscribeStreamState = api.obs.subscribeToStreamStateChanges((outputActive) => {
    void (async () => {
      const config = readConfig(api);
      if (outputActive && config.obsStreaming.enableOnStreamStart) {
        await setEnabledPersisted(true, 'obs stream started');
      } else if (!outputActive && config.obsStreaming.disableOnStreamStop) {
        await setEnabledPersisted(false, 'obs stream stopped');
      }
    })();
  });

  const unsubscribeObsStatus = api.obs.subscribeToStatusChanges((connected) => {
    void (async () => {
      const config = readConfig(api);
      if (connected && config.obsStreaming.enableOnObsConnect) {
        await setEnabledPersisted(true, 'obs connected');
      } else if (!connected && config.obsStreaming.disableOnObsDisconnect) {
        await setEnabledPersisted(false, 'obs disconnected');
      }
    })();
  });

  void (async () => {
    const config = readConfig(api);
    if (!config.obsStreaming.enableOnStreamStart && !config.obsStreaming.enableOnObsConnect) return;
    try {
      if (config.obsStreaming.enableOnObsConnect && api.obs.isConnected() && !config.enabled) {
        await setEnabledPersisted(true, 'obs already connected');
        return;
      }
      if (!config.obsStreaming.enableOnStreamStart) return;
      const streamStatus = await api.obs.getStreamStatus();
      if (streamStatus.outputActive && !config.enabled) {
        await setEnabledPersisted(true, 'obs stream already active');
      }
    } catch {
      // Best-effort only; event-driven updates will still apply later.
    }
  })();

  void tick();

  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
    unsubscribeStreamState();
    unsubscribeObsStatus();
  };
}
