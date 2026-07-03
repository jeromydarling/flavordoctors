import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { formatPrice } from '../../lib/types';
import { PageSpinner } from '../../components/Protected';
import { AdminNav } from './AdminNav';

interface Analytics {
  mrr: number;
  activeSubscribers: number;
  orders30d: number;
  revenue30d: number;
  ordersTotal: number;
  revenueTotal: number;
  aov: number;
  repeatRate: number;
  topProducts: { name: string; units: number }[];
  contacts: { total: number; consented: number } | null;
  nps: { responses: number; score: number | null; promoters: number; detractors: number };
  saveOffers: { cancels: number; saves: number };
  scorecard: { metric: string; target: string; value: string; met: boolean }[];
}

export function AdminAnalytics() {
  const [data, setData] = useState<Analytics | null>(null);

  useEffect(() => {
    api.get<Analytics>('/api/admin/analytics').then(setData).catch(() => {});
  }, []);

  if (!data)
    return (
      <div className="mx-auto max-w-6xl px-4 py-12">
        <AdminNav />
        <PageSpinner />
      </div>
    );

  const stats = [
    { label: 'MRR (monthly-equivalent)', value: formatPrice(data.mrr) },
    { label: 'Active subscribers', value: String(data.activeSubscribers) },
    { label: 'Orders (30d)', value: String(data.orders30d) },
    { label: 'Revenue (30d)', value: formatPrice(data.revenue30d) },
    { label: 'All-time revenue', value: formatPrice(data.revenueTotal) },
    { label: 'Average order value', value: formatPrice(data.aov) },
    { label: 'Repeat purchase rate', value: `${data.repeatRate}%` },
    { label: 'Email contacts (consented)', value: `${data.contacts?.consented ?? 0} / ${data.contacts?.total ?? 0}` },
    {
      label: `NPS (${data.nps?.responses ?? 0} responses)`,
      value: data.nps?.score === null || data.nps === undefined ? '—' : String(data.nps.score),
    },
    { label: 'Cancel-flow saves', value: `${data.saveOffers?.saves ?? 0} saved / ${data.saveOffers?.cancels ?? 0} canceled` },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <AdminNav />
      <h2 className="text-2xl font-bold">Clinic Vitals</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rx-card !p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-medical/60">{s.label}</p>
            <p className="mt-1 text-3xl font-black text-gold">{s.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-10 text-2xl font-bold">
        Distributor Readiness <span className="text-medical/60 text-base">(KeHE / UNFI benchmarks)</span>
      </h2>
      <div className="mt-4 overflow-x-auto rounded-xl border-2 border-navy-lighter">
        <table className="w-full min-w-[560px] text-left">
          <thead className="bg-navy-light text-sm uppercase tracking-wide text-medical/60">
            <tr><th className="p-3">Benchmark</th><th className="p-3">Target</th><th className="p-3">Current</th><th className="p-3">Status</th></tr>
          </thead>
          <tbody className="divide-y divide-navy-lighter">
            {data.scorecard.map((row) => (
              <tr key={row.metric}>
                <td className="p-3 font-bold">{row.metric}</td>
                <td className="p-3 text-medical/70">{row.target}</td>
                <td className="p-3 text-gold">{row.value}</td>
                <td className="p-3">{row.met ? <span className="font-bold text-rx">✓ Met</span> : <span className="text-medical/60">In progress</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-2xl font-bold">Most Prescribed (units sold)</h2>
      <div className="mt-4 space-y-2">
        {data.topProducts.length === 0 && <p className="text-medical/60">No sales yet.</p>}
        {data.topProducts.map((p) => (
          <div key={p.name} className="flex items-center gap-3">
            <span className="w-48 truncate font-bold">{p.name}</span>
            <div className="h-4 rounded bg-rx" style={{ width: `${Math.min(100, (p.units / Math.max(1, data.topProducts[0]?.units ?? 1)) * 100)}%` }} />
            <span className="text-sm text-medical/70">{p.units}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
