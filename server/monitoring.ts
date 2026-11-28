export type LogSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export type AlertType =
  | 'SQLITE_SAVE_FAILED'
  | 'MONOBANK_WEBHOOK_REJECTED'
  | 'MONOBANK_PAYMENT_MISMATCH'
  | 'UNHANDLED_SERVER_ERROR';

export interface ProductionAlertOptions {
  alertType: AlertType;
  severity?: LogSeverity;
  message: string;
  error?: unknown;
  context?: Record<string, unknown>;
}

interface ParsedSentryDsn {
  storeUrl: string;
  publicKey: string;
}

const ALERT_THROTTLE_MS = 60_000;
const lastWebhookAlertMsByType = new Map<string, number>();

export function parseSentryDsn(rawDsn: string | undefined): ParsedSentryDsn | null {
  const trimmed = rawDsn?.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const publicKey = parsed.username;
    const projectId = parsed.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (!publicKey || !projectId || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')) {
      return null;
    }
    return {
      storeUrl: `${parsed.protocol}//${parsed.host}/api/${projectId}/store/`,
      publicKey,
    };
  } catch {
    return null;
  }
}

function serializeError(error: unknown): { name?: string; message: string; stack?: string } | undefined {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return {
    message: typeof error === 'string' ? error : String(error),
  };
}

function isStructuredCloudLoggingEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    Boolean(process.env.K_SERVICE) ||
    process.env.CLOUD_LOGGING_JSON === 'true'
  );
}

export function logStructured(
  severity: LogSeverity,
  message: string,
  payload?: Record<string, unknown>
): void {
  const entry = {
    severity,
    message,
    timestamp: new Date().toISOString(),
    serviceContext: {
      service: process.env.K_SERVICE || 'dankiv-writer-site',
      version: process.env.K_REVISION || process.env.npm_package_version || 'local',
    },
    ...(payload || {}),
  };

  if (isStructuredCloudLoggingEnabled()) {
    const line = JSON.stringify(entry);
    if (severity === 'ERROR' || severity === 'CRITICAL') {
      process.stderr.write(`${line}\n`);
    } else {
      process.stdout.write(`${line}\n`);
    }
    return;
  }

  if (severity === 'ERROR' || severity === 'CRITICAL') {
    console.error(`[${severity}] ${message}`, payload || '');
  } else if (severity === 'WARNING') {
    console.warn(`[${severity}] ${message}`, payload || '');
  }
}

async function sendToSentry(
  severity: LogSeverity,
  message: string,
  error?: unknown,
  context?: Record<string, unknown>
): Promise<void> {
  const dsn = parseSentryDsn(process.env.SENTRY_DSN);
  if (!dsn) return;

  const serialized = serializeError(error);
  const sentryLevel =
    severity === 'CRITICAL'
      ? 'fatal'
      : severity === 'ERROR'
        ? 'error'
        : severity === 'WARNING'
          ? 'warning'
          : 'info';

  const body = {
    event_id: cryptoRandomHex(16),
    timestamp: Math.floor(Date.now() / 1000),
    platform: 'node',
    level: sentryLevel,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.K_REVISION || undefined,
    message: { formatted: message },
    ...(serialized
      ? {
          exception: {
            values: [
              {
                type: serialized.name || 'Error',
                value: serialized.message,
              },
            ],
          },
        }
      : {}),
    extra: {
      ...(context || {}),
      ...(serialized?.stack ? { stack: serialized.stack } : {}),
    },
  };

  try {
    await fetch(dsn.storeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=dankiv-monitor/1.0, sentry_key=${dsn.publicKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Never throw from telemetry transport
  }
}

async function sendAlertWebhook(options: ProductionAlertOptions): Promise<void> {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL?.trim();
  if (!webhookUrl) return;

  const now = Date.now();
  const prevMs = lastWebhookAlertMsByType.get(options.alertType) || 0;
  if (now - prevMs < ALERT_THROTTLE_MS) return;
  lastWebhookAlertMsByType.set(options.alertType, now);

  const severity = options.severity || 'ERROR';
  const serialized = serializeError(options.error);
  const service = process.env.K_SERVICE || 'dankiv-writer-site';
  const text = `[${severity}] ${service} · ${options.alertType}: ${options.message}${
    serialized?.message ? ` (${serialized.message})` : ''
  }`;

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        severity,
        alertType: options.alertType,
        service,
        timestamp: new Date(now).toISOString(),
        message: options.message,
        error: serialized,
        context: options.context,
      }),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // Never throw from alert webhook transport
  }
}

function cryptoRandomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function emitProductionAlert(options: ProductionAlertOptions): void {
  const severity = options.severity || 'ERROR';
  const serializedError = serializeError(options.error);

  logStructured(severity, options.message, {
    alertType: options.alertType,
    ...(serializedError ? { error: serializedError } : {}),
    ...(options.context ? { context: options.context } : {}),
  });

  if (process.env.NODE_ENV !== 'test') {
    void sendToSentry(severity, options.message, options.error, {
      alertType: options.alertType,
      ...(options.context || {}),
    });
    void sendAlertWebhook(options);
  }
}

export function reportProductionError(
  message: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  const serializedError = serializeError(error);
  logStructured('ERROR', message, {
    ...(serializedError ? { error: serializedError } : {}),
    ...(context ? { context } : {}),
  });

  if (process.env.NODE_ENV !== 'test') {
    void sendToSentry('ERROR', message, error, context);
  }
}
