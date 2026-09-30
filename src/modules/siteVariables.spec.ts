/**
 * The Golden Rules variables map (PRD-09, ADR-0020): what `${irc}` resolves to
 * (#630), and the boot warning for the setting it retired.
 */
import type { PrismaClient } from '@prisma/client';
import { site } from './config';
import { resolveSiteVariables, retiredSiteEnvWarning } from './siteVariables';

const client = {
  forum: { findFirst: () => Promise.resolve({ id: 3 }) }
} as unknown as PrismaClient;

describe('resolveSiteVariables — ${irc} (#630)', () => {
  it('resolves to the public IRC guide, not an in-app route', async () => {
    const variables = await resolveSiteVariables(client);
    expect(variables.irc).toBe(site.ircGuideUrl);
    expect(variables.irc).toMatch(/^https?:\/\//);
  });

  it('ships one token for that destination, not two', async () => {
    const variables = await resolveSiteVariables(client);
    expect(variables).not.toHaveProperty('irc_guide_article');
  });
});

describe('retiredSiteEnvWarning', () => {
  it('warns when the retired STELLAR_IRC_URL is still set', () => {
    expect(retiredSiteEnvWarning({ STELLAR_IRC_URL: '/irc' })).toMatch(
      /STELLAR_IRC_URL is ignored.*STELLAR_IRC_GUIDE_URL/
    );
  });

  it('stays quiet when it is unset or empty', () => {
    expect(retiredSiteEnvWarning({})).toBeNull();
    expect(retiredSiteEnvWarning({ STELLAR_IRC_URL: '' })).toBeNull();
  });
});
