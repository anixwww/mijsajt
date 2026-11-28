import { create } from 'zustand';
import type { PurchasedAccess } from '../types.ts';
import { sanitizePurchasedAccessForDevice } from '../utils/paymentCrypto.ts';

export const CART_STORAGE_KEY = 'dankiv_cart_ids_v1';
export const UNLOCKED_STORAGE_KEY = 'dankiv_unlocked_access_v1';

function readInitialCartIds(): string[] {
  try {
    const saved = localStorage.getItem(CART_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readInitialUnlocked(): PurchasedAccess[] {
  try {
    const saved = localStorage.getItem(UNLOCKED_STORAGE_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed) ? sanitizePurchasedAccessForDevice(parsed) : [];
  } catch {
    return [];
  }
}

function persistCartIds(cartIds: string[]): void {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartIds));
  } catch {
    // Ignore storage errors
  }
}

function persistUnlocked(items: PurchasedAccess[]): void {
  try {
    localStorage.setItem(
      UNLOCKED_STORAGE_KEY,
      JSON.stringify(sanitizePurchasedAccessForDevice(items))
    );
  } catch {
    // Ignore storage errors
  }
}

interface CartState {
  cartIds: string[];
  unlockedItems: PurchasedAccess[];
  addToCart: (productId: string) => void;
  removeFromCart: (productId: string) => void;
  clearCart: () => void;
  mergeUnlocked: (items: PurchasedAccess[]) => void;
  clearDeviceLibrary: () => void;
}

export const useCartStore = create<CartState>((set) => ({
  cartIds: readInitialCartIds(),
  unlockedItems: readInitialUnlocked(),

  addToCart: (productId) =>
    set((state) => {
      if (state.cartIds.includes(productId)) return state;
      const next = [...state.cartIds, productId];
      persistCartIds(next);
      return { cartIds: next };
    }),
  removeFromCart: (productId) =>
    set((state) => {
      const next = state.cartIds.filter((id) => id !== productId);
      persistCartIds(next);
      return { cartIds: next };
    }),
  clearCart: () => {
    persistCartIds([]);
    set({ cartIds: [] });
  },
  mergeUnlocked: (incoming) =>
    set((state) => {
      const cleanIncoming = sanitizePurchasedAccessForDevice(incoming);
      const merged = new Map<string, PurchasedAccess>();
      for (const item of state.unlockedItems) merged.set(item.productId, item);
      for (const item of cleanIncoming) merged.set(item.productId, item);
      const next = sanitizePurchasedAccessForDevice(Array.from(merged.values()));
      persistUnlocked(next);
      return { unlockedItems: next };
    }),
  clearDeviceLibrary: () => {
    try {
      localStorage.removeItem(UNLOCKED_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    set({ unlockedItems: [] });
  },
}));
