import { create } from 'zustand';
import type { SectionId } from '../types.ts';

export interface NewWorkNotificationState {
  section: 'poetry' | 'prose' | 'blog' | 'store';
  itemId: string;
  kindLabel: string;
  title: string;
}

export interface PoetrySpaceState {
  accentColor?: string;
  swipeKey?: string;
  swipeDirection: number;
}

export interface PoetryBackdropStyle {
  backgroundColor?: string;
  backgroundImage?: string;
}

interface UiState {
  activeSection: SectionId;
  deepLinkItemId: string | null;
  drawerOpen: boolean;
  drawerTab: 'cart' | 'library';
  authorStudioOpen: boolean;
  authModalOpen: boolean;
  telegramModalOpen: boolean;
  leaderboardOpen: boolean;
  chatOpen: boolean;
  musicSelectionsOpen: boolean;
  poetryBackdropStyle: PoetryBackdropStyle | null;
  proseHomeBackdrop: boolean;
  poetryImmersionMode: boolean;
  poetrySpaceState: PoetrySpaceState;
  newWorkNotification: NewWorkNotificationState | null;
  setActiveSection: (section: SectionId) => void;
  setDeepLinkItemId: (itemId: string | null) => void;
  setDrawerOpen: (open: boolean) => void;
  setDrawerTab: (tab: 'cart' | 'library') => void;
  openDrawer: (tab?: 'cart' | 'library') => void;
  setAuthorStudioOpen: (open: boolean) => void;
  setAuthModalOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  setTelegramModalOpen: (open: boolean) => void;
  setLeaderboardOpen: (open: boolean) => void;
  setChatOpen: (open: boolean) => void;
  setMusicSelectionsOpen: (open: boolean) => void;
  setPoetryBackdropStyle: (style: PoetryBackdropStyle | null) => void;
  setProseHomeBackdrop: (active: boolean) => void;
  setPoetryImmersionMode: (active: boolean | ((prev: boolean) => boolean)) => void;
  setPoetrySpaceState: (state: PoetrySpaceState) => void;
  setNewWorkNotification: (notif: NewWorkNotificationState | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  activeSection: 'home',
  deepLinkItemId: null,
  drawerOpen: false,
  drawerTab: 'cart',
  authorStudioOpen: false,
  authModalOpen: false,
  telegramModalOpen: false,
  leaderboardOpen: false,
  chatOpen: false,
  musicSelectionsOpen: false,
  poetryBackdropStyle: null,
  proseHomeBackdrop: false,
  poetryImmersionMode: false,
  poetrySpaceState: { swipeDirection: 1 },
  newWorkNotification: null,

  setActiveSection: (activeSection) => set({ activeSection }),
  setDeepLinkItemId: (deepLinkItemId) => set({ deepLinkItemId }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setDrawerTab: (drawerTab) => set({ drawerTab }),
  openDrawer: (tab) =>
    set((state) => ({
      drawerTab: tab ?? state.drawerTab,
      drawerOpen: true,
    })),
  setAuthorStudioOpen: (authorStudioOpen) => set({ authorStudioOpen }),
  setAuthModalOpen: (open) =>
    set((state) => ({
      authModalOpen: typeof open === 'function' ? open(state.authModalOpen) : open,
    })),
  setTelegramModalOpen: (telegramModalOpen) => set({ telegramModalOpen }),
  setLeaderboardOpen: (leaderboardOpen) => set({ leaderboardOpen }),
  setChatOpen: (chatOpen) => set({ chatOpen }),
  setMusicSelectionsOpen: (musicSelectionsOpen) => set({ musicSelectionsOpen }),
  setPoetryBackdropStyle: (poetryBackdropStyle) => set({ poetryBackdropStyle }),
  setProseHomeBackdrop: (proseHomeBackdrop) => set({ proseHomeBackdrop }),
  setPoetryImmersionMode: (active) =>
    set((state) => ({
      poetryImmersionMode:
        typeof active === 'function' ? active(state.poetryImmersionMode) : active,
    })),
  setPoetrySpaceState: (poetrySpaceState) => set({ poetrySpaceState }),
  setNewWorkNotification: (newWorkNotification) => set({ newWorkNotification }),
}));
