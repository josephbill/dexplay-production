# PayPal sandbox demo on Render

The existing Render deployment is the **sandbox demo**:

- PWA: `https://dexplay-web.onrender.com`
- API: `https://dexplay-api.onrender.com`
- Webhook: `https://dexplay-api.onrender.com/paypal/webhook`

It uses the existing Render database and Redis. No second web/API/database stack is needed. The API mode is chosen by its server environment; there is no mode switch in the browser. The Render Blueprint sets `APP_ENV=staging` and `PAYPAL_MODE=sandbox`.

## Configure the existing API service

1. In Render, open the existing `dexplay-api` service and its **Environment** settings.
2. Set `APP_ENV` to `staging` and `PAYPAL_MODE` to `sandbox`.
3. Configure all five sandbox variables:

   | Variable | Value |
   |---|---|
   | `PAYPAL_SANDBOX_CLIENT_ID` | Client ID for your PayPal sandbox REST app |
   | `PAYPAL_SANDBOX_CLIENT_SECRET` | Secret for that sandbox app |
   | `PAYPAL_SANDBOX_WEBHOOK_ID` | ID of the sandbox webhook registered to the API URL above |
   | `PAYPAL_SANDBOX_INDIVIDUAL_PLAN_ID` | Sandbox monthly Individual plan ID ($9.99/month) |
   | `PAYPAL_SANDBOX_CLINIC_PLAN_ID` | Sandbox monthly Clinic plan ID ($49/month) |

4. Save the environment and redeploy/restart the API service.
5. Check `https://dexplay-api.onrender.com/paypal/config`. It should return `{"mode":"sandbox","enabled":true}`. If `enabled` is false, at least one of the five sandbox values is missing.

Render also generates `RESOURCE_REVIEWER_TOKEN`. Keep it server-side and share it only with the designated DexPlay content reviewer through a secure channel. It is not a `VITE_*` setting and must not be added to source control. Discovery uses the public OT Toolbox RSS feed, with no discovery-provider account, key, card, or subscription. The reviewer page limits discovery to 10 feed requests per UTC day. Physio-Pedia discovery remains deferred because its public sitemap returned 403; DexPlay does not bypass that response.

The API requires both plan IDs even if you are testing only one plan, so configure both. Keep the two actual live plan IDs and live PayPal credentials out of these sandbox variables.

## Set up the PayPal sandbox resources

1. In the PayPal Developer Dashboard, select the **Sandbox** environment.
2. Create or select a sandbox REST app. Copy its client ID and secret to the Render API variables above.
3. Create a monthly subscription product and two active plans, one for **$9.99/month** and one for **$49/month**. Copy their plan IDs to the corresponding Render variables.
4. In the same sandbox REST app, create a webhook with URL:
   `https://dexplay-api.onrender.com/paypal/webhook`
5. Subscribe it to:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
6. Copy the webhook's **Webhook ID** (not an event ID) to `PAYPAL_SANDBOX_WEBHOOK_ID`.

## Run a demo subscription

1. Open `https://dexplay-web.onrender.com`, then go to **Settings → Plans**. Confirm that it says **SANDBOX — test transactions only; no real charges**.
2. Leave SMS consent unchecked; SMS is not configured in the free Render setup.
3. Select an Individual or Clinic plan. Approve checkout using a PayPal **sandbox buyer account** from the Developer Dashboard, never a real buyer account.
4. PayPal sends the activation webhook to Render. DexPlay then creates and saves the device key on the browser that started checkout. Individual plans issue one key; Clinic plans issue patient-device keys.

## Show the AI contribution with synthetic data

AI is off by default. In the PWA, create a fictional profile (for example, “Demo Alex”), open **Settings**, review the per-profile AI data-sharing notice, and explicitly enable AI consent. The client sends only broad age band, language, game mode, bounded difficulty settings, and round measurements to the configured OpenAI provider. It does not send the profile name/ID, condition category, contact data, session IDs, camera video, or full prior reports. Local play/history does not depend on AI.

To demonstrate an actual AI response without using a real participant or real session data, send this synthetic request from Postman to `POST https://dexplay-api.onrender.com/analysis/free` (do not add a name, profile ID, or session ID):

```json
{
  "ai_consent": true,
  "session_data": [
    {"round_num":1,"mode":"sort_place","objects_placed":3,"objects_total":4,"avg_time":12.5,"fumbles":1,"accuracy":0.75},
    {"round_num":2,"mode":"sort_place","objects_placed":4,"objects_total":4,"avg_time":10.2,"fumbles":0,"accuracy":1.0},
    {"round_num":3,"mode":"sort_place","objects_placed":3,"objects_total":4,"avg_time":11.4,"fumbles":1,"accuracy":0.75}
  ],
  "profile": {
    "group":"child",
    "age_group":"7-9",
    "language":"en",
    "difficulty":{"object_size_mm":22,"time_limit_s":75,"objects_count":5,"zone_size_mm":80,"speed_factor":1},
    "recent_session_accuracy":[0.5,0.75,0.75]
  }
}
```

The response contains the measured summary, a brief AI-written report, and a next-difficulty proposal with rationale. A real user session in the PWA displays measured local results and clearly labels AI output; the proposal is not saved until the user/caregiver accepts the selected settings. Declining leaves the saved difficulty unchanged. OpenAI usage is billed and quota-controlled by the configured OpenAI account; do not use patient data for this demo.

For web-resource review, open **Settings → Open resource reviewer workflow**, enter the server-generated reviewer token, and manually start discovery. Candidates remain in that protected queue until the reviewer confirms public/free access, license status, age range, mat relevance, safety notes, and approves publication. An external link is not labelled clinic-recommended without documented clinic approval.

If the UI says sandbox payments are not configured, check that all five values are present on the `dexplay-api` service, then redeploy. If checkout succeeds but key activation stays pending, inspect the PayPal sandbox webhook delivery and Render API logs.

## Safety and data

- Do not set `PAYPAL_MODE=live` or enter live credentials on this demo deployment.
- The server rejects `PAYPAL_MODE=sandbox` when `APP_ENV=production`.
- Render's free Postgres expires after 30 days and free Redis is volatile. Use synthetic demo data only, not patient data.
- For a separate real production deployment, use its own API and database, set `APP_ENV=production` and `PAYPAL_MODE=live`, and configure only live PayPal credentials/plans/webhook. Do not mix sandbox device keys or accounts into it.
- The repository's automated PayPal flow test mocks PayPal and verifies checkout creation → activation webhook → one-time key claim → key activation. It is not a real sandbox transaction. Perform the steps above with a sandbox buyer and inspect the sandbox webhook delivery before claiming the deployed end-to-end transaction was verified.
