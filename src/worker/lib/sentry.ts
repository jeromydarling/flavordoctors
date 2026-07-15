import type { Env } from '../types';

/**
 * Minimal Sentry reporter for Workers — no SDK, one fetch to the envelope
 * endpoint. Inert unless the SENTRY_DSN secret is set, so it costs nothing
 * until error monitoring is switched on.
 */
export function captureException(env: Env, err: unknown, context: Record<string, string> = {}): Promise<void> {
  const dsn = env.SENTRY_DSN;
  if (!dsn) return Promise.resolve();
  try {
    const m = dsn.match(/^https:\/\/([a-f0-9]+)@([^/]+)\/(\d+)$/);
    if (!m) return Promise.resolve();
    const [, key, host, projectId] = m;
    const eventId = crypto.randomUUID().replace(/-/g, '');
    const now = new Date().toISOString();
    const e = err instanceof Error ? err : new Error(String(err));
    const event = {
      event_id: eventId,
      timestamp: now,
      platform: 'javascript',
      level: 'error',
      environment: 'production',
      tags: context,
      exception: {
        values: [{ type: e.name || 'Error', value: e.message, stacktrace: e.stack ? { frames: [] } : undefined }],
      },
      extra: { stack: e.stack ?? null },
    };
    const envelope =
      JSON.stringify({ event_id: eventId, sent_at: now }) +
      '\n' +
      JSON.stringify({ type: 'event' }) +
      '\n' +
      JSON.stringify(event);
    return fetch(`https://${host}/api/${projectId}/envelope/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=flavordoctors-worker/1.0`,
      },
      body: envelope,
    }).then(
      () => undefined,
      () => undefined // monitoring must never take the site down
    );
  } catch {
    return Promise.resolve();
  }
}
