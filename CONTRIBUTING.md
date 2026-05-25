# Contributing to portaBaltica

portaBaltica is a research dashboard from [NauroLabs](https://naurolabs.com)
that aggregates Baltic open-data sources. Issues, ideas, and pull requests
are welcome.

## Quick orientation

- **Frontend:** React 19 + TypeScript + Vite + Tailwind (in `src/`)
- **Backend:** Azure Functions v3 (CommonJS, Node 20) — thin proxies to
  public data sources (in `api/`)
- **No database.** Everything is fetched on demand from upstream public APIs.
- **No LLM calls.** `ai-insights` is rules-based.
- See `AGENTS.md` for conventions.

## Data sources

All upstream data sources are public (Eurostat, data.gov.lv, Elering, ECB,
Open-Meteo, etc.). If you add a new source, document it in `README.md` and
add the origin to the CSP `connect-src` in `staticwebapp.config.json`.

## Bug reports

Open an issue with:

- What you tried to do
- What happened (screenshot if it's a UI issue)
- What you expected
- Browser / OS if relevant

## Pull requests

1. Fork, branch off `master`.
2. Keep PRs focused.
3. `npm run lint` and `npm run build` must pass.
4. Add or update tests when touching data-shape logic (in `tests/`).
5. **Do not remove the per-IP rate limit** in `api/shared/rateLimit.js` —
   it protects upstream APIs from abuse and the SWA Free tier monthly quota.

## What we accept

- ✅ New indicators backed by public data sources
- ✅ Performance / caching improvements
- ✅ Bug fixes, accessibility, dark-mode polish
- ✅ Localization beyond English

## What we don't accept

- ❌ Endpoints requiring a paid third-party API key
- ❌ Endpoints calling LLMs (use a separate side project)
- ❌ Anything that bypasses the rate limit or removes it
- ❌ Hard-coded secrets

## Security

See [`SECURITY.md`](SECURITY.md).

## Code of conduct

See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
