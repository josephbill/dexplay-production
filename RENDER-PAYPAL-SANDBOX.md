# Render PayPal sandbox demo setup

The Render Blueprint defines two separate payment environments:

- **Production:** `https://dexplay-web.onrender.com` → `https://dexplay-api.onrender.com`, using `APP_ENV=production` and `PAYPAL_MODE=live`.
- **Sandbox demo:** `https://dexplay-web-sandbox.onrender.com` → `https://dexplay-api-sandbox.onrender.com`, using `APP_ENV=staging` and `PAYPAL_MODE=sandbox`.

The sandbox API has its own database and Redis service. Its device keys and demo records are not production credentials or data. The browser does not choose the PayPal mode; the API selects it from its server environment. Production rejects sandbox mode.

## 1. Provision the sandbox services

1. Push the repository changes to the Git branch connected to Render.
2. In Render, sync the existing Blueprint with `render.yaml` and approve creation of `dexplay-web-sandbox`, `dexplay-api-sandbox`, `dexplay-sandbox-db`, and `dexplay-redis-sandbox`.
3. Keep the existing `dexplay-api` settings unchanged: `APP_ENV=production` and `PAYPAL_MODE=live`.
4. Wait for the sandbox web and API services to deploy. The sandbox API health check should pass at `https://dexplay-api-sandbox.onrender.com/health/ready`.

Render may ask for values marked `sync: false` during Blueprint sync. Enter them in Render's protected environment-variable fields, not in this file or source control.

## 2. Create PayPal sandbox credentials and plans

1. In the PayPal Developer Dashboard, use the **Sandbox** environment.
2. Create a sandbox REST app and use its client ID and secret.
3. Create two monthly subscription plans matching the prices shown in DexPlay: individual at **$9.99/month** and clinic at **$49/month**. Copy their sandbox plan IDs.
4. Create a webhook for the sandbox API URL:
   `https://dexplay-api-sandbox.onrender.com/paypal/webhook`
5. Subscribe it to these events:
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.EXPIRED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
6. Copy the sandbox webhook ID.

## 3. Configure the sandbox API service

In the `dexplay-api-sandbox` Render service, set:

| Environment variable | Value |
|---|---|
| `APP_ENV` | `staging` |
| `PAYPAL_MODE` | `sandbox` |
| `PAYPAL_SANDBOX_CLIENT_ID` | Sandbox REST app client ID |
| `PAYPAL_SANDBOX_CLIENT_SECRET` | Sandbox REST app secret |
| `PAYPAL_SANDBOX_WEBHOOK_ID` | Sandbox webhook ID |
| `PAYPAL_SANDBOX_INDIVIDUAL_PLAN_ID` | Sandbox $9.99/month plan ID |
| `PAYPAL_SANDBOX_CLINIC_PLAN_ID` | Sandbox $49/month plan ID |

The Blueprint supplies the sandbox service's public origin, allowed web origin, isolated database and Redis URLs, encryption key, and API-key pepper. It also requires `OPENAI_API_KEY` for API startup. Save the changes and redeploy the sandbox API.

Leave `PAYPAL_MODE=live` and the existing live PayPal credentials/plans on the production API. Never copy sandbox credentials, webhook IDs, plan IDs, or generated device keys into the production service.

## 4. Run a sandbox purchase

1. Open `https://dexplay-web-sandbox.onrender.com` and choose **Settings → Plans**. It should show **SANDBOX — test transactions only; no real charges**.
2. Keep the SMS-consent option unchecked; SMS is not configured on this free Blueprint.
3. Select an individual or clinic plan. PayPal should show the sandbox checkout.
4. Approve with a PayPal sandbox buyer account from the Developer Dashboard, not a real PayPal account.
5. After PayPal sends the activation webhook, DexPlay claims the activation and saves the issued device key on that browser. Individual plans issue one device key; clinic plans issue multiple patient-device keys.

If the UI reports that sandbox payments are not configured, check that all five `PAYPAL_SANDBOX_*` values are set on `dexplay-api-sandbox` and that the service restarted. If checkout returns but activation remains pending, check the sandbox webhook URL, selected event types, webhook ID, and API logs.

## Notes

- Changing server environment variables requires a sandbox API redeploy/restart; there is no client-side switch.
- Render's free API may sleep, free Postgres expires after 30 days, and free Redis is volatile. This setup is for synthetic demo data only, not patient data.
- The production application and PayPal mode are not changed by sandbox testing.
