import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    // PostHog LLM analytics via OTel span processor (production only).
    // Use dynamic imports so Node-only OTel packages never touch the Edge bundle.
    if (process.env.NODE_ENV === "production") {
      const { resourceFromAttributes } = await import("@opentelemetry/resources");
      const { BasicTracerProvider } = await import("@opentelemetry/sdk-trace-base");
      const { AsyncLocalStorageContextManager } = await import("@opentelemetry/context-async-hooks");
      const { trace, context: otelContext } = await import("@opentelemetry/api");
      const { PostHog } = await import("posthog-node");
      const { PostHogSpanProcessor } = await import("@posthog/ai/otel");

      const key  = process.env.NEXT_PUBLIC_POSTHOG_KEY  ?? "";
      const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com";
      const resource = resourceFromAttributes({ "service.name": "yapscore" });

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
