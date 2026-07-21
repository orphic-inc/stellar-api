# Code of Conduct — Stellar Golden Rules

These are Stellar's six site-wide Golden Rules — the non-negotiable behavioral standard baked into the software. Per-Community rules may only ever be a subset or extension of these six. `${...}` placeholders (including the links below) are resolved at read time: `GET /api/rules/tree` ships a `variables` map the UI substitutes (see PRD-09 / ADR-0020). Links resolve to one of two places, decided by who needs to read them: member-facing pages live in the in-app wiki, while guidance anyone may need _before_ they have an account — onboarding, the Interview, IRC conduct — lives on the public wiki, because registration is invite-only and the in-app wiki is behind the login. The rule _model_ lives in `docs/prd/05-rules-and-governance.md`; this file is the canonical prose, mirrored into the seed by a CI drift-guard.

**1.1 Do not create more than one account.** Users are allowed one account per lifetime. If your account is disabled, contact staff in ${disabled_channel} on ${irc}.

**1.2 Do not trade, sell, give away, or offer accounts.** If you no longer wish to use your account, send a ${staffpm} and request that your account be disabled.

**1.3 Do not share accounts.** Accounts are for personal use only. Granting access to your account in any way (e.g., shared login details, external programs) is prohibited. [Invite](${invite_article}) friends or direct them to the [IRC Interview](${interview_article}).

---

**2.1 Do not invite bad users.** You are responsible for your invitees. You will not be punished if your invitees fail to maintain required share ratios, but invitees who break golden rules will place your invite privileges and account at risk.

**2.2 Do not trade, sell, publicly give away, or publicly offer invites.** Only invite people you know and trust. Do not offer invites via other trackers, forums, social media, or other public locations. Responding to public invite requests is prohibited. Exception: Staff-designated recruiters may offer invites in approved locations.

**2.3 Do not request invites or accounts.** Requesting invites to—or accounts on—${site_name} or other trackers is prohibited. Invites may be _offered_, but not requested, in the site's Invites forum (restricted to the [Power User class](${classes_article}) and above). You may request invites by messaging users only when they have offered them in the Invites Forum. Unsolicited invite requests, even by private message, are prohibited.

---

**3.1 Do not engage in ratio manipulation.** Transferring buffer—or increasing your buffer—through unintended uses of the IRC protocol or site features (e.g., [request abuse](${requests_article})) constitutes ratio manipulation. When in doubt, send a ${staffpm} asking for more information.

**3.2 Do not report incorrect data to the tracker (i.e., cheating).** Reporting incorrect data to the tracker constitutes cheating, whether it is accomplished through the use of a modified "cheat API call" or through manipulation of an approved interface (stellar-ui).

**3.3 Do not use unapproved interfaces.** Your client must be found on the [Interface Whitelist](${interfaces_article}). You must not use interfaces that have been modified in any way. Developers interested in testing unstable interfaces must first receive staff approval.

**3.4 Do not modify ${site_name} files.** Embedding non-${site_name} announce XML/URLs in ${site_name} releases are prohibited. Doing so causes false data to be reported and will be interpreted as cheating. This applies to standalone URLs, stringified XML (JSON, etc.), and API-based URLs that have been loaded into an interface.

**3.5 Do not share consumed links or your IRC key.** Sharing consumed links is considered cheating. IRC keys enable users to report stats to the tracker.

---

**4.1 Do not blackmail, threaten, or expose fellow users.** Exposing or threatening to expose private information about users for any reason is prohibited. Private information includes but is not limited to personally identifying information (e.g., names, records, biographical details, photos). Information that hasn't been openly volunteered by a user should not be discussed or shared without permission. This includes private information collected via investigations into openly volunteered information (e.g., Google search results).

**4.2 Do not scam or defraud.** Scams (e.g., phishing) of any kind are prohibited.

**4.3 Do not disrespect staff decisions.** Disagreements must be discussed privately with the deciding moderator. If the moderator has retired or is unavailable, you may send a ${staffpm}. Do not contact multiple moderators hoping to find one amenable to your cause; however, you may contact a site administrator if you require a second opinion. Options for contacting staff include private message, Staff PM, and ${disabled_channel} on ${irc}. Staff are bound by the [Staff Rules](${staff_rules_article}) in turn; report a breach of those the same way you would report anything else.

**4.4 Do not impersonate staff.** Impersonating staff or official service accounts (e.g., stellar-irc-bridge) on-site, off-site, or on IRC is prohibited. Deceptively misrepresenting staff decisions is also prohibited. Conduct on the IRC network is additionally governed by the [IRC Rules](${irc_rules_article}).

**4.5 Do not backseat moderate.** "Backseat moderation" occurs when users police other users. Confronting, provoking, or chastising users suspected of violating rules—or users suspected of submitting reports—is prohibited. Submit a report if you see a rule violation. The [Forum Rules](${forum_rules_article}) cover how threads are moderated and what gets a post removed.

**4.6 Do not request special events.** Special events (e.g., freepass, neutral pass, picks) are launched at the discretion of the staff. They do not adhere to a fixed schedule, and may not be requested by users.

**4.7 Do not harvest user-identifying information.** Using ${site_name}'s services to harvest user-identifying information of any kind (e.g., IP addresses, personal links) through the use of scripts, exploits, or other techniques is prohibited.

**4.8 Do not use ${site_name}'s services (including the tracker, website, and IRC network) for commercial gain.** Commercializing services provided by or code maintained by ${site_name} (e.g., Stellar, korin-pink) is prohibited. Commercializing content provided by ${site_name} users via the aforementioned services (e.g., user community data) is prohibited. Referral schemes, financial solicitations, and money offers are also prohibited.

---

**5.1 Do not browse ${site_name} using proxies (including any VPN) with dynamic or shared IP addresses.** You may browse the site through a private server/proxy only if it has a static IP address unique to you, or through your private or shared VPS. Note that this applies to every kind of proxy, including VPN services, Tor, and public proxies. When in doubt, send a ${staffpm} seeking approval of your proxy or VPN. See our ${vpns_article} and ${ips_article} articles for more information.

**5.2 Do not abuse automated site access.** All automated site access must be done through the [API](https://github.com/orphic-inc/stellar-api). API use is limited to x requests within any xx-second window. Scripts and other automated processes must not scrape the site's HTML pages.

**5.3 Do not autosnatch freepass releases.** The automatic snatching of freepass releases using any method involving little or no user-input (e.g., API-based scripts, log or site scraping, etc.) is prohibited. See ${site_name}'s ${autofp_article} article for more information.

---

**6.1 Do not seek or exploit live bugs for any reason.** Seeking or exploiting bugs in the live site (as opposed to a local development environment) is prohibited. If you discover a critical bug or security vulnerability, immediately report it in accordance with ${site_name}'s ${bugs_article}. Non-critical bugs can be reported in the [Bugs Forum](${bugs_forum}).

**6.2 Do not publish exploits.** The publication, organization, dissemination, sharing, technical discussion, or technical facilitation of exploits is prohibited at staff discretion. Exploits are defined as unanticipated or unaccepted uses of internal, external, non-profit, or for-profit services. See ${site_name}'s ${exploit_article} article for more information. Exploits are subject to reclassification at any time.
