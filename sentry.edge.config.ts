import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",

  tracesSampleRate: 0.1,

  enabled: process.env.NODE_ENV !== "development",
});
