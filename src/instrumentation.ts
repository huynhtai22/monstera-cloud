import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ── New Relic via OpenTelemetry OTLP ──────────────────────────────────────
    // Only initialises when NEW_RELIC_LICENSE_KEY is present (safe to deploy
    // without it during local dev).
    //
    // Uses SimpleSpanProcessor instead of the default BatchSpanProcessor so
    // traces are exported immediately — BatchSpanProcessor buffers and flushes
    // in the background, which is lost when Vercel serverless functions exit.
    if (process.env.NEW_RELIC_LICENSE_KEY) {
      try {
        const { NodeSDK } = await import("@opentelemetry/sdk-node");
        const { OTLPTraceExporter } = await import(
          "@opentelemetry/exporter-trace-otlp-http"
        );
        const { resourceFromAttributes } = await import(
          "@opentelemetry/resources"
        );
        const { SimpleSpanProcessor } = await import(
          "@opentelemetry/sdk-trace-base"
        );

        const exporter = new OTLPTraceExporter({
          // New Relic OTLP ingest endpoint (US datacenter)
          // EU accounts: https://otlp.eu01.nr-data.net:4318/v1/traces
          url: "https://otlp.nr-data.net:4318/v1/traces",
          headers: {
            "api-key": process.env.NEW_RELIC_LICENSE_KEY,
          },
        });

        const sdk = new NodeSDK({
          resource: resourceFromAttributes({
            "service.name": process.env.NEW_RELIC_APP_NAME ?? "monstera-cloud",
            "deployment.environment":
              process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production",
          }),
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        });

        sdk.start();
        console.log("[OTel] New Relic tracing started");
      } catch (err) {
        // Non-fatal — observability failure must never break the app
        console.error("[OTel] Failed to start New Relic tracing:", err);
      }
    }

    // ── Sentry (errors + replays) ─────────────────────────────────────────────
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

// Next.js App Router hook for capturing request errors (Sentry SDK expects this export).
export const onRequestError = Sentry.captureRequestError;
