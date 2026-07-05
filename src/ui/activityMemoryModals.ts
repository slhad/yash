import {
  BoxRenderable,
  type CliRenderer,
  fg,
  ScrollBoxRenderable,
  StyledText,
  TextAttributes,
  TextRenderable,
} from '@opentui/core';
import type { ChatMessage } from '../platforms/base';
import { buildMemoryInsightSummary, readMemoryStatusSettings } from '../utils/memoryStatus';
import type { RuntimeStatusSnapshot } from '../utils/runtime-monitor';
import { getMemoryInsightToneColor } from '../utils/tuiStatusPresentation';

export interface ActivityEvent {
  ts: number;
  platform: string;
  type: string;
  message: string;
  userId?: string;
  username?: string;
  sessionId?: string;
}

export type ActivityModalState = { box: BoxRenderable; close: () => void };
export type MemoryModalState = { box: BoxRenderable };

export const ACTIVITY_MAX_VISIBLE = 5;

export function activityPlatformColor(platform: string): string {
  if (platform === 'twitch') return '#9146FF';
  if (platform === 'youtube') return '#FF0000';
  if (platform === 'kick') return '#53FC18';
  return 'gray';
}

export function toActivityChatterMessage(event: ActivityEvent): ChatMessage | null {
  if (!event.username) return null;
  return {
    id: `activity_${event.platform}_${event.userId ?? event.username}_${event.ts}`,
    platform: event.platform,
    userId: event.userId ?? event.username,
    username: event.username,
    message: event.message,
    timestamp: event.ts,
  };
}

export function updateActivityBarText(
  node: TextRenderable,
  options: {
    mode: string;
    activityEvents: ActivityEvent[];
    timedVisibleEvents: ActivityEvent[];
  },
): void {
  const source = options.mode === 'timed' ? options.timedVisibleEvents : options.activityEvents;
  if (source.length === 0) {
    node.content = 'No events yet';
    node.fg = 'gray';
    return;
  }
  node.fg = 'white';
  const recent = source.slice(-ACTIVITY_MAX_VISIBLE);
  const parts: ReturnType<ReturnType<typeof fg>>[] = [];
  for (let i = 0; i < recent.length; i++) {
    const ev = recent[i]!;
    if (i > 0) parts.push(fg('gray')('  │  '));
    parts.push(fg(activityPlatformColor(ev.platform))(ev.message));
  }
  if (source.length > ACTIVITY_MAX_VISIBLE) {
    parts.push(fg('gray')(` … +${source.length - ACTIVITY_MAX_VISIBLE} older`));
  }
  node.content = new StyledText(parts);
}

export function openActivityEventsModal(ctx: {
  renderer: CliRenderer;
  canOpen: () => boolean;
  getActiveActivityModal: () => ActivityModalState | null;
  setActiveActivityModal: (modal: ActivityModalState | null) => void;
  activityEvents: ActivityEvent[];
  focusMainInput: () => void;
  openChatterInfoModal: (msg: ChatMessage) => void;
  appendError: (message: string) => void;
}): void {
  try {
    if (!ctx.canOpen()) return;
    const { renderer } = ctx;

    const box = new BoxRenderable(renderer, {
      position: 'absolute',
      top: '5%',
      left: '5%',
      width: '90%',
      height: '72%',
      zIndex: 110,
      border: true,
      borderStyle: 'rounded',
      borderColor: 'yellow',
      backgroundColor: 'black',
      shouldFill: true,
      padding: 1,
      flexDirection: 'column',
      gap: 0,
      title: ' Activity Events ',
    });

    box.add(new TextRenderable(renderer, { content: '  ↑↓ scroll  •  Esc close', fg: 'gray' }));

    const scroll = new ScrollBoxRenderable(renderer, {
      flexGrow: 1,
      stickyScroll: false,
      stickyStart: 'bottom',
    });

    const events = [...ctx.activityEvents].reverse();
    if (events.length === 0) {
      scroll.add(
        new TextRenderable(renderer, { content: '  No activity events yet.', fg: 'gray' }),
      );
    } else {
      for (const ev of events) {
        const time = new Date(ev.ts).toLocaleTimeString();
        const row = new BoxRenderable(renderer, { flexDirection: 'row', width: '100%' });
        row.add(new TextRenderable(renderer, { content: `  [${time}] `, fg: 'gray' }));
        row.add(
          new TextRenderable(renderer, {
            content: `[${ev.platform}] ${ev.type}: `,
            fg: activityPlatformColor(ev.platform),
          }),
        );
        const activityMessage = toActivityChatterMessage(ev);
        if (activityMessage) {
          const prefix = `${ev.username} `;
          const suffix = ev.message.startsWith(prefix)
            ? ev.message.slice(prefix.length)
            : ev.message;
          const usernameNode = new TextRenderable(renderer, {
            content: ev.username,
            fg: activityPlatformColor(ev.platform),
            attributes: TextAttributes.UNDERLINE,
          });
          usernameNode.onMouseDown = (e) => {
            if (e.button !== 0) return;
            ctx.getActiveActivityModal()?.close();
            ctx.openChatterInfoModal(activityMessage);
          };
          row.add(usernameNode);
          row.add(
            new TextRenderable(renderer, {
              content: suffix ? ` ${suffix}` : '',
              fg: activityPlatformColor(ev.platform),
            }),
          );
        } else {
          row.add(
            new TextRenderable(renderer, {
              content: ev.message,
              fg: activityPlatformColor(ev.platform),
            }),
          );
        }
        scroll.add(row);
      }
    }

    box.add(scroll);
    renderer.root.add(box);
    const keyHandler = (sequence: string): boolean => {
      if (!ctx.getActiveActivityModal()) return false;
      if (sequence === '\x1b' || sequence === '\x1b\x1b') {
        ctx.getActiveActivityModal()?.close();
        return true;
      }
      if (sequence === '\x1b[A') {
        scroll.scrollBy(-1);
        return true;
      }
      if (sequence === '\x1b[B') {
        scroll.scrollBy(1);
        return true;
      }
      return false;
    };
    const close = (): void => {
      if (!ctx.getActiveActivityModal()) return;
      renderer.removeInputHandler(keyHandler);
      renderer.root.remove(box.id);
      ctx.setActiveActivityModal(null);
      ctx.focusMainInput();
    };
    ctx.setActiveActivityModal({ box, close });
    renderer.prependInputHandler(keyHandler);
  } catch (err) {
    ctx.appendError(`[system] Failed to open activity modal: ${String(err)}`);
  }
}

