import { json, readJson, errorResponse, newId } from '../lib/util';
import { requireAdmin } from '../lib/auth';
import { processPendingEvents, type KitContent } from '../lib/socialKits';

/**
 * Auto-drafted marketing kits (the 3e generator). Everything here is an
 * editable draft: the only exits are edit, archive, or hand-off to the
 * campaign composer — nothing ever auto-posts.
 */

export const listDrafts = requireAdmin(async (req, rc) => {
  const status = new URL(req.url).searchParams.get('status');
  const where = status ? 'WHERE d.status = ?' : "WHERE d.status != 'archived'";
  const stmt = rc.env.DB.prepare(
    `SELECT d.*, p.name AS product_name, p.slug AS product_slug FROM mkt_drafts d
     LEFT JOIN products p ON p.id = d.product_id ${where} ORDER BY d.created_at DESC LIMIT 100`
  );
  const { results } = await (status ? stmt.bind(status) : stmt).all<Record<string, unknown>>();
  return json({
    drafts: results.map((d) => ({ ...d, content: JSON.parse(String(d.content)) as KitContent })),
  });
});

export const updateDraft = requireAdmin(async (req, rc) => {
  const body = await readJson<{ content?: KitContent; status?: string }>(req);
  if (!body) return errorResponse('Invalid JSON body');
  const existing = await rc.env.DB.prepare('SELECT id FROM mkt_drafts WHERE id = ?').bind(rc.params.id).first();
  if (!existing) return errorResponse('Draft not found', 404);
  if (body.status && !['new', 'edited', 'used', 'archived'].includes(body.status)) {
    return errorResponse('Invalid status');
  }
  if (body.content) {
    for (const k of ['instagram', 'tweet', 'email_md', 'blurb'] as const) {
      if (typeof body.content[k] !== 'string') return errorResponse(`content.${k} must be a string`);
    }
    await rc.env.DB.prepare(
      "UPDATE mkt_drafts SET content = ?, status = COALESCE(?, 'edited'), updated_at = datetime('now') WHERE id = ?"
    )
      .bind(JSON.stringify(body.content), body.status ?? null, rc.params.id)
      .run();
  } else if (body.status) {
    await rc.env.DB.prepare("UPDATE mkt_drafts SET status = ?, updated_at = datetime('now') WHERE id = ?")
      .bind(body.status, rc.params.id)
      .run();
  }
  return json({ ok: true });
});

/** Load a draft's email section into the campaign composer as a draft campaign. */
export const draftToCampaign = requireAdmin(async (_req, rc) => {
  const draft = await rc.env.DB.prepare(
    'SELECT d.*, p.name AS product_name FROM mkt_drafts d LEFT JOIN products p ON p.id = d.product_id WHERE d.id = ?'
  )
    .bind(rc.params.id)
    .first<{ id: string; title: string; content: string; product_name: string | null }>();
  if (!draft) return errorResponse('Draft not found', 404);
  const content = JSON.parse(draft.content) as KitContent;
  const bodyHtml = content.email_md
    .split(/\n{2,}/)
    .map((para) => `<p>${para.trim().replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')}</p>`)
    .join('\n');
  const id = newId('cmp');
  await rc.env.DB.prepare(
    'INSERT INTO campaigns (id, name, segment, subject, body_html) VALUES (?, ?, ?, ?, ?)'
  )
    .bind(id, draft.title, 'all_contacts', `${draft.product_name ?? 'News'} — from the clinic`, bodyHtml)
    .run();
  await rc.env.DB.prepare("UPDATE mkt_drafts SET status = 'used', updated_at = datetime('now') WHERE id = ?")
    .bind(rc.params.id)
    .run();
  return json({ campaignId: id }, 201);
});

/** Manual "generate now": drain pending events without waiting for the cron. */
export const processDraftEvents = requireAdmin(async (_req, rc) => {
  const drafted = await processPendingEvents(rc.env, 10);
  const { results } = await rc.env.DB.prepare(
    "SELECT status, COUNT(*) n FROM mkt_events GROUP BY status"
  ).all<{ status: string; n: number }>();
  return json({ drafted, events: Object.fromEntries(results.map((r) => [r.status, r.n])) });
});
