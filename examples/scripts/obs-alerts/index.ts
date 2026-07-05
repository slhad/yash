import type {
  ScriptActivityEvent,
  ScriptApi,
  UserScriptAction,
  UserScriptArgSchema,
  UserScriptDefinition,
} from './types';

const SCRIPT_ID = 'obs-alerts';
const ACTION_PREFIX = 'obs.alerts';
const VALID_PLATFORMS = ['twitch', 'kick', 'youtube'] as const;
const DEFAULT_TEXT_TEMPLATE = '{user}';

type AlertPlatform = (typeof VALID_PLATFORMS)[number];

type AlertRule = {
  id: string;
  enabled: boolean;
  platform: AlertPlatform;
  types: string[];
  scene: string;
  /** Legacy/simple source used for both text and visibility when split targets are omitted. */
  source?: string;
  textSource: string;
  showSource: string;
  textTemplate: string;
};

type ObsAlertsConfig = {
  enabled: boolean;
  paused: boolean;
  rules: AlertRule[];
};

export const scriptDefinition = {
  actionPrefix: ACTION_PREFIX,
  title: 'OBS Alerts',
} satisfies UserScriptDefinition;

const PLATFORM_ARG = {
  type: 'enum',
  required: true,
  values: [...VALID_PLATFORMS],
} as const satisfies UserScriptArgSchema;

const TYPES_ARG = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'activity.types',
    params: {
      valueMode: 'csv',
      platformArg: 'platform',
    },
  },
} as const satisfies UserScriptArgSchema;

const SCENE_ARG = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'obs.scenes',
  },
} as const satisfies UserScriptArgSchema;

const SOURCE_ARG = {
  type: 'string',
  required: false,
  minLength: 1,
  maxLength: 200,
  autocomplete: {
    type: 'provider',
    providerId: 'obs.sceneSources',
    params: {
      sceneArg: 'scene',
      useCurrentSceneByDefault: false,
      includeQualifiedRefs: false,
    },
  },
} as const satisfies UserScriptArgSchema;

const ID_ARG = {
  type: 'string',
  required: true,
  minLength: 1,
  maxLength: 80,
} as const satisfies UserScriptArgSchema;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePlatform(value: unknown): AlertPlatform | null {
  const platform = normalizeString(value).toLowerCase();
  return VALID_PLATFORMS.includes(platform as AlertPlatform) ? (platform as AlertPlatform) : null;
}

function normalizeTypes(value: unknown): string[] {
  const values = Array.isArray(value) ? value : String(value ?? '').split(',');
  return values
    .map((item) => normalizeString(item).toLowerCase())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function normalizeRule(value: unknown): AlertRule | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = normalizeString(record.id);
  const platform = normalizePlatform(record.platform);
  const types = normalizeTypes(record.types);
  const scene = normalizeString(record.scene);
  const source = normalizeString(record.source);
  const textSource = normalizeString(record.textSource) || source;
  const showSource = normalizeString(record.showSource) || source;
  if (!id || !platform || types.length === 0 || !scene || !textSource || !showSource) return null;

  return {
    id,
    enabled: normalizeBoolean(record.enabled, true),
    platform,
    types,
    scene,
    source: source || undefined,
    textSource,
    showSource,
    textTemplate: normalizeString(record.textTemplate) || DEFAULT_TEXT_TEMPLATE,
  };
}

function readConfig(api: ScriptApi): ObsAlertsConfig {
  const rawRules = api.settings.get<unknown[]>('rules', []);
  return {
    enabled: normalizeBoolean(api.settings.get('enabled', true), true),
    paused: normalizeBoolean(api.settings.get('paused', false), false),
    rules: Array.isArray(rawRules)
      ? rawRules.map(normalizeRule).filter((r): r is AlertRule => Boolean(r))
      : [],
  };
}

async function writeRules(api: ScriptApi, rules: AlertRule[]): Promise<void> {
  await api.settings.set('rules', rules);
}

function renderTemplate(template: string, event: ScriptActivityEvent): string {
  const user = normalizeString(event.username) || 'someone';
  return template
    .replace(/\{user\}/g, user)
    .replace(/\{username\}/g, user)
    .replace(/\{platform\}/g, event.platform)
    .replace(/\{type\}/g, event.type)
    .replace(/\{message\}/g, event.message ?? '');
}

