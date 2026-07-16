import { describe, expect, test } from 'bun:test';
import { startPagePoll } from '../src/utils/webChatHeader';

describe('startPagePoll', () => {
  test('does not overlap an async task and stops scheduling after abort', async () => {
    const controller = new AbortController();
    let active = 0;
    let calls = 0;
    let maxActive = 0;

    startPagePoll(
      async () => {
        calls++;
        active++;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(10);
        active--;
      },
      1,
      controller.signal,
    );

    await Bun.sleep(35);
    controller.abort();
    await Bun.sleep(15);
    const callsAfterAbort = calls;
    await Bun.sleep(15);

    expect(calls).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
    expect(calls).toBe(callsAfterAbort);
  });

  test('uses the latest adaptive interval after each completed task', async () => {
    const controller = new AbortController();
    let calls = 0;
    let interval = 1;

    startPagePoll(
      async () => {
        calls++;
        if (calls === 1) interval = 50;
      },
      () => interval,
      controller.signal,
    );

    await Bun.sleep(15);
    controller.abort();
    expect(calls).toBe(1);
  });
});
