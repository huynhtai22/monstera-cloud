import * as Sentry from "@sentry/nextjs";
async function validateRuntimeSecrets() {
  if (process.env.NODE_ENV !== "production") return;
  // Only secrets required by every server route are startup-fatal. Optional
  // integrations validate their own secrets and fail closed at the endpoint.
  const required = ["DATABASE_URL", "NEXTAUTH_SECRET", "ENCRYPTION_KEY"] as const;
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(", ")}`);
  if ((process.env.NEXTAUTH_SECRET?.length ?? 0) < 32) throw new Error("NEXTAUTH_SECRET must be at least 32 characters");
  if (!/^[0-9a-f]{64}$/i.test(process.env.ENCRYPTION_KEY ?? "")) {
    throw new Error("ENCRYPTION_KEY must be exactly 64 hexadecimal characters (32 bytes)");
  }
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await validateRuntimeSecrets();
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
