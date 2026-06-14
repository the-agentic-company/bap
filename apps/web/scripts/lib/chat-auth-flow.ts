import { spawn } from "node:child_process";
import { saveConfig, type ChatConfig } from "./cli-shared";
import { sleep } from "./chat-format";

const DEFAULT_CLIENT_ID = "bap-cli";

export function openUrlInBrowser(url: string): boolean {
  try {
    const commandByPlatform: Record<string, { cmd: string; args: string[] }> = {
      darwin: { cmd: "open", args: [url] },
      linux: { cmd: "xdg-open", args: [url] },
      win32: { cmd: "cmd", args: ["/c", "start", "", url] },
    };
    const command = commandByPlatform[process.platform];
    if (!command) {
      return false;
    }
    const child = spawn(command.cmd, command.args, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export async function authenticate(
  serverUrl: string,
  options: { open: boolean },
): Promise<ChatConfig | null> {
  console.log(`\nAuthenticating with ${serverUrl}\n`);

  let deviceCode: string;
  let userCode: string;
  let verificationUri: string;
  let interval = 5;
  let expiresIn = 1800;

  try {
    const res = await fetch(`${serverUrl}/api/auth/device/code`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.BAP_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
      }),
    });

    if (!res.ok) {
      console.error(`Failed to request device code: ${res.status}`);
      return null;
    }

    const data = await res.json();
    deviceCode = data.device_code;
    userCode = data.user_code;
    verificationUri = data.verification_uri_complete || data.verification_uri;
    interval = data.interval || 5;
    expiresIn = data.expires_in || 1800;
  } catch (err) {
    console.error("Could not connect to server:", err);
    return null;
  }

  console.log("Visit the following URL and enter the code:\n");
  console.log(`  ${verificationUri}\n`);
  console.log(`  Code: ${userCode}\n`);
  if (options.open && openUrlInBrowser(verificationUri)) {
    console.log("Opened the browser for you.\n");
  }
  console.log("Waiting for approval...\n");

  let pollingInterval = interval * 1000;
  const deadline = Date.now() + expiresIn * 1000;

  const pollForToken = async (): Promise<ChatConfig | null> => {
    if (Date.now() >= deadline) {
      console.error("Code expired. Please try again.");
      return null;
    }

    await sleep(pollingInterval);

    try {
      const res = await fetch(`${serverUrl}/api/auth/device/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: process.env.BAP_CLI_CLIENT_ID || DEFAULT_CLIENT_ID,
        }),
      });

      const data = await res.json();

      if (data.access_token) {
        const config: ChatConfig = {
          serverUrl,
          token: data.access_token,
        };
        saveConfig(config);
        console.log("Authenticated successfully.\n");
        return config;
      }

      if (data.error) {
        switch (data.error) {
          case "authorization_pending":
            break;
          case "slow_down":
            pollingInterval += 5000;
            break;
          case "expired_token":
            console.error("Code expired. Please try again.");
            return null;
          case "access_denied":
            console.error("Authentication denied.");
            return null;
          default:
            console.error(`Unexpected error: ${data.error}`);
            break;
        }
      }
    } catch {
      // retry
    }

    return pollForToken();
  };

  return pollForToken();
}
