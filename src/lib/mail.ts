import { Resend } from 'resend';
import { logger } from "@/lib/logger";

// Vercel build phase evaluates this file statically. If RESEND_API_KEY is missing during
// the build phase, the Resend constructor throws a fatal error and breaks the build.
// Providing a fallback string "re_dummy" prevents this build crash.
const resend = new Resend(process.env.RESEND_API_KEY || "re_dummy");


export const sendOtpEmail = async (email: string, otp: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [email],
      subject: 'Verify your email - Monstera Cloud',
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; rounded: 8px;">
          <h2 style="color: #1a1a1a; margin-bottom: 16px;">Verify your email</h2>
          <p style="color: #4a5568; line-height: 1.5; margin-bottom: 24px;">
            To complete your registration at Monstera Cloud, please use the following 6-digit verification code:
          </p>
          <div style="background-color: #f7fafc; padding: 16px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 4px; color: #1ba177; border-radius: 4px; margin-bottom: 24px;">
            ${otp}
          </div>
          <p style="color: #718096; font-size: 14px;">
            This code will expire in 10 minutes. If you did not request this, please ignore this email.
          </p>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });

    if (error) {
      logger.error('[MAIL] Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] Unexpected Error:', err);
    return { success: false, error: err };
  }
};

export const sendPasswordResetEmail = async (email: string, resetUrl: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [email],
      subject: 'Reset your password – Monstera Cloud',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1a1a1a; margin-bottom: 8px;">Reset your password</h2>
          <p style="color: #4a5568; line-height: 1.6; margin-bottom: 24px;">
            We received a request to reset the password for your Monstera Cloud account associated with <strong>${email}</strong>.
            Click the button below to set a new password. This link expires in <strong>1 hour</strong>.
          </p>
          <a href="${resetUrl}"
             style="display: inline-block; background-color: #1ba177; color: #ffffff; text-decoration: none;
                    padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; margin-bottom: 24px;">
            Reset Password
          </a>
          <p style="color: #718096; font-size: 13px; margin-top: 16px;">
            If you did not request this, you can safely ignore this email. Your password will not change.
          </p>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });

    if (error) {
      logger.error('[MAIL] Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] Unexpected Error:', err);
    return { success: false, error: err };
  }
};

export const sendSyncFailureEmail = async (to: string, pipelineName: string, errorMsg: string) => {
  try {
    const safeError = (errorMsg || "").slice(0, 2000);
    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [to],
      subject: `Sync failed: ${pipelineName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1a1a1a; margin-bottom: 8px;">Sync failed</h2>
          <p style="color: #4a5568; line-height: 1.6; margin-bottom: 18px;">
            Your pipeline <strong>${pipelineName}</strong> failed to sync.
          </p>
          <div style="background-color: #fff5f5; padding: 14px 16px; border-radius: 6px; border: 1px solid #fed7d7; color: #9b2c2c; white-space: pre-wrap;">
${safeError}
          </div>
          <p style="color: #718096; font-size: 13px; margin-top: 18px;">
            Open the Reports page to see full logs and retry the sync.
          </p>
          <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });

    if (error) {
      logger.error('[MAIL] SyncFailure Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] SyncFailure Unexpected Error:', err);
    return { success: false, error: err };
  }
};

export const sendDataFreshnessAlertEmail = async (to: string, workspaceName: string, hoursStale: number) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [to],
      subject: `Data is stale: ${workspaceName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1a1a1a; margin-bottom: 8px;">Your data is stale</h2>
          <p style="color: #4a5568; line-height: 1.6; margin-bottom: 18px;">
            We haven't seen a successful sync in <strong>${hoursStale} hours</strong> for workspace <strong>${workspaceName}</strong>.
          </p>
          <p style="color: #718096; font-size: 13px; margin-top: 18px;">
            Open Monstera Cloud to review logs and re-run your pipeline(s).
          </p>
          <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });
    if (error) {
      logger.error('[MAIL] Freshness Resend Error:', error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] Freshness Unexpected Error:', err);
    return { success: false, error: err };
  }
};

export const sendPaymentPastDueEmail = async (to: string, name: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [to],
      subject: 'Action required: Your Monstera Cloud payment is past due',
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1a1a1a; margin-bottom: 8px;">Payment past due</h2>
          <p style="color: #4a5568; line-height: 1.6; margin-bottom: 24px;">
            Hi ${name || 'there'},<br/><br/>
            We were unable to process your most recent Monstera Cloud subscription payment.
            Please update your payment method to avoid losing access to your plan.
          </p>
          <a href="https://monsteracloud.com/pricing"
             style="display: inline-block; background-color: #e53e3e; color: #ffffff; text-decoration: none;
                    padding: 14px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; margin-bottom: 24px;">
            Update Payment Method
          </a>
          <p style="color: #718096; font-size: 13px; margin-top: 16px;">
            If you believe this is an error or need help, reply to this email or contact us at hello@monsteracloud.com.
          </p>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });

    if (error) {
      logger.error('[MAIL] PaymentPastDue Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] PaymentPastDue Unexpected Error:', err);
    return { success: false, error: err };
  }
};

