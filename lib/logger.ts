/**
 * Server-side structured logger that emits to PostHog via OpenTelemetry.
 * Falls back to console in development (PostHog provider not registered).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("Agent started", { model: "gemini-2.5-flash", userId });
 *   logger.error("Tool failed", { tool: "writeNotes", error: err.message });
 */

import { logs, SeverityNumber } from "@opentelemetry/api-logs";

type Attrs = Record<string, string | number | boolean | undefined>;

function emit(
  severity: SeverityNumber,
  severityText: string,
  body: string,
  attributes?: Attrs
) {
  const otelLogger = logs.getLogger("yapscore");
  otelLogger.emit({
    body,
    severityNumber: severity,
    severityText,
    attributes: attributes as Record<string, string | number | boolean>,
  });
}

export const logger = {
  debug(body: string, attributes?: Attrs) {
    emit(SeverityNumber.DEBUG, "DEBUG", body, attributes);
  },
  info(body: string, attributes?: Attrs) {
    emit(SeverityNumber.INFO, "INFO", body, attributes);
  },
  warn(body: string, attributes?: Attrs) {
    emit(SeverityNumber.WARN, "WARN", body, attributes);
  },
  error(body: string, attributes?: Attrs) {
    emit(SeverityNumber.ERROR, "ERROR", body, attributes);
  },
};
