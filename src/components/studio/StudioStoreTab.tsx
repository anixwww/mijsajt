import {
  ArrowLeft,
  BookOpen,
  Check,
  Download,
  FileText,
  PenTool,
  Plus,
  Save,
  Tablet,
  Trash2,
  Upload,
  Palette,
  X,
} from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  getEffectivePriceUah,
  parseStoreProductPromo,
  serializeStoreProductPromoLabel,
  type ProductType,
  type StoreProduct,
} from '../../types.ts';
import { EditorialImage } from '../EditorialImage.tsx';
import { readImageAsOptimizedDataUrl } from '../../utils/imageUpload.ts';
import { AntiFrameIcon } from '../StoreIcons.tsx';
import {
  COVER_PRESETS,
  formatFileSize,
  STUDIO_INPUT_CLASS,
  STUDIO_INPUT_SM_CLASS,
  STUDIO_LABEL_CLASS,
  type GetAuthHeadersFn,
} from './studioShared.ts';

interface StudioStoreTabProps {
  products: StoreProduct[];
  setProducts: (updater: (prev: StoreProduct[]) => StoreProduct[]) => void;
  loading: boolean;
  getAuthHeaders: GetAuthHeadersFn;
  setFeedback: (msg: string | null) => void;
  onCatalogUpdated: () => void;
  isCreatingNew: boolean;
  setIsCreatingNew: (val: boolean) => void;
}

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
    case 'painting':
      return <Palette className="w-3.5 h-3.5 shrink-0" strokeWidth={1.75} />;
  }
}

