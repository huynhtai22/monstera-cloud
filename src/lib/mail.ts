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
