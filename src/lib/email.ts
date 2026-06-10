import nodemailer from "nodemailer";
import { escapeHtml } from "./pii";

// Ported from legacy-streamlit/utils/email.py — Gmail SMTP with a 587 STARTTLS
// attempt and a 465 SSL fallback. Reads SMTP_* env vars. TLS is mandatory on
// both paths so credentials and recipient PII never travel in plaintext.

interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  from: string;
}

function getSmtpConfig(): SmtpConfig | null {
  const username = process.env.SMTP_USERNAME?.trim();
  const password = process.env.SMTP_PASSWORD?.replace(/\s+/g, "").trim();
  if (!username || !password) return null;
  return {
    host: process.env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    username,
    password,
    from: process.env.EMAIL_FROM?.trim() || username,
  };
}

export async function sendInviteEmail(
  toEmail: string,
  groupName: string,
  invitedBy: string,
): Promise<{ ok: boolean; error: string | null }> {
  const cfg = getSmtpConfig();
  if (!cfg) {
    return { ok: false, error: "SMTP credentials are not configured." };
  }

  // Group names and inviter labels are user input — escape them so a crafted
  // group name can't inject HTML into mail sent to arbitrary addresses.
  const safeInviter = escapeHtml(invitedBy);
  const safeGroup = escapeHtml(groupName);

  const html = `
    <html>
      <body style="font-family: Arial, sans-serif; color: #333;">
        <p>Hi,</p>
        <p><strong>${safeInviter}</strong> has invited you to join the group
        <strong>"${safeGroup}"</strong> on <em>Monthly Expense Tracker</em>.</p>
        <p>Sign in to the app to accept or decline the invite.</p>
        <hr style="border:none; border-top:1px solid #eee;">
        <p style="color:#888; font-size:12px;">— Monthly Expense Tracker</p>
      </body>
    </html>`;

  const message = {
    from: cfg.from,
    to: toEmail,
    subject: `You've been invited to join '${groupName.replace(/[\r\n]+/g, " ")}'`,
    html,
  };

  // Attempt 1: configured port (587 STARTTLS by default). requireTLS makes
  // nodemailer fail instead of silently sending plaintext when STARTTLS is
  // unavailable.
  try {
    const transport = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.port === 465,
      requireTLS: true,
      auth: { user: cfg.username, pass: cfg.password },
      connectionTimeout: 15000,
    });
    await transport.sendMail(message);
    return { ok: true, error: null };
  } catch (e1) {
    // Fallback: 465 SSL
    try {
      const transport = nodemailer.createTransport({
        host: cfg.host,
        port: 465,
        secure: true,
        auth: { user: cfg.username, pass: cfg.password },
        connectionTimeout: 15000,
      });
      await transport.sendMail(message);
      return { ok: true, error: null };
    } catch (e2) {
      return {
        ok: false,
        error: `Port ${cfg.port}: ${String(e1)} | Port 465: ${String(e2)}`,
      };
    }
  }
}