export function StudioStoreTab({
  products,
  setProducts,
  loading,
  getAuthHeaders,
  setFeedback,
  onCatalogUpdated,
  isCreatingNew,
  setIsCreatingNew,
}: StudioStoreTabProps) {
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadingEbookId, setUploadingEbookId] = useState<string | null>(null);

  // New Product form state
  const [newProdType, setNewProdType] = useState<ProductType>('wip_gdoc');
  const [newProdTitle, setNewProdTitle] = useState('');
  const [newProdSubtitle, setNewProdSubtitle] = useState('');
  const [newProdCover, setNewProdCover] = useState(COVER_PRESETS[2].url);
  const [newProdPrice, setNewProdPrice] = useState('280');
  const [newProdDiscount, setNewProdDiscount] = useState('0');
  const [newProdPromoActive, setNewProdPromoActive] = useState(false);
  const [newProdPromoLabel, setNewProdPromoLabel] = useState('');
  const [newProdIsBestseller, setNewProdIsBestseller] = useState(false);
  const [newProdPromoEndsAt, setNewProdPromoEndsAt] = useState('');
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

  useEffect(() => {
    setSelectedProductId((prev) =>
      prev && products.some((p) => p.id === prev) ? prev : products[0]?.id || null
    );
  }, [products]);

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
      const dataUrl = await readImageAsOptimizedDataUrl(file);

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
        setFeedback(`Файл «${data.fileName}» підготовлено для нової книги.`);
      }
    } catch {
      setFeedback('Помилка під час завантаження файлу книги.');
    } finally {
      setUploadingEbookId(null);
    }
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
      setProducts((prev) => {
        const nextList = prev.filter((p) => p.id !== id);
        if (selectedProductId === id) {
          setSelectedProductId(nextList[0]?.id || null);
        }
        return nextList;
      });
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
          promoLabel: serializeStoreProductPromoLabel({
            promoLabel: newProdPromoLabel,
            isBestseller: newProdIsBestseller,
            promoEndsAt: newProdPromoEndsAt,
          }),
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
      setNewProdIsBestseller(false);
      setNewProdPromoEndsAt('');
      setNewProdEbookMeta(null);
      setFeedback('Нову позицію додано до крамниці.');
      setIsCreatingNew(false);
      onCatalogUpdated();
    } catch {
      setFeedback('Не вдалося додати видання.');
    }
  };

  if (isCreatingNew) {
    return (
      <form onSubmit={handleCreateProduct} className="max-w-3xl space-y-5">
        <div className="flex items-center justify-between gap-3 pb-2">
          <div>
            <h4 className="text-base font-semibold text-[#141413] dark:text-[#EDEAE1]">
              Нова позиція у крамниці
            </h4>
            <p className="text-xs text-[#5C5C58] dark:text-[#A6A196]">
              Оберіть формат видання, завантажте обкладинку та вкажіть ціну.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsCreatingNew(false)}
            className="btn-editorial-secondary"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Назад до каталогу</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={STUDIO_LABEL_CLASS}>Тип позиції</label>
            <select
              value={newProdType}
              onChange={(e) => setNewProdType(e.target.value as ProductType)}
              className={STUDIO_INPUT_CLASS}
            >
              <option value="wip_gdoc">Роман у роботі (Google Документ)</option>
              <option value="ebook">Електронна книга</option>
              <option value="paper_book">Паперова книга (фізична)</option>
              <option value="poem_frame">Тіло вірша (скляна антирамка)</option>
              <option value="painting">Оригінальна картина (живопис)</option>
            </select>
          </div>
          <div>
            <label className={STUDIO_LABEL_CLASS}>Назва *</label>
            <input
              type="text"
              required
              value={newProdTitle}
              onChange={(e) => setNewProdTitle(e.target.value)}
              placeholder="Наприклад: Готель біля залізниці"
              className={STUDIO_INPUT_CLASS}
            />
          </div>
        </div>

        <div>
          <label className={STUDIO_LABEL_CLASS}>Підзаголовок</label>
          <input
            type="text"
            value={newProdSubtitle}
            onChange={(e) => setNewProdSubtitle(e.target.value)}
            placeholder="Коротке уточнення формату"
            className={STUDIO_INPUT_CLASS}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center py-2">
          <div className="sm:col-span-3 max-w-[130px]">
            <EditorialImage
              src={newProdCover}
              alt="Прев’ю обкладинки"
              titleFallback="Обкладинка"
              aspectClassName="aspect-[3/4]"
              className="rounded-lg"
            />
          </div>
          <div className="sm:col-span-9 space-y-2.5">
            <label className={STUDIO_LABEL_CLASS}>Обкладинка / фото</label>
            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={newProdCover}
                onChange={(e) => setNewProdCover(e.target.value)}
                className={`flex-1 min-w-[180px] ${STUDIO_INPUT_SM_CLASS} font-mono`}
              />
              <label className="btn-editorial-secondary cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                <span>{uploadingId === 'new-product' ? 'Завантаження...' : 'Завантажити фото'}</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadCoverFile(f, (url) => setNewProdCover(url), 'new-product');
                  }}
                  className="hidden"
                />
              </label>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {COVER_PRESETS.map((preset) => (
                <button
                  key={preset.url}
                  type="button"
                  onClick={() => setNewProdCover(preset.url)}
                  className={`px-2 py-1 text-[11px] rounded-md cursor-pointer transition-colors ${
                    newProdCover === preset.url
                      ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5] font-medium'
                      : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={STUDIO_LABEL_CLASS}>Ціна (₴) *</label>
            <input
              type="number"
              required
              min={1}
              value={newProdPrice}
              onChange={(e) => setNewProdPrice(e.target.value)}
              className={`${STUDIO_INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
          <div>
            <label className={STUDIO_LABEL_CLASS}>Знижка (%)</label>
            <input
              type="number"
              min={0}
              max={90}
              value={newProdDiscount}
              onChange={(e) => setNewProdDiscount(e.target.value)}
              className={`${STUDIO_INPUT_CLASS} font-mono tabular-nums`}
            />
          </div>
          <div>
            <label className={STUDIO_LABEL_CLASS}>Текст акції</label>
            <input
              type="text"
              value={newProdPromoLabel}
              onChange={(e) => setNewProdPromoLabel(e.target.value)}
              placeholder="Ранній доступ"
              className={STUDIO_INPUT_CLASS}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2 text-xs text-[#141413] dark:text-[#EDEAE1] cursor-pointer">
              <input
                type="checkbox"
                checked={newProdPromoActive}
                onChange={(e) => setNewProdPromoActive(e.target.checked)}
                className="accent-[#315E3C] dark:accent-[#E5E5E5] w-4 h-4"
              />
              <span>Увімкнути акцію одразу після додавання</span>
            </label>
            <label className="inline-flex items-center gap-2 text-xs text-[#141413] dark:text-[#EDEAE1] cursor-pointer">
              <input
                type="checkbox"
                checked={newProdIsBestseller}
                onChange={(e) => setNewProdIsBestseller(e.target.checked)}
                className="accent-[#315E3C] dark:accent-[#E5E5E5] w-4 h-4"
              />
              <span>Бестселлер</span>
            </label>
          </div>
          <div>
            <label className={STUDIO_LABEL_CLASS}>Таймер акції (до дати й часу)</label>
            <input
              type="datetime-local"
              value={newProdPromoEndsAt}
              onChange={(e) => setNewProdPromoEndsAt(e.target.value)}
              className={`${STUDIO_INPUT_SM_CLASS} font-mono`}
            />
          </div>
        </div>

        {newProdType === 'wip_gdoc' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={STUDIO_LABEL_CLASS}>Гостьове посилання Google Docs *</label>
              <input
                type="url"
                required
                value={newProdGdocUrl}
                onChange={(e) => setNewProdGdocUrl(e.target.value)}
                placeholder="https://docs.google.com/document/d/.../view"
                className={`${STUDIO_INPUT_CLASS} font-mono text-xs`}
              />
            </div>
            <div>
              <label className={STUDIO_LABEL_CLASS}>Прогрес написання</label>
              <input
                type="text"
                value={newProdProgress}
                onChange={(e) => setNewProdProgress(e.target.value)}
                className={STUDIO_INPUT_CLASS}
              />
            </div>
          </div>
        )}

        {newProdType === 'ebook' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={STUDIO_LABEL_CLASS}>Формати</label>
                <input
                  type="text"
                  value={newProdFormats}
                  onChange={(e) => setNewProdFormats(e.target.value)}
                  className={STUDIO_INPUT_CLASS}
                />
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Кількість сторінок</label>
                <input
                  type="number"
                  value={newProdPages}
                  onChange={(e) => setNewProdPages(e.target.value)}
                  className={`${STUDIO_INPUT_CLASS} font-mono tabular-nums`}
                />
              </div>
            </div>

            <div className="p-3.5 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                  Файл електронної книги
                </p>
                <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                  {newProdEbookMeta
                    ? `${newProdEbookMeta.fileName} (${formatFileSize(newProdEbookMeta.fileSize)})`
                    : 'EPUB, PDF, FB2, MOBI або TXT — до 40 МБ'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <label className="btn-editorial-primary cursor-pointer">
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
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadEbookFile(f);
                      e.target.value = '';
                    }}
                    className="hidden"
                  />
                </label>
                {newProdEbookMeta && (
                  <button
                    type="button"
                    onClick={() => setNewProdEbookMeta(null)}
                    className="p-1.5 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 cursor-pointer"
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
              <label className={STUDIO_LABEL_CLASS}>Тип палітурки</label>
              <input
                type="text"
                value={newProdBinding}
                onChange={(e) => setNewProdBinding(e.target.value)}
                className={STUDIO_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={STUDIO_LABEL_CLASS}>Кількість сторінок</label>
              <input
                type="number"
                value={newProdPages}
                onChange={(e) => setNewProdPages(e.target.value)}
                className={`${STUDIO_INPUT_CLASS} font-mono tabular-nums`}
              />
            </div>
          </div>
        )}

        {newProdType === 'poem_frame' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={STUDIO_LABEL_CLASS}>Розміри антирамки</label>
              <input
                type="text"
                value={newProdDimensions}
                onChange={(e) => setNewProdDimensions(e.target.value)}
                className={STUDIO_INPUT_CLASS}
              />
            </div>
            <div>
              <label className={STUDIO_LABEL_CLASS}>Матеріал</label>
              <input
                type="text"
                value={newProdMaterial}
                onChange={(e) => setNewProdMaterial(e.target.value)}
                className={STUDIO_INPUT_CLASS}
              />
            </div>
          </div>
        )}

        <div>
          <label className={STUDIO_LABEL_CLASS}>Опис *</label>
          <textarea
            rows={3}
            required
            value={newProdDesc}
            onChange={(e) => setNewProdDesc(e.target.value)}
            className={STUDIO_INPUT_CLASS}
          />
        </div>

        <div>
          <label className={STUDIO_LABEL_CLASS}>Ознайомчий уривок</label>
          <textarea
            rows={2}
            value={newProdExcerpt}
            onChange={(e) => setNewProdExcerpt(e.target.value)}
            className={STUDIO_INPUT_CLASS}
          />
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button type="submit" className="btn-editorial-primary">
            <Plus className="w-4 h-4" />
            <span>Додати до крамниці</span>
          </button>
          <button
            type="button"
            onClick={() => setIsCreatingNew(false)}
            className="btn-editorial-secondary"
          >
            Скасувати
          </button>
        </div>
      </form>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-12 rounded-xl bg-[#F5F4EE] dark:bg-[#262626] animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 h-64 rounded-xl bg-[#F5F4EE] dark:bg-[#262626] animate-pulse" />
          <div className="lg:col-span-8 h-96 rounded-xl bg-[#F5F4EE] dark:bg-[#262626] animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Split Master-Detail Store Catalog */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Product List */}
        <div className="lg:col-span-4 rounded-xl space-y-1.5">
          {products.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#5C5C58] dark:text-[#A6A196] rounded-xl bg-[#FAF9F5] dark:bg-[#262626]">
              У крамниці ще немає товарів.
            </div>
          ) : (
            products.map((prod) => {
              const isActive = prod.id === selectedProduct?.id;
              const price = getEffectivePriceUah(prod);
              return (
                <button
                  key={prod.id}
                  type="button"
                  onClick={() => setSelectedProductId(prod.id)}
                  className={`w-full px-3.5 py-3 rounded-xl text-left flex items-center justify-between gap-2.5 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#F2F6EE] dark:bg-[#323232] text-[#1E3A29] dark:text-[#E5E5E5]'
                      : 'bg-[#FAF9F5] dark:bg-[#262626] hover:bg-[#EFECE6] dark:hover:bg-[#2E2E2E] text-[#141413] dark:text-[#EDEAE1]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className={isActive ? 'text-[#2C5937] dark:text-[#E5E5E5]' : 'text-[#5C5C58] dark:text-[#A6A196]'}>
                      {renderTypeIcon(prod.type)}
                    </span>
                    <span className={`text-xs truncate ${isActive ? 'font-semibold' : 'font-medium'}`}>
                      {prod.title}
                    </span>
                  </div>
                  <span className="font-mono text-xs tabular-nums text-[#5C5C58] dark:text-[#A6A196] shrink-0">
                    {price} ₴
                  </span>
                </button>
              );
            })
          )}
        </div>

        {/* Right: Single-Elevation Detail Editor */}
        {selectedProduct && (
          <div className="lg:col-span-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-1">
              <div className="min-w-0">
                <h4 className="text-lg font-semibold text-[#141413] dark:text-[#EDEAE1] truncate">
                  {selectedProduct.title}
                </h4>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="font-mono text-sm font-semibold text-[#141413] dark:text-[#EDEAE1] tabular-nums">
                  {getEffectivePriceUah(selectedProduct)} ₴
                  {(selectedProduct.discountPercent || 0) > 0 && (
                    <span className="ml-1.5 text-xs text-[#5C5C58] line-through">
                      {selectedProduct.priceUah} ₴
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => handleDeleteProduct(selectedProduct.id)}
                  className="p-2 text-[#5C5C58] dark:text-[#A6A196] hover:text-rose-700 dark:hover:text-rose-400 rounded-lg hover:bg-rose-700/10 transition-colors cursor-pointer"
                  title="Видалити позицію"
                  aria-label={`Видалити ${selectedProduct.title}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Cover + Title */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <div className="md:col-span-3 max-w-[140px]">
                <EditorialImage
                  src={selectedProduct.coverImage}
                  alt={selectedProduct.title}
                  titleFallback={selectedProduct.title}
                  aspectClassName="aspect-[3/4]"
                  className="rounded-lg"
                />
              </div>

              <div className="md:col-span-9 space-y-3">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Обкладинка (URL або файл)</label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={selectedProduct.coverImage}
                      onChange={(e) => updateProductField(selectedProduct.id, 'coverImage', e.target.value)}
                      className={`flex-1 min-w-[180px] ${STUDIO_INPUT_SM_CLASS} font-mono`}
                    />
                    <label className="btn-editorial-secondary py-1.5 px-3 cursor-pointer">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {uploadingId === selectedProduct.id ? 'Завантаження...' : 'Завантажити фото'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) {
                            uploadCoverFile(
                              f,
                              (url) => updateProductField(selectedProduct.id, 'coverImage', url),
                              selectedProduct.id
                            );
                          }
                        }}
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
                        className={`px-2 py-1 text-[11px] rounded-md cursor-pointer transition-colors ${
                          selectedProduct.coverImage === preset.url
                            ? 'bg-[#EAE7DF] dark:bg-[#323232] text-[#2C5937] dark:text-[#E5E5E5] font-medium'
                            : 'text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1]'
                        }`}
                      >
                        {preset.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Назва</label>
                    <input
                      type="text"
                      value={selectedProduct.title}
                      onChange={(e) => updateProductField(selectedProduct.id, 'title', e.target.value)}
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Підзаголовок</label>
                    <input
                      type="text"
                      value={selectedProduct.subtitle}
                      onChange={(e) => updateProductField(selectedProduct.id, 'subtitle', e.target.value)}
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Description & Excerpt */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className={STUDIO_LABEL_CLASS}>Опис у крамниці</label>
                <textarea
                  rows={3}
                  value={selectedProduct.description}
                  onChange={(e) => updateProductField(selectedProduct.id, 'description', e.target.value)}
                  className={STUDIO_INPUT_SM_CLASS}
                />
              </div>
              <div>
                <label className={STUDIO_LABEL_CLASS}>Ознайомчий уривок</label>
                <textarea
                  rows={3}
                  value={selectedProduct.sampleExcerpt}
                  onChange={(e) => updateProductField(selectedProduct.id, 'sampleExcerpt', e.target.value)}
                  className={STUDIO_INPUT_SM_CLASS}
                />
              </div>
            </div>

            {/* Price & Promo */}
            {(() => {
              const parsedPromo = parseStoreProductPromo(selectedProduct);
              return (
                <div className="pt-2 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                    <div>
                      <label className={STUDIO_LABEL_CLASS}>Ціна (₴)</label>
                      <input
                        type="number"
                        min={1}
                        value={selectedProduct.priceUah}
                        onChange={(e) => updateProductField(selectedProduct.id, 'priceUah', Number(e.target.value))}
                        className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className={STUDIO_LABEL_CLASS}>Знижка (%)</label>
                      <input
                        type="number"
                        min={0}
                        max={90}
                        value={selectedProduct.discountPercent ?? 0}
                        onChange={(e) =>
                          updateProductField(selectedProduct.id, 'discountPercent', Number(e.target.value))
                        }
                        className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={STUDIO_LABEL_CLASS}>Назва акції</label>
                      <input
                        type="text"
                        value={parsedPromo.cleanPromoLabel}
                        onChange={(e) =>
                          updateProductField(
                            selectedProduct.id,
                            'promoLabel',
                            serializeStoreProductPromoLabel({
                              promoLabel: e.target.value,
                              isBestseller: parsedPromo.isBestseller,
                              promoEndsAt: parsedPromo.promoEndsAt,
                            })
                          )
                        }
                        placeholder="Наприклад: Осіння пропозиція"
                        className={STUDIO_INPUT_SM_CLASS}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
                    <div className="flex flex-wrap items-center gap-4">
                      <label className="inline-flex items-center gap-2 text-xs text-[#141413] dark:text-[#EDEAE1] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(selectedProduct.promoActive)}
                          onChange={(e) => updateProductField(selectedProduct.id, 'promoActive', e.target.checked)}
                          className="accent-[#315E3C] dark:accent-[#E5E5E5] w-4 h-4"
                        />
                        <span>Акція активна на вітрині</span>
                      </label>

                      <label className="inline-flex items-center gap-2 text-xs text-[#141413] dark:text-[#EDEAE1] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={parsedPromo.isBestseller}
                          onChange={(e) =>
                            updateProductField(
                              selectedProduct.id,
                              'promoLabel',
                              serializeStoreProductPromoLabel({
                                promoLabel: parsedPromo.cleanPromoLabel,
                                isBestseller: e.target.checked,
                                promoEndsAt: parsedPromo.promoEndsAt,
                              })
                            )
                          }
                          className="accent-[#315E3C] dark:accent-[#E5E5E5] w-4 h-4"
                        />
                        <span>Бестселлер</span>
                      </label>
                    </div>

                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label className={STUDIO_LABEL_CLASS}>Таймер закінчення акції</label>
                        {parsedPromo.promoEndsAt && (
                          <button
                            type="button"
                            onClick={() =>
                              updateProductField(
                                selectedProduct.id,
                                'promoLabel',
                                serializeStoreProductPromoLabel({
                                  promoLabel: parsedPromo.cleanPromoLabel,
                                  isBestseller: parsedPromo.isBestseller,
                                  promoEndsAt: '',
                                })
                              )
                            }
                            className="text-[11px] text-[#5C5C58] dark:text-[#A6A196] hover:text-[#141413] dark:hover:text-[#EDEAE1] cursor-pointer"
                          >
                            Скинути
                          </button>
                        )}
                      </div>
                      <input
                        type="datetime-local"
                        value={parsedPromo.promoEndsAt}
                        onChange={(e) =>
                          updateProductField(
                            selectedProduct.id,
                            'promoLabel',
                            serializeStoreProductPromoLabel({
                              promoLabel: parsedPromo.cleanPromoLabel,
                              isBestseller: parsedPromo.isBestseller,
                              promoEndsAt: e.target.value,
                            })
                          )
                        }
                        className={`${STUDIO_INPUT_SM_CLASS} font-mono`}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3 text-xs font-mono text-[#5C5C58] dark:text-[#A6A196] tabular-nums">
                    <span>
                      На вітрині:{' '}
                      <strong className="text-[#141413] dark:text-[#EDEAE4]">
                        {getEffectivePriceUah(selectedProduct)} ₴
                      </strong>
                    </span>
                  </div>
                </div>
              );
            })()}

            {/* Type-specific settings */}
            {selectedProduct.type === 'wip_gdoc' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div className="md:col-span-2">
                  <label className={STUDIO_LABEL_CLASS}>Гостьове посилання Google Docs</label>
                  <input
                    type="url"
                    value={selectedProduct.gdocGuestUrl || ''}
                    onChange={(e) => updateProductField(selectedProduct.id, 'gdocGuestUrl', e.target.value)}
                    className={`${STUDIO_INPUT_SM_CLASS} font-mono`}
                  />
                </div>
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Прогрес розділів</label>
                  <input
                    type="text"
                    value={selectedProduct.progressLabel || ''}
                    onChange={(e) => updateProductField(selectedProduct.id, 'progressLabel', e.target.value)}
                    className={STUDIO_INPUT_SM_CLASS}
                  />
                </div>
              </div>
            )}

            {selectedProduct.type === 'ebook' && (
              <div className="space-y-4 pt-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Формати</label>
                    <input
                      type="text"
                      value={selectedProduct.formats || ''}
                      onChange={(e) => updateProductField(selectedProduct.id, 'formats', e.target.value)}
                      className={STUDIO_INPUT_SM_CLASS}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Сторінок</label>
                    <input
                      type="number"
                      value={selectedProduct.pages || 160}
                      onChange={(e) => updateProductField(selectedProduct.id, 'pages', Number(e.target.value))}
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                  <div>
                    <label className={STUDIO_LABEL_CLASS}>Рік видання</label>
                    <input
                      type="number"
                      value={selectedProduct.year || 2026}
                      onChange={(e) => updateProductField(selectedProduct.id, 'year', Number(e.target.value))}
                      className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                    />
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAF9F5] dark:bg-[#262626] rounded-xl space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs font-semibold text-[#141413] dark:text-[#EDEAE1]">
                        Файл електронної книги
                      </p>
                      <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                        EPUB, PDF, FB2, MOBI, TXT — передається покупцю після оплати.
                      </p>
                    </div>
                    <label className="btn-editorial-primary cursor-pointer py-1.5 px-3">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {uploadingEbookId === selectedProduct.id
                          ? 'Завантаження...'
                          : selectedProduct.ebookFileName
                            ? 'Замінити файл'
                            : 'Завантажити файл'}
                      </span>
                      <input
                        type="file"
                        accept=".epub,.pdf,.fb2,.mobi,.azw3,.txt,.rtf,.docx,.zip"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadEbookFile(f, selectedProduct.id);
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {selectedProduct.ebookFileName ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="w-4 h-4 text-[#2C5937] dark:text-[#E5E5E5] shrink-0" />
                        <span className="text-xs font-mono text-[#141413] dark:text-[#EDEAE1] truncate">
                          {selectedProduct.ebookFileName}
                        </span>
                        {selectedProduct.ebookFileSize && (
                          <span className="text-[11px] font-mono text-[#5C5C58] tabular-nums shrink-0">
                            ({formatFileSize(selectedProduct.ebookFileSize)})
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handlePreviewEbookDownload(selectedProduct)}
                          className="btn-editorial-secondary py-1 px-2.5 text-[11px]"
                        >
                          <Download className="w-3 h-3" />
                          <span>Перевірити</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleClearExistingEbook(selectedProduct.id)}
                          className="p-1.5 text-[#5C5C58] hover:text-rose-700 dark:hover:text-rose-400 cursor-pointer"
                          title="Видалити файл"
                          aria-label="Видалити прикріплений файл"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-[11px] text-[#5C5C58] dark:text-[#A6A196]">
                      Файл не завантажено — передається резервний .txt.
                    </p>
                  )}
                </div>
              </div>
            )}

            {selectedProduct.type === 'paper_book' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Палітурка / видання</label>
                  <input
                    type="text"
                    value={selectedProduct.binding || ''}
                    onChange={(e) => updateProductField(selectedProduct.id, 'binding', e.target.value)}
                    className={STUDIO_INPUT_SM_CLASS}
                  />
                </div>
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Сторінок</label>
                  <input
                    type="number"
                    value={selectedProduct.pages || 200}
                    onChange={(e) => updateProductField(selectedProduct.id, 'pages', Number(e.target.value))}
                    className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                  />
                </div>
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Рік видання</label>
                  <input
                    type="number"
                    value={selectedProduct.year || 2026}
                    onChange={(e) => updateProductField(selectedProduct.id, 'year', Number(e.target.value))}
                    className={`${STUDIO_INPUT_SM_CLASS} font-mono tabular-nums`}
                  />
                </div>
              </div>
            )}

            {selectedProduct.type === 'poem_frame' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Розміри антирамки</label>
                  <input
                    type="text"
                    value={selectedProduct.dimensions || ''}
                    onChange={(e) => updateProductField(selectedProduct.id, 'dimensions', e.target.value)}
                    className={STUDIO_INPUT_SM_CLASS}
                  />
                </div>
                <div>
                  <label className={STUDIO_LABEL_CLASS}>Матеріал (скло, папір)</label>
                  <input
                    type="text"
                    value={selectedProduct.material || ''}
                    onChange={(e) => updateProductField(selectedProduct.id, 'material', e.target.value)}
                    className={STUDIO_INPUT_SM_CLASS}
                  />
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => handleSaveProduct(selectedProduct)}
                className="btn-editorial-primary"
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
    </div>
  );
}
