# DexPlay: subscribed vs. non-subscribed

This comparison describes behavior implemented in the current codebase. A subscription is activated by a PayPal subscription and an active device key; the API checks that key and the account's active subscription before allowing cloud operations.

| Capability | No active subscription / device key | Active subscription / device key |
|---|---|---|
| Camera setup and mat calibration | Available | Available |
| Play the available games | Available | Available |
| Save profiles, sessions, and round results on this device | Available locally | Available locally |
| See local progress, scores, and recent sessions | Available | Available |
| Export local data and print the on-device report view | Available | Available |
| Sync session measurements to DexPlay's cloud API | Not available; sessions remain on this device | Available when online and the API is healthy |
| Get a post-game agent report | Brief score and encouragement; pseudonymous round metrics are analyzed but not stored in cloud session history | Detailed parent, therapist, and patient reports after authenticated cloud sync |
| Receive adaptive next-session difficulty | Agent may return an updated difficulty based on this game and the limited accuracy history provided | Agent may return an updated difficulty based on the submitted session and available history |
| Find and download curated resources | Not run; resource mining is excluded from free analysis | Possible when matching, approved resources exist in the catalog |
| Use the cloud account endpoints (cloud export/delete and sync) | Not available | Available for an active key |
| Number of keys issued by plan | None | Individual: one device key; Clinic: up to 50 patient-device keys |

## Important distinctions

- **A subscription is not needed to use the core game.** Camera practice and local session history are available without cloud access.
- After a free session, the app may send pseudonymous game measurements plus a limited language/age-band/difficulty profile to the analysis API for a brief agent report. It does not send the user's name, profile ID, diagnosis, hand preference, or camera video through this free-analysis request. Free analysis is not stored as a cloud session; local game history stays on the device.
- The Reports screen can show local scores and session history without a subscription. Detailed parent, therapist, and patient reports are generated as part of authenticated cloud sync.
- Resources are not guaranteed by subscribing. The project starts with an empty curated-resource catalog, so recommendations/downloads may return no matching items until reviewed resources are added.
- The clinic patient roster in the PWA is stored locally. The API also has a protected clinic-dashboard endpoint, but the current PWA does not call that endpoint; do not treat a remotely synchronized clinic dashboard as a current UI feature.
- Free brief analysis requires a reachable API, Redis-based rate limiting, and the LLM service. If analysis is unavailable, the app shows a short on-device score summary. Detailed subscriber reports and resources require authenticated cloud sync.
- Video remains on the device. The cloud sync payload contains session/profile measurements, not camera video.
- In the current Render sandbox demo, PayPal approval and device-key issuance are for testing only; they do not represent a production subscription or real charge.

## Code references

- Local game/session flow and optional cloud sync: `web/src/components/GameSession.tsx`
- Cloud report and resource handling: `web/src/App.tsx`
- Subscription/device-key authorization and sync: `api/app/main.py`
- Clinic dashboard endpoint: `api/app/main.py`
- Curated-resource lookup: `api/app/agents/resource.py`
- Catalog is intentionally empty initially: `README.md`
