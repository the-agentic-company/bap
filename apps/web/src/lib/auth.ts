import { isSelfHostedEdition } from "@cmdclaw/core/server/edition";
import { trackSignupFromSession } from "@cmdclaw/core/server/services/user-telemetry";
import { db } from "@cmdclaw/db/client";
import { authSchema, user as userTable } from "@cmdclaw/db/schema";
import { autumn } from "autumn-js/better-auth";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { admin, bearer, lastLoginMethod, magicLink } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { env } from "@/env";
import { INVITE_ONLY_LOGIN_ERROR, shouldGrantAdminRole } from "@/lib/admin-emails";
import { buildMagicLinkEmailPayload } from "@/lib/magic-link-email";
import { MAGIC_LINK_TTL_SECONDS } from "@/lib/magic-link-request";
import { buildSignInMagicLinkUrl } from "@/lib/magic-link-request";
import { buildPasswordResetEmailPayload } from "@/lib/password-reset-email";
import { getTrustedOrigins } from "@/lib/trusted-origins";
import { isApprovedLoginEmail } from "@/server/lib/approved-login-emails";
import { createMagicLinkRequestState } from "@/server/lib/magic-link-request-state";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

const appUrl = env.APP_URL ?? env.VITE_APP_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function assertInviteOnlyLogin(email: string) {
  if (await isApprovedLoginEmail(email)) {
    return;
  }

  throw new APIError("FORBIDDEN", {
    code: INVITE_ONLY_LOGIN_ERROR,
    message: INVITE_ONLY_LOGIN_ERROR,
    email,
  });
}

const socialProviders = isSelfHostedEdition()
  ? {}
  : {
      ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
      ...(env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET
        ? {
            apple: {
              clientId: env.APPLE_CLIENT_ID,
              clientSecret: env.APPLE_CLIENT_SECRET,
              appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER,
            },
          }
        : {}),
    };

export const auth = betterAuth({
  appName: "CmdClaw",
  baseURL: appUrl,
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    requireEmailVerification: false,
    revokeSessionsOnPasswordReset: true,
    async sendResetPassword({ user, url }) {
      if (resend && env.EMAIL_FROM) {
        const emailContent = buildPasswordResetEmailPayload(url, user.email);

        await resend.emails.send({
          from: `CmdClaw <${env.EMAIL_FROM}>`,
          to: user.email,
          subject: `Set your CmdClaw password | ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
          html: emailContent.html,
          text: emailContent.text,
        });
      } else {
        console.info(`[better-auth] Password reset for ${user.email}: ${url}`);
      }
    },
  },
  user: {
    additionalFields: {
      phoneNumber: {
        type: "string",
        required: false,
      },
    },
  },
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: authSchema,
  }),
  socialProviders,
  trustedOrigins: getTrustedOrigins(),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-in/magic-link" && ctx.path !== "/sign-in/email") {
        return;
      }

      const email = typeof ctx.body?.email === "string" ? ctx.body.email : null;
      if (!email) {
        return;
      }

      await assertInviteOnlyLogin(email);
    }),
  },
  // Don't forget to regenerate the schema if you add a new plugin
  // Run "bun auth:generate" to regenerate the schema
  plugins: [
    bearer(),
    admin({
      defaultRole: "user",
      adminRoles: ["admin"],
    }),
    lastLoginMethod(),
    ...(!isSelfHostedEdition()
      ? [
          autumn({
            secretKey: env.AUTUMN_SECRET_KEY,
          }),
        ]
      : []),
    magicLink({
      expiresIn: MAGIC_LINK_TTL_SECONDS,
      async sendMagicLink({ email, token, url }) {
        console.log(`[auth] Sending magic link to ${email}`);
        await createMagicLinkRequestState({
          token,
          email,
          verificationUrl: url,
        });
        const signInUrl = buildSignInMagicLinkUrl({
          token,
          baseUrl: appUrl,
        });

        if (resend && env.EMAIL_FROM) {
          const emailContent = buildMagicLinkEmailPayload(signInUrl, email);

          await resend.emails.send({
            from: `CmdClaw <${env.EMAIL_FROM}>`,
            to: email,
            subject: `Sign in to CmdClaw | ${new Date().toISOString().slice(0, 19).replace("T", " ")}`,
            html: emailContent.html,
            text: emailContent.text,
          });
        } else {
          console.info(`[better-auth] Magic link for ${email}: ${signInUrl}`);
        }
      },
    }),
    // TanStack Start cookie integration. MUST be the final plugin so it can set cookies on
    // responses after every other plugin has run (replaces the previous nextCookies()).
    tanstackStartCookies(),
  ],
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          await assertInviteOnlyLogin(user.email);
          if (shouldGrantAdminRole(user.email)) {
            return { data: { ...user, role: "admin" } };
          }
          return { data: user };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const existingUser = await db.query.user.findFirst({
            where: eq(userTable.id, session.userId),
            columns: {
              email: true,
            },
          });

          if (existingUser?.email) {
            await assertInviteOnlyLogin(existingUser.email);
          }
        },
        after: async (session, context) => {
          try {
            await trackSignupFromSession({ session, context });
          } catch (error) {
            console.error("[auth] failed to emit signup telemetry", error);
            if (error instanceof AggregateError) {
              console.error("[auth] signup telemetry causes", error.errors);
            }
          }
        },
      },
    },
  },
});
