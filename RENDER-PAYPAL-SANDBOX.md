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

If the UI says sandbox payments are not configured, check that all five values are present on the `dexplay-api` service, then redeploy. If checkout succeeds but key activation stays pending, inspect the PayPal sandbox webhook delivery and Render API logs.

## Safety and data

- Do not set `PAYPAL_MODE=live` or enter live credentials on this demo deployment.
- The server rejects `PAYPAL_MODE=sandbox` when `APP_ENV=production`.
- Render's free Postgres expires after 30 days and free Redis is volatile. Use synthetic demo data only, not patient data.
- For a separate real production deployment, use its own API and database, set `APP_ENV=production` and `PAYPAL_MODE=live`, and configure only live PayPal credentials/plans/webhook. Do not mix sandbox device keys or accounts into it.
