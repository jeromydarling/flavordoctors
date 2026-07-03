import type { Env } from '../types';

/**
 * SMS channel abstraction (Wave 3). Sends via Twilio when credentials are
 * configured; otherwise a logged no-op. Note: US A2P 10DLC registration is
 * required before production SMS — plan several weeks of carrier lead time.
 *
 * Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM (E.164 number).
 */
export async function sendSms(env: Env, to: string, body: string): Promise<void> {
  const cfg = env as unknown as Record<string, string | undefined>;
  const sid = cfg.TWILIO_ACCOUNT_SID;
  const token = cfg.TWILIO_AUTH_TOKEN;
  const from = cfg.TWILIO_FROM;
  if (!sid || !token || !from) {
    console.log(`[sms skipped — Twilio not configured] to=${to}`);
    return;
  }
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    });
    if (!res.ok) console.error(`SMS send failed (${res.status}): ${await res.text()}`);
  } catch (err) {
    console.error('SMS send failed:', err);
  }
}
