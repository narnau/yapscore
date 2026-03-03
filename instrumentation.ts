import * as Sentry from "@sentry/nextjs";
import type { LoggerProvider } from "@opentelemetry/sdk-logs";

// Lazily set in register() — only available in the Node.js runtime.
// Route handlers import this to call forceFlush() via after().
let _loggerProvider: LoggerProvider | null = null;
export function getLoggerProvider(): LoggerProvider | null {
  return _loggerProvider;
}

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // Only send logs in production (POSTHOG_KEY only set there).
    // Use dynamic imports so Node-only OTel packages never touch the Edge bundle.
    if (process.env.NODE_ENV === "production") {
      const { BatchLogRecordProcessor, LoggerProvider } = await import("@opentelemetry/sdk-logs");
      const { OTLPLogExporter } = await import("@opentelemetry/exporter-logs-otlp-http");
      const { logs } = await import("@opentelemetry/api-logs");
      const { resourceFromAttributes } = await import("@opentelemetry/resources");
      const { BasicTracerProvider } = await import("@opentelemetry/sdk-trace-base");
      const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
      const { trace } = await import("@opentelemetry/api");
      const { PostHog } = await import("posthog-node");
      const { PostHogSpanProcessor } = await import("@posthog/ai/otel");

      const key  = process.env.NEXT_PUBLIC_POSTHOG_KEY  ?? "";
      const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
      const resource = resourceFromAttributes({ "service.name": "yapscore" });

      // ── Logs (OTLP → PostHog) ────────────────────────────────────────────
      _loggerProvider = new LoggerProvider({
        resource,
        processors: [
          new BatchLogRecordProcessor(
            new OTLPLogExporter({
              url: `${host}/i/v1/logs`,
              headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
            })
          ),
        ],
      });
      logs.setGlobalLoggerProvider(_loggerProvider);

      // ── Traces (PostHog AI / LLM analytics) ─────────────────────────────
      const { context: otelContext } = await import("@opentelemetry/api");
      const phClient = new PostHog(key, { host, flushAt: 1, flushInterval: 0 });
      const tracerProvider = new BasicTracerProvider({
        resource,
        spanProcessors: [new PostHogSpanProcessor(phClient)],
      });
      const contextManager = new AsyncLocalStorageContextManager();
      contextManager.enable();
      otelContext.setGlobalContextManager(contextManager);
      trace.setGlobalTracerProvider(tracerProvider);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