async function fireRule(
  api: ScriptApi,
  rule: AlertRule,
  event: ScriptActivityEvent,
): Promise<void> {
  if (!api.obs.isConnected()) {
    api.logger.warn(`[obs-alerts] OBS is not connected; skipped rule "${rule.id}"`);
    api.feedback.event('warning', `OBS not connected; skipped ${rule.id}`);
    return;
  }

  try {
    const sceneItemId = await api.obs.getSceneItemId(rule.scene, rule.showSource);
    const text = renderTemplate(rule.textTemplate, event);
    await api.obs.setInputSettings(rule.textSource, { text });
    await api.obs.setSceneItemEnabled(rule.scene, sceneItemId, true);
    api.feedback.event(
      'alert',
      `${rule.id}: ${event.platform}/${event.type} → text=${rule.textSource} show=${rule.scene}.${rule.showSource}`,
    );
  } catch (err) {
    api.logger.warn(`[obs-alerts] failed rule "${rule.id}": ${String(err)}`);
    api.feedback.event('warning', `failed ${rule.id}: ${String(err)}`);
  }
}

function matchingRules(config: ObsAlertsConfig, event: ScriptActivityEvent): AlertRule[] {
  if (!config.enabled || config.paused) return [];
  const eventType = normalizeString(event.type).toLowerCase();
  return config.rules.filter(
    (rule) => rule.enabled && rule.platform === event.platform && rule.types.includes(eventType),
  );
}

function buildRuleFromArgs(args: Record<string, unknown>): AlertRule {
  const id = normalizeString(args.id);
  const platform = normalizePlatform(args.platform);
  const types = normalizeTypes(args.types);
  const scene = normalizeString(args.scene);
  const source = normalizeString(args.source);
  const textSource = normalizeString(args.textSource) || source;
  const showSource = normalizeString(args.showSource) || source;
  if (!id) throw new Error('id is required');
  if (!platform) throw new Error('platform must be twitch, kick, or youtube');
  if (types.length === 0) throw new Error('types must contain at least one event type');
  if (!scene) throw new Error('scene is required');
  if (!textSource) throw new Error('textSource is required unless source is provided');
  if (!showSource) throw new Error('showSource is required unless source is provided');
  return {
    id,
    enabled: normalizeBoolean(args.enabled, true),
    platform,
    types,
    scene,
    source: source || undefined,
    textSource,
    showSource,
    textTemplate: normalizeString(args.textTemplate) || DEFAULT_TEXT_TEMPLATE,
  };
}

function getDataDir(): string {
  return (
    process.env.YASH_DATA_DIR ||
    `${process.env.XDG_CONFIG_HOME || `${process.env.HOME || '.'}/.config`}/yash`
  );
}

function getConfigPath(): string {
  return `${getDataDir()}/scripts/${SCRIPT_ID}/config.jsonc`;
}

