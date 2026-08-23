export type RedisRuntimeEnv = {
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
};

export type RedisConfig = {
  url: string;
  token: string;
};

const VERCEL_SENSITIVE_PLACEHOLDER = "[SENSITIVE]";

/** Resolve usable Upstash credentials without exposing or constructing a client. */
export function resolveRedisConfig(
  env: RedisRuntimeEnv = process.env as RedisRuntimeEnv,
): RedisConfig | null {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

  if (
    !url ||
    !token ||
    url === VERCEL_SENSITIVE_PLACEHOLDER ||
    token === VERCEL_SENSITIVE_PLACEHOLDER
  ) {
    return null;
  }

  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }

  return { url, token };
}
