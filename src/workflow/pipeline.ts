type AgentThunk = () => Promise<unknown>;
type StageFn = (prev: unknown, original: unknown, index: number) => Promise<unknown>;

export async function parallel(thunks: AgentThunk[]): Promise<unknown[]> {
  const results = await Promise.allSettled(thunks.map((t) => t()));
  return results.map((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    const reason = r.reason;
    throw new Error(`parallel thunk[${i}] failed: ${reason instanceof Error ? reason.message : String(reason)}`);
  });
}

export async function pipeline<T>(
  items: T[],
  ...stages: StageFn[]
): Promise<unknown[]> {
  const thunks = items.map((item, idx) => async () => {
    let prev: unknown = null;
    for (const stage of stages) {
      prev = await stage(prev, item, idx);
    }
    return prev;
  });

  return parallel(thunks);
}
