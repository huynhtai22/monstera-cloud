import * as Sentry from "@sentry/nextjs";

// Client-side Sentry initialization (replaces legacy sentry.client.config.ts)
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",

  // Capture 10% of traces for performance monitoring (keeps quota low)
  tracesSampleRate: 0.1,

  // Replay: capture 5% of sessions normally, 100% of sessions with errors
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,

  integrations: [Sentry.replayIntegration()],

  // Don't capture errors in local development to avoid noise
  enabled: process.env.NODE_ENV !== "development",
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
