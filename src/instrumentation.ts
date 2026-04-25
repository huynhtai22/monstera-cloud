export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // ── New Relic via OpenTelemetry OTLP ──────────────────────────────────────
    // Only initialises when NEW_RELIC_LICENSE_KEY is present (safe to deploy
    // without it during local dev).
    if (process.env.NEW_RELIC_LICENSE_KEY) {
      const { NodeSDK } = await import("@opentelemetry/sdk-node");
      const { OTLPTraceExporter } = await import(
        "@opentelemetry/exporter-trace-otlp-http"
      );
      const { Resource } = await import("@opentelemetry/resources");
      const {
        getNodeAutoInstrumentations,
      } = await import("@opentelemetry/auto-instrumentations-node");

      const sdk = new NodeSDK({
        resource: new Resource({
          "service.name":
            process.env.NEW_RELIC_APP_NAME ?? "monstera-cloud",
          "deployment.environment":
            process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "production",
        }),
        traceExporter: new OTLPTraceExporter({
          // New Relic OTLP ingest endpoint (US datacenter)
          // EU: https://otlp.eu01.nr-data.net:4318/v1/traces
          url: "https://otlp.nr-data.net:4318/v1/traces",
          headers: {
            "api-key": process.env.NEW_RELIC_LICENSE_KEY,
          },
        }),
        instrumentations: [
          getNodeAutoInstrumentations({
            // Reduces noise — file system spans are rarely useful in prod
            "@opentelemetry/instrumentation-fs": { enabled: false },
          }),
        ],
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
