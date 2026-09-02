export const chunk = (items, size) => {
  const chunks = [];

  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }

  return chunks;
};

// A rolling pool: `limit` workers pull from a shared cursor until the list is
// exhausted, so a slow item holds up only its own worker. Reading and advancing
// the cursor happens between awaits, which on a single thread is atomic — no two
// workers can take the same index.
export const runWithConcurrency = async (items, limit, worker) => {
  let cursor = 0;

  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index], index);
      }
    },
  );

  await Promise.all(workers);
};

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
