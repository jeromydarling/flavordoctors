import { json, readJson, errorResponse } from '../lib/util';
import { requireStaff, requireAdmin } from '../lib/auth';
import { upsertCrmContact, logInteraction, crmDailySweep, CRM_KINDS, CRM_STATUSES } from '../lib/crm';
import { sendEmail } from '../lib/email';
import { audit } from '../lib/audit';

const MANUAL_INTERACTIONS = ['call', 'meeting', 'note', 'email_in'];

export const crmList = requireStaff(async (req, rc) => {
  const url = new URL(req.url);
  const status = url.searchParams.get('status');
  const kind = url.searchParams.get('kind');
  const q = url.searchParams.get('q')?.trim().toLowerCase();
  const clauses: string[] = [];
  const binds: string[] = [];
  if (status && CRM_STATUSES.includes(status as never)) {
    clauses.push('status = ?');
    binds.push(status);
  }
  if (kind && CRM_KINDS.includes(kind as never)) {
    clauses.push('kind = ?');
    binds.push(kind);
  }
  if (q) {
    clauses.push('(email LIKE ? OR LOWER(COALESCE(name,"")) LIKE ? OR LOWER(COALESCE(company,"")) LIKE ?)');
    binds.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { results } = await rc.env.DB.prepare(
    `SELECT * FROM crm_contacts ${where} ORDER BY COALESCE(last_touch_at, created_at) DESC LIMIT 200`
  )
    .bind(...binds)
    .all();
  const { results: openTasks } = await rc.env.DB.prepare(
    "SELECT contact_id, COUNT(*) n FROM crm_tasks WHERE done = 0 AND due_at <= datetime('now', '+1 day') GROUP BY contact_id"
  ).all<{ contact_id: string; n: number }>();
  const taskMap = Object.fromEntries(openTasks.map((t) => [t.contact_id, t.n]));
  return json({ contacts: results.map((c) => ({ ...c, dueTasks: taskMap[String(c.id)] ?? 0 })) });
});

export const crmCreate = requireStaff(async (req, rc) => {
  const body = await readJson<{ email?: string; name?: string; company?: string; kind?: string; status?: string; notesMd?: string }>(req);
  if (!body?.email?.includes('@')) return errorResponse('A valid email is required');
  const id = await upsertCrmContact(rc.env, {
    email: body.email,
    name: body.name?.trim() || null,
    company: body.company?.trim() || null,
    kind: body.kind,
    status: body.status,
    notesMd: body.notesMd ?? null,
  });
  rc.ctx.waitUntil(audit(rc.env, rc.user!.email, 'crm_contact_create', id, body.email.toLowerCase()));
  return json({ id }, 201);
});

export const crmDetail = requireStaff(async (_req, rc) => {
  const contact = await rc.env.DB.prepare('SELECT * FROM crm_contacts WHERE id = ?').bind(rc.params.id).first();
  if (!contact) return errorResponse('Contact not found', 404);
  const [{ results: interactions }, { results: tasks }] = await Promise.all([
    rc.env.DB.prepare('SELECT * FROM crm_interactions WHERE contact_id = ? ORDER BY created_at DESC LIMIT 100')
      .bind(rc.params.id)
      .all(),
    rc.env.DB.prepare('SELECT * FROM crm_tasks WHERE contact_id = ? ORDER BY done, due_at LIMIT 50')
      .bind(rc.params.id)
      .all(),
  ]);
  return json({ contact, interactions, tasks });
});

export const crmUpdate = requireStaff(async (req, rc) => {
  const body = await readJson<{ name?: string | null; company?: string | null; kind?: string; status?: string; notesMd?: string | null; nextFollowupAt?: string | null }>(req);
  if (!body) return errorResponse('Invalid JSON body');
  const existing = await rc.env.DB.prepare('SELECT id FROM crm_contacts WHERE id = ?').bind(rc.params.id).first();
  if (!existing) return errorResponse('Contact not found', 404);
  if (body.kind && !CRM_KINDS.includes(body.kind as never)) return errorResponse('Invalid kind');
  if (body.status && !CRM_STATUSES.includes(body.status as never)) return errorResponse('Invalid status');
  // Explicit human edits DO overwrite (the fill-blanks rule applies to automated upserts).
  await rc.env.DB.prepare(
    `UPDATE crm_contacts SET
       name = COALESCE(?, name), company = COALESCE(?, company),
       kind = COALESCE(?, kind), status = COALESCE(?, status),
       notes_md = COALESCE(?, notes_md), next_followup_at = COALESCE(?, next_followup_at),
       updated_at = datetime('now')
     WHERE id = ?`
  )
    .bind(body.name ?? null, body.company ?? null, body.kind ?? null, body.status ?? null, body.notesMd ?? null, body.nextFollowupAt ?? null, rc.params.id)
    .run();
  return json({ ok: true });
});

export const crmAddInteraction = requireStaff(async (req, rc) => {
  const body = await readJson<{ kind?: string; summary?: string; detail?: string }>(req);
  if (!body?.kind || !MANUAL_INTERACTIONS.includes(body.kind)) {
    return errorResponse(`kind must be one of: ${MANUAL_INTERACTIONS.join(', ')}`);
  }
  if (!body.summary?.trim()) return errorResponse('summary is required');
  const contact = await rc.env.DB.prepare('SELECT id FROM crm_contacts WHERE id = ?').bind(rc.params.id).first();
  if (!contact) return errorResponse('Contact not found', 404);
  await logInteraction(rc.env, rc.params.id, body.kind, body.summary.trim(), {
    detail: body.detail?.trim() || null,
    createdBy: rc.user!.email,
  });
  return json({ ok: true }, 201);
});

/** 1:1 relationship email, rendered through the branded shell; logs email_out. */
export const crmComposeEmail = requireStaff(async (req, rc) => {
  const body = await readJson<{ subject?: string; bodyHtml?: string }>(req);
  if (!body?.subject?.trim() || !body.bodyHtml?.trim()) return errorResponse('subject and bodyHtml required');
  const contact = await rc.env.DB.prepare('SELECT id, email, name FROM crm_contacts WHERE id = ?')
    .bind(rc.params.id)
    .first<{ id: string; email: string; name: string | null }>();
  if (!contact) return errorResponse('Contact not found', 404);
  await sendEmail(rc.env, contact.email, body.subject.trim(), body.bodyHtml);
  await logInteraction(rc.env, contact.id, 'email_out', body.subject.trim(), {
    detail: body.bodyHtml,
    createdBy: rc.user!.email,
  });
  return json({ ok: true });
});

export const crmAddTask = requireStaff(async (req, rc) => {
  const body = await readJson<{ title?: string; dueAt?: string }>(req);
  if (!body?.title?.trim()) return errorResponse('title is required');
  if (!body.dueAt || Number.isNaN(Date.parse(body.dueAt))) return errorResponse('dueAt (ISO timestamp) is required');
  const contact = await rc.env.DB.prepare('SELECT id FROM crm_contacts WHERE id = ?').bind(rc.params.id).first();
  if (!contact) return errorResponse('Contact not found', 404);
  await rc.env.DB.prepare('INSERT INTO crm_tasks (contact_id, title, due_at) VALUES (?, ?, ?)')
    .bind(rc.params.id, body.title.trim(), new Date(body.dueAt).toISOString())
    .run();
  return json({ ok: true }, 201);
});

export const crmCompleteTask = requireStaff(async (_req, rc) => {
  const result = await rc.env.DB.prepare(
    "UPDATE crm_tasks SET done = 1, done_at = datetime('now') WHERE id = ? AND done = 0"
  )
    .bind(rc.params.taskId)
    .run();
  if (result.meta.changes === 0) return errorResponse('Task not found or already done', 404);
  return json({ ok: true });
});

/** Ops/test utility: run the daily relationship sweep immediately. */
export const crmSweepNow = requireAdmin(async (_req, rc) => {
  await crmDailySweep(rc.env);
  return json({ ok: true });
});
