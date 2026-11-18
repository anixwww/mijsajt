import {
  BarChart3,
  BookOpen,
  Check,
  Download,
  FileText,
  Package,
  PenTool,
  Plus,
  Save,
  Tablet,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import {
  getEffectivePriceUah,
  type BlogPost,
  type OrderRecord,
  type Poem,
  type ProductType,
  type ProseWork,
  type StoreProduct,
} from '../types.ts';
import {
  clearStoredDeviceIdentity,
  ensureDeviceKeypair,
  getDeviceDisplayLabel,
  getStoredDeviceIdentity,
} from '../utils/deviceAccess.ts';
import { BehaviorAnalyticsTab } from './BehaviorAnalyticsTab.tsx';
import { EditorialImage } from './EditorialImage.tsx';
import { AntiFrameIcon } from './StoreIcons.tsx';

interface AuthorStudioModalProps {
  isOpen: boolean;
  isAdmin: boolean;
  getAdminToken: () => Promise<string | null>;
  onClose: () => void;
  onCatalogUpdated: () => void;
  heroLeadText: string;
  onHeroLeadUpdated: (text: string) => void;
}

const COVER_PRESETS = [
  {
    label: 'Карпатська туш',
    url: '/src/assets/images/ebook_cover_silence_1795025673857.jpg',
  },
  {
    label: 'Лляні аркуші',
    url: '/src/assets/images/ebook_cover_letters_1795025674171.jpg',
  },
  {
    label: 'Нічний стіл',
    url: '/src/assets/images/wip_manuscript_novel_1795025674997.jpg',
  },
  {
    label: 'Осіннє вікно',
    url: '/src/assets/images/blog_essay_autumn_1795025674773.jpg',
  },
  {
    label: 'Портрет автора',
    url: '/src/assets/images/author_portrait_desk_1795025673568.jpg',
  },
];

function renderTypeIcon(type: ProductType) {
  switch (type) {
    case 'ebook':
      return <Tablet className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />;
    case 'paper_book':
      return <BookOpen className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />;
    case 'wip_gdoc':
      return <PenTool className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />;
    case 'poem_frame':
      return <AntiFrameIcon className="w-3.5 h-3.5 shrink-0" />;
  }
}

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export function AuthorStudioModal({
  isOpen,
  isAdmin,
  getAdminToken,
  onClose,
  onCatalogUpdated,
  heroLeadText,
  onHeroLeadUpdated,
}: AuthorStudioModalProps) {
  const [tab, setTab] = useState<'store_admin' | 'new_product' | 'publish' | 'home_text' | 'orders' | 'analytics'>('store_admin');
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [poems, setPoems] = useState<Poem[]>([]);
  const [prose, setProse] = useState<ProseWork[]>([]);
  const [blog, setBlog] = useState<BlogPost[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [leadDraft, setLeadDraft] = useState(heroLeadText);
  const [loading, setLoading] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadingEbookId, setUploadingEbookId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [trustedDevices, setTrustedDevices] = useState<
    Array<{ deviceId: string; domain: string; label: string; createdAt: string; lastUsedAt: string }>
  >([]);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);

  // New Product form state
  const [newProdType, setNewProdType] = useState<ProductType>('wip_gdoc');
  const [newProdTitle, setNewProdTitle] = useState('');
  const [newProdSubtitle, setNewProdSubtitle] = useState('');
  const [newProdCover, setNewProdCover] = useState(COVER_PRESETS[2].url);
  const [newProdPrice, setNewProdPrice] = useState('280');
  const [newProdDiscount, setNewProdDiscount] = useState('0');
  const [newProdPromoActive, setNewProdPromoActive] = useState(false);
  const [newProdPromoLabel, setNewProdPromoLabel] = useState('');
  const [newProdProgress, setNewProdProgress] = useState('Розділи 1–3');
  const [newProdGdocUrl, setNewProdGdocUrl] = useState('');
  const [newProdFormats, setNewProdFormats] = useState('EPUB · PDF · TXT');
  const [newProdPages, setNewProdPages] = useState('180');
  const [newProdEbookMeta, setNewProdEbookMeta] = useState<{
    fileName: string;
    mimeType: string;
    fileSize: number;
    storageKey: string;
  } | null>(null);
  const [newProdBinding, setNewProdBinding] = useState('Тверда палітурка');
  const [newProdDimensions, setNewProdDimensions] = useState('21 × 30 см (А4)');
  const [newProdMaterial, setNewProdMaterial] = useState('Загартоване скло, металеві кліпси, бавовняний папір');
  const [newProdDesc, setNewProdDesc] = useState('');
  const [newProdExcerpt, setNewProdExcerpt] = useState('');

  // New literary work form state
  const [pubKind, setPubKind] = useState<'poem' | 'prose' | 'blog'>('poem');
  const [pubTitle, setPubTitle] = useState('');
  const [pubMeta, setPubMeta] = useState('');
  const [pubContent, setPubContent] = useState('');

  useEffect(() => {
    setLeadDraft(heroLeadText);
  }, [heroLeadText]);

  const getAuthHeaders = async (
    extra?: Record<string, string>
  ): Promise<Record<string, string> | null> => {
    const token = await getAdminToken();
    if (!token) {
      setFeedback('Сесія адміністратора відсутня або закінчилась. Увійдіть повторно через Google.');
      return null;
    }
    return {
      ...(extra || {}),
      Authorization: `Bearer ${token}`,
    };
  };

  const loadAuthorData = async () => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch('/api/author/catalog', { headers });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося завантажити дані автора.');
        return;
      }
      const list: StoreProduct[] = data.products || [];
      setProducts(list);
      setSelectedProductId((prev) =>
        prev && list.some((p) => p.id === prev) ? prev : list[0]?.id || null
      );
      setPoems(data.poems || []);
      setProse(data.prose || []);
      setBlog(data.blog || []);
      setOrders(data.orders || []);
      if (typeof data.heroLeadText === 'string') {
        setLeadDraft(data.heroLeadText);
      }
      try {
        const devRes = await fetch('/api/author/devices', { headers });
        if (devRes.ok) {
          const devData = (await devRes.json()) as {
            devices?: Array<{
              deviceId: string;
              domain: string;
              label: string;
              createdAt: string;
              lastUsedAt: string;
            }>;
          };
          setTrustedDevices(devData.devices || []);
        }
        const host = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
        if (host) {
          const localDev = await getStoredDeviceIdentity(host);
          setCurrentDeviceId(localDev?.deviceId || null);
        }
      } catch {
        // Non-blocking devices fetch
      }
    } catch {
      setFeedback('Не вдалося завантажити дані автора.');
    } finally {
      setLoading(false);
    }
  };

  const handleBindCurrentDevice = async () => {
    const host = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
    if (!host) return;
    setDeviceBusy(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const identity = await ensureDeviceKeypair(host, 'andrijdankiv5@gmail.com');
      const res = await fetch('/api/author/devices/bind', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          deviceId: identity.deviceId,
          publicKeySpki: identity.publicKeySpki,
          label: getDeviceDisplayLabel(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback(data.error || 'Не вдалося прив’язати пристрій.');
        return;
      }
      setCurrentDeviceId(identity.deviceId);
      setFeedback(`Пристрій прив’язано до домену ${host}.`);
      await loadAuthorData();
    } catch {
      setFeedback('Не вдалося прив’язати поточний пристрій.');
    } finally {
      setDeviceBusy(false);
    }
  };

  const handleRevokeDevice = async (deviceId: string) => {
    setDeviceBusy(true);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(`/api/author/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFeedback((data as { error?: string }).error || 'Не вдалося відв’язати пристрій.');
        return;
      }
      const host = typeof window !== 'undefined' ? window.location.hostname.toLowerCase() : '';
      if (host && currentDeviceId === deviceId) {
        await clearStoredDeviceIdentity(host);
        setCurrentDeviceId(null);
      }
      setTrustedDevices((prev) => prev.filter((d) => d.deviceId !== deviceId));
      setFeedback('Доступ для пристрою скасовано.');
    } finally {
      setDeviceBusy(false);
    }
  };

  useEffect(() => {
    if (!isOpen || !isAdmin) return;
    loadAuthorData();
  }, [isOpen, isAdmin]);

  if (!isOpen || !isAdmin) return null;

  const selectedProduct = products.find((p) => p.id === selectedProductId) || null;

  const updateProductField = <K extends keyof StoreProduct>(
    id: string,
    field: K,
    value: StoreProduct[K]
  ) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: value } : p)));
  };

  const uploadCoverFile = async (file: File, onUrlReady: (url: string) => void, targetKey: string) => {
    setUploadingId(targetKey);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Помилка читання файлу'));
        reader.readAsDataURL(file);
      });

      const response = await fetch('/api/author/upload-cover', {
        method: 'POST',
        headers,
        body: JSON.stringify({ dataUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося завантажити обкладинку.');
        return;
      }
      onUrlReady(data.url);
    } catch {
      setFeedback('Не вдалося завантажити файл зображення.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleExistingCoverUpload = (productId: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadCoverFile(file, (url) => updateProductField(productId, 'coverImage', url), productId);
  };

  const handleNewCoverUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadCoverFile(file, (url) => setNewProdCover(url), 'new-product');
  };

  const uploadEbookFile = async (file: File, productId?: string) => {
    const targetKey = productId || 'new-ebook';
    setUploadingEbookId(targetKey);
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
        'X-File-Type': file.type || 'application/octet-stream',
        ...(productId ? { 'X-Product-Id': productId } : {}),
      });
      if (!headers) return;
      const response = await fetch('/api/author/upload-ebook', {
        method: 'POST',
        headers,
        body: file,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося завантажити файл книги.');
        return;
      }

      if (productId && data.product) {
        setProducts((prev) => prev.map((p) => (p.id === productId ? data.product : p)));
        setFeedback(`Файл «${data.fileName}» збережено у базі даних.`);
        onCatalogUpdated();
      } else {
        setNewProdEbookMeta({
          fileName: data.fileName,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          storageKey: data.storageKey,
        });
        setFeedback(`Файл «${data.fileName}» підготовлено та буде прикріплено до нової книги.`);
      }
    } catch {
      setFeedback('Помилка під час завантаження файлу книги.');
    } finally {
      setUploadingEbookId(null);
    }
  };

  const handleExistingEbookUpload = (productId: string, e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadEbookFile(file, productId);
    e.target.value = '';
  };

  const handleNewEbookUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadEbookFile(file);
    e.target.value = '';
  };

  const handlePreviewEbookDownload = async (product: StoreProduct) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const res = await fetch(
        `/api/ebooks/${encodeURIComponent(product.id)}/download?preview=author`,
        { headers }
      );
      if (!res.ok) {
        setFeedback('Не вдалося завантажити файл для перевірки.');
        return;
      }
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = product.ebookFileName || `${product.id}.txt`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(blobUrl);
    } catch {
      setFeedback('Помилка перевірки файлу.');
    }
  };

  const handleClearExistingEbook = async (productId: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/products/${productId}/ebook`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити файл книги.');
        return;
      }
      setProducts((prev) => prev.map((p) => (p.id === productId ? data.product : p)));
      setFeedback('Файл електронної книги видалено з бази.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити файл книги.');
    }
  };

  const handleSaveHeroLead = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/settings', {
        method: 'PUT',
        headers,
        body: JSON.stringify({ heroLeadText: leadDraft }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка збереження тексту.');
        return;
      }
      onHeroLeadUpdated(data.heroLeadText);
      setFeedback('Опис на головній сторінці оновлено.');
    } catch {
      setFeedback('Помилка з’єднання із сервером.');
    }
  };

  const handleSaveProduct = async (product: StoreProduct) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch(`/api/author/products/${product.id}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(product),
      });
      if (!response.ok) {
        const data = await response.json();
        setFeedback(data.error || 'Помилка збереження.');
        return;
      }
      setSavedId(product.id);
      setTimeout(() => setSavedId(null), 2000);
      setFeedback(`Збережено зміни для «${product.title}».`);
      onCatalogUpdated();
    } catch {
      setFeedback('Помилка збереження.');
    }
  };

  const handleDeleteProduct = async (id: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/products/${id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити позицію.');
        return;
      }
      const nextList = products.filter((p) => p.id !== id);
      setProducts(nextList);
      if (selectedProductId === id) {
        setSelectedProductId(nextList[0]?.id || null);
      }
      setFeedback('Позицію видалено з крамниці.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити позицію.');
    }
  };

  const handleCreateProduct = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const response = await fetch('/api/author/products', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          type: newProdType,
          title: newProdTitle,
          subtitle: newProdSubtitle,
          coverImage: newProdCover,
          priceUah: Number(newProdPrice),
          discountPercent: Number(newProdDiscount),
          promoActive: newProdPromoActive,
          promoLabel: newProdPromoLabel,
          progressLabel: newProdProgress,
          gdocGuestUrl: newProdGdocUrl,
          formats: newProdFormats,
          pages: Number(newProdPages),
          ebookFileName: newProdEbookMeta?.fileName,
          ebookMimeType: newProdEbookMeta?.mimeType,
          ebookFileSize: newProdEbookMeta?.fileSize,
          ebookStorageKey: newProdEbookMeta?.storageKey,
          binding: newProdBinding,
          dimensions: newProdDimensions,
          material: newProdMaterial,
          description: newProdDesc,
          sampleExcerpt: newProdExcerpt,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося додати видання.');
        return;
      }
      setProducts((prev) => [data.product, ...prev]);
      setSelectedProductId(data.product.id);
      setNewProdTitle('');
      setNewProdSubtitle('');
      setNewProdGdocUrl('');
      setNewProdDesc('');
      setNewProdExcerpt('');
      setNewProdDiscount('0');
      setNewProdPromoActive(false);
      setNewProdPromoLabel('');
      setNewProdEbookMeta(null);
      setFeedback('Нову позицію додано до крамниці.');
      setTab('store_admin');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося додати видання.');
    }
  };

  const handlePublishWork = async (e: FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    try {
      const headers = await getAuthHeaders({ 'Content-Type': 'application/json' });
      if (!headers) return;
      const payload: Record<string, string | number> = {
        title: pubTitle,
        content: pubContent,
        year: 2026,
      };
      if (pubKind === 'poem') payload.cycle = pubMeta || 'Нові вірші';
      if (pubKind === 'prose') payload.genre = pubMeta || 'Оповідання';
      if (pubKind === 'blog') payload.category = pubMeta || 'Майстерня';

      const response = await fetch('/api/author/publish', {
        method: 'POST',
        headers,
        body: JSON.stringify({ kind: pubKind, payload }),
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Помилка публікації.');
        return;
      }
      setPubTitle('');
      setPubMeta('');
      setPubContent('');
      setFeedback('Твір опубліковано на сайті.');
      loadAuthorData();
      onCatalogUpdated();
    } catch {
      setFeedback('Помилка публікації.');
    }
  };

  const handleDeleteWork = async (kind: 'poem' | 'prose' | 'blog', id: string) => {
    setFeedback(null);
    try {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch(`/api/author/works/${kind}/${id}`, {
        method: 'DELETE',
        headers,
      });
      const data = await response.json();
      if (!response.ok) {
        setFeedback(data.error || 'Не вдалося видалити запис.');
        return;
      }
      if (kind === 'poem') setPoems((prev) => prev.filter((p) => p.id !== id));
      if (kind === 'prose') setProse((prev) => prev.filter((p) => p.id !== id));
      if (kind === 'blog') setBlog((prev) => prev.filter((p) => p.id !== id));
      setFeedback('Запис видалено.');
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося видалити запис.');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-[#141413]/55 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Кабінет автора — Адміністратор"
    >
      <div
        className="bg-[#F7F6F2] border border-[#E4E1DA] rounded-2xl max-w-5xl w-full max-h-[92vh] overflow-y-auto p-5 sm:p-8 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 pb-5 border-b border-[#E4E1DA]">
          <div>
            <p className="text-xs text-[#5C5C58] mb-1">Робочий простір письменника й адміністратора</p>
            <h3 className="font-serif text-3xl font-semibold text-[#141413]">Кабінет автора</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-[#5C5C58] hover:text-[#141413] hover:bg-[#EFECE6] rounded-md cursor-pointer"
            aria-label="Закрити кабінет"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace Tabs */}
        <div className="flex flex-wrap items-center gap-1 p-1 bg-[#EFECE6] rounded-lg my-6 w-fit">
          <button
            type="button"
            onClick={() => {
              setTab('store_admin');
              setFeedback(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'store_admin' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5C58]'
            }`}
          >
            Крамниця ({products.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('new_product');
              setFeedback(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'new_product' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5C58]'
            }`}
          >
            + Додати товар
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('publish');
              setFeedback(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'publish' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5C58]'
            }`}
          >
            Тексти й публікація
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('home_text');
              setFeedback(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'home_text' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5C58]'
            }`}
          >
            Головна сторінка
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('orders');
              setFeedback(null);
            }}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap tabular-nums ${
              tab === 'orders' ? 'bg-white text-[#141413] shadow-xs' : 'text-[#5C5C58]'
            }`}
          >
            Замовлення ({orders.length})
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('analytics');
              setFeedback(null);
            }}
            className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap ${
              tab === 'analytics' ? 'bg-white text-[#881337] shadow-xs' : 'text-[#5C5C58]'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" strokeWidth={1.75} />
            <span>Статистика поведінки</span>
          </button>
        </div>

        {feedback && (
          <p className="mb-5 px-4 py-2.5 text-xs font-medium bg-white border border-[#E4E1DA] rounded-lg text-[#141413]">
            {feedback}
          </p>
        )}

        {/* TAB 1: Split Master-Detail Store Customization */}
        {tab === 'store_admin' && (
          loading ? (
            <p className="text-sm text-[#5C5C58]">Завантаження каталогу...</p>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Product List Selector */}
              <div className="lg:col-span-4 bg-white border border-[#E4E1DA] rounded-xl divide-y divide-[#E4E1DA] overflow-hidden">
                {products.map((prod) => {
                  const isActive = prod.id === selectedProduct?.id;
                  const price = getEffectivePriceUah(prod);
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => setSelectedProductId(prod.id)}
                      className={`w-full px-4 py-3 text-left flex items-center justify-between gap-3 transition-colors cursor-pointer ${
                        isActive ? 'bg-[#F7F6F2] text-[#881337]' : 'hover:bg-[#F7F6F2]/60 text-[#141413]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={isActive ? 'text-[#881337]' : 'text-[#5C5C58]'}>
                          {renderTypeIcon(prod.type)}
                        </span>
                        <span className={`text-xs truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                          {prod.title}
                        </span>
                      </div>
                      <span className="font-mono text-xs tabular-nums text-[#5C5C58] shrink-0">
                        {price} ₴
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Focused Product Editor */}
              {selectedProduct && (
                <div className="lg:col-span-8 p-5 sm:p-6 bg-white border border-[#E4E1DA] rounded-xl space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[#E4E1DA]">
                    <div>
                      <span className="text-xs text-[#5C5C58]">Редагування позиції</span>
                      <h4 className="font-serif text-2xl font-semibold text-[#141413]">
                        {selectedProduct.title}
                      </h4>
                    </div>

                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold text-[#141413] tabular-nums">
                        {getEffectivePriceUah(selectedProduct)} ₴
                        {(selectedProduct.discountPercent || 0) > 0 && (
                          <span className="ml-2 text-xs text-[#5C5C58] line-through">
                            {selectedProduct.priceUah} ₴
                          </span>
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteProduct(selectedProduct.id)}
                        className="p-2 text-[#5C5C58] hover:text-[#881337] rounded-md transition-colors cursor-pointer"
                        title="Видалити позицію"
                        aria-label={`Видалити ${selectedProduct.title}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Cover + Title */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
                    <div className="md:col-span-3">
                      <EditorialImage
                        src={selectedProduct.coverImage}
                        alt={selectedProduct.title}
                        titleFallback={selectedProduct.title}
                        aspectClassName="aspect-[3/4]"
                        className="rounded-lg border border-[#E4E1DA]"
                      />
                    </div>

                    <div className="md:col-span-9 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-[#141413] mb-1">
                          Обкладинка (URL або завантаження файлу)
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <input
                            type="text"
                            value={selectedProduct.coverImage}
                            onChange={(e) => updateProductField(selectedProduct.id, 'coverImage', e.target.value)}
                            className="flex-1 min-w-[180px] px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                          />
                          <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#141413] bg-[#EFECE6] hover:bg-[#E5E5E0] rounded-md cursor-pointer whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5" />
                            <span>
                              {uploadingId === selectedProduct.id ? 'Завантаження...' : 'Завантажити фото'}
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleExistingCoverUpload(selectedProduct.id, e)}
                              className="hidden"
                            />
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {COVER_PRESETS.map((preset) => (
                            <button
                              key={preset.url}
                              type="button"
                              onClick={() => updateProductField(selectedProduct.id, 'coverImage', preset.url)}
                              className={`px-2 py-1 text-[11px] rounded border cursor-pointer ${
                                selectedProduct.coverImage === preset.url
                                  ? 'border-[#881337] text-[#881337] bg-[#F7F6F2]'
                                  : 'border-[#E4E1DA] text-[#5C5C58] hover:border-[#141413]'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs text-[#5C5C58] mb-1">Назва</label>
                          <input
                            type="text"
                            value={selectedProduct.title}
                            onChange={(e) => updateProductField(selectedProduct.id, 'title', e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#5C5C58] mb-1">Підзаголовок</label>
                          <input
                            type="text"
                            value={selectedProduct.subtitle}
                            onChange={(e) => updateProductField(selectedProduct.id, 'subtitle', e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Description & Excerpt */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[#5C5C58] mb-1">Опис у крамниці</label>
                      <textarea
                        rows={3}
                        value={selectedProduct.description}
                        onChange={(e) => updateProductField(selectedProduct.id, 'description', e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#5C5C58] mb-1">Ознайомчий уривок</label>
                      <textarea
                        rows={3}
                        value={selectedProduct.sampleExcerpt}
                        onChange={(e) => updateProductField(selectedProduct.id, 'sampleExcerpt', e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                      />
                    </div>
                  </div>

                  {/* Price, Discount & Promo */}
                  <div className="p-4 bg-[#F7F6F2] border border-[#E4E1DA] rounded-lg space-y-3">
                    <p className="text-xs font-semibold text-[#141413]">Ціна, знижка та акція</p>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Базова ціна (₴)</label>
                        <input
                          type="number"
                          min={1}
                          value={selectedProduct.priceUah}
                          onChange={(e) => updateProductField(selectedProduct.id, 'priceUah', Number(e.target.value))}
                          className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Знижка (%)</label>
                        <input
                          type="number"
                          min={0}
                          max={90}
                          value={selectedProduct.discountPercent ?? 0}
                          onChange={(e) =>
                            updateProductField(selectedProduct.id, 'discountPercent', Number(e.target.value))
                          }
                          className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs text-[#5C5C58] mb-1">Назва акції</label>
                        <input
                          type="text"
                          value={selectedProduct.promoLabel || ''}
                          onChange={(e) => updateProductField(selectedProduct.id, 'promoLabel', e.target.value)}
                          placeholder="Наприклад: Осіння пропозиція"
                          className="w-full px-3 py-2 text-xs bg-white border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <label className="inline-flex items-center gap-2 text-xs text-[#141413] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedProduct.promoActive)}
                          onChange={(e) => updateProductField(selectedProduct.id, 'promoActive', e.target.checked)}
                          className="accent-[#881337] w-4 h-4"
                        />
                        <span>Акція активна на вітрині</span>
                      </label>

                      <span className="text-xs font-mono text-[#5C5C58] tabular-nums">
                        Фінальна ціна: <strong className="text-[#141413]">{getEffectivePriceUah(selectedProduct)} ₴</strong>
                      </span>
                    </div>
                  </div>

                  {/* Type-specific settings */}
                  {selectedProduct.type === 'wip_gdoc' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="md:col-span-2">
                        <label className="block text-xs text-[#5C5C58] mb-1">Гостьове посилання Google Docs</label>
                        <input
                          type="url"
                          value={selectedProduct.gdocGuestUrl || ''}
                          onChange={(e) => updateProductField(selectedProduct.id, 'gdocGuestUrl', e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Прогрес розділів</label>
                        <input
                          type="text"
                          value={selectedProduct.progressLabel || ''}
                          onChange={(e) => updateProductField(selectedProduct.id, 'progressLabel', e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                    </div>
                  )}

                  {selectedProduct.type === 'ebook' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                          <label className="block text-xs text-[#5C5C58] mb-1">Формати</label>
                          <input
                            type="text"
                            value={selectedProduct.formats || ''}
                            onChange={(e) => updateProductField(selectedProduct.id, 'formats', e.target.value)}
                            className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#5C5C58] mb-1">Сторінок</label>
                          <input
                            type="number"
                            value={selectedProduct.pages || 160}
                            onChange={(e) => updateProductField(selectedProduct.id, 'pages', Number(e.target.value))}
                            className="w-full px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-[#5C5C58] mb-1">Рік видання</label>
                          <input
                            type="number"
                            value={selectedProduct.year || 2026}
                            onChange={(e) => updateProductField(selectedProduct.id, 'year', Number(e.target.value))}
                            className="w-full px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                          />
                        </div>
                      </div>

                      {/* Database E-Book File Manager */}
                      <div className="p-4 bg-[#F7F6F2] border border-[#E4E1DA] rounded-lg space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-[#141413]">
                              Файл електронної книги у базі даних
                            </p>
                            <p className="text-[11px] text-[#5C5C58]">
                              Завантажений файл (EPUB, PDF, FB2, MOBI, TXT) автоматично передається покупцю після оплати.
                            </p>
                          </div>

                          <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#881337] hover:bg-[#9F1239] rounded-md cursor-pointer whitespace-nowrap">
                            <Upload className="w-3.5 h-3.5" />
                            <span>
                              {uploadingEbookId === selectedProduct.id
                                ? 'Завантаження у базу...'
                                : selectedProduct.ebookFileName
                                  ? 'Замінити файл книги'
                                  : 'Завантажити файл книги'}
                            </span>
                            <input
                              type="file"
                              accept=".epub,.pdf,.fb2,.mobi,.azw3,.txt,.rtf,.docx,.zip"
                              onChange={(e) => handleExistingEbookUpload(selectedProduct.id, e)}
                              className="hidden"
                            />
                          </label>
                        </div>

                        {selectedProduct.ebookFileName ? (
                          <div className="p-3 bg-white border border-[#E4E1DA] rounded-md flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <FileText className="w-4 h-4 text-[#881337] shrink-0" />
                              <div className="min-w-0">
                                <p className="text-xs font-mono font-medium text-[#141413] truncate">
                                  {selectedProduct.ebookFileName}
                                </p>
                                {selectedProduct.ebookFileSize && (
                                  <p className="text-[11px] text-[#5C5C58] font-mono tabular-nums">
                                    Розмір: {formatFileSize(selectedProduct.ebookFileSize)}
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                onClick={() => handlePreviewEbookDownload(selectedProduct)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-[#141413] bg-[#F7F6F2] border border-[#D4D4CE] hover:border-[#141413] rounded-md transition-colors cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>Перевірити файл</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleClearExistingEbook(selectedProduct.id)}
                                className="p-1.5 text-[#5C5C58] hover:text-[#881337] rounded-md cursor-pointer"
                                title="Видалити файл"
                                aria-label="Видалити прикріплений файл"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-[11px] text-[#5C5C58]">
                            Файл ще не завантажено — наразі при покупці передається резервний текстовий файл (.txt).
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedProduct.type === 'paper_book' && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Палітурка / видання</label>
                        <input
                          type="text"
                          value={selectedProduct.binding || ''}
                          onChange={(e) => updateProductField(selectedProduct.id, 'binding', e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Сторінок</label>
                        <input
                          type="number"
                          value={selectedProduct.pages || 200}
                          onChange={(e) => updateProductField(selectedProduct.id, 'pages', Number(e.target.value))}
                          className="w-full px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Рік видання</label>
                        <input
                          type="number"
                          value={selectedProduct.year || 2026}
                          onChange={(e) => updateProductField(selectedProduct.id, 'year', Number(e.target.value))}
                          className="w-full px-3 py-2 text-xs font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                    </div>
                  )}

                  {selectedProduct.type === 'poem_frame' && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Розміри антирамки</label>
                        <input
                          type="text"
                          value={selectedProduct.dimensions || ''}
                          onChange={(e) => updateProductField(selectedProduct.id, 'dimensions', e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-[#5C5C58] mb-1">Матеріал (скло, папір)</label>
                        <input
                          type="text"
                          value={selectedProduct.material || ''}
                          onChange={(e) => updateProductField(selectedProduct.id, 'material', e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleSaveProduct(selectedProduct)}
                      className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-semibold text-white bg-[#141413] hover:bg-[#881337] rounded-md transition-colors cursor-pointer"
                    >
                      {savedId === selectedProduct.id ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Збережено</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>Зберегти зміни</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        )}

        {/* TAB 2: Create New Product */}
        {tab === 'new_product' && (
          <form onSubmit={handleCreateProduct} className="space-y-4 bg-white p-5 sm:p-6 border border-[#E4E1DA] rounded-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Тип позиції</label>
                <select
                  value={newProdType}
                  onChange={(e) => setNewProdType(e.target.value as ProductType)}
                  className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                >
                  <option value="wip_gdoc">Роман у роботі (Google Документ)</option>
                  <option value="ebook">Електронна книга</option>
                  <option value="paper_book">Паперова книга (фізична)</option>
                  <option value="poem_frame">Тіло вірша (скляна антирамка)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Назва</label>
                <input
                  type="text"
                  required
                  value={newProdTitle}
                  onChange={(e) => setNewProdTitle(e.target.value)}
                  placeholder="Наприклад: Готель біля залізниці"
                  className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#141413] mb-1">Підзаголовок</label>
              <input
                type="text"
                value={newProdSubtitle}
                onChange={(e) => setNewProdSubtitle(e.target.value)}
                placeholder="Коротке уточнення формату"
                className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center p-4 bg-[#F7F6F2] border border-[#E4E1DA] rounded-lg">
              <div className="sm:col-span-3">
                <EditorialImage
                  src={newProdCover}
                  alt="Прев’ю обкладинки"
                  titleFallback="Обкладинка"
                  aspectClassName="aspect-[3/4]"
                  className="rounded-lg border border-[#D4D4CE]"
                />
              </div>
              <div className="sm:col-span-9 space-y-2">
                <label className="block text-xs font-medium text-[#141413]">Обкладинка / фото</label>
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    value={newProdCover}
                    onChange={(e) => setNewProdCover(e.target.value)}
                    className="flex-1 min-w-[180px] px-3 py-2 text-xs font-mono bg-white border border-[#D4D4CE] rounded-md"
                  />
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#141413] bg-[#EFECE6] hover:bg-[#E5E5E0] rounded-md cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingId === 'new-product' ? 'Завантаження...' : 'Завантажити файл'}</span>
                    <input type="file" accept="image/*" onChange={handleNewCoverUpload} className="hidden" />
                  </label>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {COVER_PRESETS.map((preset) => (
                    <button
                      key={preset.url}
                      type="button"
                      onClick={() => setNewProdCover(preset.url)}
                      className="px-2 py-1 text-[11px] rounded border border-[#D4D4CE] text-[#5C5C58] hover:border-[#141413] cursor-pointer"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Ціна (₴)</label>
                <input
                  type="number"
                  required
                  min={1}
                  value={newProdPrice}
                  onChange={(e) => setNewProdPrice(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Знижка (%)</label>
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={newProdDiscount}
                  onChange={(e) => setNewProdDiscount(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Текст акції</label>
                <input
                  type="text"
                  value={newProdPromoLabel}
                  onChange={(e) => setNewProdPromoLabel(e.target.value)}
                  placeholder="Ранній доступ"
                  className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                />
              </div>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-[#141413] cursor-pointer">
              <input
                type="checkbox"
                checked={newProdPromoActive}
                onChange={(e) => setNewProdPromoActive(e.target.checked)}
                className="accent-[#881337] w-4 h-4"
              />
              <span>Увімкнути акцію одразу після додавання</span>
            </label>

            {newProdType === 'wip_gdoc' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    Гостьове посилання Google Docs
                  </label>
                  <input
                    type="url"
                    required
                    value={newProdGdocUrl}
                    onChange={(e) => setNewProdGdocUrl(e.target.value)}
                    placeholder="https://docs.google.com/document/d/.../view"
                    className="w-full px-3 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">Прогрес написання</label>
                  <input
                    type="text"
                    value={newProdProgress}
                    onChange={(e) => setNewProdProgress(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
              </div>
            )}

            {newProdType === 'ebook' && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#141413] mb-1">Формати</label>
                    <input
                      type="text"
                      value={newProdFormats}
                      onChange={(e) => setNewProdFormats(e.target.value)}
                      className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#141413] mb-1">Кількість сторінок</label>
                    <input
                      type="number"
                      value={newProdPages}
                      onChange={(e) => setNewProdPages(e.target.value)}
                      className="w-full px-3 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                    />
                  </div>
                </div>

                <div className="p-4 bg-[#F7F6F2] border border-[#E4E1DA] rounded-lg flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#141413]">
                      Файл електронної книги у базу даних
                    </p>
                    <p className="text-[11px] text-[#5C5C58]">
                      {newProdEbookMeta
                        ? `${newProdEbookMeta.fileName} (${formatFileSize(newProdEbookMeta.fileSize)})`
                        : 'EPUB, PDF, FB2, MOBI або TXT — до 40 МБ'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <label className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#881337] hover:bg-[#9F1239] rounded-md cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {uploadingEbookId === 'new-ebook'
                          ? 'Завантаження...'
                          : newProdEbookMeta
                            ? 'Змінити файл'
                            : 'Завантажити книгу'}
                      </span>
                      <input
                        type="file"
                        accept=".epub,.pdf,.fb2,.mobi,.azw3,.txt,.rtf,.docx,.zip"
                        onChange={handleNewEbookUpload}
                        className="hidden"
                      />
                    </label>
                    {newProdEbookMeta && (
                      <button
                        type="button"
                        onClick={() => setNewProdEbookMeta(null)}
                        className="p-1.5 text-[#5C5C58] hover:text-[#881337] cursor-pointer"
                        aria-label="Прибрати файл"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {newProdType === 'paper_book' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">Тип палітурки</label>
                  <input
                    type="text"
                    value={newProdBinding}
                    onChange={(e) => setNewProdBinding(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">Кількість сторінок</label>
                  <input
                    type="number"
                    value={newProdPages}
                    onChange={(e) => setNewProdPages(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
              </div>
            )}

            {newProdType === 'poem_frame' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">Розміри антирамки</label>
                  <input
                    type="text"
                    value={newProdDimensions}
                    onChange={(e) => setNewProdDimensions(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">Матеріал</label>
                  <input
                    type="text"
                    value={newProdMaterial}
                    onChange={(e) => setNewProdMaterial(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#141413] mb-1">Опис</label>
              <textarea
                rows={3}
                required
                value={newProdDesc}
                onChange={(e) => setNewProdDesc(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-[#141413] mb-1">Ознайомчий уривок</label>
              <textarea
                rows={2}
                value={newProdExcerpt}
                onChange={(e) => setNewProdExcerpt(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
              />
            </div>

            <button
              type="submit"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#881337] hover:bg-[#9F1239] rounded-md cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Додати до крамниці</span>
            </button>
          </form>
        )}

        {/* TAB 3: Publish & Manage Literary Works */}
        {tab === 'publish' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form onSubmit={handlePublishWork} className="lg:col-span-7 space-y-4 bg-white p-5 sm:p-6 border border-[#E4E1DA] rounded-xl">
              <h4 className="font-serif text-2xl font-semibold text-[#141413]">Опублікувати новий текст</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">Розділ сайту</label>
                  <select
                    value={pubKind}
                    onChange={(e) => setPubKind(e.target.value as 'poem' | 'prose' | 'blog')}
                    className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  >
                    <option value="poem">Вірші (з’явиться першим у свайпі)</option>
                    <option value="prose">Проза</option>
                    <option value="blog">Блог</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#141413] mb-1">
                    {pubKind === 'poem' ? 'Цикл' : pubKind === 'prose' ? 'Жанр' : 'Категорія'}
                  </label>
                  <input
                    type="text"
                    value={pubMeta}
                    onChange={(e) => setPubMeta(e.target.value)}
                    placeholder={pubKind === 'poem' ? 'Карпатські зошити' : pubKind === 'prose' ? 'Новела' : 'Майстерня'}
                    className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Заголовок</label>
                <input
                  type="text"
                  required
                  value={pubTitle}
                  onChange={(e) => setPubTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#141413] mb-1">Текст</label>
                <textarea
                  rows={7}
                  required
                  value={pubContent}
                  onChange={(e) => setPubContent(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#141413] hover:bg-[#881337] rounded-md cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Опублікувати</span>
              </button>
            </form>

            {/* Quick List of Existing Works */}
            <div className="lg:col-span-5 bg-white p-5 border border-[#E4E1DA] rounded-xl space-y-4">
              <h4 className="font-serif text-xl font-semibold text-[#141413]">Опубліковані матеріали</h4>
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {poems.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 py-2 border-b border-[#E4E1DA] text-xs">
                    <div className="min-w-0">
                      <span className="text-[#5C5C58]">Вірш · </span>
                      <span className="font-medium text-[#141413] truncate">{p.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteWork('poem', p.id)}
                      className="p-1 text-[#5C5C58] hover:text-[#881337] cursor-pointer shrink-0"
                      aria-label={`Видалити вірш ${p.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {prose.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-2 py-2 border-b border-[#E4E1DA] text-xs">
                    <div className="min-w-0">
                      <span className="text-[#5C5C58]">Проза · </span>
                      <span className="font-medium text-[#141413] truncate">{p.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteWork('prose', p.id)}
                      className="p-1 text-[#5C5C58] hover:text-[#881337] cursor-pointer shrink-0"
                      aria-label={`Видалити твір ${p.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {blog.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-2 py-2 border-b border-[#E4E1DA] text-xs">
                    <div className="min-w-0">
                      <span className="text-[#5C5C58]">Блог · </span>
                      <span className="font-medium text-[#141413] truncate">{b.title}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteWork('blog', b.id)}
                      className="p-1 text-[#5C5C58] hover:text-[#881337] cursor-pointer shrink-0"
                      aria-label={`Видалити допис ${b.title}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: Homepage Text Customization & Trusted Devices */}
        {tab === 'home_text' && (
          <div className="space-y-6 max-w-2xl">
            <form onSubmit={handleSaveHeroLead} className="bg-white p-5 sm:p-6 border border-[#E4E1DA] rounded-xl space-y-4">
              <div>
                <h4 className="font-serif text-2xl font-semibold text-[#141413] mb-1">
                  Текст під іменем на головній сторінці
                </h4>
                <p className="text-xs text-[#5C5C58]">
                  Цей блок бачать усі відвідувачі над списком розділів на стартовому екрані.
                </p>
              </div>

              <textarea
                rows={4}
                required
                minLength={3}
                maxLength={500}
                value={leadDraft}
                onChange={(e) => setLeadDraft(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-[#F7F6F2] border border-[#D4D4CE] rounded-md focus:outline-none focus:border-[#881337]"
              />

              <button
                type="submit"
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-[#141413] hover:bg-[#881337] rounded-md cursor-pointer"
              >
                <Save className="w-4 h-4" />
                <span>Зберегти текст</span>
              </button>
            </form>

            <div className="bg-white p-5 sm:p-6 border border-[#E4E1DA] rounded-xl space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h4 className="font-serif text-2xl font-semibold text-[#141413] mb-1">
                    Прив’язані пристрої та домени
                  </h4>
                  <p className="text-xs text-[#5C5C58]">
                    Доступ для <span className="font-mono text-[#141413]">andrijdankiv5@gmail.com</span> на цьому домені:{' '}
                    <span className="font-mono text-[#141413]">
                      {typeof window !== 'undefined' ? window.location.hostname : ''}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  disabled={deviceBusy}
                  onClick={handleBindCurrentDevice}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#1E4631] hover:bg-[#153524] rounded-md cursor-pointer disabled:opacity-60"
                >
                  {currentDeviceId ? 'Оновити прив’язку пристрою' : 'Прив’язати цей пристрій'}
                </button>
              </div>

              {trustedDevices.length === 0 ? (
                <p className="text-xs text-[#5C5C58]">
                  Пристрої ще не прив’язано. Натисніть кнопку вище, щоб дозволити швидкий вхід із цього браузера та домену.
                </p>
              ) : (
                <div className="divide-y divide-[#E4E1DA]">
                  {trustedDevices.map((dev) => (
                    <div key={dev.deviceId} className="py-3 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0">
                        <p className="font-medium text-[#141413] truncate">
                          {dev.label}
                          {dev.deviceId === currentDeviceId && (
                            <span className="ml-2 text-[10px] font-mono text-[#1E4631]">(цей пристрій)</span>
                          )}
                        </p>
                        <p className="text-[11px] font-mono text-[#5C5C58] truncate">
                          {dev.domain} · {new Date(dev.lastUsedAt).toLocaleDateString('uk-UA')}
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={deviceBusy}
                        onClick={() => handleRevokeDevice(dev.deviceId)}
                        className="px-2.5 py-1 text-[11px] text-[#881337] border border-[#881337]/30 hover:bg-[#881337] hover:text-white rounded cursor-pointer shrink-0"
                      >
                        Відв’язати
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 5: Orders & Shipping Fulfillment */}
        {tab === 'orders' && (
          <div className="space-y-4">
            {orders.length === 0 ? (
              <div className="bg-white p-10 border border-[#E4E1DA] rounded-xl text-center">
                <Package className="w-8 h-8 text-[#5C5C58] mx-auto mb-2" strokeWidth={1.5} />
                <p className="font-serif text-2xl text-[#141413] mb-1">Замовлень ще немає</p>
                <p className="text-xs text-[#5C5C58]">
                  Тут з’являться оплачені книги, антирамки з адресами доставки та електронні замовлення.
                </p>
              </div>
            ) : (
              orders.map((ord) => (
                <div key={ord.orderCode} className="p-5 bg-white border border-[#E4E1DA] rounded-xl space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-[#E4E1DA]">
                    <div className="text-xs text-[#5C5C58]">
                      <span className="font-mono font-semibold text-[#141413]">#{ord.orderCode}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{ord.buyerName}</span>
                      <span aria-hidden="true"> · </span>
                      <span>{ord.buyerEmail}</span>
                    </div>
                    <span className="font-mono text-sm font-semibold text-[#141413] tabular-nums">
                      {ord.totalUah} ₴
                    </span>
                  </div>

                  <div className="text-xs text-[#141413] space-y-1">
                    {ord.items.map((it) => (
                      <p key={it.productId}>• {it.title}</p>
                    ))}
                  </div>

                  {ord.shipping && (
                    <div className="p-3 bg-[#F7F6F2] rounded-lg text-xs text-[#444440] space-y-1">
                      <p className="font-semibold text-[#141413]">
                        Доставка ({ord.shipping.carrier === 'nova_poshta' ? 'Нова Пошта' : ord.shipping.carrier === 'ukrposhta' ? 'Укрпошта' : 'Кур’єр'})
                      </p>
                      <p>
                        {ord.shipping.recipientName} · {ord.shipping.phone} · {ord.shipping.city}, {ord.shipping.addressOrBranch}
                      </p>
                      {ord.shipping.comment && <p className="italic">Коментар: {ord.shipping.comment}</p>}
                    </div>
                  )}

                  {ord.payment && (
                    <p className="text-[11px] font-mono text-emerald-800">
                      Оплачено · {ord.payment.providerLabel}
                      {ord.payment.cardLast4 ? ` (•••• ${ord.payment.cardLast4})` : ''} · {ord.payment.transactionId}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {/* TAB 6: User Behavior Analytics */}
        {tab === 'analytics' && (
          <BehaviorAnalyticsTab getAdminToken={getAdminToken} />
        )}
      </div>
    </div>
  );
}