export default function setup(api: ScriptApi): () => void {
  const unsubscribe = api.activity.subscribe((event) => {
    const config = readConfig(api);
    for (const rule of matchingRules(config, event)) {
      void fireRule(api, rule, event);
    }
  });

  const actions: UserScriptAction[] = [
    {
      id: `${ACTION_PREFIX}.list`,
      title: 'List OBS alert rules',
      description: 'Lists configured Twitch/Kick/YouTube activity alert rules.',
      domain: 'obs',
      readOnly: true,
      invoke: async () => {
        const config = readConfig(api);
        const lines = [
          `[obs-alerts] enabled=${config.enabled} paused=${config.paused} rules=${config.rules.length}`,
        ];
        for (const rule of config.rules) {
          lines.push(
            `[obs-alerts] ${rule.enabled ? 'on ' : 'off'} ${rule.id}: ${rule.platform}:${rule.types.join(',')} → text=${rule.textSource} show=${rule.scene}.${rule.showSource} template=${JSON.stringify(rule.textTemplate)}`,
          );
        }
        if (config.rules.length === 0)
          lines.push(`[obs-alerts] no rules yet; add one with /action ${ACTION_PREFIX}.add ...`);
        return { output: lines, data: { config } };
      },
    },
    {
      id: `${ACTION_PREFIX}.add`,
      title: 'Add an OBS alert rule',
      description: `Adds a rule to ${getConfigPath()}. Use replace=true to update an existing id.`,
      domain: 'obs',
      readOnly: false,
      args: {
        id: ID_ARG,
        platform: PLATFORM_ARG,
        types: TYPES_ARG,
        scene: SCENE_ARG,
        source: SOURCE_ARG,
        textSource: SOURCE_ARG,
        showSource: SOURCE_ARG,
        textTemplate: { type: 'string', required: false, minLength: 1, maxLength: 300 },
        enabled: { type: 'boolean', required: false },
        replace: { type: 'boolean', required: false },
      },
      examples: [
        {
          args: {
            id: 'twitch-follow',
            platform: 'twitch',
            types: 'follow',
            scene: 'Alerts',
            textSource: 'Follower Text',
            showSource: 'Follower Animation',
          },
          description: 'Set Follower Text and show Follower Animation when a Twitch follow arrives',
        },
      ],
      invoke: async (args) => {
        const rule = buildRuleFromArgs(args);
        const replace = normalizeBoolean(args.replace, false);
        const config = readConfig(api);
        const existingIndex = config.rules.findIndex((candidate) => candidate.id === rule.id);
        if (existingIndex >= 0 && !replace) {
          throw new Error(`Rule "${rule.id}" already exists; pass replace=true to update it`);
        }
        const nextRules = [...config.rules];
        if (existingIndex >= 0) nextRules[existingIndex] = rule;
        else nextRules.push(rule);
        await writeRules(api, nextRules);
        return {
          output: [`[obs-alerts] ${existingIndex >= 0 ? 'updated' : 'added'} ${rule.id}`],
          data: { rule },
        };
      },
    },
    {
      id: `${ACTION_PREFIX}.remove`,
      title: 'Remove an OBS alert rule',
      description: 'Removes a configured alert rule by id.',
      domain: 'obs',
      readOnly: false,
      args: { id: ID_ARG },
      invoke: async (args) => {
        const id = normalizeString(args.id);
        const config = readConfig(api);
        const nextRules = config.rules.filter((rule) => rule.id !== id);
        if (nextRules.length === config.rules.length) throw new Error(`Rule "${id}" not found`);
        await writeRules(api, nextRules);
        return { output: [`[obs-alerts] removed ${id}`], data: { id } };
      },
    },
    {
      id: `${ACTION_PREFIX}.enable`,
      title: 'Enable or disable an OBS alert rule',
      description: 'Toggles a configured alert rule by id.',
      domain: 'obs',
      readOnly: false,
      args: { id: ID_ARG, enabled: { type: 'boolean', required: true } },
      invoke: async (args) => {
        const id = normalizeString(args.id);
        const enabled = normalizeBoolean(args.enabled, true);
        const config = readConfig(api);
        let found = false;
        const nextRules = config.rules.map((rule) => {
          if (rule.id !== id) return rule;
          found = true;
          return { ...rule, enabled };
        });
        if (!found) throw new Error(`Rule "${id}" not found`);
        await writeRules(api, nextRules);
        return { output: [`[obs-alerts] ${id} enabled=${enabled}`], data: { id, enabled } };
      },
    },
    {
      id: `${ACTION_PREFIX}.pause`,
      title: 'Pause OBS alerts',
      description: 'Temporarily stops activity events from firing alert rules.',
      domain: 'obs',
      readOnly: false,
      invoke: async () => {
        await api.settings.set('paused', true);
        return { output: ['[obs-alerts] paused'] };
      },
    },
    {
      id: `${ACTION_PREFIX}.resume`,
      title: 'Resume OBS alerts',
      description: 'Resumes activity-event alert rules.',
      domain: 'obs',
      readOnly: false,
      invoke: async () => {
        await api.settings.set('paused', false);
        return { output: ['[obs-alerts] resumed'] };
      },
    },
    {
      id: `${ACTION_PREFIX}.status`,
      title: 'Show OBS alerts status',
      description: 'Shows enabled, paused, and rule count.',
      domain: 'obs',
      readOnly: true,
      invoke: async () => {
        const config = readConfig(api);
        return {
          output: [
            `[obs-alerts] enabled=${config.enabled} paused=${config.paused} rules=${config.rules.length}`,
          ],
          data: { config },
        };
      },
    },
    {
      id: `${ACTION_PREFIX}.test`,
      title: 'Test an OBS alert rule',
      description: 'Fires a configured rule manually with a fake user/event.',
      domain: 'obs',
      readOnly: false,
      args: {
        id: ID_ARG,
        user: { type: 'string', required: false, minLength: 1, maxLength: 100 },
        platform: { type: 'enum', required: false, values: [...VALID_PLATFORMS] },
        type: {
          type: 'string',
          required: false,
          minLength: 1,
          maxLength: 100,
          autocomplete: {
            type: 'provider',
            providerId: 'activity.types',
            params: { platformArg: 'platform' },
          },
        },
        message: { type: 'string', required: false, minLength: 1, maxLength: 300 },
      },
      invoke: async (args) => {
        const id = normalizeString(args.id);
        const config = readConfig(api);
        const rule = config.rules.find((candidate) => candidate.id === id);
        if (!rule) throw new Error(`Rule "${id}" not found`);
        const event: ScriptActivityEvent = {
          platform: normalizePlatform(args.platform) ?? rule.platform,
          type: normalizeString(args.type) || rule.types[0] || 'test',
          username: normalizeString(args.user) || 'TestUser',
          message: normalizeString(args.message) || 'Test activity event',
        };
        await fireRule(api, rule, event);
        return {
          output: [`[obs-alerts] tested ${id} with ${event.username}`],
          data: { rule, event },
        };
      },
    },
  ];

  for (const action of actions) api.registerAction(action);

  return unsubscribe;
}
