import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Product } from '../lib/types';

export interface CartLine {
  product: Product;
  quantity: number;
}

interface CartState {
  lines: CartLine[];
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  add: (product: Product, quantity?: number) => void;
  setQuantity: (productId: string, quantity: number) => void;
  remove: (productId: string) => void;
  clear: () => void;
  count: number;
  total: number;
}

const CartContext = createContext<CartState | null>(null);
const STORAGE_KEY = 'fd_cart_v1';

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as CartLine[];
    } catch {
      return [];
    }
  });
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines));
  }, [lines]);

  const add = (product: Product, quantity = 1) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, quantity: Math.min(20, l.quantity + quantity) } : l
        );
      }
      return [...prev, { product, quantity }];
    });
    setOpen(true);
  };

  const setQuantity = (productId: string, quantity: number) => {
    setLines((prev) =>
      quantity <= 0
        ? prev.filter((l) => l.product.id !== productId)
        : prev.map((l) => (l.product.id === productId ? { ...l, quantity: Math.min(20, quantity) } : l))
    );
  };

  const remove = (productId: string) => setLines((prev) => prev.filter((l) => l.product.id !== productId));
  const clear = () => setLines([]);

  const { count, total } = useMemo(
    () => ({
      count: lines.reduce((n, l) => n + l.quantity, 0),
      total: lines.reduce((n, l) => n + l.quantity * l.product.price, 0),
    }),
    [lines]
  );

  return (
    <CartContext.Provider value={{ lines, isOpen, setOpen, add, setQuantity, remove, clear, count, total }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart(): CartState {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
