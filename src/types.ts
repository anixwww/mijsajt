export type SectionId = 'home' | 'poetry' | 'prose' | 'blog' | 'store' | 'radio';

export type TopRankNumber = 1 | 2 | 3 | 4 | 5;

export interface UserTopBadges {
  activityRank?: TopRankNumber;
  donorRank?: TopRankNumber;
}

export interface GuestUser {
  uid: string;
  firebaseUid?: string;
  displayName: string;
  email: string;
  photoUrl?: string;
  provider: 'google';
  likedPoemIds?: string[];
  likedRadioTrackIds?: string[];
  createdAt?: string;
  sessionToken?: string;
  badges?: UserTopBadges;
  donorChatText?: string;
  hasPin?: boolean;
}

export interface RememberedGuestHint {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
  hasPin?: boolean;
}

export interface ReviewItem {
  id: string;
  targetType: 'poem' | 'prose' | 'product';
  targetId: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  authorBadges?: UserTopBadges;
  rating: number | null;
  comment: string;
  createdAt: string;
}

export interface HomeFeedbackItem extends ReviewItem {
  targetTitle: string;
}

export interface PoemImagePalette {
  background: string;
  secondaryBackground?: string;
  text: string;
  isDark?: boolean;
}

export interface PoemSoundCloudTrack {
  id: string;
  title: string;
  artist: string;
  soundcloudUrl: string;
  embedTargetUrl: string;
  artworkUrl?: string;
}

export type PoemSubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface Poem {
  id: string;
  title: string;
  cycle: string;
  year: number;
  excerpt: string;
  content: string;
  contentTruncated?: boolean;
  note?: string;
  fontSize?: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  textAlign?: 'left' | 'center' | 'right';
  lineSpacing?: 'tight' | 'normal' | 'relaxed' | 'loose';
  textColor?: string;
  backgroundColor?: string;
  imageUrl?: string;
  imagePalette?: PoemImagePalette;
  soundcloudTrack?: PoemSoundCloudTrack;
  soundcloudTracks?: PoemSoundCloudTrack[];
  isCommunity?: boolean;
  authorUid?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  submissionId?: string;
  workStatus?: ProseStatus;
  viewsCount: number;
  likesCount?: number;
  isLiked?: boolean;
  ratingAverage: number;
  ratingCount: number;
  userRating: number | null;
  reviews: ReviewItem[];
}

export interface PoemSubmission {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  title: string;
  cycle: string;
  year: number;
  content: string;
  note?: string;
  fontSize?: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  textAlign?: 'left' | 'center' | 'right';
  lineSpacing?: 'tight' | 'normal' | 'relaxed' | 'loose';
  textColor?: string;
  backgroundColor?: string;
  imageUrl?: string;
  imagePalette?: PoemImagePalette;
  soundcloudTrack?: PoemSoundCloudTrack;
  soundcloudTracks?: PoemSoundCloudTrack[];
  status: PoemSubmissionStatus;
  workStatus?: ProseStatus;
  moderationNote?: string;
  publishedPoemId?: string;
  createdAt: string;
  updatedAt: string;
}

export type ProseTagPresetColor =
  | 'rose'
  | 'amber'
  | 'emerald'
  | 'sky'
  | 'violet'
  | 'coral'
  | 'teal'
  | 'indigo';

export type ProseTagColor = ProseTagPresetColor | (string & {});

export interface ProseTag {
  id: string;
  label: string;
  color: ProseTagColor;
}

export type ProseStatus = 'completed' | 'in_progress';

export type ProseAccessMode = 'public' | 'authorized' | 'paid';

export type ProseSubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface ProseChapter {
  id: string;
  title: string;
  content: string;
  publishedAt: string;
}

export interface ProseWork {
  id: string;
  title: string;
  genre: string;
  pages: number;
  publishedAt: string;
  slogan: string;
  excerpt: string;
  content: string;
  chapters?: ProseChapter[];
  totalWords?: number;
  tagIds?: string[];
  status?: ProseStatus;
  accessMode?: ProseAccessMode;
  requiresAuth?: boolean;
  isPaid?: boolean;
  priceUah?: number;
  previewText?: string;
  isLocked?: boolean;
  pdfFileName?: string;
  pdfFileSize?: number;
  pdfStorageKey?: string;
  hasPdf?: boolean;
  moodboardUrls?: string[];
  isCommunity?: boolean;
  authorUid?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  submissionId?: string;
  ratingAverage: number;
  ratingCount: number;
  userRating: number | null;
  reviews: ReviewItem[];
}

