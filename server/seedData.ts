import {
  DEFAULT_HOME_REPEATERS,
  type ContactMessageRecord,
  type GlobalChatMessage,
  type HomeRepeatersConfig,
  type InterviewLinkItem,
  type MonthlySelection,
  type OrderRecord,
  type PoemSubmissionStatus,
  type ProductType,
  type ProseAccessMode,
  type ProseChapter,
  type ProseStatus,
  type ProseSubmissionStatus,
  type ProseTag,
  type RadioTrack,
  type ReviewItem,
  type SiteAnalyticsData,
  type SocialLinkItem,
  type WeeklyMusicSelection,
  type WeeklyPoemWinner,
  type WeeklyProseWinner,
} from '../src/types.ts';

export interface RawProseWork {
  id: string;
  title: string;
  genre: string;
  pages: number;
  publishedAt: string;
  slogan: string;
  excerpt: string;
  content: string;
  chapters?: ProseChapter[];
  tagIds?: string[];
  status?: ProseStatus;
  accessMode?: ProseAccessMode;
  requiresAuth?: boolean;
  isPaid?: boolean;
  priceUah?: number;
  pdfFileName?: string;
  pdfFileSize?: number;
  pdfStorageKey?: string;
  moodboardUrls?: string[];
  isCommunity?: boolean;
  authorUid?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  submissionId?: string;
}

