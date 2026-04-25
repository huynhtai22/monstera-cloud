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
      const { NodeSDK } = await import("@opentelemetry/sdk-node");
      const { OTLPTraceExporter } = await import(
        "@opentelemetry/exporter-trace-otlp-http"
      );
      const { Resource } = await import("@opentelemetry/resources");
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
        resource: new Resource({
          "service.name": process.env.NEW_RELIC_APP_NAME ?? "monstera-cloud",
          "deployment.environment":
            process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production",
        }),
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      });

      sdk.start();
    }

    // ── Sentry (errors + replays) ─────────────────────────────────────────────
    await import("../sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}
