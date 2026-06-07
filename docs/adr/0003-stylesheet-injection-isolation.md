# Stylesheet injection isolation & sanitization

**Status: Proposed — decision pending.** Records the decision to be made; see [PRD-03](../prd/03-stylesheet-themes-and-scoring.md). (ADR-0002 is reserved for community-health-pulse, [#75](https://github.com/orphic-inc/stellar-api/issues/75).)

User-supplied stylesheets (`profile.externalStylesheet` / AuthorStylesheetUrl) are injected site-wide by the stellar-ui `StylesheetInjector`. This is a trust boundary: an unscoped user stylesheet can break the app chrome or carry an injection/exfiltration vector. The URL is format-validated (`z.string().url()`), but format validation is not safety. Mitigated in part by the `/private/` invite-only model, but the injection mechanics still need a decided isolation strategy.

Decision to record here (not yet made):

- **Isolation:** how user CSS is scoped so it cannot override app chrome — a global-CSS-reset boundary (e.g. `all: revert` on a container, per MDN) around the injected sheet vs. iframe/shadow-DOM sandbox. This is the "Global SCSS/CSS reset flag" in PRD-03.
- **Sanitization / fetch policy:** proxy + scan server-side, host allowlist, CSP `style-src`, and handling of `url()` / `@import` inside user CSS.

_Fill in the chosen approach and consequences once decided._
