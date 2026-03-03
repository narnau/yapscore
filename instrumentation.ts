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

      _loggerProvider = new LoggerProvider({
        resource: resourceFromAttributes({ "service.name": "yapscore" }),
        processors: [
          new BatchLogRecordProcessor(
            new OTLPLogExporter({
              url: `${process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com"}/i/v1/logs`,
              headers: {
                Authorization: `Bearer ${process.env.NEXT_PUBLIC_POSTHOG_KEY ?? ""}`,
                "Content-Type": "application/json",
              },
            })
          ),
        ],
      });

      logs.setGlobalLoggerProvider(_loggerProvider);
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
