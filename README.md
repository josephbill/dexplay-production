# DexPlay Production

Production PWA and cloud services live here. The existing `../dexplay-mvp` remains the separate validation CLI.

## Run locally

1. Install Node 20+ and Python 3.11+.
2. In `web/`, run `pnpm install` then `pnpm dev`.
3. For a private cloud deployment, copy the root `.env.example` to `.env` and `api/.env.example` to `api/.env`; set real credentials, then run `docker compose up --build`. The web service listens on port 8080. Put an HTTPS reverse proxy in front before enabling camera or payments.
4. For API-only development, configure `api/.env`, install `requirements.txt`, run Alembic migrations, then start `uvicorn app.main:app --reload`.

The free child and clinic flows run locally after the PWA shell has been installed. Gameplay never makes network requests and video is processed in the browser. The cloud `/sync` path is only used after a device key is activated. Cloud startup is deliberately fail-closed: live LLM, database, encryption, PayPal and Twilio settings are validated when their services are enabled. No sandbox PayPal mode, demo API keys, fake resources, or simulated payment success is shipped.

## Structure

- `web/`: React/Vite PWA, OpenCV.js camera pipeline, IndexedDB, printable mat, child game, and clinic dashboard.
- `api/`: FastAPI orchestrator, tool-calling agents, SQLAlchemy models, PayPal REST/webhook verification, and Twilio notifications.
- `infra/`: PostgreSQL, Redis, API, and Celery worker compose configuration.

## Required live configuration

See `api/.env.example` and the root `.env.example`. PayPal requires live client credentials, a registered webhook ID, and active plan IDs for both plans. SMS requires active Twilio credentials and a sender or Messaging Service SID. The API refuses to enable paid flows without these values. Set a persistent 32-byte base64 `DATA_ENCRYPTION_KEY`, API-key pepper, HTTPS origin, and PostgreSQL/Redis URLs. Never commit `.env` files.

## Privacy / performance

Frames remain in browser memory and are never sent or stored. Only round/session measurements can be synced. Server-side session/profile payloads are encrypted before persistence. OpenCV is dynamically loaded only when the camera exercise starts, so the app shell remains small; OpenCV's prebuilt WASM is an additional offline-cached asset and means the strict `<5MB including WASM` target is not met by the upstream binary. A reduced custom OpenCV build is required to meet that target. Verify frame rates on the target Snapdragon 730 and clinic laptop before release.

The catalog starts empty by design. Populate only reviewed resources with verified availability, matching SHA-256 hashes, and documented licenses before enabling them; no invented content or sample URLs are seeded.

The latest web build precaches 10,785 KiB uncompressed (about 3.64 MB gzip across app, OpenCV, and service worker). The compressed transfer fits a 5 MB budget; the installed offline cache does not. The production system must be deployed behind HTTPS, with DB backups, monitoring, key rotation, privacy notices, consent flows, retention policy, and jurisdiction-specific clinical/privacy review before real patient use.

## API tooling

Import [api/postman/DexPlay-Production.postman_collection.json](api/postman/DexPlay-Production.postman_collection.json) into Postman to explore the implemented API routes. The collection marks live PayPal subscription creation and account deletion as real side effects; the webhook route is for PayPal-signed deliveries only. Use synthetic, non-identifying practice data when exercising sync endpoints.

## Render free-tier proof-of-concept deployment

The root `render.yaml` defines a free Render Blueprint with the static PWA, FastAPI service, Render Postgres, and private-only Render Key Value. The PWA and API use the paired default Render hosts `dexplay-web.onrender.com` and `dexplay-api.onrender.com`; update `VITE_API_URL`, `PUBLIC_ORIGIN`, and `ALLOWED_ORIGINS` together if you rename either service or add a custom domain. The API's `DATABASE_URL` and `REDIS_URL` are linked to the Render-managed database and Key Value. The API normalizes Render's PostgreSQL URL to the asyncpg SQLAlchemy driver. The browser and service worker both use the configured API origin; local development continues to use Vite's `/api` proxy.

To deploy, push this repository to a Git provider, create a Render Blueprint from the repository root, supply `OPENAI_API_KEY` when prompted, and deploy. Render generates the encryption key and API-key pepper. Back up `DATA_ENCRYPTION_KEY` securely and keep it stable: replacing it prevents decryption of existing saved cloud data. PayPal remains unavailable until live client credentials, a registered webhook ID, and active individual/clinic plan IDs are added to the API service. Leave Twilio credentials blank on this free blueprint because it has no background worker; deploy a paid Render worker before enabling SMS.

This configuration is for a demo or proof of concept, **not production patient data**. Render's free API service sleeps after 15 minutes without traffic and can take about a minute to wake. Free Postgres is limited to 1 GB, has no backups, and expires after 30 days. Free Key Value is limited to 25 MB and loses data when restarted. Render does not offer a free background worker, so SMS task processing is disabled. Upgrade the API, database, Key Value, and add a worker with persistence/backups before using this deployment for a production service or real patient data.
