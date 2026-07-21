/**
 * The six Stellar Golden Rules — the non-negotiable, site-wide behavioral canon
 * (PRD-05 / PRD-09). This module is the structured MIRROR of the canonical prose
 * in `CODE_OF_CONDUCT.md`: the 6 numbered groups become `Rule` nodes and each
 * `x.y` entry a `SubRule`, with bodies copied verbatim. A CI drift-guard
 * (`goldenRules.spec.ts`) parses the prose and asserts it still matches this
 * table, so the two can never silently diverge.
 *
 * CRS micro-impact weights are PRD-05 TBD — rows seed at the schema default (0).
 * The `${...}` tokens in titles/descriptions are resolved at read time by
 * `resolveSiteVariables()` and substituted UI-side (ADR-0020); they are stored
 * verbatim here so the prose is the single authored source.
 */
import { PrismaClient } from '@prisma/client';

export interface GoldenSubRule {
  /** Stable key, unique within the parent rule. */
  code: string;
  /** Display title, sans the leading "x.y " number and trailing period. */
  title: string;
  /** Verbatim prose body (may carry `${...}` tokens + markdown links). */
  description: string;
}

export interface GoldenRuleDef {
  /** Machine-stable rule key, e.g. "golden.accounts". */
  code: string;
  /** The group's display title (lives only here + PRD — not in the prose). */
  title: string;
  subRules: GoldenSubRule[];
}

