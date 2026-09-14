import nodemailer from 'nodemailer';
import { email as emailConfig, site } from '../modules/config';
import { getLogger } from '../modules/logging';
import { INVITE_TTL_DAYS } from '../modules/inviteExpiry';

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
    text: `You have been invited to join the site. Register here:\n\n${emailConfig.siteUrl}/register?inviteKey=${inviteKey}\n\nThis invitation expires in ${INVITE_TTL_DAYS} days.`
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
    // Names the same destination as the disabled login's 403 (#622): staff
    // reinstate on IRC. Not a login link, which would only return that 403,
    // and not an in-app page — a disabled member has no session to reach one.
    text: `Your account has been deactivated after a long period of inactivity. This is routine, and nothing has been deleted.\n\nIf you would like it back, ask staff in ${site.disabledChannel} on IRC and they can reinstate it. How to connect:\n\n${site.ircGuideUrl}`
  });
  return true;
}
