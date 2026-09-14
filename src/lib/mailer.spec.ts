/**
 * The dormancy deactivation email names the same destination as the disabled
 * login's 403 (#622): the IRC channel staff reinstate in, and a public guide to
 * reaching it. It used to link `${siteUrl}/reactivate`, a page that does not
 * exist, and a disabled member has no session to reach any in-app page anyway.
 */
const sendMail = jest.fn().mockResolvedValue({});

jest.mock('nodemailer', () => ({
  __esModule: true,
  default: { createTransport: () => ({ sendMail }) }
}));
jest.mock('../modules/logging', () => ({
  getLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() })
}));
jest.mock('../modules/config', () => ({
  email: {
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpUser: '',
    smtpPass: '',
    fromAddress: 'noreply@example.com',
    siteUrl: 'https://stellar.example.com'
  },
  site: {
    disabledChannel: '#disabled-test',
    ircGuideUrl: 'https://kb.example.com/irc-guide'
  }
}));

import { sendInactivityDisabledEmail } from './mailer';

describe('sendInactivityDisabledEmail', () => {
  beforeEach(() => {
    sendMail.mockClear();
  });

  const sentText = async () => {
    await sendInactivityDisabledEmail('member@example.com');
    expect(sendMail).toHaveBeenCalledTimes(1);
    return (sendMail.mock.calls[0][0] as { text: string }).text;
  };

  it('names the disabled channel and links the IRC guide from config', async () => {
    const text = await sentText();

    expect(text).toContain('#disabled-test');
    expect(text).toContain('https://kb.example.com/irc-guide');
  });

  it('no longer links the in-app reactivation page', async () => {
    const text = await sentText();

    expect(text).not.toContain('/reactivate');
    expect(text).not.toContain('https://stellar.example.com');
  });

  it('says nothing was deleted', async () => {
    expect(await sentText()).toContain('nothing has been deleted');
  });
});