export type ClientWeeklyReportSummary = {
  weekLabel: string;
  syncs: number;
  errors: number;
  rowsSynced: number;
  pipelines: number;
  freshnessHours: number | null;
};

export const sendClientWeeklyReport = async (
  to: string,
  clientName: string,
  workspaceName: string,
  summary: ClientWeeklyReportSummary,
  clientLogoUrl?: string | null,
) => {
  try {
    const safeName = clientName || "your client";
    const logoHtml = clientLogoUrl
      ? `<img src="${clientLogoUrl}" alt="${safeName}" style="height: 36px; border-radius: 6px; margin-bottom: 12px;" />`
      : "";
    const freshness =
      summary.freshnessHours === null
        ? "no successful syncs this week"
        : `${summary.freshnessHours}h since last successful sync`;
    const errorBadge =
      summary.errors > 0
        ? `<span style="display:inline-block; background-color:#fef2f2; color:#991b1b; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600;">${summary.errors} error${summary.errors === 1 ? "" : "s"}</span>`
        : `<span style="display:inline-block; background-color:#ecfdf5; color:#047857; padding:4px 10px; border-radius:999px; font-size:12px; font-weight:600;">All green</span>`;

    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [to],
      subject: `Weekly recap: ${safeName} – ${summary.weekLabel}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
          ${logoHtml}
          <h2 style="color: #1a1a1a; margin-bottom: 4px;">Weekly recap: ${safeName}</h2>
          <p style="color: #64748b; margin-top: 0; margin-bottom: 20px; font-size: 14px;">
            Workspace: <strong>${workspaceName}</strong> · ${summary.weekLabel}
          </p>
          <div style="margin-bottom: 20px;">${errorBadge}</div>
          <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
            <tr>
              <td style="padding: 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius: 6px 0 0 6px;">
                <div style="font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Syncs</div>
                <div style="font-size:22px; font-weight:700; color:#0f172a;">${summary.syncs}</div>
              </td>
              <td style="padding: 12px; background:#f8fafc; border-top:1px solid #e2e8f0; border-bottom:1px solid #e2e8f0;">
                <div style="font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Rows synced</div>
                <div style="font-size:22px; font-weight:700; color:#1ba177;">${summary.rowsSynced.toLocaleString()}</div>
              </td>
              <td style="padding: 12px; background:#f8fafc; border:1px solid #e2e8f0; border-radius: 0 6px 6px 0;">
                <div style="font-size:12px; color:#64748b; text-transform:uppercase; letter-spacing:0.05em;">Pipelines</div>
                <div style="font-size:22px; font-weight:700; color:#0f172a;">${summary.pipelines}</div>
              </td>
            </tr>
          </table>
          <p style="color: #475569; font-size: 14px; margin-bottom: 8px;">
            Freshness: <strong>${freshness}</strong>.
          </p>
          <p style="color: #718096; font-size: 13px; margin-top: 20px;">
            Open Monstera Cloud to drill into logs, retry failed syncs, or change who receives this email.
          </p>
          <div style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });
    if (error) {
      logger.error('[MAIL] ClientWeeklyReport Resend Error:', error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] ClientWeeklyReport Unexpected Error:', err);
    return { success: false, error: err };
  }
};

export const sendPerformanceAlertEmail = async (to: string, workspaceName: string, netRoas: number, spend: number, dateLabel: string) => {
  try {
    const { data, error } = await resend.emails.send({
      from: 'Monstera Cloud <no-reply@monsteracloud.com>',
      to: [to],
      subject: `Performance alert: Net ROAS ${netRoas.toFixed(2)} (${workspaceName})`,
      html: `
        <div style="font-family: sans-serif; max-width: 560px; margin: 0 auto; padding: 32px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <h2 style="color: #1a1a1a; margin-bottom: 8px;">Performance alert</h2>
          <p style="color: #4a5568; line-height: 1.6; margin-bottom: 18px;">
            Workspace <strong>${workspaceName}</strong> has low Net ROAS on <strong>${dateLabel}</strong>.
          </p>
          <div style="background-color: #f8fafc; padding: 14px 16px; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="color:#0f172a; font-weight:600;">Net ROAS: ${netRoas.toFixed(2)}</div>
            <div style="color:#475569; margin-top:6px;">Ad spend: ${spend.toFixed(2)}</div>
          </div>
          <p style="color: #718096; font-size: 13px; margin-top: 18px;">
            Open the Reports page to investigate spend and attribution.
          </p>
          <div style="margin-top: 28px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #a0aec0;">
            © 2026 Monstera Cloud. All rights reserved.
          </div>
        </div>
      `,
    });
    if (error) {
      logger.error('[MAIL] Performance Resend Error:', error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    logger.error('[MAIL] Performance Unexpected Error:', err);
    return { success: false, error: err };
  }
};
