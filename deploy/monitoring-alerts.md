# Production Monitoring & Alerting

The server emits structured Google Cloud Logging JSON lines (`severity`, `message`, `alertType`, `serviceContext`, `context`) in production (`NODE_ENV=production`, Cloud Run `K_SERVICE`, or `CLOUD_LOGGING_JSON=true`) via `server/monitoring.ts`.

Optional direct notifications:
- `SENTRY_DSN` — forwards `ERROR` / `CRITICAL` / `WARNING` alerts and unhandled server exceptions to Sentry.
- `ALERT_WEBHOOK_URL` — sends deduplicated (60s per `alertType`) JSON alert payloads to Slack/Discord/custom webhook endpoints.

## Cloud Monitoring Log-Based Alert Policies

### 1. Failed to save to SQLite (`SQLITE_SAVE_FAILED`)
Create a log-based metric / alert in Cloud Monitoring using the filter:

```text
resource.type="cloud_run_revision"
jsonPayload.alertType="SQLITE_SAVE_FAILED"
severity="CRITICAL"
```

Alert threshold: trigger immediately when count > 0 over a 1-minute window.

### 2. Monobank Webhook Rejections & Amount Mismatches
Monitor failed signature checks, invalid invoices, and payment amount mismatches:

```text
resource.type="cloud_run_revision"
(jsonPayload.alertType="MONOBANK_WEBHOOK_REJECTED" OR jsonPayload.alertType="MONOBANK_PAYMENT_MISMATCH")
```

Alert threshold: trigger when count >= 3 within 5 minutes (or immediately for `MONOBANK_PAYMENT_MISMATCH`).
