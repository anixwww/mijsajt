import { create } from 'zustand';
import type {
  BlogPost,
  CatalogResponse,
  HomePayload,
  Poem,
  ProseWork,
  RadioTrack,
  StoreProduct,
  WeeklyMusicSelection,
} from '../types.ts';

export const HOME_SHELL_STORAGE_KEY = 'dankiv_home_shell_v1';

export function readCachedHomeShell(): HomePayload | null {
  try {
    const raw = localStorage.getItem(HOME_SHELL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HomePayload;
    return typeof parsed?.heroLeadText === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

export function writeCachedHomeShell(payload: HomePayload): void {
  try {
    const compact: HomePayload = {
      heroLeadText: payload.heroLeadText,
      authorAboutText: payload.authorAboutText,
      authorPhotoUrl: payload.authorPhotoUrl,
      authorPhotos: payload.authorPhotos,
      socialLinks: payload.socialLinks,
      monobankJarUrl: payload.monobankJarUrl,
      monobankModalTitle: payload.monobankModalTitle,
      monobankModalSubtitle: payload.monobankModalSubtitle,
      monobankCardLabel: payload.monobankCardLabel,
      monobankModalText: payload.monobankModalText,
      monobankEmptyText: payload.monobankEmptyText,
      contactEmail: payload.contactEmail,
      interviews: payload.interviews,
      homeActionAboutTitle: payload.homeActionAboutTitle,
      homeActionContactTitle: payload.homeActionContactTitle,
      homeActionMonobankTitle: payload.homeActionMonobankTitle,
      homeActionInterviewsTitle: payload.homeActionInterviewsTitle,
      homeRepeaters: payload.homeRepeaters,
      proseAuthDiscountPercent: payload.proseAuthDiscountPercent,
      storeAuthDiscountPercent: payload.storeAuthDiscountPercent,
      uniqueVisitors: payload.uniqueVisitors,
    };
    localStorage.setItem(HOME_SHELL_STORAGE_KEY, JSON.stringify(compact));
  } catch {
    // Ignore storage quota errors
  }
}

interface CatalogState {
  homeShell: HomePayload | null;
  catalog: CatalogResponse | null;
  loading: boolean;
  loadError: string | null;
  uniqueVisitors: number;
  setHomeShell: (
    shell: HomePayload | null | ((prev: HomePayload | null) => HomePayload | null)
  ) => void;
  setCatalog: (
    next: CatalogResponse | null | ((prev: CatalogResponse | null) => CatalogResponse | null)
  ) => void;
  setLoading: (loading: boolean) => void;
  setLoadError: (err: string | null | ((prev: string | null) => string | null)) => void;
  setUniqueVisitors: (count: number | ((prev: number) => number)) => void;
  updatePoem: (poem: Poem) => void;
  updateProse: (prose: ProseWork) => void;
  updateBlogPost: (post: BlogPost) => void;
  updateProduct: (product: StoreProduct) => void;
  setPoemViews: (poemId: string, viewsCount: number) => void;
  setBlogViews: (postId: string, viewsCount: number) => void;
  updateHomeFields: (patch: Partial<HomePayload>) => void;
  setRadioTracksInCatalog: (tracks: RadioTrack[]) => void;
  updateRadioTrackLikeInCatalog: (trackId: string, likesCount: number, isLiked: boolean) => void;
  setWeeklySelectionsInCatalog: (selections: WeeklyMusicSelection[]) => void;
}

const initialHomeShell = readCachedHomeShell();

export const useCatalogStore = create<CatalogState>((set) => ({
  homeShell: initialHomeShell,
  catalog: null,
  loading: !initialHomeShell,
  loadError: null,
  uniqueVisitors: initialHomeShell?.uniqueVisitors ?? 1,

  setHomeShell: (shell) =>
    set((state) => ({
      homeShell: typeof shell === 'function' ? shell(state.homeShell) : shell,
    })),
  setCatalog: (next) =>
    set((state) => ({
      catalog: typeof next === 'function' ? next(state.catalog) : next,
    })),
  setLoading: (loading) => set({ loading }),
  setLoadError: (err) =>
    set((state) => ({
      loadError: typeof err === 'function' ? err(state.loadError) : err,
    })),
  setUniqueVisitors: (count) =>
    set((state) => ({
      uniqueVisitors: typeof count === 'function' ? count(state.uniqueVisitors) : count,
    })),
  updatePoem: (updatedPoem) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            poems: state.catalog.poems.map((p) => (p.id === updatedPoem.id ? updatedPoem : p)),
          }
        : state.catalog,
    })),
  updateProse: (updatedProse) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            prose: state.catalog.prose.map((w) => (w.id === updatedProse.id ? updatedProse : w)),
          }
        : state.catalog,
    })),
  updateBlogPost: (updatedPost) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            blog: state.catalog.blog.map((b) => (b.id === updatedPost.id ? updatedPost : b)),
          }
        : state.catalog,
    })),
  updateProduct: (updatedProduct) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            products: state.catalog.products.map((prod) =>
              prod.id === updatedProduct.id ? updatedProduct : prod
            ),
          }
        : state.catalog,
    })),
  setPoemViews: (poemId, viewsCount) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            poems: state.catalog.poems.map((p) => (p.id === poemId ? { ...p, viewsCount } : p)),
          }
        : state.catalog,
    })),
  setBlogViews: (postId, viewsCount) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            blog: state.catalog.blog.map((b) => (b.id === postId ? { ...b, viewsCount } : b)),
          }
        : state.catalog,
    })),
  updateHomeFields: (patch) =>
    set((state) => {
      const nextShell = state.homeShell ? { ...state.homeShell, ...patch } : state.homeShell;
      if (nextShell) writeCachedHomeShell(nextShell);
      return {
        catalog: state.catalog ? { ...state.catalog, ...patch } : state.catalog,
        homeShell: nextShell,
      };
    }),
  setRadioTracksInCatalog: (tracks) =>
    set((state) => ({
      catalog: state.catalog ? { ...state.catalog, radioTracks: tracks } : state.catalog,
    })),
  updateRadioTrackLikeInCatalog: (trackId, likesCount, isLiked) =>
    set((state) => ({
      catalog: state.catalog
        ? {
            ...state.catalog,
            radioTracks: (state.catalog.radioTracks ?? []).map((t) =>
              t.id === trackId ? { ...t, likesCount, isLiked } : t
            ),
          }
        : state.catalog,
    })),
  setWeeklySelectionsInCatalog: (selections) =>
    set((state) => ({
      catalog: state.catalog
        ? { ...state.catalog, weeklyMusicSelections: selections }
        : state.catalog,
    })),
}));
