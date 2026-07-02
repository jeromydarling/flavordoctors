import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { QuizResult } from '../lib/types';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { ProductImage } from '../components/ProductImage';
import { LogoMark } from '../components/Logo';
import { formatPrice } from '../lib/types';

interface Question {
  key: string;
  label: string;
  options: { value: string; label: string }[];
}

const QUESTIONS: Question[] = [
  {
    key: 'symptom',
    label: 'What brings you to the clinic today?',
    options: [
      { value: 'boring-dinners', label: 'Chronic boring dinners' },
      { value: 'sad-lunches', label: 'Recurring sad desk lunches' },
      { value: 'dessert-emergencies', label: 'Frequent dessert emergencies' },
      { value: 'grill-night', label: 'Grill nights lacking a finishing move' },
    ],
  },
  {
    key: 'heat',
    label: 'Pain threshold (spice tolerance)?',
    options: [
      { value: 'mild', label: 'Mild — handle me gently' },
      { value: 'medium', label: 'Medium — a pleasant tingle' },
      { value: 'hot', label: 'Hot — bring the burn' },
      { value: 'inferno', label: 'Inferno — I feel nothing anymore' },
    ],
  },
  {
    key: 'palate',
    label: 'Which ward are you usually admitted to?',
    options: [
      { value: 'savory', label: 'Savory — burgers, fries, steak' },
      { value: 'sweet', label: 'Sweet — dessert is a food group' },
      { value: 'both', label: 'Both — I contain multitudes' },
    ],
  },
  {
    key: 'adventure',
    label: 'Family history of flavor adventurousness?',
    options: [
      { value: 'classics', label: 'The classics, done perfectly' },
      { value: 'curious', label: 'Curious — surprise me a little' },
      { value: 'fearless', label: 'Fearless — miso caramel? Prescribe it' },
    ],
  },
  {
    key: 'kitchen',
    label: 'What do you cook most?',
    options: [
      { value: 'burgers', label: 'Burgers & sandwiches' },
      { value: 'grill', label: 'Steaks, veggies & the grill' },
      { value: 'snacks', label: 'Fries & snack attacks' },
      { value: 'desserts', label: 'Desserts & breakfast treats' },
    ],
  },
];

