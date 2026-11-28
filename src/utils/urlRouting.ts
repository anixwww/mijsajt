import type { CatalogResponse, SectionId } from '../types.ts';

export const VALID_SECTIONS: SectionId[] = ['home', 'poetry', 'prose', 'blog', 'radio', 'store'];

export function sanitizeSafeHref(
  rawUrl: string | undefined | null,
  fallback = '#',
  options?: { allowMailto?: boolean }
): string {
  const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  if (!trimmed) return fallback;
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    if (options?.allowMailto && parsed.protocol === 'mailto:') {
      return parsed.toString();
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export function parseLocationHash(): {
  section: SectionId;
  itemId: string | null;
  isSecretAuth: boolean;
} {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return { section: 'home', itemId: null, isSecretAuth: false };
  const [sectionPart, itemPart] = raw.split('/');
  if (sectionPart === 'admin' || sectionPart === 'login') {
    return { section: 'home', itemId: null, isSecretAuth: true };
  }
  const section = VALID_SECTIONS.includes(sectionPart as SectionId)
    ? (sectionPart as SectionId)
    : 'home';
  return {
    section,
    itemId: itemPart ? decodeURIComponent(itemPart) : null,
    isSecretAuth: false,
  };
}

export function parseInitialSecretSearch(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.get('admin') === '1' || params.get('auth') === '1';
}

export function updateDocumentSeoMetadata(
  activeSection: SectionId,
  deepLinkItemId: string | null,
  catalog: CatalogResponse | null
): void {
  if (!catalog) return;

  const baseTitle = 'Андрій Даньків — Вірші, Проза, БДК, Крамниця';
  const baseDesc =
    'Офіційний сайт письменника Андрія Даньківа: поезія, мала і велика проза, БДК (Будда дивиться кіно) та крамниця електронних книг і гостьового доступу до поточних романів у Google Документах.';

  let pageTitle = baseTitle;
  let pageDesc = baseDesc;

  if (activeSection === 'poetry' && deepLinkItemId) {
    const poem = catalog.poems.find((p) => p.id === deepLinkItemId);
    if (poem) {
      pageTitle = `«${poem.title}» — Вірш | Андрій Даньків`;
      pageDesc = poem.excerpt || poem.content || baseDesc;
    }
  } else if (activeSection === 'poetry') {
    pageTitle = 'Поезія — Вірші та рядки | Андрій Даньків';
    pageDesc =
      'Добірка поезій письменника Андрія Даньківа: вірші, обрамлені в художні рядки та інтерактивні візуальні відгуки.';
  } else if (activeSection === 'prose' && deepLinkItemId) {
    const prose = catalog.prose.find((w) => w.id === deepLinkItemId);
    if (prose) {
      pageTitle = `«${prose.title}» — Проза | Андрій Даньків`;
      pageDesc = prose.excerpt || prose.previewText || baseDesc;
    }
  } else if (activeSection === 'prose') {
    pageTitle = 'Проза — Оповідання та історії | Андрій Даньків';
    pageDesc =
      'Розділ прози письменника Андрія Даньківа: оповідання, уривки та платний доступ до повних історій і PDF-документів.';
  } else if (activeSection === 'blog' && deepLinkItemId) {
    const post = catalog.blog.find((b) => b.id === deepLinkItemId);
    if (post) {
      pageTitle = `«${post.title}» — БДК (Будда дивиться кіно) | Андрій Даньків`;
      pageDesc = post.excerpt || post.content || baseDesc;
    }
  } else if (activeSection === 'blog') {
    pageTitle = 'БДК (Будда дивиться кіно) — Рецензії та кінороздуми | Андрій Даньків';
    pageDesc =
      'БДК (Будда дивиться кіно) Андрія Даньківа: рецензії на фільми, розбори режисерських рішень, кінороздуми та саундтреки стрічок.';
  } else if (activeSection === 'radio') {
    pageTitle = 'Радіостанція — Музичний ефір | Андрій Даньків';
    pageDesc =
      'Авторська радіостанція Андрія Даньківа: послідовний ефір композицій із SoundCloud у безперервному колі.';
  } else if (activeSection === 'store' && deepLinkItemId) {
    const product = catalog.products.find((prod) => prod.id === deepLinkItemId);
    if (product) {
      pageTitle = `«${product.title}» — Крамниця | Андрій Даньків`;
      pageDesc = product.description || product.sampleExcerpt || baseDesc;
    }
  } else if (activeSection === 'store') {
    pageTitle = 'Крамниця — Книги та видання | Андрій Даньків';
    pageDesc =
      'Офіційна крамниця Андрія Даньківа: паперові та електронні книги, скляні антирамки та гостьовий доступ до романів у процесі написання.';
  }

  document.title = pageTitle;

  const setMetaTag = (selector: string, attr: string, value: string) => {
    let el = document.querySelector(selector);
    if (!el) {
      el = document.createElement('meta');
      if (selector.includes('name=')) {
        const nameMatch = selector.match(/name="([^"]+)"/);
        if (nameMatch) el.setAttribute('name', nameMatch[1]);
      } else if (selector.includes('property=')) {
        const propMatch = selector.match(/property="([^"]+)"/);
        if (propMatch) el.setAttribute('property', propMatch[1]);
      }
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  };

  setMetaTag('meta[name="description"]', 'content', pageDesc);
  setMetaTag('meta[property="og:title"]', 'content', pageTitle);
  setMetaTag('meta[property="og:description"]', 'content', pageDesc);
}
