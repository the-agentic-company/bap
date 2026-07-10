import { createAuthClient } from "better-auth/client";
import {
  adminClient,
  deviceAuthorizationClient,
  inferAdditionalFields,
  lastLoginMethodClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import type { auth } from "@/lib/auth";
import { env } from "@/env";

const getAuthClientBaseURL = () => {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return env.VITE_APP_URL ?? "";
};

export const authClient = createAuthClient({
  baseURL: getAuthClientBaseURL(),
  plugins: [
    inferAdditionalFields<typeof auth>(),
    magicLinkClient(),
    lastLoginMethodClient(),
    deviceAuthorizationClient(),
    organizationClient({
      teams: {
        enabled: false,
      },
      schema: {
        organization: {
          additionalFields: {
            billingPlanId: {
              type: "string",
              required: false,
              defaultValue: "free",
              input: false,
            },
            autumnCustomerId: {
              type: "string",
              required: false,
              input: false,
            },
            imageStorageKey: {
              type: "string",
              required: false,
              input: false,
            },
            imageMimeType: {
              type: "string",
              required: false,
              input: false,
            },
            updatedAt: {
              type: "date",
              required: false,
              input: false,
            },
          },
        },
      },
    }),
    adminClient(),
  ],
});
