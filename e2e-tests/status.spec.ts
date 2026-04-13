if (process.env.RUN_PLAYWRIGHT === '1') {
  const { test, expect } = await import('@playwright/test');

  test('api: /api/status returns platform statuses', async ({ request }) => {
    const resp = await request.get('/api/status');
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    // Expect at least youtube/twitch/kick keys
    expect(typeof body).toBe('object');
    expect(body.youtube).toBeDefined();
    expect(body.twitch).toBeDefined();
    expect(body.kick).toBeDefined();
  });
}
