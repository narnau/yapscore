// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://656475760c31e0e57713101cacf1e403@o4510962731057152.ingest.de.sentry.io/4510962734202960",

  enabled: process.env.NODE_ENV === "production",
  tracesSampleRate: 0.2,
  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Enable sending user PII (Personally Identifiable Information)
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#sendDefaultPii
  sendDefaultPii: true,

  // Drop non-actionable events: browser Event objects captured as promise
  // rejections (e.g. resource load failures, CSP violations). These have no
  // stack trace and surface as "<unknown>" in Sentry.
  beforeSend(event, hint) {
    const orig = hint?.originalException;
    if (orig instanceof Event && !(orig instanceof Error)) {
      return null;
    }
    return event;
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
