import type { FlavorProfileRow, ProductRow, RequestContext } from '../types';
import { json, errorResponse, readJson } from '../lib/util';
import { runChat } from '../lib/ai';
import { getAuthUser, requireAuth } from '../lib/auth';
import { publicProduct } from './products';

export interface QuizAnswers {
  heat: 'mild' | 'medium' | 'hot' | 'inferno';
  palate: 'sweet' | 'savory' | 'both';
  adventure: 'classics' | 'curious' | 'fearless';
  kitchen: 'burgers' | 'grill' | 'snacks' | 'desserts';
  symptom: 'boring-dinners' | 'sad-lunches' | 'dessert-emergencies' | 'grill-night';
}

const VALID: Record<keyof QuizAnswers, string[]> = {
  heat: ['mild', 'medium', 'hot', 'inferno'],
  palate: ['sweet', 'savory', 'both'],
  adventure: ['classics', 'curious', 'fearless'],
  kitchen: ['burgers', 'grill', 'snacks', 'desserts'],
  symptom: ['boring-dinners', 'sad-lunches', 'dessert-emergencies', 'grill-night'],
};

const SPICY = new Set(['seoul-spice', 'chile-lime-cure', 'spicy-cacao-cure', 'tajin-treatment', 'cowboy-compound', 'mango-rx']);
const ADVENTUROUS = new Set([
  'miso-doctor', 'garam-gold', 'saffron-gold', 'miso-caramel-doctor', 'blueberry-lavender-rx',
  'passion-fruit-protocol', 'strawberry-balsamic-serum', 'ramen-remedy', 'greek-diagnosis', 'bleu-diagnosis',
]);
const CLASSICS = new Set([
  'ranch-rx', 'big-doc-sauce', 'classic-md', 'in-n-out-insider', 'canes-classic',
  'dark-matter-fudge', 'ketchup-code', 'smoked-cheddar-cure', 'bourbon-street-drizzle',
]);

const KITCHEN_COLLECTIONS: Record<QuizAnswers['kitchen'], Record<string, number>> = {
  burgers: { mayo: 3, 'burger-sauce': 4, seasoning: 2 },
  grill: { butter: 4, seasoning: 2, mayo: 1 },
  snacks: { seasoning: 4, mayo: 2, 'burger-sauce': 2 },
  desserts: { toppers: 5, butter: 1 },
};

