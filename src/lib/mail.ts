import { Resend } from 'resend';

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
      console.error('[MAIL] Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[MAIL] Unexpected Error:', err);
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
      console.error('[MAIL] Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[MAIL] Unexpected Error:', err);
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
      console.error('[MAIL] SyncFailure Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[MAIL] SyncFailure Unexpected Error:', err);
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
      console.error('[MAIL] Freshness Resend Error:', error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    console.error('[MAIL] Freshness Unexpected Error:', err);
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
      console.error('[MAIL] PaymentPastDue Resend Error:', error);
      return { success: false, error };
    }

    return { success: true, data };
  } catch (err) {
    console.error('[MAIL] PaymentPastDue Unexpected Error:', err);
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
      console.error('[MAIL] Performance Resend Error:', error);
      return { success: false, error };
    }
    return { success: true, data };
  } catch (err) {
    console.error('[MAIL] Performance Unexpected Error:', err);
    return { success: false, error: err };
  }
};
