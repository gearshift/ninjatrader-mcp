import path from "path";

export function resolveDataPath(
  env: NodeJS.ProcessEnv,
  repoRoot: string,
  pid: number = process.pid,
): string {
  const base = env.NT_DATA_PATH
    ? path.resolve(env.NT_DATA_PATH)
    : path.join(repoRoot, "data");

  if (!env.VITEST) return base;

  const worker = env.VITEST_POOL_ID ?? env.VITEST_WORKER_ID ?? "0";
  return path.join(base, `vitest-${pid}-${worker}`);
}
