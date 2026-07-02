const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is this medication?',
    a: 'Flavor Doctors products are small-batch doctored mayos, compound butters, burger sauces, ice cream toppers, and fry seasonings. They treat chronic blandness, sauce deficiency, and drive-thru withdrawal.',
  },
  {
    q: 'How should I take it?',
    a: 'Apply liberally to burgers, fries, steaks, toast, ice cream, and anything else in reach. Dosage may be increased without physician approval.',
  },
  {
    q: 'How does the Monthly Rx Box work?',
    a: 'Choose a tier — Starter Rx (4 items, $39/mo), Standard Rx (6 items, $54/mo), or Full Prescription (8 items, $69/mo). After checkout you can customize which products arrive each month; if you don’t, we send our best-sellers. Billing is handled by Stripe and renews monthly.',
  },
  {
    q: 'Can I change or cancel my subscription?',
    a: 'Yes — visit My Chart (your account) to swap box items anytime, or open the billing portal to pause, cancel, or update payment details. Changes apply to your next billing cycle.',
  },
  {
    q: 'How is it stored?',
    a: 'Mayos, sauces, and toppers: refrigerate after opening. Butters: keep refrigerated or frozen. Seasonings: store in a cool, dry pantry. Keep away from roommates.',
  },
  {
    q: 'Known side effects',
    a: 'You’ll eat this on everything. Other reported effects include hosting more cookouts, hoarding fries, and describing sandwiches as "life-changing".',
  },
  {
    q: 'Allergens & ingredients',
    a: 'Products may contain eggs, dairy, soy, sesame, and tree nuts. Every jar lists full ingredients on the label. If you have severe allergies, consult the label (and an actual doctor).',
  },
  {
    q: 'Shipping',
    a: 'Orders ship in 2–3 business days in insulated packaging. Subscription boxes ship at the start of each billing cycle. Butter ships with ice packs in warm months.',
  },
];

export function Faq() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <p className="text-center text-sm font-extrabold uppercase tracking-widest text-rx">
        Patient Information Leaflet
      </p>
      <h1 className="mt-3 text-center text-5xl font-black md:text-6xl">FAQ</h1>
      <p className="mt-4 text-center text-lg text-medical/60">
        Read this leaflet carefully before consuming Flavor Doctors products.
      </p>
      <div className="prescription-pad mt-10">
        <div className="divide-y-2 divide-dashed divide-navy/20">
          {FAQS.map((f, i) => (
            <details key={f.q} className="group py-4" open={i === 0}>
              <summary className="cursor-pointer list-none font-heading text-xl font-bold marker:content-none">
                <span className="mr-2 text-rx-dark">{i + 1}.</span>
                {f.q}
                <span className="float-right text-rx-dark transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 leading-relaxed text-navy/80">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
