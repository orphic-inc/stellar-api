import nodemailer from 'nodemailer';
import { email as emailConfig } from '../modules/config';
import { getLogger } from '../modules/logging';

const log = getLogger('mailer');

function createTransporter() {
  return nodemailer.createTransport({
    host: emailConfig.smtpHost,
    port: emailConfig.smtpPort,
    auth: emailConfig.smtpUser
      ? { user: emailConfig.smtpUser, pass: emailConfig.smtpPass }
      : undefined
  });
}

export async function sendInviteEmail(
  to: string,
  inviteKey: string
): Promise<boolean> {
  if (!emailConfig.smtpHost) {
    log.warn('STELLAR_SMTP_HOST not set — invite email not sent', { to });
    return false;
  }

  await createTransporter().sendMail({
    from: emailConfig.fromAddress,
    to,
    subject: "You've been invited",
    text: `You have been invited to join the site. Register here:\n\n${emailConfig.siteUrl}/register?inviteKey=${inviteKey}\n\nThis invitation expires in 30 days.`
  });
  return true;
}

export async function sendRecoveryEmail(
  to: string,
  resetUrl: string
): Promise<boolean> {
  if (!emailConfig.smtpHost) {
    log.warn('STELLAR_SMTP_HOST not set — recovery email not sent', { to });
    return false;
  }

  await createTransporter().sendMail({
    from: emailConfig.fromAddress,
    to,
    subject: 'Account recovery',
    text: `You requested a password reset. Follow this link to set a new password:\n\n${resetUrl}\n\nThis link expires in 2 hours. If you did not request this, you can ignore this email.`
  });
  return true;
}

export async function sendInactivityWarningEmail(
  to: string,
  daysUntilDisable: number
): Promise<boolean> {
  if (!emailConfig.smtpHost) {
    log.warn('STELLAR_SMTP_HOST not set — inactivity warning not sent', { to });
    return false;
  }

  await createTransporter().sendMail({
    from: emailConfig.fromAddress,
    to,
    subject: 'Your account is about to be deactivated',
    text: `Your account has been inactive for a long time and is scheduled to be deactivated in ${daysUntilDisable} days.\n\nTo keep it, just sign in:\n\n${emailConfig.siteUrl}/login\n\nSigning in is enough — there is nothing else to do.`
  });
  return true;
}

export async function sendInactivityDisabledEmail(
  to: string
): Promise<boolean> {
  if (!emailConfig.smtpHost) {
    log.warn('STELLAR_SMTP_HOST not set — deactivation notice not sent', {
      to
    });
    return false;
  }

  await createTransporter().sendMail({
    from: emailConfig.fromAddress,
    to,
    subject: 'Your account has been deactivated',
    // Points at the reactivation flow rather than at login, which would only
    // return the 403 that brought them here.
    text: `Your account has been deactivated after a long period of inactivity.\n\nIf you would like it back, you can ask staff to reinstate it:\n\n${emailConfig.siteUrl}/reactivate\n\nNothing has been deleted.`
  });
  return true;
}
