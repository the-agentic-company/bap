import type { NextConfig } from "next";
import os from "node:os";
import * as envConfig from "./src/env.js";

void envConfig;

const nextBuildCpus = Math.min(
  4,
  Math.max(
    1,
    (typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length) -
      1,
  ),
);

type WebpackRule = {
  resourceQuery?: unknown;
  test?: {
    test?: (value: string) => boolean;
  };
};

const nextConfig: NextConfig = {
  /* config options here */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  webpack(config) {
    const rules = config.module.rules as WebpackRule[];
    const svgAssetRule = rules.find((rule) => rule.test?.test?.(".svg"));
    if (svgAssetRule) {
      svgAssetRule.resourceQuery = { not: [/raw/] };
    }

    config.module.rules.unshift({
      test: /\.svg$/i,
      resourceQuery: /raw/,
      type: "asset/source",
    });
    return config;
  },
  reactCompiler: true,
  experimental: {
    // Render builders can expose a large CPU count, which makes Next fan out enough
    // workers to OOM during page-data collection.
    cpus: nextBuildCpus,
  },
  transpilePackages: ["@cmdclaw/core", "@cmdclaw/db"],
  typescript: {
    tsconfigPath: "./tsconfig.build.json",
  },
  images: {
    remotePatterns: [{ hostname: "lh3.googleusercontent.com" }, { hostname: "cdn.brandfetch.io" }],
  },
  serverExternalPackages: ["@whiskeysockets/baileys", "dockerode", "docker-modem", "ssh2"],
};

export default nextConfig;
