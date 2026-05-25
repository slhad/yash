import { describe, expect, test } from 'bun:test';
import { getHelpCommands, renderTuiHelpLines } from '../src/utils/help';

describe('shared help metadata', () => {
  test('api help includes shared command docs from one source', () => {
    const commands = getHelpCommands('api');
    expect(commands.find((entry) => entry.command === '/marker')).toMatchObject({
      usage: '/marker [description] [| timestamp]',
      example: '/marker Replay | -300',
    });
    expect(commands.find((entry) => entry.command === '/markers')).toMatchObject({
      usage:
        '/markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]',
      example: '/markers restore twitch',
    });
    expect(commands.find((entry) => entry.command === '/connect')).toMatchObject({
      usage: '/connect <youtube|twitch|kick>',
    });
    expect(commands.find((entry) => entry.command === '/scripts')).toMatchObject({
      usage: '/scripts [list|install <example-id>]',
      example: '/scripts install obs-startup',
    });
  });

  test('tui help renders shared lines including tui-only commands', () => {
    const lines = renderTuiHelpLines();
    expect(lines[0]).toBe('[help] Available commands:');
    expect(lines).toContain(
      '[help]   /connect <youtube|twitch|kick|obs>  — Authenticate a platform or configure OBS',
    );
    expect(lines).toContain(
      '[help]   /stream [platform…]  — Edit stream info (opens modal, persists to settings)',
    );
    expect(lines).toContain(
      '[help]       e.g.  /marker Replay|-300  (YouTube: 5 minutes before current live position)',
    );
    expect(lines).toContain(
      '[help]   /markers restore twitch [limit] | clear [all|ids] | edit <id> | [all|youtube|twitch|kick] [limit]  — List, restore, edit, or clear YouTube chapters',
    );
    expect(lines).toContain(
      '[help]   /scripts [list|install <example-id>]  — List or install bundled example scripts',
    );
  });
});
