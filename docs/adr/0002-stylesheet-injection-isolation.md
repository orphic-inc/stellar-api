# Stylesheet injection isolation & sanitization

**Status: Proposed — decision pending.** Stub recording the decision to be made; see [PRD-01](../prd/01-stylesheet-themes-and-scoring.md).

User-supplied stylesheets (`profile.externalStylesheet`, a URL) are injected site-wide by the stellar-ui `StylesheetInjector`. This is a trust boundary: an unsanitized user stylesheet can break the app chrome (leak past its intended scope) or carry an injection/exfiltration vector. The URL is already format-validated (`z.string().url()`), but format validation is not safety.

Decision to record here (not yet made):

- **Isolation:** how user CSS is scoped so it cannot override app chrome — a global-CSS-reset boundary (e.g. `all: revert` on a container, per MDN) around the injected sheet vs. an iframe/shadow-DOM sandbox.
- **Sanitization / fetch policy:** whether stylesheets are proxied/fetched + scanned server-side, restricted to an allowlist of hosts, or constrained by CSP (`style-src`), and how `url()`/`@import` inside user CSS are handled.

The adoption-**scoring** anti-abuse model (the +10/+100 self-dealing risk) is a separate decision tracked as an open question in PRD-01 and may get its own ADR.

_Fill in the chosen approach and consequences once decided._
