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
| Generate cloud coaching and written reports | Not available | Requested during cloud sync; availability depends on the cloud/LLM service |
| Download recommended curated resources | Not available through cloud sync | Possible when matching, approved resources exist in the catalog |
| Use the cloud account endpoints (cloud export/delete and sync) | Not available | Available for an active key |
| Number of keys issued by plan | None | Individual: one device key; Clinic: up to 50 patient-device keys |

## Important distinctions

- **A subscription is not needed to use the core game.** Camera practice and local session history are available without cloud access.
- The Reports screen can show local scores and session history without a subscription. The written parent, therapist, and patient reports are generated as part of the cloud-sync response, not by the local-only flow.
- Resources are not guaranteed by subscribing. The project starts with an empty curated-resource catalog, so recommendations/downloads may return no matching items until reviewed resources are added.
- The clinic patient roster in the PWA is stored locally. The API also has a protected clinic-dashboard endpoint, but the current PWA does not call that endpoint; do not treat a remotely synchronized clinic dashboard as a current UI feature.
- Cloud sync and reports require a reachable, configured API and its dependencies. An active key alone cannot make an unavailable cloud or LLM service work.
- Video remains on the device. The cloud sync payload contains session/profile measurements, not camera video.
- In the current Render sandbox demo, PayPal approval and device-key issuance are for testing only; they do not represent a production subscription or real charge.

## Code references

- Local game/session flow and optional cloud sync: `web/src/components/GameSession.tsx`
- Cloud report and resource handling: `web/src/App.tsx`
- Subscription/device-key authorization and sync: `api/app/main.py`
- Clinic dashboard endpoint: `api/app/main.py`
- Curated-resource lookup: `api/app/agents/resource.py`
- Catalog is intentionally empty initially: `README.md`