export function IntakeExam() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [result, setResult] = useState<QuizResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user } = useAuth();
  const cart = useCart();

  const answer = async (key: string, value: string) => {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    if (step < QUESTIONS.length - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<QuizResult>('/api/quiz', next);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The doctor stepped out — try again.');
    } finally {
      setBusy(false);
    }
  };

  const downloadPrescription = () => {
    if (!result) return;
    const items = result.prescription.map((p, i) => `<text x="60" y="${300 + i * 40}" font-size="24" font-family="Georgia">℞ ${i + 1}. ${escapeXml(p.name)} — apply liberally</text>`).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="${360 + result.prescription.length * 40}" style="background:#F5F5F5">
<rect width="600" height="100%" fill="#F5F5F5" stroke="#0D1B2A" stroke-width="6"/>
<rect width="600" height="90" fill="#0D1B2A"/>
<text x="60" y="58" font-size="34" font-weight="bold" font-family="Georgia" fill="#F5F5F5">℞ Flavor Doctors</text>
<text x="60" y="150" font-size="20" font-family="Georgia" fill="#0D1B2A">Patient: ${escapeXml(user?.email ?? 'Walk-in patient')}</text>
<text x="60" y="190" font-size="22" font-weight="bold" font-family="Georgia" fill="#0D1B2A">Diagnosis: ${escapeXml(result.condition)}</text>
<line x1="60" y1="230" x2="540" y2="230" stroke="#0D1B2A" stroke-dasharray="8 6" stroke-width="2"/>
${items}
<text x="380" y="${320 + result.prescription.length * 40}" font-size="26" font-style="italic" font-family="Georgia" fill="#27AE60">Dr. Flavor, MD</text>
</svg>`;
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'flavor-doctors-prescription.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  if (result) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <div className="prescription-pad">
          <div className="flex items-center justify-between border-b-2 border-dashed border-navy/30 pb-4">
            <LogoMark className="h-12 w-12" />
            <span className="text-sm font-bold uppercase tracking-widest text-navy/60">Official Diagnosis</span>
          </div>
          <h1 className="mt-6 font-heading text-4xl font-black">{result.condition}</h1>
          <p className="mt-4 font-heading text-lg leading-relaxed">{result.diagnosis}</p>
          <p className="mt-6 text-right font-heading text-2xl italic text-rx-dark">— Dr. Flavor, MD</p>
        </div>

        <h2 className="mt-10 text-3xl font-black">Your Prescription</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {result.prescription.map((p) => (
            <div key={p.id} className="overflow-hidden rounded-xl border-2 border-navy-lighter bg-navy-light">
              <Link to={`/product/${p.slug}`}>
                <ProductImage product={p} className="h-36 w-full" />
              </Link>
              <div className="p-4">
                <p className="font-heading text-lg font-bold">{p.name}</p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="font-bold text-gold">{formatPrice(p.price)}</span>
                  <button className="btn-rx !px-3 !py-1 !text-sm" onClick={() => cart.add(p)}>
                    + Add
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap gap-4">
          <button
            className="btn-rx"
            onClick={() => {
              result.prescription.forEach((p) => cart.add(p));
            }}
          >
            Fill Entire Prescription ({formatPrice(result.prescription.reduce((n, p) => n + p.price, 0))})
          </button>
          <button className="btn-outline" onClick={downloadPrescription}>
            ⬇ Download Prescription
          </button>
          <Link to="/subscribe" className="btn-gold">
            Get Refills Monthly →
          </Link>
        </div>
        {!result.saved && (
          <p className="mt-4 text-sm text-medical/50">
            <Link to="/login" className="text-rx underline">Sign in</Link> to save this diagnosis to your chart.
          </p>
        )}
      </div>
    );
  }

  const q = QUESTIONS[step];
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <p className="text-center text-sm font-extrabold uppercase tracking-widest text-rx">New Patient Intake</p>
      <h1 className="mt-3 text-center text-5xl font-black">The Intake Exam</h1>
      <p className="mt-3 text-center text-lg text-medical/60">
        Five questions. One diagnosis. A prescription for everything that's bland in your life.
      </p>

      <div className="mt-10 flex justify-center gap-2">
        {QUESTIONS.map((_, i) => (
          <div key={i} className={`h-2 w-10 rounded-full ${i <= step ? 'bg-rx' : 'bg-navy-lighter'}`} />
        ))}
      </div>

      {error && <p className="mt-6 rounded bg-red-500/20 p-3 text-center text-red-300">{error}</p>}

      <div className="rx-card mt-8">
        <p className="text-sm font-bold uppercase tracking-widest text-medical/50">
          Question {step + 1} of {QUESTIONS.length}
        </p>
        <h2 className="mt-2 font-heading text-3xl font-bold">{q.label}</h2>
        <div className="mt-6 grid gap-3">
          {q.options.map((o) => (
            <button
              key={o.value}
              disabled={busy}
              onClick={() => answer(q.key, o.value)}
              className="rounded-lg border-2 border-navy-lighter px-5 py-4 text-left text-lg font-semibold transition-colors hover:border-rx hover:text-rx disabled:opacity-50"
            >
              {o.label}
            </button>
          ))}
        </div>
        {busy && <p className="mt-4 text-center text-rx">The doctor is reviewing your chart…</p>}
        {step > 0 && !busy && (
          <button className="mt-4 text-sm text-medical/50 hover:text-medical" onClick={() => setStep(step - 1)}>
            ← Previous question
          </button>
        )}
      </div>
    </div>
  );
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