export const GOLDEN_RULES: readonly GoldenRuleDef[] = [
  {
    code: 'golden.accounts',
    title: 'Accounts',
    subRules: [
      {
        code: 'single-account',
        title: 'Do not create more than one account',
        description:
          'Users are allowed one account per lifetime. If your account is disabled, contact staff in ${disabled_channel} on ${irc}.'
      },
      {
        code: 'no-trade-accounts',
        title: 'Do not trade, sell, give away, or offer accounts',
        description:
          'If you no longer wish to use your account, send a ${staffpm} and request that your account be disabled.'
      },
      {
        code: 'no-share-accounts',
        title: 'Do not share accounts',
        description:
          'Accounts are for personal use only. Granting access to your account in any way (e.g., shared login details, external programs) is prohibited. [Invite](${invite_article}) friends or direct them to the [IRC Interview](${interview_article}).'
      }
    ]
  },
  {
    code: 'golden.invites',
    title: 'Invites',
    subRules: [
      {
        code: 'no-bad-invitees',
        title: 'Do not invite bad users',
        description:
          'You are responsible for your invitees. You will not be punished if your invitees fail to maintain required share ratios, but invitees who break golden rules will place your invite privileges and account at risk.'
      },
      {
        code: 'no-trade-invites',
        title:
          'Do not trade, sell, publicly give away, or publicly offer invites',
        description:
          'Only invite people you know and trust. Do not offer invites via other trackers, forums, social media, or other public locations. Responding to public invite requests is prohibited. Exception: Staff-designated recruiters may offer invites in approved locations.'
      },
      {
        code: 'no-request-invites',
        title: 'Do not request invites or accounts',
        description:
          "Requesting invites to—or accounts on—${site_name} or other trackers is prohibited. Invites may be _offered_, but not requested, in the site's Invites forum (restricted to the [Power User class](${classes_article}) and above). You may request invites by messaging users only when they have offered them in the Invites Forum. Unsolicited invite requests, even by private message, are prohibited."
      }
    ]
  },
  {
    code: 'golden.contribution-integrity',
    title: 'Contribution Integrity & Accounting',
    subRules: [
      {
        code: 'no-ratio-manipulation',
        title: 'Do not engage in ratio manipulation',
        description:
          'Transferring buffer—or increasing your buffer—through unintended uses of the IRC protocol or site features (e.g., [request abuse](${requests_article})) constitutes ratio manipulation. When in doubt, send a ${staffpm} asking for more information.'
      },
      {
        code: 'no-false-data',
        title: 'Do not report incorrect data to the tracker (i.e., cheating)',
        description:
          'Reporting incorrect data to the tracker constitutes cheating, whether it is accomplished through the use of a modified "cheat API call" or through manipulation of an approved interface (stellar-ui).'
      },
      {
        code: 'no-unapproved-interfaces',
        title: 'Do not use unapproved interfaces',
        description:
          'Your client must be found on the [Interface Whitelist](${interfaces_article}). You must not use interfaces that have been modified in any way. Developers interested in testing unstable interfaces must first receive staff approval.'
      },
      {
        code: 'no-modify-files',
        title: 'Do not modify ${site_name} files',
        description:
          'Embedding non-${site_name} announce XML/URLs in ${site_name} releases are prohibited. Doing so causes false data to be reported and will be interpreted as cheating. This applies to standalone URLs, stringified XML (JSON, etc.), and API-based URLs that have been loaded into an interface.'
      },
      {
        code: 'protect-credentials',
        title: 'Do not share consumed links or your IRC key',
        description:
          'Sharing consumed links is considered cheating. IRC keys enable users to report stats to the tracker.'
      }
    ]
  },
  {
    code: 'golden.conduct',
    title: 'Conduct',
    subRules: [
      {
        code: 'no-blackmail',
        title: 'Do not blackmail, threaten, or expose fellow users',
        description:
          "Exposing or threatening to expose private information about users for any reason is prohibited. Private information includes but is not limited to personally identifying information (e.g., names, records, biographical details, photos). Information that hasn't been openly volunteered by a user should not be discussed or shared without permission. This includes private information collected via investigations into openly volunteered information (e.g., Google search results)."
      },
      {
        code: 'no-scam',
        title: 'Do not scam or defraud',
        description: 'Scams (e.g., phishing) of any kind are prohibited.'
      },
      {
        code: 'respect-staff-decisions',
        title: 'Do not disrespect staff decisions',
        description:
          'Disagreements must be discussed privately with the deciding moderator. If the moderator has retired or is unavailable, you may send a ${staffpm}. Do not contact multiple moderators hoping to find one amenable to your cause; however, you may contact a site administrator if you require a second opinion. Options for contacting staff include private message, Staff PM, and ${disabled_channel} on ${irc}. Staff are bound by the [Staff Rules](${staff_rules_article}) in turn; report a breach of those the same way you would report anything else.'
      },
      {
        code: 'no-impersonate-staff',
        title: 'Do not impersonate staff',
        description:
          'Impersonating staff or official service accounts (e.g., stellar-irc-bridge) on-site, off-site, or on IRC is prohibited. Deceptively misrepresenting staff decisions is also prohibited. Conduct on the IRC network is additionally governed by the [IRC Rules](${irc_rules_article}).'
      },
      {
        code: 'no-backseat-moderate',
        title: 'Do not backseat moderate',
        description:
          '"Backseat moderation" occurs when users police other users. Confronting, provoking, or chastising users suspected of violating rules—or users suspected of submitting reports—is prohibited. Submit a report if you see a rule violation. The [Forum Rules](${forum_rules_article}) cover how threads are moderated and what gets a post removed.'
      },
      {
        code: 'no-request-events',
        title: 'Do not request special events',
        description:
          'Special events (e.g., freepass, neutral pass, picks) are launched at the discretion of the staff. They do not adhere to a fixed schedule, and may not be requested by users.'
      },
      {
        code: 'no-harvest-info',
        title: 'Do not harvest user-identifying information',
        description:
          "Using ${site_name}'s services to harvest user-identifying information of any kind (e.g., IP addresses, personal links) through the use of scripts, exploits, or other techniques is prohibited."
      },
      {
        code: 'no-commercial-use',
        title:
          "Do not use ${site_name}'s services (including the tracker, website, and IRC network) for commercial gain",
        description:
          'Commercializing services provided by or code maintained by ${site_name} (e.g., Stellar, korin-pink) is prohibited. Commercializing content provided by ${site_name} users via the aforementioned services (e.g., user community data) is prohibited. Referral schemes, financial solicitations, and money offers are also prohibited.'
      }
    ]
  },
  {
    code: 'golden.access-automation',
    title: 'Access & Automation',
    subRules: [
      {
        code: 'no-dynamic-proxies',
        title:
          'Do not browse ${site_name} using proxies (including any VPN) with dynamic or shared IP addresses',
        description:
          'You may browse the site through a private server/proxy only if it has a static IP address unique to you, or through your private or shared VPS. Note that this applies to every kind of proxy, including VPN services, Tor, and public proxies. When in doubt, send a ${staffpm} seeking approval of your proxy or VPN. See our ${vpns_article} and ${ips_article} articles for more information.'
      },
      {
        code: 'no-automated-abuse',
        title: 'Do not abuse automated site access',
        description:
          "All automated site access must be done through the [API](https://github.com/orphic-inc/stellar-api). API use is limited to x requests within any xx-second window. Scripts and other automated processes must not scrape the site's HTML pages."
      },
      {
        code: 'no-autosnatch',
        title: 'Do not autosnatch freepass releases',
        description:
          "The automatic snatching of freepass releases using any method involving little or no user-input (e.g., API-based scripts, log or site scraping, etc.) is prohibited. See ${site_name}'s ${autofp_article} article for more information."
      }
    ]
  },
  {
    code: 'golden.bugs-exploits',
    title: 'Bugs & Exploits',
    subRules: [
      {
        code: 'no-exploit-live-bugs',
        title: 'Do not seek or exploit live bugs for any reason',
        description:
          "Seeking or exploiting bugs in the live site (as opposed to a local development environment) is prohibited. If you discover a critical bug or security vulnerability, immediately report it in accordance with ${site_name}'s ${bugs_article}. Non-critical bugs can be reported in the [Bugs Forum](${bugs_forum})."
      },
      {
        code: 'no-publish-exploits',
        title: 'Do not publish exploits',
        description:
          "The publication, organization, dissemination, sharing, technical discussion, or technical facilitation of exploits is prohibited at staff discretion. Exploits are defined as unanticipated or unaccepted uses of internal, external, non-profit, or for-profit services. See ${site_name}'s ${exploit_article} article for more information. Exploits are subject to reclassification at any time."
      }
    ]
  }
];

/**
 * Idempotent seed — a no-op once any `Rule` rows exist (mirrors `seedForums`).
 * Weights are left at the schema default (0); magnitudes are PRD-05 TBD.
 */
export async function seedGoldenRules(client: PrismaClient): Promise<void> {
  const existing = await client.rule.count();
  if (existing > 0) return;

  for (let i = 0; i < GOLDEN_RULES.length; i++) {
    const rule = GOLDEN_RULES[i];
    await client.rule.create({
      data: {
        code: rule.code,
        title: rule.title,
        sortOrder: (i + 1) * 10,
        subRules: {
          create: rule.subRules.map((sub, j) => ({
            code: sub.code,
            title: sub.title,
            description: sub.description,
            sortOrder: (j + 1) * 10
          }))
        }
      }
    });
  }
}