export interface ProseSubmission {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  title: string;
  genre: string;
  slogan?: string;
  excerpt?: string;
  content: string;
  pages: number;
  totalWords?: number;
  moodboardUrls?: string[];
  status: ProseSubmissionStatus;
  workStatus?: ProseStatus;
  moderationNote?: string;
  publishedProseId?: string;
  createdAt: string;
  updatedAt: string;
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
  contentTruncated?: boolean;
  viewsCount: number;
}

export type ProductType = 'ebook' | 'paper_book' | 'wip_gdoc' | 'poem_frame' | 'painting';

export interface StoreProduct {
  id: string;
  type: ProductType;
  title: string;
  subtitle: string;
  priceUah: number;
  discountPercent?: number;
  promoActive?: boolean;
  promoLabel?: string;
  isBestseller?: boolean;
  promoEndsAt?: string;
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
  status: 'pending' | 'paid' | 'failed' | 'expired';
  providerLabel: string;
  method: 'card' | 'apple_google_pay' | 'monobank';
  cardBrand?: string;
  cardLast4?: string;
  cardFingerprint?: string;
  encryptionProtocol?: string;
  receiptSignature?: string;
  transactionId: string;
  paidAt: string;
}

export interface EncryptedPiiEnvelope {
  alg: 'AES-256-GCM';
  iv: string;
  tag: string;
  ciphertext: string;
}

export interface PaymentSessionResponse {
  sessionId: string;
  nonce: string;
  amountUah: number;
  expiresAt: string;
  algorithm: string;
  serverPublicKeyJwk: JsonWebKey;
  monobankAcquiringAvailable?: boolean;
}

export interface EncryptedPaymentEnvelope {
  sessionId: string;
  clientPublicKeyJwk: JsonWebKey;
  iv: string;
  ciphertext: string;
}

export type UnlockedAccessType = ProductType | 'prose_access';

export interface PurchasedAccess {
  productId: string;
  orderCode: string;
  title: string;
  type: UnlockedAccessType;
  proseId?: string;
  purchasedAt: string;
  gdocGuestUrl?: string;
  downloadUrl?: string;
  ebookFileName?: string;
  ebookFileSize?: number;
  pdfFileName?: string;
  pdfFileSize?: number;
  hasPdf?: boolean;
  formats?: string;
  progressLabel?: string;
  shippingSummary?: string;
  paymentTransactionId?: string;
}

export interface OrderRecord {
  orderCode: string;
  guestUid?: string;
  buyerName: string;
  buyerEmail: string;
  buyerNameMasked?: string;
  buyerEmailMasked?: string;
  buyerEmailHash?: string;
  encryptedPii?: EncryptedPiiEnvelope;
  integrityVerified?: boolean;
  piiLocked?: boolean;
  createdAt: string;
  totalUah: number;
  shipping?: ShippingDetails;
  payment?: PaymentSummary;
  items: PurchasedAccess[];
  pendingProductIds?: string[];
  pendingProseId?: string;
}

export type SocialPlatform =
  | 'telegram'
  | 'instagram'
  | 'facebook'
  | 'youtube'
  | 'threads'
  | 'x'
  | 'tiktok';

export interface SocialLinkItem {
  platform: SocialPlatform;
  label: string;
  url: string;
  enabled: boolean;
}

export interface InterviewLinkItem {
  id: string;
  title: string;
  outlet: string;
  dateLabel: string;
  content?: string;
  url?: string;
}

export interface ContactMessageRecord {
  id: string;
  name: string;
  contact: string;
  message: string;
  createdAt: string;
  read: boolean;
}

export type PoemRepeaterMode = 'latest' | 'top_rated' | 'most_liked' | 'most_viewed';
export type ProseRepeaterMode = 'latest' | 'top_rated' | 'free_only' | 'paid_only';
export type BlogRepeaterMode = 'latest' | 'most_viewed' | 'quick_read';
export type StoreRepeaterMode =
  | 'smart_highlights'
  | 'discounted'
  | 'promo_active'
  | 'bestsellers'
  | 'top_rated'
  | 'latest';

export interface HomeRepeatersConfig {
  poemMode: PoemRepeaterMode;
  poemLimit: number;
  proseMode: ProseRepeaterMode;
  proseLimit: number;
  blogMode: BlogRepeaterMode;
  blogLimit: number;
  storeMode: StoreRepeaterMode;
  storeLimit: number;
}

