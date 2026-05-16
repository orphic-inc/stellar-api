import nodemailer from 'nodemailer';
import { email as emailConfig } from '../modules/config';
import { getLogger } from '../modules/logging';

const log = getLogger('mailer');

export async function sendInviteEmail(
  to: string,
  inviteKey: string
): Promise<boolean> {
  if (!emailConfig.smtpHost) {
    log.warn('STELLAR_SMTP_HOST not set — invite email not sent', { to });
    return false;
  }

  const transporter = nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: emailConfig.smtpPort,
    auth: emailConfig.smtpUser
      ? { user: emailConfig.smtpUser, pass: emailConfig.smtpPass }
      : undefined
  });

  await transporter.sendMail({
    from: emailConfig.fromAddress,
    to,
    subject: "You've been invited",
    text: `You have been invited to join the site. Register here:\n\n${emailConfig.siteUrl}/register?inviteKey=${inviteKey}\n\nThis invitation expires in 30 days.`
  });
  return true;
}
