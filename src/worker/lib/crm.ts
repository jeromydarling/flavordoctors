import type { Env } from '../types';
import { newId } from './util';

/**
 * B2B relationship layer. Two invariants from the spec:
 *  - Upsert by email everywhere: fill blanks, NEVER overwrite what a human wrote.
 *  - Every outbound email to a contact logs an email_out interaction.
 */

export interface CrmContactInput {
  email: string;
  name?: string | null;
  company?: string | null;
  kind?: string;
  status?: string;
  tags?: string[] | null;
  notesMd?: string | null;
  city?: string | null;
  region?: string | null;
  nextFollowupAt?: string | null;
}

export const CRM_KINDS = ['vendor', 'distributor', 'retailer', 'other'] as const;
export const CRM_STATUSES = ['lead', 'active', 'key_account', 'at_risk', 'dormant'] as const;

/** Upsert by email: creates when missing; fills only NULL columns when present. */
export async function upsertCrmContact(env: Env, input: CrmContactInput): Promise<string> {
  const email = input.email.trim().toLowerCase();
  const existing = await env.DB.prepare('SELECT id FROM crm_contacts WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE crm_contacts SET
         name = COALESCE(name, ?), company = COALESCE(company, ?),
         city = COALESCE(city, ?), region = COALESCE(region, ?),
         updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(input.name ?? null, input.company ?? null, input.city ?? null, input.region ?? null, existing.id)
      .run();
    return existing.id;
  }
  const id = newId('crm');
  await env.DB.prepare(
    `INSERT INTO crm_contacts (id, email, name, company, kind, status, tags, notes_md, city, region, next_followup_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      email,
      input.name ?? null,
      input.company ?? null,
      CRM_KINDS.includes((input.kind ?? '') as (typeof CRM_KINDS)[number]) ? input.kind! : 'vendor',
      CRM_STATUSES.includes((input.status ?? '') as (typeof CRM_STATUSES)[number]) ? input.status! : 'lead',
      input.tags ? JSON.stringify(input.tags) : null,
      input.notesMd ?? null,
      input.city ?? null,
      input.region ?? null,
      input.nextFollowupAt ?? null
    )
    .run();
  return id;
}

export async function logInteraction(
  env: Env,
  contactId: string,
  kind: string,
  summary: string,
  opts: { detail?: string | null; createdBy?: string | null; touch?: boolean } = {}
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO crm_interactions (contact_id, kind, summary, detail, created_by) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(contactId, kind, summary, opts.detail ?? null, opts.createdBy ?? null)
    .run();
  if (opts.touch !== false) {
    await env.DB.prepare("UPDATE crm_contacts SET last_touch_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .bind(contactId)
      .run();
  }
}

/**
 * Daily relationship sweep:
 *  - new contact, no touch within 5 days of creation → file an intro task
 *  - next_followup_at due → file a follow-up task
 *  - active/key_account quiet for 30 days → flag at_risk + file a task
 * auto_key keeps every sweep-created task at-most-once.
 */
export async function crmDailySweep(env: Env): Promise<void> {
  const { results: newUntouched } = await env.DB.prepare(
    `SELECT id, COALESCE(company, name, email) label FROM crm_contacts
     WHERE last_touch_at IS NULL AND created_at <= datetime('now', '-5 days') AND status NOT IN ('dormant')`
  ).all<{ id: string; label: string }>();
  for (const c of newUntouched) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO crm_tasks (contact_id, title, due_at, auto_key) VALUES (?, ?, datetime('now'), ?)"
    )
      .bind(c.id, `Reach out to ${c.label} — added 5+ days ago, never contacted`, `intro:${c.id}`)
      .run();
  }

  const { results: due } = await env.DB.prepare(
    `SELECT id, COALESCE(company, name, email) label, next_followup_at FROM crm_contacts
     WHERE next_followup_at IS NOT NULL AND next_followup_at <= datetime('now')`
  ).all<{ id: string; label: string; next_followup_at: string }>();
  for (const c of due) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO crm_tasks (contact_id, title, due_at, auto_key) VALUES (?, ?, ?, ?)"
    )
      .bind(c.id, `Follow up with ${c.label} (promised)`, c.next_followup_at, `followup:${c.id}:${c.next_followup_at}`)
      .run();
    await env.DB.prepare("UPDATE crm_contacts SET next_followup_at = NULL, updated_at = datetime('now') WHERE id = ?")
      .bind(c.id)
      .run();
  }

  const { results: quiet } = await env.DB.prepare(
    `SELECT id, COALESCE(company, name, email) label, last_touch_at FROM crm_contacts
     WHERE status IN ('active', 'key_account') AND last_touch_at IS NOT NULL AND last_touch_at <= datetime('now', '-30 days')`
  ).all<{ id: string; label: string; last_touch_at: string }>();
  for (const c of quiet) {
    await env.DB.prepare("UPDATE crm_contacts SET status = 'at_risk', updated_at = datetime('now') WHERE id = ?")
      .bind(c.id)
      .run();
    await env.DB.prepare(
      "INSERT OR IGNORE INTO crm_tasks (contact_id, title, due_at, auto_key) VALUES (?, ?, datetime('now'), ?)"
    )
      .bind(c.id, `${c.label} has gone quiet (30+ days) — check in`, `atrisk:${c.id}:${c.last_touch_at}`)
      .run();
    await logInteraction(env, c.id, 'system', 'Flagged at_risk: no touch in 30+ days', { touch: false });
  }
}
