/**
 * Bounded-concurrency map. Higgsfield concurrency starts at 2 (HF_CONCURRENCY)
 * so a full week's fill does not stampede the API.
 */
export async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

export function hfConcurrency(): number {
  const n = Number.parseInt(process.env.HF_CONCURRENCY ?? "2", 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}
