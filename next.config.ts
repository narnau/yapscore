import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Next.js DevTools (segment explorer) — crashes intermittently in 15.5.x
  devTools: false,
  // Keep heavy Node-only packages out of the browser bundle
  serverExternalPackages: ["adm-zip", "webmscore"],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // Prevent clickjacking attacks
          { key: "X-Frame-Options", value: "DENY" },
          // Block MIME-type sniffing
          { key: "X-Content-Type-Options", value: "nosniff" },
          // Only send origin in Referer header
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Disable browser features the app doesn't use
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), interest-cohort=()" },
          // Content Security Policy — restrict resource origins
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // Next.js inline scripts + Verovio WASM blob workers
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://js.stripe.com",
              "style-src 'self' 'unsafe-inline'",
              // Verovio WASM + local files
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              // API calls: Supabase, OpenRouter, Stripe
              `connect-src 'self' ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""} https://openrouter.ai https://api.stripe.com https://o4507995819524096.ingest.us.sentry.io`,
              // Stripe hosted fields
              "frame-src https://js.stripe.com https://hooks.stripe.com",
              "worker-src 'self' blob:",
              "object-src 'none'",
              "base-uri 'self'",
            ].join("; "),
          },
          // Uncomment on production once HTTPS is confirmed:
          // { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },

  webpack: (config, { isServer, webpack }) => {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    if (!isServer) {
      // Verovio uses node: imports inside an ENVIRONMENT_IS_NODE guard,
      // but webpack tries to bundle them anyway. Strip the node: prefix so
      // the fallback config can silence them.
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:(.*)$/, (resource: any) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs:     false,
        module: false,
        crypto: false,
        path:   false,
        url:    false,
      };
    }

    return config;
  },
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "score-26",

  project: "app",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // Skip source map upload when no auth token (e.g. CI build checks)
  disableSourceMapUpload: !process.env.SENTRY_AUTH_TOKEN,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  webpack: {
    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,

    // Tree-shaking options for reducing bundle size
    treeshake: {
      // Automatically tree-shake Sentry logger statements to reduce bundle size
      removeDebugLogging: true,
    },
  },
});