export const DEFAULT_HOME_REPEATERS: HomeRepeatersConfig = {
  poemMode: 'latest',
  poemLimit: 1,
  proseMode: 'latest',
  proseLimit: 5,
  blogMode: 'latest',
  blogLimit: 5,
  storeMode: 'smart_highlights',
  storeLimit: 6,
};

const VALID_POEM_MODES: ReadonlySet<PoemRepeaterMode> = new Set([
  'latest',
  'top_rated',
  'most_liked',
  'most_viewed',
]);
const VALID_PROSE_MODES: ReadonlySet<ProseRepeaterMode> = new Set([
  'latest',
  'top_rated',
  'free_only',
  'paid_only',
]);
const VALID_BLOG_MODES: ReadonlySet<BlogRepeaterMode> = new Set([
  'latest',
  'most_viewed',
  'quick_read',
]);
const VALID_STORE_MODES: ReadonlySet<StoreRepeaterMode> = new Set([
  'smart_highlights',
  'discounted',
  'promo_active',
  'bestsellers',
  'top_rated',
  'latest',
]);

function clampRepeaterLimit(raw: unknown, fallback: number): number {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(1, Math.min(12, Math.round(numeric)));
}

export function normalizeHomeRepeatersConfig(raw: unknown): HomeRepeatersConfig {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_HOME_REPEATERS };
  }
  const obj = raw as Record<string, unknown>;
  const poemMode = VALID_POEM_MODES.has(obj.poemMode as PoemRepeaterMode)
    ? (obj.poemMode as PoemRepeaterMode)
    : DEFAULT_HOME_REPEATERS.poemMode;
  const proseMode = VALID_PROSE_MODES.has(obj.proseMode as ProseRepeaterMode)
    ? (obj.proseMode as ProseRepeaterMode)
    : DEFAULT_HOME_REPEATERS.proseMode;
  const blogMode = VALID_BLOG_MODES.has(obj.blogMode as BlogRepeaterMode)
    ? (obj.blogMode as BlogRepeaterMode)
    : DEFAULT_HOME_REPEATERS.blogMode;
  const storeMode = VALID_STORE_MODES.has(obj.storeMode as StoreRepeaterMode)
    ? (obj.storeMode as StoreRepeaterMode)
    : DEFAULT_HOME_REPEATERS.storeMode;

  return {
    poemMode,
    poemLimit: clampRepeaterLimit(obj.poemLimit, DEFAULT_HOME_REPEATERS.poemLimit),
    proseMode,
    proseLimit: clampRepeaterLimit(obj.proseLimit, DEFAULT_HOME_REPEATERS.proseLimit),
    blogMode,
    blogLimit: clampRepeaterLimit(obj.blogLimit, DEFAULT_HOME_REPEATERS.blogLimit),
    storeMode,
    storeLimit: clampRepeaterLimit(obj.storeLimit, DEFAULT_HOME_REPEATERS.storeLimit),
  };
}

export interface HomePayload {
  heroLeadText: string;
  authorAboutText?: string;
  authorPhotoUrl?: string;
  authorPhotos?: string[];
  socialLinks?: SocialLinkItem[];
  monobankJarUrl?: string;
  monobankAcquiringEnabled?: boolean;
  monobankModalTitle?: string;
  monobankModalSubtitle?: string;
  monobankCardLabel?: string;
  monobankModalText?: string;
  monobankEmptyText?: string;
  contactEmail?: string;
  interviews?: InterviewLinkItem[];
  homeActionAboutTitle?: string;
  homeActionContactTitle?: string;
  homeActionMonobankTitle?: string;
  homeActionInterviewsTitle?: string;
  homeRepeaters?: HomeRepeatersConfig;
  proseAuthDiscountPercent?: number;
  proseTelegramDiscountPercent?: number;
  storeAuthDiscountPercent?: number;
  uniqueVisitors: number;
}

export interface TelegramSubscriptionState {
  subscribed: boolean;
  token?: string;
  channelLabel?: string;
  channelUrl?: string;
  telegramUser?: {
    id: number;
    username?: string;
    firstName?: string;
  };
  checkedAt?: string;
}

export type RadioStationId = 'indie' | 'electronic';

