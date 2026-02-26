import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Disable Next.js DevTools (segment explorer) — crashes intermittently in 15.5.x
  devTools: false,
  // Keep heavy Node-only packages out of the browser bundle
  serverExternalPackages: ["adm-zip", "webmscore"],
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

export default nextConfig;