function scoreProducts(products: ProductRow[], a: QuizAnswers): ProductRow[] {
  const scored = products.map((p) => {
    let score = p.is_bestseller === 1 ? 1 : 0;
    score += KITCHEN_COLLECTIONS[a.kitchen][p.collection] ?? 0;
    if (a.palate === 'sweet') score += p.collection === 'toppers' ? 3 : p.collection === 'butter' ? 0 : -3;
    if (a.palate === 'savory') score += p.collection === 'toppers' ? -2 : 1;
    if (a.heat === 'hot' || a.heat === 'inferno') score += SPICY.has(p.slug) ? 3 : 0;
    if (a.heat === 'mild') score -= SPICY.has(p.slug) ? 3 : 0;
    if (a.adventure === 'fearless') score += ADVENTUROUS.has(p.slug) ? 3 : 0;
    if (a.adventure === 'classics') score += CLASSICS.has(p.slug) ? 3 : ADVENTUROUS.has(p.slug) ? -2 : 0;
    if (a.adventure === 'curious') score += 1;
    return { p, score };
  });
  scored.sort((x, y) => y.score - x.score);

  // Top 3, allowing at most 2 per collection so prescriptions stay varied
  // without forcing savory items on dessert-focused patients.
  const picked: ProductRow[] = [];
  const perCollection = new Map<string, number>();
  for (const { p } of scored) {
    if (picked.length >= 3) break;
    const used = perCollection.get(p.collection) ?? 0;
    if (used >= 2) continue;
    picked.push(p);
    perCollection.set(p.collection, used + 1);
  }
  for (const { p } of scored) {
    if (picked.length >= 3) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked;
}

function conditionFor(a: QuizAnswers): string {
  if (a.symptom === 'dessert-emergencies') return 'Chronic Dessert Insufficiency';
  if (a.heat === 'inferno') return 'Acute Capsaicin Deficiency';
  if (a.symptom === 'sad-lunches') return 'Recurring Desk-Lunch Syndrome';
  if (a.symptom === 'grill-night') return 'Compound Butter Deficiency (Grill-Onset)';
  const stage = a.adventure === 'fearless' ? 'III' : a.adventure === 'curious' ? 'II' : 'I';
  return `Acute Blandness, Stage ${stage}`;
}

/** The Intake Exam: score the answers, write the diagnosis, store for logged-in patients. */
export async function submitQuiz(req: Request, rc: RequestContext): Promise<Response> {
  const body = await readJson<Partial<QuizAnswers>>(req);
  if (!body) return errorResponse('Invalid answers');
  for (const [key, allowed] of Object.entries(VALID)) {
    const value = body[key as keyof QuizAnswers];
    if (!value || !allowed.includes(value)) return errorResponse(`Missing or invalid answer: ${key}`);
  }
  const answers = body as QuizAnswers;

  const { results: products } = await rc.env.DB.prepare(
    'SELECT * FROM products WHERE is_active = 1 AND is_drop = 0'
  ).all<ProductRow>();
  const prescription = scoreProducts(products, answers);
  const condition = conditionFor(answers);

  let diagnosis = `Patient presents with ${condition.toLowerCase()}. Recommended course of treatment: ${prescription
    .map((p) => p.name)
    .join(', ')}. Apply liberally. Refills available via the Monthly Rx Box.`;
  try {
    diagnosis = await runChat(rc.env, [
      {
        role: 'user',
        content: `You are Dr. Flavor of "Flavor Doctors", a premium sauce brand with a playful medical theme. A patient's intake exam shows: heat tolerance=${answers.heat}, palate=${answers.palate}, adventurousness=${answers.adventure}, cooks mostly=${answers.kitchen}, chief complaint=${answers.symptom}. Their diagnosed condition is "${condition}" and you are prescribing: ${prescription.map((p) => `${p.name} (${p.description})`).join('; ')}.

Write a 3-4 sentence doctor's note in a warm, witty clinical voice: confirm the diagnosis, explain why each prescribed product treats their specific symptoms, and end with one playful instruction. No preamble, no markdown, under 90 words.`,
      },
    ], 300);
  } catch (err) {
    console.error('Quiz diagnosis AI failed, using template:', err);
  }

  const user = await getAuthUser(req, rc.env);
  if (user) {
    await rc.env.DB.prepare(
      `INSERT INTO flavor_profiles (user_id, answers_json, condition, diagnosis, prescribed_json, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET answers_json = excluded.answers_json, condition = excluded.condition,
         diagnosis = excluded.diagnosis, prescribed_json = excluded.prescribed_json, updated_at = excluded.updated_at`
    )
      .bind(user.id, JSON.stringify(answers), condition, diagnosis, JSON.stringify(prescription.map((p) => p.id)))
      .run();
  }

  return json({
    condition,
    diagnosis,
    prescription: prescription.map(publicProduct),
    saved: !!user,
  });
}

/** The stored flavor profile for My Chart. */
export const getMyProfile = requireAuth(async (_req, rc) => {
  const profile = await rc.env.DB.prepare('SELECT * FROM flavor_profiles WHERE user_id = ?')
    .bind(rc.user!.id)
    .first<FlavorProfileRow>();
  if (!profile) return json({ profile: null });
  const ids = profile.prescribed_json ? (JSON.parse(profile.prescribed_json) as string[]) : [];
  let prescription: ReturnType<typeof publicProduct>[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await rc.env.DB.prepare(`SELECT * FROM products WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<ProductRow>();
    prescription = results.map(publicProduct);
  }
  return json({
    profile: {
      condition: profile.condition,
      diagnosis: profile.diagnosis,
      updatedAt: profile.updated_at,
      prescription,
    },
  });
});
