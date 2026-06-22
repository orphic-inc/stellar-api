# Security Policy

Stellar takes the safety of its members and its infrastructure seriously. This policy describes how to report a vulnerability responsibly. It mirrors Golden Rule 6 in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md): **do not seek or exploit live bugs** (6.1) and **do not publish exploits** (6.2).

## Reporting a vulnerability

If you discover a critical bug or security vulnerability:

- **Report it privately.** Do **not** open a public GitHub issue, post in a public forum, or discuss the vulnerability in any public channel — doing so exposes other members before a fix can ship.
- Use the appropriate **staff / security contact channel**: send a Staff PM in-app, or contact a site administrator directly. If you cannot reach staff in-app, use the disabled-account support channel on IRC.
- Include enough detail to reproduce: affected endpoint or page, steps, and expected vs. actual behavior. A minimal proof of concept is welcome; a weaponized exploit is not.

Non-critical bugs (no security or data-integrity impact) may be reported through the normal Bugs Forum rather than this private channel.

## Rules of engagement

- **Do not test against the live site.** Verify findings against a local development environment, not production. Probing, fuzzing, or exploiting the live site is itself a Golden Rule 6.1 violation.
- **No data exfiltration or persistence.** Do not access, modify, or retain data that is not yours, and do not pivot beyond the minimum needed to demonstrate the issue.
- **Do not publish or share exploits.** Publication, dissemination, or technical facilitation of exploits is prohibited (Golden Rule 6.2).

## Coordinated disclosure

We practice coordinated disclosure. Please give us a reasonable window to investigate and ship a fix before any public discussion. Good-faith research conducted within this policy — private reporting, no live-site testing, no exfiltration, no publication — will not be treated as a Golden Rule violation. We will acknowledge valid reports and keep you informed as we remediate.
