export async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number = 20000,
  intervalMs: number = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (e) {
      // ignore predicate errors while waiting
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor: timed out after ${timeoutMs}ms`);
}
