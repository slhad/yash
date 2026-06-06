export type HelpSurface = 'tui' | 'api';

export interface HelpCommandEntry {
  command: string;
  description: string;
  usage?: string;
  example?: string;
}

interface SharedHelpEntry {
  command: string;
  surfaces: HelpSurface[];
  description?: string;
  usage?: string;
  example?: string;
  descriptions?: Partial<Record<HelpSurface, string>>;
  usages?: Partial<Record<HelpSurface, string>>;
  examples?: Partial<Record<HelpSurface, string>>;
  tuiExamples?: string[];
}

const HELP_ENTRIES: SharedHelpEntry[] = [
  {
    command: '/help',
    surfaces: ['tui', 'api'],
    description: 'Show available commands',
    usage: '/help',
    example: '/help',
  },
  {
    command: 'status legend',
    surfaces: ['tui', 'api'],
    description:
      'Status symbols: ✓ = authenticated and online, ○ = authenticated but offline, ✗ = not authenticated',
  },
  {
    command: '/connect',
    surfaces: ['tui', 'api'],
    descriptions: {
      tui: 'Authenticate a platform or configure OBS',
      api: 'Authenticate a platform',
    },
    usages: {
      tui: '/connect <youtube|twitch|kick|obs>',
      api: '/connect <youtube|twitch|kick>',
    },
    example: '/connect twitch',
  },
  {
    command: '/stream',
    surfaces: ['tui'],
    description: 'Edit stream info (opens modal, persists to settings)',
    usage: '/stream [platform…]',
  },
  {
    command: '/setup-youtube',
    surfaces: ['tui'],
    description: 'Configure YouTube stream options (playlists, tags, chapters, description)',
    usage: '/setup-youtube',
  },
  {
    command: '/msg',
    surfaces: ['tui', 'api'],
    description: 'Send a message to a specific platform or all',
    usage: '/msg <all|youtube|twitch|kick> <text>',
    example: '/msg all Hello world',
  },
  {
    command: '/marker',
    surfaces: ['tui', 'api'],
    description: 'Place a stream marker on all platforms',
    usage: '/marker [description] [| timestamp]',
    examples: { api: '/marker Replay | -300' },
    tuiExamples: [
      '/marker Intro | 0',
      '/marker Q&A | 3723    (timestamp in seconds, YouTube only)',
      '/marker Boss|32:44  (YouTube: minutes:seconds also works)',
      '/marker Replay|-300  (YouTube: 5 minutes before current live position)',
    ],
  },
  {
    command: '/markers',
    surfaces: ['tui', 'api'],
    description: 'List, restore, edit, or clear YouTube chapters',
    usage:
      '/markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]',
    example: '/markers restore twitch',
    tuiExamples: ['/markers clear 1,2,5'],
  },
  {
    command: '/info',
    surfaces: ['tui'],
    description: 'Show current stream/channel info from all providers',
    usage: '/info',
  },
  {
    command: '/memory',
    surfaces: ['tui', 'api'],
    descriptions: {
      tui: 'Show runtime memory telemetry, open the memory modal, or write a heap snapshot',
      api: 'Show runtime memory and retention telemetry',
    },
    usages: {
      tui: '/memory [modal|snapshot [label]]',
      api: '/memory',
    },
    tuiExamples: [
      '/memory modal  — open the live memory status modal',
      '/memory snapshot before-youtube-rotation  — write a heap snapshot file',
    ],
  },
  {
    command: '/inject',
    surfaces: ['tui'],
    description: 'Inject a fake chat message for offline testing',
    usage: '/inject <twitch|youtube|kick> <username> <message>',
  },
  {
    command: '/chatter',
    surfaces: ['tui'],
    description: 'Open chatter info modal for the most recent message from that user',
    usage: '/chatter <@username>',
  },
  {
    command: '/chat',
    surfaces: ['tui'],
    description: 'Clear matching entries from Chat only',
    usage: '/chat clear <all|messages|events|logs>',
  },
  {
    command: '/activity',
    surfaces: ['tui'],
    description:
      'Open the activity bar modal (follows, subs, cheers, raids); keyboard shortcut: Ctrl+G',
    usage: '/activity',
  },
  {
    command: '/history',
    surfaces: ['tui'],
    description: 'Browse all stream broadcasts and search message history',
    usage: '/history',
    tuiExamples: [
      '/history search <query>  — open history with search pre-filled',
      '/history user <@name>  — search history filtered to a user',
    ],
  },
  {
    command: '/settings',
    surfaces: ['tui', 'api'],
    descriptions: {
      tui: 'Open the settings modal',
      api: 'Get or set a UI setting',
    },
    usages: {
      tui: '/settings',
      api: '/settings get <key> | /settings set <key> <value>',
    },
    example: '/settings set logs.level debug',
    tuiExamples: [
      '/settings get <key>  — get a setting value',
      '/settings set <key> <value>  — set a setting value',
      '/settings set logs.level debug  — set the minimum log level',
    ],
  },
  {
    command: '/scripts',
    surfaces: ['tui', 'api'],
    description: 'List, install, or repair bundled example scripts',
    usage: '/scripts [list|install <example-id> [repair|force] [copy|link]]',
    example: '/scripts install obs-startup repair',
  },
  {
    command: '/logs',
    surfaces: ['tui'],
    description: 'Manage logs',
    usage: '/logs clear | tail <n> | visible <true|false>',
  },
  {
    command: '/exit',
    surfaces: ['tui'],
    description: 'Exit the app',
    usage: '/exit',
  },
];

function valueForSurface(
  entry: SharedHelpEntry,
  surface: HelpSurface,
  key: 'description' | 'usage' | 'example',
): string | undefined {
  if (key === 'description') return entry.descriptions?.[surface] ?? entry.description;
  if (key === 'usage') return entry.usages?.[surface] ?? entry.usage;
  return entry.examples?.[surface] ?? entry.example;
}

export function getHelpCommands(surface: HelpSurface): HelpCommandEntry[] {
  return HELP_ENTRIES.filter((entry) => entry.surfaces.includes(surface)).map((entry) => ({
    command: entry.command,
    description: valueForSurface(entry, surface, 'description') ?? '',
    usage: valueForSurface(entry, surface, 'usage'),
    example: valueForSurface(entry, surface, 'example'),
  }));
}

export function renderTuiHelpLines(): string[] {
  const lines = ['[help] Available commands:'];

  for (const entry of HELP_ENTRIES) {
    if (!entry.surfaces.includes('tui')) continue;

    const description = valueForSurface(entry, 'tui', 'description');
    const usage = valueForSurface(entry, 'tui', 'usage');

    if (entry.command === 'status legend') {
      lines.push(`[help] ${description}`);
      continue;
    }

    if (usage && description) {
      lines.push(`[help]   ${usage}  — ${description}`);
    } else if (usage) {
      lines.push(`[help]   ${usage}`);
    } else if (description) {
      lines.push(`[help]   ${entry.command}  — ${description}`);
    }

    for (const example of entry.tuiExamples ?? []) {
      lines.push(`[help]       e.g.  ${example}`);
    }
  }

  return lines;
}
