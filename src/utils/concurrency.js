export const chunk = (items, size) => {
  // Two different faults, and only the first is the loud one.
  //
  // A size of 0 or less never advances the cursor below, so the loop runs
  // forever: the process hangs with no error, no log and nothing to grep for.
  //
  // A fractional size terminates, and is refused for a different reason. It
  // loses nothing and duplicates nothing — `slice` truncates its arguments —
  // but the groups come out uneven, and below 1 it emits empty ones:
  // `chunk([1..6], 2.5)` is `[[1,2],[3,4,5],[6]]` and `0.5` gives six empty
  // groups interleaved with the items. For a batch send that is a batch of
  // zero addresses and batches that are not BATCH_SIZE.
  //
  // Throwing rather than returning [] is deliberate. The only caller is the
  // bulk invitation send, and an empty list of batches there would send nothing
  // and report the job finished. A silent success is worse than a hang, and a
  // TypeError here reaches errorHandler without a statusCode, so the caller
  // gets a generic 500 and the whole thing is logged.
  if (!Number.isInteger(size) || size < 1)
    throw new TypeError(`chunk size must be a positive integer, received ${size}`);

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
