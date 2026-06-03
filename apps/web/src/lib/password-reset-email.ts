function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getPasswordResetLogoUrl(): string {
  const configuredAppUrl = process.env.VITE_APP_URL?.trim();
  if (configuredAppUrl) {
    try {
      const parsedConfiguredAppUrl = new URL(configuredAppUrl);
      if (!isLoopbackHostname(parsedConfiguredAppUrl.hostname)) {
        return new URL("/logo.png", parsedConfiguredAppUrl).toString();
      }
    } catch {
      // Ignore invalid env values and fall back to the public brand domain.
    }
  }

  return "https://cmdclaw.ai/logo.png";
}

export function buildPasswordResetEmailPayload(
  resetUrl: string,
  email: string,
): {
  html: string;
  text: string;
} {
  const resetPageUrl = new URL(resetUrl);
  const safeEmail = escapeHtml(email);
  const safeResetUrl = escapeHtml(resetUrl);
  const safeLogoUrl = escapeHtml(getPasswordResetLogoUrl());

  return {
    text: `CMDCLAW PASSWORD SETUP

A password setup or reset was requested for ${email}.

Set or reset your password: ${resetUrl}

For your safety:
- This link opens on ${resetPageUrl.hostname.replace(/^www\./, "")}
- It expires in 1 hour
- CmdClaw will never ask for your password by email

If you didn't request this email, you can safely ignore it.`,
    html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; background-color: #f5f5f4; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 48px 20px;">
        <table role="presentation" style="max-width: 480px; width: 100%; border-collapse: collapse; background-color: #ffffff; border: 2px solid #B33A3A; border-radius: 12px; overflow: hidden;">
          <tr>
            <td align="center" style="padding: 44px 40px 0 40px;">
              <img src="${safeLogoUrl}" alt="CmdClaw" width="40" height="40" style="display: block; width: 40px; height: 40px; margin: 0 auto 10px auto;">
              <p style="margin: 0; font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: #B33A3A;">CmdClaw</p>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding: 24px 40px;">
              <table role="presentation" style="border-collapse: collapse; width: 36px;">
                <tr><td style="border-top: 2px solid #B33A3A; font-size: 0; line-height: 0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px;">
              <h1 style="margin: 0 0 16px 0; font-size: 22px; font-weight: 600; letter-spacing: -0.02em; color: #1c1917; text-align: center; line-height: 1.3;">Set your CmdClaw password</h1>
              <p style="margin: 0 0 8px 0; font-size: 15px; color: #57534e; line-height: 1.6; text-align: center;">A password setup or reset was requested for<br><strong style="color: #1c1917;">${safeEmail}</strong></p>
              <p style="margin: 0 0 32px 0; font-size: 14px; color: #a8a29e; line-height: 1.6; text-align: center;">This link expires in 1 hour.</p>
              <table role="presentation" style="margin: 0 auto 32px auto; border-collapse: collapse;">
                <tr>
                  <td align="center" style="background-color: #18181b; border-radius: 8px;">
                    <a href="${safeResetUrl}" style="display: inline-block; padding: 14px 36px; background-color: #18181b; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; letter-spacing: 0.02em; border-radius: 8px;">Set password</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 40px 32px 40px;">
              <p style="margin: 0 0 4px 0; font-size: 12px; color: #a8a29e; line-height: 1.5;">Or copy this link:</p>
              <p style="margin: 0; font-size: 12px; line-height: 1.5; word-break: break-all;">
                <a href="${safeResetUrl}" style="color: #B33A3A; text-decoration: underline;">${safeResetUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 40px; border-top: 1px solid #f5f5f4; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #a8a29e; line-height: 1.5;">If you didn't request this email, you can safely ignore it.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `,
  };
}
