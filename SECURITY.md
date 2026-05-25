# Security Policy

## Reporting a vulnerability

**Please do not file public issues for security problems.**

Email the maintainer privately via the contact on
[naurolabs.com](https://naurolabs.com), or open a
[GitHub private security advisory](https://github.com/samoletovs/portaBaltica/security/advisories/new).

We aim to acknowledge within 7 days.

## Scope

In scope:

- Bypass of the per-IP rate limit in `api/shared/rateLimit.js`
- Server-side request forgery via upstream URL injection
- XSS in any indicator rendering surface
- CSP misconfiguration that allows arbitrary script execution
- Any leakage of the deployed environment variables

Out of scope:

- Denial of service via legitimate volume (the public Free-tier limits
  are documented; rate limiting is a known trade-off)
- Findings against the underlying upstream APIs (Eurostat, data.gov.lv,
  Open-Meteo, etc.) — report those to their respective owners
- Dependency CVEs without a working exploit path through portaBaltica

## Disclosure

We follow coordinated disclosure. Reporters are credited in release notes
unless they prefer to stay anonymous.
