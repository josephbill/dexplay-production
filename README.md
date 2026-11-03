# DexPlay

DexPlay is an offline-capable web app for camera-guided dexterity games, with optional cloud analysis and a protected workflow for reviewing learning resources. This repository contains the React Progressive Web App (PWA), the FastAPI service, and deployment configuration. It is a proof of concept and is **not ready for real patient data**.

## What the app does

- Lets a caregiver or clinic create local child profiles and play four camera-guided activities: color sorting, stacking, threading, and button practice.
- Uses the device camera and hand-landmark model in the browser to track interaction with a printed DexPlay mat. Video is not uploaded.
- Saves profiles, sessions, rounds, preferences, and downloaded resources in browser IndexedDB so core practice and progress remain local.
- Offers a clinic roster, local progress, printable reports, and a resource catalog.
- Can optionally sync session measurements to the API, generate AI feedback and adaptive difficulty suggestions, translate report text to the selected app language, and match reviewed resources.
- Includes a protected resource-review workflow. Discovered public-feed entries remain candidates until a reviewer checks and approves them.
- Supports ten interface languages: English, Spanish, Hindi, Chinese, Arabic, Swahili, Portuguese, French, Bengali, and Filipino.
- Uses responsive, spaced layouts for home and patient dashboards, detailed session reports, onboarding, and resource review. AI feedback follows the selected app language and is hidden when translation is unavailable.

## Project layout

```text
web/                         React, TypeScript, Vite PWA
  src/App.tsx                App state, setup, screen selection, cloud sync
  src/components/            Game session and reports screens
  src/cv/                    Camera UI and hand-landmark worker
  src/db/                    IndexedDB schema and helpers
  src/i18n/                  Language catalogs and localized content
  public/                    PWA assets, mat, hand model, runtime WASM
api/                         FastAPI service
  app/main.py                HTTP routes, authentication, request lifecycle
  app/orchestrator.py        Concurrent analysis-agent orchestration
  app/agents/                Privacy, adaptive play, reports, resources, AI
  app/services/              Resource discovery and payment integrations
  app/models/                SQLAlchemy persistence entities
  migrations/                Alembic database migrations
  tests/                     API tests
  postman/                   API request collection
docker-compose.yml           Local PostgreSQL, Redis, API, worker, and web
render.yaml                  Render proof-of-concept blueprint
```

See [architecture.md](./architecture.md) for component responsibilities, data flows, AI boundaries, and deployment details.

## Run and validate locally

### Web app

Requirements: Node.js `>=20.19.0` and pnpm.

```powershell
cd web
pnpm install
pnpm dev
```

The Vite development server proxies `/api` requests to `http://localhost:8000`. Start the API as well to try cloud-backed features. Camera access requires browser permission and a secure context (localhost is treated as secure by modern browsers).

```powershell
pnpm build
pnpm preview
```

The web package does not currently define a test script or browser test suite.

### API

Requirements: Python 3.11+, PostgreSQL, and Redis. Copy `api/.env.example` to `api/.env`, fill in appropriate local values, install dependencies, and run migrations before starting the service:

```powershell
cd api
python -m pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload
```

Configuration is validated at startup. In particular, `ALLOWED_ORIGINS` must include the web origin, the encryption key must decode to 32 bytes, the API-key pepper must be at least 32 bytes, and reviewer credentials must be at least 32 bytes when configured. Do not copy production credentials into a local development environment.

Run API tests from `api/`:

```powershell
python -m pytest -q
```

### Docker Compose

The root `docker-compose.yml` runs PostgreSQL, Redis, the API, a Celery worker, and the built web app. Copy the root `.env.example` to `.env` and `api/.env.example` to `api/.env`, configure private values, then run `docker compose up --build`. The web container listens on port `8080`. Use HTTPS for a deployed camera-enabled app.

## AI, camera processing, and privacy

AI is optional and is off until a user opts in separately for a profile. It is not used to invent game scores or observe video. The camera hand-landmark model is a separate on-device computer-vision component; its frames stay in browser memory and are not sent to the API.

When AI consent is enabled:

- The free-analysis endpoint can return brief, pseudonymous feedback from submitted round measurements.
- Authenticated cloud sync can generate parent, therapist, and patient reports, suggest next-session difficulty, and request matching against the reviewed catalog.
- Before LLM analysis, the API narrows inputs to the fields needed for the task, such as a broad age band, language, game mode, bounded difficulty settings, and round measurements. Names, profile/session identifiers, contact information, diagnosis/condition categories, and camera video are excluded from AI prompts.
- The AI can summarize the measurements and suggest settings, but it does not diagnose. Suggested difficulty is not applied until the user accepts it. Reports are not guaranteed: network, consent, subscription, or provider failures leave local measurements available and are shown as status.
- Report translation is a separate, consent-gated request that translates report text into the selected interface language. If translation is unavailable, the UI hides the untranslated AI feedback rather than presenting it as if it were translated.

Cloud session payloads are encrypted before persistence. API device keys are hashed for lookup; account deletion and export are provided through protected API routes. Review credentials and payment secrets are server-side only. Read the privacy and security notes in [architecture.md](./architecture.md) and review all consent and data-retention requirements before any real-world deployment.

## Resource review

The published catalog is intentionally not populated with fabricated content. The reviewer workflow uses a server-only `RESOURCE_REVIEWER_TOKEN`; it is not bundled into the PWA. The proof-of-concept discovery source is The OT Toolbox public RSS feed. Discovery is manually triggered and rate-limited. Each candidate must be reviewed for public access, license/copyright status, intended age range, relevance, safety, and link status before publication. External resources are not labelled clinic-recommended unless a clinic explicitly approves them and records evidence.

Set the reviewer token in the API environment and share it with designated reviewers through a secure channel. Do not use a `VITE_*` variable or commit it to source control. Discovery and catalog behavior are implemented in `api/app/services/resource_discovery.py` and the protected `/review/resources/*` routes.

## Configuration and deployment

- Root `.env.example` contains the Compose database password placeholder.
- `api/.env.example` documents API settings, encryption keys, allowed origins, OpenAI, PayPal, resource-review, and optional Twilio variables.
- `render.yaml` describes the hosted proof-of-concept static PWA, API, PostgreSQL, and Redis services. See [RENDER-PAYPAL-SANDBOX.md](./RENDER-PAYPAL-SANDBOX.md) for sandbox payment setup.
- The Render demo is configured for sandbox payments and has free-tier limitations. It is not suitable for production or patient data.
- See [PAYWALL-COMPARISON.md](./PAYWALL-COMPARISON.md) for the current local/free versus subscribed cloud capabilities.

Keep encryption keys stable and backed up; losing or replacing the key makes previously encrypted cloud data unreadable. A real production deployment needs HTTPS, persistent and backed-up services, monitoring, incident response, key rotation, an established retention policy, and jurisdiction-specific privacy and clinical review.

## Diagnostics and API exploration

Browser operation events are prefixed `[DexPlay operation]`; session sync emits `[DexPlay sync]` events. API logs correlate requests with request IDs and avoid logging credentials, personal identifiers, report text, request bodies, or raw session measurements.

Import [api/postman/DexPlay-Production.postman_collection.json](./api/postman/DexPlay-Production.postman_collection.json) into Postman to explore the API. Subscription creation and account deletion have real side effects in a live deployment. Use synthetic, non-identifying data for manual requests.
