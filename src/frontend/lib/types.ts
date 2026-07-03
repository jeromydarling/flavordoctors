export interface Product {
  id: string;
  slug: string;
  name: string;
  collection: string;
  description: string;
  aiDescription: string | null;
  price: number;
  imageUrl: string | null;
  isBestseller: boolean;
  isActive?: boolean;
  isDrop?: boolean;
  dropStartsAt?: string | null;
  dropStock?: number | null;
}

export interface Drop {
  product: Product;
  state: 'upcoming' | 'early-access' | 'live' | 'sold-out';
  startsAt: string | null;
  earlyAccessAt: string | null;
  stock: number | null;
  canBuy: boolean;
}

export interface QuizResult {
  condition: string;
  diagnosis: string;
  prescription: Product[];
  saved: boolean;
}

export interface FlavorProfile {
  condition: string | null;
  diagnosis: string | null;
  updatedAt: string;
  prescription: Product[];
}

export interface LoyaltyInfo {
  points: number;
  tier: { key: string; name: string };
  nextTier: { key: string; name: string; pointsNeeded: number } | null;
}

export const CADENCES = [
  { key: 'monthly', label: 'Monthly' },
  { key: 'bimonthly', label: 'Every 2 months' },
  { key: 'annual', label: 'Annual — 2 months free' },
] as const;

export const FREE_SHIPPING_THRESHOLD = 4500;
export const BUNDLE_MIN_QTY = 3;
export const BUNDLE_PERCENT = 15;

export interface User {
  id: string;
  email: string;
  isAdmin: boolean;
}

export interface OrderItem {
  productId: string;
  name: string;
  slug: string | null;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  email: string | null;
  total: number;
  status: string;
  createdAt: string;
  items: OrderItem[];
}

export interface Subscription {
  id: string;
  tier: string;
  tierName: string;
  itemsPerMonth: number | null;
  priceMonthly: number | null;
  cadence: string;
  cadenceLabel: string;
  status: string;
  items: string[];
  nextBillingDate: string | null;
}

export const COLLECTIONS: { key: string; label: string; blurb: string }[] = [
  { key: 'mayo', label: 'Doctored Mayo', blurb: '8 oz jars of clinically creamy mayo' },
  { key: 'butter', label: 'Doctored Ghee Butter', blurb: '4 oz shelf-stable spiced ghee' },
  { key: 'burger-sauce', label: 'Doctored Burger Sauce', blurb: '8 oz jars of drive-thru cures' },
  { key: 'toppers', label: 'Ice Cream Toppers', blurb: '8 oz jars of dessert medicine' },
  { key: 'seasoning', label: 'Fry Seasoning', blurb: '4 oz shakers of fry treatment' },
];

export const TIERS = [
  {
    key: 'starter',
    name: 'Starter Rx',
    items: 4,
    price: 3900,
    blurb: 'A low-dose introduction: 4 doctored items every month.',
  },
  {
    key: 'standard',
    name: 'Standard Rx',
    items: 6,
    price: 5400,
    blurb: 'The recommended dosage: 6 items monthly for balanced flavor health.',
  },
  {
    key: 'full',
    name: 'Full Prescription',
    items: 8,
    price: 6900,
    blurb: 'Maximum strength: 8 items a month. For chronic flavor deficiency.',
  },
] as const;

export function collectionLabel(key: string): string {
  return COLLECTIONS.find((c) => c.key === key)?.label ?? key;
}

export function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