export const RADIO_STATIONS: ReadonlyArray<{ id: RadioStationId; label: string }> = [
  { id: 'indie', label: 'Інді' },
  { id: 'electronic', label: 'Електроніка' },
];

export interface RadioTrack {
  id: string;
  title: string;
  artist: string;
  soundcloudUrl: string;
  embedTargetUrl?: string;
  artworkUrl?: string;
  station: RadioStationId;
  order?: number;
  addedAt: string;
  likesCount?: number;
  isLiked?: boolean;
  inRepertoire?: boolean;
  repertoireBucket?: 'top_liked' | 'newest' | null;
}


export interface WeeklyPeriodInfo {
  weekKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
}

export interface WeeklyPoemWinner {
  id: string;
  weekKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  selectedAt: string;
  sourcePoemId: string;
  sourceSubmissionId?: string;
  authorUid?: string;
  authorName: string;
  authorPhotoUrl?: string;
  title: string;
  cycle?: string;
  year?: number;
  content: string;
  note?: string;
  fontSize?: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  textAlign?: 'left' | 'center' | 'right';
  lineSpacing?: 'tight' | 'normal' | 'relaxed' | 'loose';
  textColor?: string;
  backgroundColor?: string;
  imageUrl?: string;
  imagePalette?: PoemImagePalette;
  soundcloudTrack?: PoemSoundCloudTrack;
  soundcloudTracks?: PoemSoundCloudTrack[];
  ratingAverage: number;
  ratingCount: number;
}

export interface WeeklyProseWinner {
  id: string;
  weekKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  selectedAt: string;
  sourceProseId: string;
  sourceSubmissionId?: string;
  authorUid?: string;
  authorName: string;
  authorPhotoUrl?: string;
  title: string;
  genre: string;
  pages: number;
  totalWords?: number;
  slogan?: string;
  content: string;
  chapters?: ProseChapter[];
  moodboardUrls?: string[];
  publishedAt?: string;
  ratingAverage: number;
  ratingCount: number;
}

export interface WeeklyMusicTrack {
  id: string;
  title: string;
  artist: string;
  soundcloudUrl: string;
  embedTargetUrl: string;
  artworkUrl?: string;
}

export interface WeeklyMusicSelection {
  id: string;
  weekKey: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  text?: string;
  photos: string[];
  tracks: WeeklyMusicTrack[];
  createdAt: string;
  updatedAt: string;
}

export interface MonthlySelectionTrack {
  id: string;
  title: string;
  artist: string;
  soundcloudUrl: string;
  embedTargetUrl: string;
  artworkUrl?: string;
  note?: string;
  addedAt: string;
}

