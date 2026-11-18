export type SectionId = 'home' | 'poetry' | 'prose' | 'blog' | 'store';

export interface GuestUser {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
  provider: 'google' | 'email' | 'device';
  sessionToken?: string;
}

export interface ReviewItem {
  id: string;
  targetType: 'poem' | 'product';
  targetId: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  rating: number;
  comment: string;
  createdAt: string;
}

export interface Poem {
  id: string;
  title: string;
  cycle: string;
  year: number;
  excerpt: string;
  content: string;
  note?: string;
  viewsCount: number;
  ratingAverage: number;
  ratingCount: number;
  userRating: number | null;
  reviews: ReviewItem[];
}

export interface ProseWork {
  id: string;
  title: string;
  genre: string;
  year: number;
  readingMinutes: number;
  excerpt: string;
  content: string;
}

export interface BlogPost {
  id: string;
  title: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
  coverImage?: string;
  excerpt: string;
  content: string;
  viewsCount: number;
}

export type ProductType = 'ebook' | 'paper_book' | 'wip_gdoc' | 'poem_frame';

export interface StoreProduct {
  id: string;
  type: ProductType;
  title: string;
  subtitle: string;
  priceUah: number;
  discountPercent?: number;
  promoActive?: boolean;
  promoLabel?: string;
  coverImage: string;
  description: string;
  sampleExcerpt: string;
  formats?: string;
  pages?: number;
  year?: number;
  ebookFullText?: string;
  ebookFileName?: string;
  ebookMimeType?: string;
  ebookFileSize?: number;
  ebookStorageKey?: string;
  hasEbookFile?: boolean;
  binding?: string;
  dimensions?: string;
  material?: string;
  progressLabel?: string;
  wordCount?: number;
  lastUpdated?: string;
  gdocGuestUrl?: string;
  ratingAverage: number;
  ratingCount: number;
  userRating: number | null;
  reviews: ReviewItem[];
}

export interface ShippingDetails {
  recipientName: string;
  phone: string;
  carrier: 'nova_poshta' | 'ukrposhta' | 'courier';
  city: string;
  addressOrBranch: string;
  postalCode?: string;
  comment?: string;
}

export interface PaymentSummary {
  status: 'paid';
  providerLabel: string;
  method: 'card' | 'apple_google_pay';
  cardLast4?: string;
  transactionId: string;
  paidAt: string;
}

export interface PurchasedAccess {
  productId: string;
  orderCode: string;
  title: string;
  type: ProductType;
  purchasedAt: string;
  gdocGuestUrl?: string;
  downloadUrl?: string;
  ebookFileName?: string;
  ebookFileSize?: number;
  formats?: string;
  progressLabel?: string;
  shippingSummary?: string;
  paymentTransactionId?: string;
}

export interface OrderRecord {
  orderCode: string;
  buyerName: string;
  buyerEmail: string;
  createdAt: string;
  totalUah: number;
  shipping?: ShippingDetails;
  payment?: PaymentSummary;
  items: PurchasedAccess[];
}

export interface CatalogResponse {
  heroLeadText: string;
  poems: Poem[];
  prose: ProseWork[];
  blog: BlogPost[];
  products: StoreProduct[];
  uniqueVisitors: number;
}

export function isPhysicalProduct(type: ProductType): boolean {
  return type === 'paper_book' || type === 'poem_frame';
}

export function getEffectivePriceUah(product: Pick<StoreProduct, 'priceUah' | 'discountPercent'>): number {
  const discount = Math.max(0, Math.min(90, Number(product.discountPercent) || 0));
  if (discount <= 0) return product.priceUah;
  return Math.max(1, Math.round(product.priceUah * (1 - discount / 100)));
}

export type AnalyticsClickCategory = 'section' | 'content' | 'store' | 'action';
export type AnalyticsDwellCategory = 'section' | 'poem' | 'prose' | 'blog' | 'product';

export interface AnalyticsClickStat {
  targetKey: string;
  label: string;
  category: AnalyticsClickCategory;
  clicks: number;
  lastClickedAt: string;
}

export interface AnalyticsDwellStat {
  targetKey: string;
  label: string;
  category: AnalyticsDwellCategory;
  totalSeconds: number;
  sessionsCount: number;
  maxSeconds: number;
  lastActiveAt: string;
}

export interface AnalyticsExitStat {
  momentKey: string;
  label: string;
  section: string;
  exits: number;
  totalSessionSeconds: number;
  avgSessionSeconds: number;
  lastExitAt: string;
}

export interface BehaviorEventRecord {
  id: string;
  sessionId: string;
  type: 'click' | 'dwell' | 'exit';
  targetKey: string;
  label: string;
  durationSeconds?: number;
  createdAt: string;
}

export interface SiteAnalyticsData {
  totalSessions: number;
  seenSessionIds: string[];
  totalClicks: number;
  totalTrackedSeconds: number;
  clicksByTarget: Record<string, AnalyticsClickStat>;
  dwellByTarget: Record<string, AnalyticsDwellStat>;
  exitsByMoment: Record<string, AnalyticsExitStat>;
  recentEvents: BehaviorEventRecord[];
}

export interface AuthorAnalyticsReport {
  summary: {
    totalSessions: number;
    totalClicks: number;
    totalTrackedSeconds: number;
    avgSessionSeconds: number;
    totalExits: number;
    topClick: AnalyticsClickStat | null;
    topDwell: (AnalyticsDwellStat & { avgSeconds: number }) | null;
    topExit: (AnalyticsExitStat & { sharePercent: number }) | null;
  };
  clicks: AnalyticsClickStat[];
  dwell: (AnalyticsDwellStat & { avgSeconds: number })[];
  exits: (AnalyticsExitStat & { sharePercent: number })[];
  recentEvents: BehaviorEventRecord[];
}

