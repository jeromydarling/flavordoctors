import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { AdminNav } from './AdminNav';

interface Contact {
  id: string;
  email: string;
  name: string | null;
  company: string | null;
  kind: string;
  status: string;
  notes_md: string | null;
  last_touch_at: string | null;
  next_followup_at: string | null;
  dueTasks?: number;
}
interface Interaction { id: number; kind: string; summary: string; detail: string | null; created_by: string | null; created_at: string }
interface Task { id: number; title: string; due_at: string; done: number }

const KINDS = ['vendor', 'distributor', 'retailer', 'other'];
const STATUSES = ['lead', 'active', 'key_account', 'at_risk', 'dormant'];
const STATUS_COLORS: Record<string, string> = {
  lead: 'bg-navy-lighter text-medical/70',
  active: 'bg-rx/20 text-rx',
  key_account: 'bg-gold/20 text-gold',
  at_risk: 'bg-red-500/20 text-red-300',
  dormant: 'bg-navy-lighter text-medical/40',
};

export function AdminCrm() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Contact | null>(null);
  const [timeline, setTimeline] = useState<Interaction[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [newContact, setNewContact] = useState({ email: '', name: '', company: '', kind: 'vendor' });
  const [logForm, setLogForm] = useState({ kind: 'call', summary: '' });
  const [taskForm, setTaskForm] = useState({ title: '', dueAt: '' });
  const [mail, setMail] = useState({ subject: '', body: '' });

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set('status', statusFilter);
    if (search.trim()) params.set('q', search.trim());
    const d = await api.get<{ contacts: Contact[] }>(`/api/admin/crm?${params}`).catch(() => ({ contacts: [] }));
    setContacts(d.contacts);
  }, [statusFilter, search]);
  useEffect(() => { load(); }, [load]);

  const openDetail = async (c: Contact) => {
    setSelected(c);
    const d = await api.get<{ contact: Contact; interactions: Interaction[]; tasks: Task[] }>(`/api/admin/crm/${c.id}`);
    setSelected(d.contact);
    setTimeline(d.interactions);
    setTasks(d.tasks);
  };
  const refreshDetail = async () => selected && openDetail(selected);

  const create = async () => {
    try {
      await api.post('/api/admin/crm', newContact);
      setNewContact({ email: '', name: '', company: '', kind: 'vendor' });
      setNote('Contact added.');
      await load();
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : 'Failed');
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <AdminNav />
      <h1 className="text-4xl font-black">Vendor & Distributor CRM</h1>
      <p className="mt-2 text-medical/70">Spice vendors, co-packers, distributors, retail buyers — every relationship, one timeline each.</p>
      {note && <p className="mt-3 rounded bg-rx/10 p-2 text-sm font-semibold text-rx">{note}</p>}

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <button className={`rounded-full px-3 py-1 text-sm font-bold ${statusFilter === '' ? 'bg-rx text-navy' : 'bg-navy-light text-medical/70'}`} onClick={() => setStatusFilter('')}>All</button>
        {STATUSES.map((s) => (
          <button key={s} className={`rounded-full px-3 py-1 text-sm font-bold ${statusFilter === s ? 'bg-rx text-navy' : 'bg-navy-light text-medical/70'}`} onClick={() => setStatusFilter(s)}>
            {s.replace('_', ' ')}
          </button>
        ))}
        <input className="input !w-56 !py-1.5 !text-sm" placeholder="Search name, company, email…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="mt-4 rx-card !p-4">
        <p className="text-sm font-bold">Add contact</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input aria-label="Email" className="input !w-56 !py-1.5 !text-sm" placeholder="buyer@distributor.com" value={newContact.email} onChange={(e) => setNewContact({ ...newContact, email: e.target.value })} />
          <input aria-label="Name" className="input !w-40 !py-1.5 !text-sm" placeholder="Name" value={newContact.name} onChange={(e) => setNewContact({ ...newContact, name: e.target.value })} />
          <input aria-label="Company" className="input !w-48 !py-1.5 !text-sm" placeholder="Company" value={newContact.company} onChange={(e) => setNewContact({ ...newContact, company: e.target.value })} />
          <select aria-label="Kind" className="input !w-36 !py-1.5 !text-sm" value={newContact.kind} onChange={(e) => setNewContact({ ...newContact, kind: e.target.value })}>
            {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <button className="btn-rx !py-1.5 !text-sm" onClick={create}>Add</button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="space-y-2">
          {contacts.length === 0 && <p className="text-sm text-medical/50">No contacts match.</p>}
          {contacts.map((c) => (
            <button key={c.id} className={`block w-full rounded-xl border-2 p-3 text-left transition-colors ${selected?.id === c.id ? 'border-rx bg-navy-light' : 'border-navy-lighter bg-navy-light/40 hover:border-rx/50'}`} onClick={() => openDetail(c)}>
              <div className="flex items-center justify-between">
                <span className="font-bold">{c.company || c.name || c.email}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${STATUS_COLORS[c.status]}`}>{c.status.replace('_', ' ')}</span>
              </div>
              <p className="text-sm text-medical/60">{c.kind} · {c.email}{(c.dueTasks ?? 0) > 0 ? ` · ⏰ ${c.dueTasks} due` : ''}</p>
            </button>
          ))}
        </div>

        {selected && (
          <div className="rx-card !p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-xl font-black">{selected.company || selected.name || selected.email}</h2>
                <p className="text-sm text-medical/60">{selected.name} · {selected.email}</p>
              </div>
              <select aria-label="Status" className="input !w-40 !py-1 !text-sm" value={selected.status}
                onChange={async (e) => { await api.put(`/api/admin/crm/${selected.id}`, { status: e.target.value }); setSelected({ ...selected, status: e.target.value }); await load(); }}>
                {STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold">Log an interaction</p>
              <div className="mt-1 flex gap-2">
                <select aria-label="Interaction kind" className="input !w-28 !py-1.5 !text-sm" value={logForm.kind} onChange={(e) => setLogForm({ ...logForm, kind: e.target.value })}>
                  {['call', 'meeting', 'note', 'email_in'].map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input aria-label="Summary" className="input flex-1 !py-1.5 !text-sm" placeholder="Talked pricing for Q4 order…" value={logForm.summary} onChange={(e) => setLogForm({ ...logForm, summary: e.target.value })} />
                <button className="btn-rx !py-1.5 !text-sm" onClick={async () => { await api.post(`/api/admin/crm/${selected.id}/interactions`, logForm); setLogForm({ kind: 'call', summary: '' }); await refreshDetail(); }}>Log</button>
              </div>
            </div>

            <div className="mt-4">
              <p className="text-sm font-bold">Email {selected.name?.split(' ')[0] || 'them'} (branded shell)</p>
              <input aria-label="Subject" className="input mt-1 !py-1.5 !text-sm" placeholder="Subject" value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
              <textarea aria-label="Body" className="input mt-2 !text-sm" rows={3} placeholder="<p>Hi …</p>" value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
              <button className="btn-rx mt-2 !py-1.5 !text-sm" onClick={async () => { await api.post(`/api/admin/crm/${selected.id}/email`, { subject: mail.subject, bodyHtml: mail.body }); setMail({ subject: '', body: '' }); setNote('Email sent & logged.'); await refreshDetail(); }}>Send</button>
            </div>

            <div className="mt-5">
              <p className="text-sm font-bold">Tasks</p>
              <div className="mt-1 flex gap-2">
                <input aria-label="Task" className="input flex-1 !py-1.5 !text-sm" placeholder="Send samples by Friday" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} />
                <input aria-label="Due" className="input !w-44 !py-1.5 !text-sm" type="datetime-local" value={taskForm.dueAt} onChange={(e) => setTaskForm({ ...taskForm, dueAt: e.target.value })} />
                <button className="btn-rx !py-1.5 !text-sm" onClick={async () => { await api.post(`/api/admin/crm/${selected.id}/tasks`, { title: taskForm.title, dueAt: new Date(taskForm.dueAt).toISOString() }); setTaskForm({ title: '', dueAt: '' }); await refreshDetail(); }}>Add</button>
              </div>
              <ul className="mt-2 space-y-1">
                {tasks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between rounded bg-navy-light/60 px-3 py-1.5 text-sm">
                    <span className={t.done ? 'text-medical/40 line-through' : ''}>{t.title} <span className="text-xs text-medical/50">due {t.due_at.slice(0, 10)}</span></span>
                    {!t.done && <button className="font-bold text-rx underline" onClick={async () => { await api.post(`/api/admin/crm/tasks/${t.id}/done`); await refreshDetail(); }}>Done</button>}
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-5">
              <p className="text-sm font-bold">Timeline</p>
              <ul className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                {timeline.map((i) => (
                  <li key={i.id} className="rounded bg-navy-light/60 px-3 py-2 text-sm">
                    <span className="rounded bg-navy-lighter px-1.5 py-0.5 text-xs font-bold uppercase">{i.kind}</span>{' '}
                    {i.summary}
                    <span className="ml-2 text-xs text-medical/50">{i.created_at.slice(0, 16).replace('T', ' ')}{i.created_by ? ` · ${i.created_by}` : ''}</span>
                  </li>
                ))}
                {timeline.length === 0 && <li className="text-sm text-medical/50">No interactions yet.</li>}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