export function openMemoryStatusModal(ctx: {
  renderer: CliRenderer;
  canOpen: () => boolean;
  getActiveMemoryModal: () => MemoryModalState | null;
  setActiveMemoryModal: (modal: MemoryModalState | null) => void;
  getSetting: (key: string, fallback: unknown) => unknown;
  getRuntimeStatus: () => RuntimeStatusSnapshot;
  focusMainInput: () => void;
}): void {
  if (!ctx.canOpen()) return;

  const memorySettings = readMemoryStatusSettings((key, fallback) => ctx.getSetting(key, fallback));
  if (!memorySettings.visible) return;

  const insight = buildMemoryInsightSummary(ctx.getRuntimeStatus(), memorySettings);
  const { renderer } = ctx;
  const statusColor =
    insight.statusLevel === 'green'
      ? 'green'
      : insight.statusLevel === 'yellow'
        ? 'yellow'
        : insight.statusLevel === 'orange'
          ? '#f97316'
          : 'red';

  const box = new BoxRenderable(renderer, {
    position: 'absolute',
    top: '8%',
    left: '6%',
    width: '88%',
    height: '72%',
    zIndex: 110,
    border: true,
    borderStyle: 'rounded',
    borderColor: statusColor,
    backgroundColor: 'black',
    shouldFill: true,
    padding: 1,
    flexDirection: 'column',
    gap: 0,
    title: ` Memory Status ${insight.title} `,
  });

  box.add(
    new TextRenderable(renderer, {
      content: `  ${insight.statusText}  •  ↑↓ scroll  •  Esc close`,
      fg: statusColor,
      attributes: TextAttributes.BOLD,
    }),
  );
  box.add(new TextRenderable(renderer, { content: '', fg: 'gray' }));

  const scroll = new ScrollBoxRenderable(renderer, {
    flexGrow: 1,
    stickyScroll: false,
    stickyStart: 'top',
  });

  for (const line of insight.lines) {
    scroll.add(
      new TextRenderable(renderer, {
        content: `  ${line.text}`,
        fg: getMemoryInsightToneColor(line.tone),
      }),
    );
  }

  box.add(scroll);
  renderer.root.add(box);
  ctx.setActiveMemoryModal({ box });

  const keyHandler = (sequence: string): boolean => {
    if (!ctx.getActiveMemoryModal()) return false;
    if (sequence === '\x1b' || sequence === '\x1b\x1b') {
      renderer.removeInputHandler(keyHandler);
      renderer.root.remove(box.id);
      ctx.setActiveMemoryModal(null);
      ctx.focusMainInput();
      return true;
    }
    if (sequence === '\x1b[A') {
      scroll.scrollBy(-1);
      return true;
    }
    if (sequence === '\x1b[B') {
      scroll.scrollBy(1);
      return true;
    }
    return false;
  };

  renderer.prependInputHandler(keyHandler);
}
