export type PaddleJsEnvironment = "sandbox" | "production";

/** Mirror server-side paddleEnvironment() for Paddle.js overlay checkout. */
export function getPaddleJsEnvironment(): PaddleJsEnvironment {
  const env = (process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT || "").toLowerCase();
  if (env === "production") return "production";
  if (env === "sandbox") return "sandbox";
  if (process.env.NEXT_PUBLIC_VERCEL_ENV === "production") return "production";
  return "sandbox";
}

export function getPaddleClientToken(): string {
  return (process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || "").trim();
}

export function paddleClientTokenMatchesEnvironment(
  token: string,
  environment: PaddleJsEnvironment
): boolean {
  if (environment === "production") return token.startsWith("live_");
  return token.startsWith("test_");
}