export interface ProseSubmissionRecord {
  id: string;
  authorUid: string;
  guestUid?: string;
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

export interface RawPoem {
  id: string;
  title: string;
  cycle: string;
  year: number;
  excerpt: string;
  content: string;
  note?: string;
  fontSize?: 'sm' | 'base' | 'lg' | 'xl' | '2xl';
  textAlign?: 'left' | 'center' | 'right';
  lineSpacing?: 'tight' | 'normal' | 'relaxed' | 'loose';
  textColor?: string;
  backgroundColor?: string;
  imageUrl?: string;
  imagePalette?: {
    background: string;
    secondaryBackground?: string;
    text: string;
    isDark?: boolean;
  };
  soundcloudTrack?: {
    id: string;
    title: string;
    artist: string;
    soundcloudUrl: string;
    embedTargetUrl: string;
    artworkUrl?: string;
  };
  soundcloudTracks?: Array<{
    id: string;
    title: string;
    artist: string;
    soundcloudUrl: string;
    embedTargetUrl: string;
    artworkUrl?: string;
  }>;
  isCommunity?: boolean;
  authorUid?: string;
  authorName?: string;
  authorPhotoUrl?: string;
  submissionId?: string;
  workStatus?: ProseStatus;
}

export interface PoemSubmissionRecord {
  id: string;
  authorUid: string;
  guestUid?: string;
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
  imagePalette?: {
    background: string;
    secondaryBackground?: string;
    text: string;
    isDark?: boolean;
  };
  soundcloudTrack?: {
    id: string;
    title: string;
    artist: string;
    soundcloudUrl: string;
    embedTargetUrl: string;
    artworkUrl?: string;
  };
  soundcloudTracks?: Array<{
    id: string;
    title: string;
    artist: string;
    soundcloudUrl: string;
    embedTargetUrl: string;
    artworkUrl?: string;
  }>;
  status: PoemSubmissionStatus;
  workStatus?: ProseStatus;
  moderationNote?: string;
  publishedPoemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawBlogPost {
  id: string;
  title: string;
  category: string;
  publishedAt: string;
  readingMinutes: number;
  coverImage?: string;
  excerpt: string;
  content: string;
}

export interface RawStoreProduct {
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
  binding?: string;
  dimensions?: string;
  material?: string;
  progressLabel?: string;
  wordCount?: number;
  lastUpdated?: string;
  gdocGuestUrl?: string;
}

export interface GuestAccountRecord {
  uid: string;
  displayName: string;
  email: string;
  photoUrl?: string;
  googleUid?: string;
  passwordHash?: string;
  salt?: string;
  pinHash?: string;
  pinSalt?: string;
  pinFailedAttempts?: number;
  pinLockedUntil?: string;
  pinUpdatedAt?: string;
  likedPoemIds?: string[];
  likedRadioTrackIds?: string[];
  donorChatText?: string;
  likedUpdatedAt?: string;
  purchasesCount?: number;
  totalTimeSeconds?: number;
  lastSeenAt?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface DonorRecord {
  id: string;
  guestUid?: string;
  displayName: string;
  photoUrl?: string;
  amountUah: number;
  note?: string;
  donatedAt: string;
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

export interface WeeklyVoteLogEntry {
  targetType: 'poem' | 'prose';
  targetId: string;
  voterKey: string;
  rating: number;
  weekKey: string;
  createdAt: string;
}

export interface SiteDatabase {
  heroLeadText: string;
  authorAboutText: string;
  authorPhotoUrl: string;
  authorPhotos: string[];
  socialLinks: SocialLinkItem[];
  monobankJarUrl: string;
  monobankModalTitle: string;
  monobankModalSubtitle: string;
  monobankCardLabel: string;
  monobankModalText: string;
  monobankEmptyText: string;
  contactEmail: string;
  interviews: InterviewLinkItem[];
  homeActionAboutTitle: string;
  homeActionContactTitle: string;
  homeActionMonobankTitle: string;
  homeActionInterviewsTitle: string;
  homeRepeaters: HomeRepeatersConfig;
  contactMessages: ContactMessageRecord[];
  poems: RawPoem[];
  poemSubmissions: PoemSubmissionRecord[];
  prose: RawProseWork[];
  proseSubmissions: ProseSubmissionRecord[];
  proseTags: ProseTag[];
  proseAuthDiscountPercent: number;
  proseTelegramDiscountPercent: number;
  telegramChannelId?: string;
  storeAuthDiscountPercent: number;
  blog: RawBlogPost[];
  products: RawStoreProduct[];
  orders: OrderRecord[];
  poemVotes: Record<string, Record<string, number>>;
  proseVotes: Record<string, Record<string, number>>;
  productVotes: Record<string, Record<string, number>>;
  weeklyVoteLog: WeeklyVoteLogEntry[];
  weeklyPoems: WeeklyPoemWinner[];
  weeklyProse: WeeklyProseWinner[];
  reviews: ReviewItem[];
  recentRatings?: ReviewItem[];
  poemViews: Record<string, number>;
  blogViews: Record<string, number>;
  visitorIpHashes: string[];
  guestAccounts: GuestAccountRecord[];
  donations: DonorRecord[];
  feedback: FeedbackRecord[];
  chatMessages: GlobalChatMessage[];
  radioTracks: RadioTrack[];
  weeklyMusicSelections: WeeklyMusicSelection[];
  monthlySelections?: MonthlySelection[];
  analytics: SiteAnalyticsData;
}

export const DEFAULT_HERO_LEAD_TEXT = '';

export const DEFAULT_AUTHOR_PHOTO_URL =
  '/src/assets/images/author_portrait_desk_1795025673568.webp';

export const DEFAULT_AUTHOR_ABOUT_TEXT = '';

export const DEFAULT_SOCIAL_LINKS: SocialLinkItem[] = [
  { platform: 'telegram', label: 'Telegram', url: 'https://t.me/andriidankiv', enabled: true },
  { platform: 'instagram', label: 'Instagram', url: '', enabled: false },
  { platform: 'facebook', label: 'Facebook', url: '', enabled: false },
  { platform: 'youtube', label: 'YouTube', url: '', enabled: false },
  { platform: 'threads', label: 'Threads', url: '', enabled: false },
  { platform: 'x', label: 'X (Twitter)', url: '', enabled: false },
  { platform: 'tiktok', label: 'TikTok', url: '', enabled: false },
];

export const DEFAULT_MONOBANK_JAR_URL = '';

export const DEFAULT_MONOBANK_MODAL_TITLE = 'Підтримати через Монобанк';
export const DEFAULT_MONOBANK_MODAL_SUBTITLE = '';
export const DEFAULT_MONOBANK_CARD_LABEL = 'Банка Монобанку';
export const DEFAULT_MONOBANK_MODAL_TEXT =
  'Якщо вірші чи проза відгукнулися вам, можна підтримати мене довільним донатом через Монобанк. Мені буде приємно.';
export const DEFAULT_MONOBANK_EMPTY_TEXT = '';

export const DEFAULT_CONTACT_EMAIL = 'andrijdankiv5@gmail.com';

export const DEFAULT_HOME_ACTION_ABOUT = 'Про мене';
export const DEFAULT_HOME_ACTION_CONTACT = 'Зв’язок';
export const DEFAULT_HOME_ACTION_MONOBANK = 'Підтримати через Монобанк';
export const DEFAULT_HOME_ACTION_INTERVIEWS = 'Розмови';

export const DEFAULT_INTERVIEWS: InterviewLinkItem[] = [];

export const INITIAL_DATABASE: SiteDatabase = {
  heroLeadText: DEFAULT_HERO_LEAD_TEXT,
  authorAboutText: DEFAULT_AUTHOR_ABOUT_TEXT,
  authorPhotoUrl: DEFAULT_AUTHOR_PHOTO_URL,
  authorPhotos: [DEFAULT_AUTHOR_PHOTO_URL],
  socialLinks: DEFAULT_SOCIAL_LINKS,
  monobankJarUrl: DEFAULT_MONOBANK_JAR_URL,
  monobankModalTitle: DEFAULT_MONOBANK_MODAL_TITLE,
  monobankModalSubtitle: DEFAULT_MONOBANK_MODAL_SUBTITLE,
  monobankCardLabel: DEFAULT_MONOBANK_CARD_LABEL,
  monobankModalText: DEFAULT_MONOBANK_MODAL_TEXT,
  monobankEmptyText: DEFAULT_MONOBANK_EMPTY_TEXT,
  contactEmail: DEFAULT_CONTACT_EMAIL,
  interviews: DEFAULT_INTERVIEWS,
  homeActionAboutTitle: DEFAULT_HOME_ACTION_ABOUT,
  homeActionContactTitle: DEFAULT_HOME_ACTION_CONTACT,
  homeActionMonobankTitle: DEFAULT_HOME_ACTION_MONOBANK,
  homeActionInterviewsTitle: DEFAULT_HOME_ACTION_INTERVIEWS,
  homeRepeaters: { ...DEFAULT_HOME_REPEATERS },
  contactMessages: [],
  poems: [],
  poemSubmissions: [],
  prose: [],
  proseSubmissions: [],
  proseTags: [],
  proseAuthDiscountPercent: 15,
  proseTelegramDiscountPercent: 50,
  telegramChannelId: '',
  storeAuthDiscountPercent: 0,
  blog: [],
  products: [],
  orders: [],
  poemVotes: {},
  proseVotes: {},
  productVotes: {},
  weeklyVoteLog: [],
  weeklyPoems: [],
  weeklyProse: [],
  reviews: [],
  recentRatings: [],
  poemViews: {},
  blogViews: {},
  visitorIpHashes: [],
  guestAccounts: [],
  donations: [],
  feedback: [],
  chatMessages: [],
  radioTracks: [],
  weeklyMusicSelections: [],
  analytics: {
    totalSessions: 0,
    seenSessionIds: [],
    totalClicks: 0,
    totalTrackedSeconds: 0,
    clicksByTarget: {},
    dwellByTarget: {},
    exitsByMoment: {},
    recentEvents: [],
    visitRecords: [],
  },
};
