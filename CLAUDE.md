# portaBaltica — Claude Code Instructions

## Project Overview

PortaBaltica is a React + TypeScript web application deployed with Azure Static Web Apps.

## Architecture

- `src/` — application UI and domain logic
- `api/` — backend/API logic for SWA integration
- `tests/` — Vitest and component-level tests
- `infrastructure/` — Bicep templates for Azure resources

## Key Rules

- Keep code strongly typed and lint-clean.
- Use environment variables for all runtime secrets.
- Maintain mobile responsiveness and accessibility.

## Validation

- `npm run lint`
- `npm run build`
- `npm run test`
