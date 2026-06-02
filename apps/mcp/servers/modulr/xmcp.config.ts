import { type XmcpConfig } from "xmcp";
import { addCommonJsPackageBoundary } from "../xmcp-commonjs-output-plugin";

const config: XmcpConfig = {
  stdio: true,
  http: {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number.parseInt(process.env.PORT ?? "3001", 10),
    endpoint: "/mcp",
  },
  paths: {
    tools: "./src/tools",
    prompts: "./src/prompts",
    resources: "./src/resources",
  },
  bundler: addCommonJsPackageBoundary,
};

export default config;