export interface MonthlySelection {
  id: string;
  monthKey: string;
  title: string;
  description?: string;
  tracks: MonthlySelectionTrack[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogResponse extends HomePayload {
  poems: Poem[];
  prose: ProseWork[];
  proseTags?: ProseTag[];
  blog: BlogPost[];
  products: StoreProduct[];
  radioTracks?: RadioTrack[];
  weeklyMusicSelections?: WeeklyMusicSelection[];
  weeklyPoems?: WeeklyPoemWinner[];
  weeklyProse?: WeeklyProseWinner[];
  weeklyCurrentPeriod?: WeeklyPeriodInfo;
  recentFeedback?: HomeFeedbackItem[];
}

export function isPhysicalProduct(type: UnlockedAccessType): boolean {
  return type === 'paper_book' || type === 'poem_frame' || type === 'painting';
}

export function getEffectivePriceUah(product: Pick<StoreProduct, 'priceUah' | 'discountPercent'>): number {
  const discount = Math.max(0, Math.min(90, Number(product.discountPercent) || 0));
  if (discount <= 0) return product.priceUah;
  return Math.max(1, Math.round(product.priceUah * (1 - discount / 100)));
}

export interface ParsedProductPromo {
  cleanPromoLabel: string;
  isBestseller: boolean;
  promoEndsAt: string;
}

const PROMO_BS_TOKEN_RE = /\[bs\]/gi;
const PROMO_TIMER_TOKEN_RE = /\[t:([^\]]+)\]/gi;

export function parseStoreProductPromo(
  product: Pick<StoreProduct, 'promoLabel' | 'isBestseller' | 'promoEndsAt'>
): ParsedProductPromo {
  const rawLabel = typeof product.promoLabel === 'string' ? product.promoLabel : '';
  const hasBsToken = PROMO_BS_TOKEN_RE.test(rawLabel);
  PROMO_BS_TOKEN_RE.lastIndex = 0;

  let extractedTimer = typeof product.promoEndsAt === 'string' ? product.promoEndsAt.trim() : '';
  const timerMatch = PROMO_TIMER_TOKEN_RE.exec(rawLabel);
  PROMO_TIMER_TOKEN_RE.lastIndex = 0;
  if (!extractedTimer && timerMatch?.[1]) {
    extractedTimer = timerMatch[1].trim();
  }

  const cleanPromoLabel = rawLabel
    .replace(PROMO_BS_TOKEN_RE, '')
    .replace(PROMO_TIMER_TOKEN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const isBestseller =
    Boolean(product.isBestseller) ||
    hasBsToken ||
    /бестсел/i.test(cleanPromoLabel);

  return {
    cleanPromoLabel,
    isBestseller,
    promoEndsAt: extractedTimer,
  };
}

export function serializeStoreProductPromoLabel(options: {
  promoLabel: string;
  isBestseller: boolean;
  promoEndsAt: string;
}): string {
  const clean = options.promoLabel
    .replace(PROMO_BS_TOKEN_RE, '')
    .replace(PROMO_TIMER_TOKEN_RE, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  const tokens: string[] = [];
  if (options.isBestseller && !/бестсел/i.test(clean)) {
    tokens.push('[bs]');
  }
  const timerVal = options.promoEndsAt.trim();
  if (timerVal) {
    tokens.push(`[t:${timerVal}]`);
  }
  const combined = [clean, ...tokens].filter(Boolean).join(' ').trim();
  return combined.slice(0, 120);
}

export function formatPromoCountdown(endsAtIso: string, nowMs: number): string | null {
  if (!endsAtIso) return null;
  const targetMs = Date.parse(endsAtIso);
  if (!Number.isFinite(targetMs)) return null;
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return null;
  const totalSec = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const hh = String(hours).padStart(2, '0');
  const mm = String(mins).padStart(2, '0');
  const ss = String(secs).padStart(2, '0');
  if (days > 0) {
    return `${days}д ${hh}:${mm}:${ss}`;
  }
  return `${hh}:${mm}:${ss}`;
}

export function getProseEffectivePriceUah(
  basePriceUah: number,
  discountPercent?: number,
  isAuthorized = false
): number {
  const base = Math.max(0, Math.round(Number(basePriceUah) || 0));
  if (base <= 0) return 0;
  const discount = Math.max(0, Math.min(90, Math.round(Number(discountPercent) || 0)));
  if (!isAuthorized || discount <= 0) return base;
  return Math.max(1, Math.round(base * (1 - discount / 100)));
}

export function getProseDiscountCalculation(
  basePriceUah: number,
  options: {
    authDiscountPercent?: number;
    isAuthorized?: boolean;
    telegramDiscountPercent?: number;
    isTelegramSubscribed?: boolean;
  }
): {
  basePriceUah: number;
  finalPriceUah: number;
  appliedDiscountPercent: number;
  appliedSource: 'none' | 'auth' | 'telegram';
  authDiscountPercent: number;
  telegramDiscountPercent: number;
} {
  const base = Math.max(0, Math.round(Number(basePriceUah) || 0));
  const rawAuthPct = Math.max(0, Math.min(90, Math.round(Number(options.authDiscountPercent) || 0)));
  const rawTgPct = Math.max(0, Math.min(90, Math.round(Number(options.telegramDiscountPercent) || 0)));
  const activeAuthPct = options.isAuthorized ? rawAuthPct : 0;
  const activeTgPct = options.isTelegramSubscribed ? rawTgPct : 0;
  const appliedDiscountPercent = Math.max(activeAuthPct, activeTgPct);

  let appliedSource: 'none' | 'auth' | 'telegram' = 'none';
  if (appliedDiscountPercent > 0) {
    appliedSource = activeTgPct >= activeAuthPct && activeTgPct > 0 ? 'telegram' : 'auth';
  }

  const finalPriceUah =
    base <= 0
      ? 0
      : appliedDiscountPercent > 0
        ? Math.max(1, Math.round(base * (1 - appliedDiscountPercent / 100)))
        : base;

  return {
    basePriceUah: base,
    finalPriceUah,
    appliedDiscountPercent,
    appliedSource,
    authDiscountPercent: rawAuthPct,
    telegramDiscountPercent: rawTgPct,
  };
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

export type VisitDeviceType = 'mobile' | 'tablet' | 'desktop' | 'bot';

export type VisitPeriodKey = 'day' | 'week' | 'month';

export interface VisitLogEntry {
  id: string;
  ipHash: string;
  sessionId?: string;
  timestamp: string;
  dateKey: string;
  hour: number;
  entrySection: string;
  deviceType: VisitDeviceType;
  browser: string;
  os: string;
  referrerHost: string;
  isNewVisitor: boolean;
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
  visitRecords?: VisitLogEntry[];
}

export interface VisitBreakdownItem {
  key: string;
  label: string;
  visits: number;
  sharePercent: number;
}

export interface VisitTrendPoint {
  key: string;
  label: string;
  visits: number;
  uniqueVisitors: number;
  newVisitors: number;
  returningVisitors: number;
}

export interface VisitPeriodReport {
  period: VisitPeriodKey;
  label: string;
  totalVisits: number;
  uniqueVisitors: number;
  newVisitors: number;
  returningVisitors: number;
  previousPeriodVisits: number;
  deltaPercent: number | null;
  peakLabel: string | null;
  peakVisits: number;
  trend: VisitTrendPoint[];
  devices: VisitBreakdownItem[];
  browsers: VisitBreakdownItem[];
  operatingSystems: VisitBreakdownItem[];
  entrySections: VisitBreakdownItem[];
  referrers: VisitBreakdownItem[];
  recentVisits: Array<{
    id: string;
    visitorCode: string;
    timestamp: string;
    entrySection: string;
    deviceType: VisitDeviceType;
    browser: string;
    os: string;
    referrerHost: string;
    isNewVisitor: boolean;
  }>;
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
  visits: {
    allTimeUniqueVisitors: number;
    day: VisitPeriodReport;
    week: VisitPeriodReport;
    month: VisitPeriodReport;
  };
  clicks: AnalyticsClickStat[];
  dwell: (AnalyticsDwellStat & { avgSeconds: number })[];
  exits: (AnalyticsExitStat & { sharePercent: number })[];
  recentEvents: BehaviorEventRecord[];
}

export type LeaderboardCategory = 'seniority' | 'time' | 'activity' | 'donors';

export interface LeaderboardSeniorityEntry {
  rank: number;
  uid: string;
  displayName: string;
  photoUrl?: string;
  createdAt: string;
}

export interface LeaderboardTimeEntry {
  rank: number;
  uid: string;
  displayName: string;
  photoUrl?: string;
  totalTimeSeconds: number;
  lastSeenAt?: string;
}

export interface LeaderboardActivityEntry {
  rank: number;
  uid: string;
  displayName: string;
  photoUrl?: string;
  badges?: UserTopBadges;
  points: number;
  commentsCount: number;
  likesCount: number;
  purchasesCount: number;
}

export interface LeaderboardDonorEntry {
  rank: number;
  id: string;
  guestUid?: string;
  displayName: string;
  photoUrl?: string;
  badges?: UserTopBadges;
  totalAmountUah: number;
  donationsCount: number;
  lastDonatedAt: string;
}

export interface DonationEntry {
  id: string;
  guestUid?: string;
  displayName: string;
  photoUrl?: string;
  amountUah: number;
  note?: string;
  donatedAt: string;
}

export interface UserLeaderboardResponse {
  seniority: LeaderboardSeniorityEntry[];
  time: LeaderboardTimeEntry[];
  activity: LeaderboardActivityEntry[];
  donors: LeaderboardDonorEntry[];
  totalRegisteredUsers: number;
  currentUserUid?: string | null;
  currentUserBadges?: UserTopBadges;
  generatedAt: string;
}

export interface FeedbackRecord {
  id: string;
  guestUid?: string;
  firebaseUid?: string;
  displayName: string;
  authorPhotoUrl?: string;
  contact?: string;
  message: string;
  createdAt: string;
  updatedAt?: string;
  readByAdmin?: boolean;
  adminReply?: string;
  adminReplyAt?: string;
  adminReplyAuthorName?: string;
  readByUser?: boolean;
}

export interface GlobalChatMessage {
  id: string;
  authorUid: string;
  authorName: string;
  authorPhotoUrl?: string;
  authorBadges?: UserTopBadges;
  authorDonorText?: string;
  isAdmin?: boolean;
  text: string;
  replyTo?: {
    id: string;
    authorUid: string;
    authorName: string;
    text: string;
  };
  createdAt: string;
}

