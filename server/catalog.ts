import crypto from 'crypto';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import {
  DEFAULT_AUTHOR_PHOTO_URL,
  DEFAULT_MONOBANK_CARD_LABEL,
  DEFAULT_MONOBANK_EMPTY_TEXT,
  DEFAULT_MONOBANK_MODAL_SUBTITLE,
  DEFAULT_MONOBANK_MODAL_TEXT,
  DEFAULT_MONOBANK_MODAL_TITLE,
  type FeedbackRecord,
  type GuestAccountRecord,
  type PoemSubmissionRecord,
  type ProseSubmissionRecord,
  type RawBlogPost,
  type RawPoem,
  type RawProseWork,
  type RawStoreProduct,
  type SiteDatabase,
} from './seedData.ts';
import {
  normalizeHomeRepeatersConfig,
  type AnalyticsClickCategory,
  type AnalyticsDwellCategory,
  type BlogPost,
  type GlobalChatMessage,
  type HomeFeedbackItem,
  type LeaderboardActivityEntry,
  type LeaderboardDonorEntry,
  type LeaderboardSeniorityEntry,
  type LeaderboardTimeEntry,
  type Poem,
  type PoemImagePalette,
  type PoemSoundCloudTrack,
  type ProseStatus,
  type ProseWork,
  type RadioStationId,
  type RadioTrack,
  type ReviewItem,
  type StoreProduct,
  type TopRankNumber,
  type UserLeaderboardResponse,
  type UserTopBadges,
} from '../src/types.ts';
import { computeProseWorkPages, countProseWords } from '../src/utils/prosePagination.ts';
import {
  getFirstFormattedExcerptLine,
  preserveFormattedText,
} from '../src/utils/textFormatting.ts';
import { recordSiteVisit } from '../src/api/visitAnalytics.ts';
import { ensureWeeklyWinnersUpToDate, getWeekPeriodForDate, recordWeeklyVoteLog } from './weeklyHighlights.ts';
import { selectRadioStationRepertoire, type RadioRepertoireBucket } from '../src/utils/radioRepertoire.ts';
import {
  cloudSyncState,
  getMonobankToken,
  hydrateAuthorizedProseAndRadio,
  hydratePublicCatalogFromFirestore,
  hydrateUserPoemSubmissionsFromFirestore,
  hydrateUserProseSubmissionsFromFirestore,
  hydrateUserSiteFeedbackFromFirestore,
  loadMediaAssetFromFirestore,
  saveMediaAssetToFirestore,
  syncGuestLikesToFirestore,
  syncPoemLikeEntryToFirestore,
  syncPoemSubmissionToFirestore,
  syncProseSubmissionToFirestore,
  syncRadioLikeEntryToFirestore,
  syncReviewToFirestore,
  syncSiteFeedbackToFirestore,
  syncWorkVoteToFirestore,
  updateSingleReviewInFirestore,
  deleteSingleReviewInFirestore,
} from './firestoreStubs.ts';
import {
  checkRateLimit,
  createEmptyAnalytics,
  createEndpointRateLimiter,
  ensureDatabase,
  fetchPinnedImageUrl,
  getCatalogRevision,
  getClientIpHash,
  missingUploadCache,
  normalizeProseStatus,
  resolveConfinedFilePath,
  resolveProseAccessMode,
  saveDatabase,
  seenAnalyticsSessionsSet,
  UPLOADS_DIR,
  validateExternalImageUrlForProxy,
  verifySameOrigin,
  visitorIpSet,
} from './db.ts';
import {
  authenticateAdminRequest,
  authenticateGuestRequest,
  cloudPoemLikesByPoemId,
  cloudPoemLikesByUid,
  cloudRadioLikesByTrackId,
  ensureAllPublicStateHydrated,
  extractBearerToken,
  hydratedGuestLikesUids,
  recordCloudPoemLikeState,
  recordCloudRadioLikeState,
  tryAuthenticateOptionalGuest,
  type UserBadgesLookup,
} from './auth.ts';
import { hashBuyerEmailLookup } from './payments.ts';

export const CATALOG_TEXT_MAX_CHARS = 220;
export const CATALOG_TEXT_CUT_CHARS = 160;
const CATALOG_SLICE_MIN_CHARS = 50;
const MISSING_UPLOAD_TTL_MS = 5 * 60 * 1000;

export function parseDecimalRating(raw: unknown): number | null {
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return null;
  const rounded = Math.round(numeric * 10) / 10;
  if (rounded < 0.1 || rounded > 5) return null;
  return rounded;
}

export function computePoemLikesCount(poemId: string, db: SiteDatabase): number {
  const likerKeys = new Set<string>();
  const cloudUids = cloudPoemLikesByPoemId.get(poemId);
  if (cloudUids) {
    for (const uid of cloudUids) {
      likerKeys.add(`g:${uid}`);
    }
  }
  for (const acc of db.guestAccounts) {
    const hasLiked = Array.isArray(acc.likedPoemIds) && acc.likedPoemIds.includes(poemId);
    if (acc.googleUid) {
      if (hydratedGuestLikesUids.has(acc.googleUid) || acc.likedUpdatedAt) {
        if (hasLiked) {
          likerKeys.add(`g:${acc.googleUid}`);
        } else {
          likerKeys.delete(`g:${acc.googleUid}`);
        }
      } else if (hasLiked) {
        likerKeys.add(`g:${acc.googleUid}`);
      }
    } else if (hasLiked) {
      likerKeys.add(`a:${acc.uid}`);
    }
  }
  return likerKeys.size;
}

export function computeRadioTrackLikesCount(trackId: string, db: SiteDatabase): number {
  const likerKeys = new Set<string>();
  const cloudUids = cloudRadioLikesByTrackId.get(trackId);
  if (cloudUids) {
    for (const uid of cloudUids) {
      likerKeys.add(`g:${uid}`);
    }
  }
  for (const acc of db.guestAccounts) {
    const hasLiked = Array.isArray(acc.likedRadioTrackIds) && acc.likedRadioTrackIds.includes(trackId);
    if (acc.googleUid) {
      if (hydratedGuestLikesUids.has(acc.googleUid) || acc.likedUpdatedAt) {
        if (hasLiked) {
          likerKeys.add(`g:${acc.googleUid}`);
        } else {
          likerKeys.delete(`g:${acc.googleUid}`);
        }
      } else if (hasLiked) {
        likerKeys.add(`g:${acc.googleUid}`);
      }
    } else if (hasLiked) {
      likerKeys.add(`a:${acc.uid}`);
    }
  }
  return likerKeys.size;
}

export function computeLeaderboardRankings(db: SiteDatabase) {
  const accountByUid = new Map(db.guestAccounts.map((acc) => [acc.uid, acc]));
  const existingPoemIds = new Set(db.poems.map((p) => p.id));

  const activityRanked = [...db.guestAccounts]
    .filter((acc) => Boolean(acc.displayName))
    .map((acc) => {
      const commentsCount = db.reviews.reduce((sum, rev) => {
        if (!rev.comment || !rev.comment.trim()) return sum;
        const matchesAuthor =
          rev.authorUid === acc.uid || (Boolean(acc.googleUid) && rev.authorUid === acc.googleUid);
        return matchesAuthor ? sum + 1 : sum;
      }, 0);

      const likedSet = new Set<string>();
      if (Array.isArray(acc.likedPoemIds)) {
        for (const poemId of acc.likedPoemIds) {
          if (existingPoemIds.has(poemId)) likedSet.add(poemId);
        }
      }
      if (acc.googleUid) {
        const cloudLiked = cloudPoemLikesByUid.get(acc.googleUid);
        if (cloudLiked) {
          for (const poemId of cloudLiked) {
            if (existingPoemIds.has(poemId)) likedSet.add(poemId);
          }
        }
      }
      const likesCount = likedSet.size;

      const accEmailHash = acc.email ? hashBuyerEmailLookup(acc.email) : '';
      const accEmailLower = acc.email ? acc.email.trim().toLowerCase() : '';
      let ordersPurchasesCount = 0;
      for (const order of db.orders) {
        const matchesUid = Boolean(
          order.guestUid &&
            (order.guestUid === acc.uid || (acc.googleUid && order.guestUid === acc.googleUid))
        );
        const matchesHash = Boolean(accEmailHash && order.buyerEmailHash === accEmailHash);
        const matchesPlainEmail = Boolean(
          !order.encryptedPii &&
            accEmailLower &&
            order.buyerEmail?.trim().toLowerCase() === accEmailLower
        );
        if (matchesUid || matchesHash || matchesPlainEmail) {
          ordersPurchasesCount +=
            Array.isArray(order.items) && order.items.length > 0 ? order.items.length : 1;
        }
      }
      const purchasesCount = Math.max(
        ordersPurchasesCount,
        Math.round(Number(acc.purchasesCount) || 0)
      );

      const points = commentsCount + likesCount + purchasesCount;
      return {
        uid: acc.uid,
        googleUid: acc.googleUid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        points,
        commentsCount,
        likesCount,
        purchasesCount,
        totalTimeSeconds: Math.round(Number(acc.totalTimeSeconds) || 0),
        createdAt: acc.createdAt,
      };
    })
    .filter((entry) => entry.points > 0)
    .sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.purchasesCount !== a.purchasesCount) return b.purchasesCount - a.purchasesCount;
      if (b.commentsCount !== a.commentsCount) return b.commentsCount - a.commentsCount;
      if (b.likesCount !== a.likesCount) return b.likesCount - a.likesCount;
      if (b.totalTimeSeconds !== a.totalTimeSeconds) return b.totalTimeSeconds - a.totalTimeSeconds;
      return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
    })
    .slice(0, 10)
    .map((entry, idx) => ({
      rank: idx + 1,
      uid: entry.uid,
      googleUid: entry.googleUid,
      displayName: entry.displayName,
      photoUrl: entry.photoUrl,
      points: entry.points,
      commentsCount: entry.commentsCount,
      likesCount: entry.likesCount,
      purchasesCount: entry.purchasesCount,
    }));

  const donorAgg = new Map<
    string,
    {
      id: string;
      guestUid?: string;
      googleUid?: string;
      displayName: string;
      photoUrl?: string;
      totalAmountUah: number;
      donationsCount: number;
      lastDonatedAt: string;
    }
  >();

  for (const don of db.donations) {
    const linked = don.guestUid ? accountByUid.get(don.guestUid) : undefined;
    const resolvedName = (linked?.displayName || don.displayName || '').trim();
    if (!resolvedName || don.amountUah <= 0) continue;
    const key = linked ? `uid:${linked.uid}` : `name:${resolvedName.toLowerCase()}`;
    const existing = donorAgg.get(key);
    const donatedAt = don.donatedAt || new Date().toISOString();
    const photoUrl = linked?.photoUrl || don.photoUrl;
    if (existing) {
      existing.totalAmountUah += Math.round(don.amountUah);
      existing.donationsCount += 1;
      if ((Date.parse(donatedAt) || 0) > (Date.parse(existing.lastDonatedAt) || 0)) {
        existing.lastDonatedAt = donatedAt;
      }
      if (!existing.photoUrl && photoUrl) {
        existing.photoUrl = photoUrl;
      }
    } else {
      donorAgg.set(key, {
        id: don.id,
        ...(linked ? { guestUid: linked.uid, googleUid: linked.googleUid } : don.guestUid ? { guestUid: don.guestUid } : {}),
        displayName: resolvedName,
        ...(photoUrl ? { photoUrl } : {}),
        totalAmountUah: Math.round(don.amountUah),
        donationsCount: 1,
        lastDonatedAt: donatedAt,
      });
    }
  }

  const donorsRanked = Array.from(donorAgg.values())
    .sort((a, b) => {
      if (b.totalAmountUah !== a.totalAmountUah) return b.totalAmountUah - a.totalAmountUah;
      if (b.donationsCount !== a.donationsCount) return b.donationsCount - a.donationsCount;
      return (Date.parse(a.lastDonatedAt) || 0) - (Date.parse(b.lastDonatedAt) || 0);
    })
    .slice(0, 10)
    .map((entry, idx) => ({
      rank: idx + 1,
      ...entry,
    }));

  const activityByUid = new Map<string, TopRankNumber>();
  for (const entry of activityRanked.slice(0, 5)) {
    const rank = entry.rank as TopRankNumber;
    activityByUid.set(entry.uid, rank);
    if (entry.googleUid) {
      activityByUid.set(entry.googleUid, rank);
    }
  }

  const donorByUid = new Map<string, TopRankNumber>();
  const donorByName = new Map<string, TopRankNumber>();
  for (const entry of donorsRanked.slice(0, 5)) {
    const rank = entry.rank as TopRankNumber;
    if (entry.guestUid) {
      donorByUid.set(entry.guestUid, rank);
      if (entry.googleUid) {
        donorByUid.set(entry.googleUid, rank);
      }
    } else if (entry.displayName) {
      donorByName.set(entry.displayName.trim().toLowerCase(), rank);
    }
  }

  const lookup: UserBadgesLookup = {
    get: (uid?: string | null, displayName?: string | null): UserTopBadges | undefined => {
      const cleanUid = typeof uid === 'string' ? uid.trim() : '';
      const cleanName = typeof displayName === 'string' ? displayName.trim().toLowerCase() : '';
      const activityRank = cleanUid ? activityByUid.get(cleanUid) : undefined;
      let donorRank = cleanUid ? donorByUid.get(cleanUid) : undefined;
      if (!donorRank && cleanName) {
        donorRank = donorByName.get(cleanName);
      }
      if (!activityRank && !donorRank) return undefined;
      return {
        ...(activityRank ? { activityRank } : {}),
        ...(donorRank ? { donorRank } : {}),
      };
    },
  };

  return {
    activityRanked,
    donorsRanked,
    lookup,
  };
}

let cachedLeaderboardEntry: {
  db: SiteDatabase;
  revision: number;
  expiresAtMs: number;
  result: ReturnType<typeof computeLeaderboardRankings>;
} | null = null;

export function getCachedLeaderboardRankings(db: SiteDatabase) {
  const now = Date.now();
  const rev = getCatalogRevision();
  if (
    cachedLeaderboardEntry &&
    cachedLeaderboardEntry.db === db &&
    cachedLeaderboardEntry.revision === rev &&
    cachedLeaderboardEntry.expiresAtMs > now
  ) {
    return cachedLeaderboardEntry.result;
  }
  const result = computeLeaderboardRankings(db);
  cachedLeaderboardEntry = {
    db,
    revision: rev,
    expiresAtMs: now + 3000,
    result,
  };
  return result;
}

export function createBadgeLookup(db: SiteDatabase): UserBadgesLookup {
  return getCachedLeaderboardRankings(db).lookup;
}

export interface AccountPhotoLookup {
  get: (uid?: string | null, displayName?: string | null) => string | undefined;
}

export function createAccountPhotoLookup(db: SiteDatabase): AccountPhotoLookup {
  const byUid = new Map<string, string>();
  const namePhotoCandidates = new Map<string, Set<string>>();

  for (const acc of db.guestAccounts) {
    const cleanPhoto = typeof acc.photoUrl === 'string' ? acc.photoUrl.trim() : '';
    if (!cleanPhoto) continue;
    if (acc.uid) byUid.set(acc.uid, cleanPhoto);
    if (acc.googleUid) byUid.set(acc.googleUid, cleanPhoto);
    const cleanName = typeof acc.displayName === 'string' ? acc.displayName.trim().toLowerCase() : '';
    if (cleanName && cleanName !== 'гість' && cleanName !== 'читач') {
      let set = namePhotoCandidates.get(cleanName);
      if (!set) {
        set = new Set<string>();
        namePhotoCandidates.set(cleanName, set);
      }
      set.add(cleanPhoto);
    }
  }

  return {
    get(uid?: string | null, displayName?: string | null) {
      if (uid && byUid.has(uid)) return byUid.get(uid);
      const cleanName = typeof displayName === 'string' ? displayName.trim().toLowerCase() : '';
      if (cleanName) {
        const candidates = namePhotoCandidates.get(cleanName);
        if (candidates && candidates.size === 1) {
          return Array.from(candidates)[0];
        }
      }
      return undefined;
    },
  };
}

export interface AccountDonorTextLookup {
  get: (uid?: string | null) => string | undefined;
}

export function createDonorTextLookup(db: SiteDatabase): AccountDonorTextLookup {
  const byUid = new Map<string, string>();
  for (const acc of db.guestAccounts) {
    const cleanText = typeof acc.donorChatText === 'string' ? acc.donorChatText.trim().slice(0, 80) : '';
    if (!cleanText) continue;
    if (acc.uid) byUid.set(acc.uid, cleanText);
    if (acc.googleUid) byUid.set(acc.googleUid, cleanText);
  }
  return {
    get(uid?: string | null) {
      if (!uid) return undefined;
      return byUid.get(uid);
    },
  };
}

export function enrichReviewWithBadges(
  review: ReviewItem,
  badgeLookup: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup
): ReviewItem {
  const authorBadges = badgeLookup.get(review.authorUid, review.authorName);
  const resolvedPhoto =
    (typeof review.authorPhotoUrl === 'string' && review.authorPhotoUrl.trim()) ||
    photoLookup?.get(review.authorUid, review.authorName) ||
    undefined;
  return {
    ...review,
    ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
    ...(authorBadges ? { authorBadges } : {}),
  };
}

export function enrichChatMessageWithBadges(
  msg: GlobalChatMessage,
  badgeLookup: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup,
  donorTextLookup?: AccountDonorTextLookup
): GlobalChatMessage {
  const authorBadges = badgeLookup.get(msg.authorUid, msg.authorName);
  const resolvedPhoto =
    (typeof msg.authorPhotoUrl === 'string' && msg.authorPhotoUrl.trim()) ||
    photoLookup?.get(msg.authorUid, msg.authorName) ||
    undefined;
  const isTop3Donor = Boolean(authorBadges?.donorRank && authorBadges.donorRank <= 3);
  const resolvedDonorText = isTop3Donor
    ? donorTextLookup?.get(msg.authorUid) ||
      (typeof msg.authorDonorText === 'string' ? msg.authorDonorText.trim().slice(0, 80) : undefined)
    : undefined;
  return {
    ...msg,
    ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
    ...(authorBadges ? { authorBadges } : {}),
    ...(resolvedDonorText ? { authorDonorText: resolvedDonorText } : {}),
  };
}

export function getEffectiveVoteKeys(
  ipHash?: string,
  account?: { uid: string; googleUid?: string } | null
): { primaryKey: string; lookupKeys: string[] } {
  const keys: string[] = [];
  if (account?.googleUid) keys.push(`u:${account.googleUid}`);
  if (account?.uid) keys.push(`u:${account.uid}`);
  if (ipHash) keys.push(ipHash);
  const lookupKeys = Array.from(new Set(keys));
  const primaryKey = account?.googleUid
    ? `u:${account.googleUid}`
    : account?.uid
      ? `u:${account.uid}`
      : ipHash || 'anon';
  return { primaryKey, lookupKeys };
}

export function findUserRatingInVotes(
  votesMap: Record<string, number>,
  lookupKeys: string[]
): number | null {
  for (const key of lookupKeys) {
    if (typeof votesMap[key] === 'number') return votesMap[key];
  }
  return null;
}

export function enrichPoem(
  poem: RawPoem,
  db: SiteDatabase,
  ipHash: string,
  guestAccount?: GuestAccountRecord | null,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup
): Poem {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const votesForPoem = db.poemVotes[poem.id] || {};
  const scores = Object.values(votesForPoem);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const { lookupKeys } = getEffectiveVoteKeys(ipHash, guestAccount);
  const userRating = findUserRatingInVotes(votesForPoem, lookupKeys);
  const poemReviews = db.reviews
    .filter((r) => r.targetType === 'poem' && r.targetId === poem.id)
    .map((r) => enrichReviewWithBadges(r, resolvedBadges, resolvedPhotos));
  const likesCount = computePoemLikesCount(poem.id, db);
  const isLiked = Boolean(
    guestAccount && Array.isArray(guestAccount.likedPoemIds) && guestAccount.likedPoemIds.includes(poem.id)
  );

  return {
    ...poem,
    viewsCount: db.poemViews[poem.id] || 0,
    likesCount,
    isLiked,
    ratingAverage,
    ratingCount,
    userRating,
    reviews: poemReviews,
  };
}

export function enrichBlogPost(post: RawBlogPost, db: SiteDatabase): BlogPost {
  return {
    ...post,
    viewsCount: db.blogViews[post.id] || 0,
  };
}

export function truncatePoemForCatalog(poem: Poem): Poem {
  if (!poem.content || poem.content.length <= CATALOG_TEXT_MAX_CHARS) {
    return poem;
  }
  const nlCut = poem.content.lastIndexOf('\n', CATALOG_TEXT_CUT_CHARS);
  const wsCut = poem.content.lastIndexOf(' ', CATALOG_TEXT_CUT_CHARS);
  const sliceEnd =
    nlCut >= CATALOG_SLICE_MIN_CHARS
      ? nlCut
      : wsCut >= CATALOG_SLICE_MIN_CHARS
        ? wsCut
        : CATALOG_TEXT_CUT_CHARS;
  return {
    ...poem,
    content: `${poem.content.slice(0, sliceEnd).trimEnd()}…`,
    contentTruncated: true,
  };
}

export function truncateBlogForCatalog(post: BlogPost): BlogPost {
  if (!post.content) return post;
  const lines = post.content.split('\n');
  const directiveLines: string[] = [];
  const proseLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith(':::blog-media ') && trimmed.endsWith(':::')) {
      directiveLines.push(line);
    } else {
      proseLines.push(line);
    }
  }

  const proseText = proseLines.join('\n');
  if (proseText.length <= CATALOG_TEXT_MAX_CHARS) {
    return post;
  }

  const nlCut = proseText.lastIndexOf('\n', CATALOG_TEXT_CUT_CHARS);
  const wsCut = proseText.lastIndexOf(' ', CATALOG_TEXT_CUT_CHARS);
  const sliceEnd =
    nlCut >= CATALOG_SLICE_MIN_CHARS
      ? nlCut
      : wsCut >= CATALOG_SLICE_MIN_CHARS
        ? wsCut
        : CATALOG_TEXT_CUT_CHARS;
  const truncatedProse = `${proseText.slice(0, sliceEnd).trimEnd()}…`;
  const rebuilt =
    directiveLines.length > 0
      ? `${truncatedProse}\n\n${directiveLines.join('\n')}`
      : truncatedProse;

  return {
    ...post,
    content: rebuilt,
    contentTruncated: true,
  };
}

export function getProsePreviewText(content: string): string {
  const paragraphs = preserveFormattedText(content)
    .split(/\n{2,}/)
    .map((p) => preserveFormattedText(p))
    .filter(Boolean);
  if (paragraphs.length === 0) return '';
  if (paragraphs.length === 1) {
    const first = paragraphs[0];
    if (first.length <= 260) return first;
    return `${first.slice(0, 260).replace(/\s+\S*$/, '')}…`;
  }
  const previewParagraphs = paragraphs.slice(0, Math.min(2, Math.max(1, paragraphs.length - 1)));
  const joined = previewParagraphs.join('\n\n');
  if (joined.length <= 520) return joined;
  return `${joined.slice(0, 520).replace(/\s+\S*$/, '')}…`;
}

export function computeProseStats(
  workId: string,
  db: SiteDatabase,
  ipHash?: string,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup,
  guestAccount?: GuestAccountRecord | null
) {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const votesForProse = db.proseVotes[workId] || {};
  const scores = Object.values(votesForProse);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const { lookupKeys } = getEffectiveVoteKeys(ipHash, guestAccount);
  const userRating = findUserRatingInVotes(votesForProse, lookupKeys);
  const proseReviews = db.reviews
    .filter((r) => r.targetType === 'prose' && r.targetId === workId)
    .map((r) => enrichReviewWithBadges(r, resolvedBadges, resolvedPhotos));
  return { ratingAverage, ratingCount, userRating, reviews: proseReviews };
}

export function getValidProseTagIds(tagIds: string[] | undefined, db: SiteDatabase): string[] {
  if (!Array.isArray(tagIds) || tagIds.length === 0) return [];
  const validSet = new Set(db.proseTags.map((t) => t.id));
  return Array.from(new Set(tagIds.filter((id) => typeof id === 'string' && validSet.has(id))));
}

export function computeProseTotalWords(work: RawProseWork): number {
  const baseWords = countProseWords(work.content);
  const chapterWords = Array.isArray(work.chapters)
    ? work.chapters.reduce((sum, ch) => sum + countProseWords(ch.content), 0)
    : 0;
  return baseWords + chapterWords;
}

export function enrichProseForPublic(
  work: RawProseWork,
  db: SiteDatabase,
  ipHash: string,
  isAuthorizedUser = false,
  includeFullContent = false,
  badgeLookup?: UserBadgesLookup,
  guestAccount?: GuestAccountRecord | null,
  photoLookup?: AccountPhotoLookup
): ProseWork {
  const accessMode = resolveProseAccessMode(work);
  const isPaid = accessMode === 'paid';
  const requiresAuth = accessMode === 'authorized';
  const hasPdf = Boolean(work.pdfStorageKey);
  const { pdfStorageKey: _hiddenPdfKey, ...safeFields } = work;
  const stats = computeProseStats(work.id, db, ipHash, badgeLookup, photoLookup, guestAccount);
  const tagIds = getValidProseTagIds(work.tagIds, db);
  const rawChapters = Array.isArray(work.chapters) ? work.chapters : [];
  const totalWords = computeProseTotalWords(work);
  const computedPages = computeProseWorkPages({
    content: work.content,
    chapters: rawChapters,
    hasPdf,
    fallbackPages: work.pages,
  });

  const normalizedStatus = normalizeProseStatus(work.status);
  const canReadDirectly = accessMode === 'public' || (requiresAuth && isAuthorizedUser);

  if (canReadDirectly) {
    return {
      ...safeFields,
      content: includeFullContent ? work.content : '',
      pages: computedPages,
      chapters: includeFullContent
        ? rawChapters
        : rawChapters.map((ch) => ({
            id: ch.id,
            title: ch.title,
            publishedAt: ch.publishedAt,
            content: '',
          })),
      totalWords,
      tagIds,
      status: normalizedStatus,
      accessMode,
      requiresAuth,
      isPaid: false,
      priceUah: 0,
      hasPdf,
      isLocked: false,
      moodboardUrls: Array.isArray(work.moodboardUrls) ? work.moodboardUrls : [],
      ...stats,
    };
  }

  const previewText = work.content.trim()
    ? getProsePreviewText(work.content)
    : work.excerpt;
  return {
    id: work.id,
    title: work.title,
    genre: work.genre,
    pages: computedPages,
    publishedAt: work.publishedAt,
    slogan: work.slogan,
    excerpt: work.excerpt,
    content: '',
    chapters: rawChapters.map((ch) => ({
      id: ch.id,
      title: ch.title,
      publishedAt: ch.publishedAt,
      content: '',
    })),
    totalWords,
    tagIds,
    status: normalizedStatus,
    accessMode,
    requiresAuth,
    isPaid,
    priceUah: isPaid ? Number(work.priceUah || 0) : 0,
    previewText,
    hasPdf,
    pdfFileName: work.pdfFileName,
    pdfFileSize: work.pdfFileSize,
    isLocked: true,
    moodboardUrls: Array.isArray(work.moodboardUrls) ? work.moodboardUrls : [],
    ...(work.isCommunity ? { isCommunity: true } : {}),
    ...(work.authorUid ? { authorUid: work.authorUid } : {}),
    ...(work.authorName ? { authorName: work.authorName } : {}),
    ...(work.authorPhotoUrl ? { authorPhotoUrl: work.authorPhotoUrl } : {}),
    ...(work.submissionId ? { submissionId: work.submissionId } : {}),
    ...stats,
  };
}

export function enrichProseForAuthor(work: RawProseWork, db: SiteDatabase): ProseWork {
  const rawChapters = Array.isArray(work.chapters) ? work.chapters : [];
  const hasPdf = Boolean(work.pdfStorageKey);
  const accessMode = resolveProseAccessMode(work);
  return {
    ...work,
    pages: computeProseWorkPages({
      content: work.content,
      chapters: rawChapters,
      hasPdf,
      fallbackPages: work.pages,
    }),
    chapters: rawChapters,
    totalWords: computeProseTotalWords(work),
    tagIds: getValidProseTagIds(work.tagIds, db),
    status: normalizeProseStatus(work.status),
    accessMode,
    requiresAuth: accessMode === 'authorized',
    isPaid: accessMode === 'paid',
    priceUah: accessMode === 'paid' ? Number(work.priceUah || 0) : 0,
    hasPdf,
    ...computeProseStats(work.id, db),
  };
}

export function enrichProductForPublic(
  product: RawStoreProduct,
  db: SiteDatabase,
  ipHash: string,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup,
  guestAccount?: GuestAccountRecord | null
): StoreProduct {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const {
    gdocGuestUrl: _hiddenUrl,
    ebookFullText: _hiddenBook,
    ebookStorageKey: _hiddenStorageKey,
    ...publicFields
  } = product;
  const votesForProduct = db.productVotes[product.id] || {};
  const scores = Object.values(votesForProduct);
  const ratingCount = scores.length;
  const ratingAverage =
    ratingCount > 0 ? Number((scores.reduce((sum, s) => sum + s, 0) / ratingCount).toFixed(1)) : 0;
  const { lookupKeys } = getEffectiveVoteKeys(ipHash, guestAccount);
  const userRating = findUserRatingInVotes(votesForProduct, lookupKeys);
  const productReviews = db.reviews
    .filter((r) => r.targetType === 'product' && r.targetId === product.id)
    .map((r) => enrichReviewWithBadges(r, resolvedBadges, resolvedPhotos));

  return {
    ...publicFields,
    hasEbookFile: Boolean(product.ebookStorageKey || product.ebookFullText),
    ratingAverage,
    ratingCount,
    userRating,
    reviews: productReviews,
  };
}

export function recordRecentRating(
  db: SiteDatabase,
  params: {
    targetType: 'poem' | 'prose' | 'product';
    targetId: string;
    rating: number;
    authorUid?: string;
    authorName?: string;
    authorPhotoUrl?: string;
  }
) {
  if (!Array.isArray(db.recentRatings)) {
    db.recentRatings = [];
  }
  const entry: ReviewItem = {
    id: `rate_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    targetType: params.targetType,
    targetId: params.targetId,
    authorUid: (params.authorUid || 'guest_voter').slice(0, 128),
    authorName: (params.authorName?.trim() || 'Читач').slice(0, 80),
    authorPhotoUrl: params.authorPhotoUrl?.trim() || undefined,
    rating: params.rating,
    comment: '',
    createdAt: new Date().toISOString(),
  };
  db.recentRatings.unshift(entry);
  if (db.recentRatings.length > 40) {
    db.recentRatings = db.recentRatings.slice(0, 40);
  }
}

export function buildRecentFeedback(
  db: SiteDatabase,
  limit = 20,
  badgeLookup?: UserBadgesLookup,
  photoLookup?: AccountPhotoLookup
): HomeFeedbackItem[] {
  const resolvedBadges = badgeLookup ?? createBadgeLookup(db);
  const resolvedPhotos = photoLookup ?? createAccountPhotoLookup(db);
  const poemTitles = new Map(db.poems.map((p) => [p.id, p.title]));
  const proseTitles = new Map(db.prose.map((p) => [p.id, p.title]));
  const productTitles = new Map(db.products.map((p) => [p.id, p.title]));

  const resolveTitle = (targetType: ReviewItem['targetType'], targetId: string): string | null => {
    if (targetType === 'poem') return poemTitles.get(targetId) ?? null;
    if (targetType === 'prose') return proseTitles.get(targetId) ?? null;
    return productTitles.get(targetId) ?? null;
  };

  const combined: HomeFeedbackItem[] = [];
  const seenIds = new Set<string>();
  const allEntries = [...(db.reviews || []), ...(db.recentRatings || [])];

  for (const item of allEntries) {
    if (!item || !item.id || seenIds.has(item.id)) continue;
    const targetTitle = resolveTitle(item.targetType, item.targetId);
    if (!targetTitle) continue;
    if (!item.comment?.trim() && typeof item.rating !== 'number') continue;
    seenIds.add(item.id);
    const authorBadges = resolvedBadges.get(item.authorUid, item.authorName);
    const resolvedPhoto =
      (typeof item.authorPhotoUrl === 'string' && item.authorPhotoUrl.trim()) ||
      resolvedPhotos.get(item.authorUid, item.authorName) ||
      undefined;
    combined.push({
      ...item,
      ...(resolvedPhoto ? { authorPhotoUrl: resolvedPhoto } : {}),
      ...(authorBadges ? { authorBadges } : {}),
      targetTitle,
    });
  }

  combined.sort((a, b) => {
    const aMs = Date.parse(a.createdAt || '') || 0;
    const bMs = Date.parse(b.createdAt || '') || 0;
    return bMs - aMs;
  });

  return combined.slice(0, limit);
}

const SOUNDCLOUD_INPUT_HOSTS = new Set([
  'soundcloud.com',
  'www.soundcloud.com',
  'm.soundcloud.com',
  'on.soundcloud.com',
  'snd.sc',
]);

const SOUNDCLOUD_SHORT_HOSTS = new Set(['on.soundcloud.com', 'snd.sc']);

const SOUNDCLOUD_EMBED_HOSTS = new Set([
  'api.soundcloud.com',
  'w.soundcloud.com',
  'soundcloud.com',
  'www.soundcloud.com',
]);

export function isAllowedSoundCloudArtworkHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return (
    lower === 'sndcdn.com' ||
    lower.endsWith('.sndcdn.com') ||
    lower === 'soundcloud.com' ||
    lower.endsWith('.soundcloud.com')
  );
}

export function normalizeSoundCloudInputUrl(rawInput: string): string | null {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.length > 600) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  if (parsed.username || parsed.password || parsed.port) return null;
  const host = parsed.hostname.toLowerCase();
  if (!SOUNDCLOUD_INPUT_HOSTS.has(host)) return null;
  if (!parsed.pathname || parsed.pathname === '/') return null;

  parsed.protocol = 'https:';
  if (host === 'm.soundcloud.com' || host === 'www.soundcloud.com') {
    parsed.hostname = 'soundcloud.com';
  }
  parsed.hash = '';
  for (const key of Array.from(parsed.searchParams.keys())) {
    if (key === 'si' || key === 'ref' || key.startsWith('utm_')) {
      parsed.searchParams.delete(key);
    }
  }
  return parsed.toString();
}

export async function resolveSoundCloudShortUrl(canonicalUrl: string): Promise<string> {
  let currentUrl = canonicalUrl;
  for (let hop = 0; hop < 4; hop += 1) {
    let parsed: URL;
    try {
      parsed = new URL(currentUrl);
    } catch {
      return canonicalUrl;
    }
    if (!SOUNDCLOUD_SHORT_HOSTS.has(parsed.hostname.toLowerCase())) {
      return currentUrl;
    }
    try {
      const response = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
        signal: AbortSignal.timeout(5000),
      });
      const location = response.headers.get('location');
      if (!location || response.status < 300 || response.status >= 400) {
        return currentUrl;
      }
      const nextRaw = new URL(location, currentUrl).toString();
      const validatedNext = normalizeSoundCloudInputUrl(nextRaw);
      if (!validatedNext) {
        return currentUrl;
      }
      currentUrl = validatedNext;
    } catch {
      return currentUrl;
    }
  }
  return currentUrl;
}

export function deriveSoundCloudFallbackMeta(canonicalUrl: string): { title: string; artist: string } {
  try {
    const parsed = new URL(canonicalUrl);
    const segments = parsed.pathname
      .split('/')
      .map((s) => decodeURIComponent(s).trim())
      .filter(Boolean);
    const artistSlug = segments[0] || 'SoundCloud';
    const trackSlug = segments[1] && segments[1] !== 'sets' ? segments[1] : segments[segments.length - 1] || 'Трек';
    const formatSlug = (slug: string) =>
      slug
        .replace(/[-_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase());
    return {
      artist: formatSlug(artistSlug) || 'SoundCloud',
      title: formatSlug(trackSlug) || 'Трек із SoundCloud',
    };
  } catch {
    return { artist: 'SoundCloud', title: 'Трек із SoundCloud' };
  }
}

export async function resolveSoundCloudTrackMetadata(
  rawUrl: string,
  station: RadioStationId = 'indie'
): Promise<{ ok: true; track: RadioTrack } | { ok: false; error: string }> {
  const normalized = normalizeSoundCloudInputUrl(rawUrl);
  if (!normalized) {
    return {
      ok: false,
      error: 'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track).',
    };
  }

  const canonicalUrl = await resolveSoundCloudShortUrl(normalized);
  const fallback = deriveSoundCloudFallbackMeta(canonicalUrl);
  let title = fallback.title;
  let artist = fallback.artist;
  let artworkUrl: string | undefined;
  let embedTargetUrl = canonicalUrl;

  try {
    const oembedEndpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonicalUrl)}`;
    const oembedRes = await fetch(oembedEndpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(7000),
    });
    if (oembedRes.ok) {
      const data = (await oembedRes.json()) as {
        title?: unknown;
        author_name?: unknown;
        thumbnail_url?: unknown;
        html?: unknown;
      };
      if (typeof data.author_name === 'string' && data.author_name.trim()) {
        artist = data.author_name.trim().slice(0, 140);
      }
      if (typeof data.title === 'string' && data.title.trim()) {
        let cleanTitle = data.title.trim();
        const suffix = ` by ${artist}`;
        if (cleanTitle.length > suffix.length && cleanTitle.toLowerCase().endsWith(suffix.toLowerCase())) {
          cleanTitle = cleanTitle.slice(0, cleanTitle.length - suffix.length).trim();
        }
        title = cleanTitle.slice(0, 200) || fallback.title;
      }
      if (typeof data.thumbnail_url === 'string' && data.thumbnail_url.trim()) {
        try {
          const thumbUrl = new URL(data.thumbnail_url.trim());
          if (
            thumbUrl.protocol === 'https:' &&
            !thumbUrl.username &&
            !thumbUrl.password &&
            isAllowedSoundCloudArtworkHost(thumbUrl.hostname)
          ) {
            artworkUrl = thumbUrl.toString();
          }
        } catch {
          // Ignore malformed thumbnail URL
        }
      }
      if (typeof data.html === 'string') {
        const srcMatch = data.html.match(/\bsrc=["'](https:\/\/w\.soundcloud\.com\/player\/\?[^"']+)["']/i);
        if (srcMatch?.[1]) {
          try {
            const playerUrl = new URL(srcMatch[1]);
            const targetParam = playerUrl.searchParams.get('url');
            if (targetParam) {
              const targetUrl = new URL(targetParam);
              if (
                targetUrl.protocol === 'https:' &&
                !targetUrl.username &&
                !targetUrl.password &&
                SOUNDCLOUD_EMBED_HOSTS.has(targetUrl.hostname.toLowerCase())
              ) {
                embedTargetUrl = targetUrl.toString();
              }
            }
          } catch {
            // Keep canonicalUrl fallback
          }
        }
      }
    }
  } catch {
    // Fallback to URL-derived metadata if oEmbed is unreachable
  }

  return {
    ok: true,
    track: {
      id: `radio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      title,
      artist,
      soundcloudUrl: canonicalUrl,
      embedTargetUrl,
      ...(artworkUrl ? { artworkUrl } : {}),
      station,
      addedAt: new Date().toISOString(),
    },
  };
}

export function sanitizePoemImageUrl(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1000) return undefined;
  if (
    (trimmed.startsWith('/uploads/') || trimmed.startsWith('/src/assets/') || trimmed.startsWith('/assets/')) &&
    !trimmed.includes('..') &&
    !trimmed.includes('\\')
  ) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if ((parsed.protocol === 'https:' || parsed.protocol === 'http:') && !parsed.username && !parsed.password) {
      return parsed.toString().slice(0, 1000);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function sanitizePoemImagePalette(raw: unknown): PoemImagePalette | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const hexRe = /^#[0-9a-fA-F]{6}$/;
  const background = typeof obj.background === 'string' ? obj.background.trim() : '';
  const text = typeof obj.text === 'string' ? obj.text.trim() : '';
  if (!hexRe.test(background) || !hexRe.test(text)) return undefined;
  const secondaryRaw = typeof obj.secondaryBackground === 'string' ? obj.secondaryBackground.trim() : '';
  const secondaryBackground = hexRe.test(secondaryRaw) ? secondaryRaw.toUpperCase() : undefined;
  const isDark = typeof obj.isDark === 'boolean' ? obj.isDark : undefined;
  return {
    background: background.toUpperCase(),
    ...(secondaryBackground ? { secondaryBackground } : {}),
    text: text.toUpperCase(),
    ...(typeof isDark === 'boolean' ? { isDark } : {}),
  };
}

export function sanitizePoemSoundCloudTrack(raw: unknown): PoemSoundCloudTrack | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const obj = raw as Record<string, unknown>;
  const rawTitle = typeof obj.title === 'string' ? obj.title.trim().slice(0, 200) : '';
  const rawArtist = typeof obj.artist === 'string' ? obj.artist.trim().slice(0, 140) : '';
  const rawScUrl = typeof obj.soundcloudUrl === 'string' ? obj.soundcloudUrl.trim() : '';
  const rawEmbedUrl = typeof obj.embedTargetUrl === 'string' ? obj.embedTargetUrl.trim() : '';
  if (!rawTitle || !rawArtist || !rawScUrl) return undefined;

  const normalizedSc = normalizeSoundCloudInputUrl(rawScUrl);
  if (!normalizedSc || normalizedSc.length > 500) return undefined;

  let embedTargetUrl = normalizedSc;
  if (rawEmbedUrl && rawEmbedUrl.length <= 500) {
    try {
      const parsedEmbed = new URL(rawEmbedUrl);
      if (
        (parsedEmbed.protocol === 'https:' || parsedEmbed.protocol === 'http:') &&
        !parsedEmbed.username &&
        !parsedEmbed.password &&
        SOUNDCLOUD_EMBED_HOSTS.has(parsedEmbed.hostname.toLowerCase())
      ) {
        parsedEmbed.protocol = 'https:';
        embedTargetUrl = parsedEmbed.toString().slice(0, 500);
      }
    } catch {
      // Fallback to normalizedSc
    }
  }

  let artworkUrl: string | undefined;
  if (typeof obj.artworkUrl === 'string' && obj.artworkUrl.trim() && obj.artworkUrl.trim().length <= 500) {
    try {
      const parsedArt = new URL(obj.artworkUrl.trim());
      if (
        parsedArt.protocol === 'https:' &&
        !parsedArt.username &&
        !parsedArt.password &&
        isAllowedSoundCloudArtworkHost(parsedArt.hostname)
      ) {
        artworkUrl = parsedArt.toString();
      }
    } catch {
      // Ignore invalid artwork URL
    }
  }

  const rawId = typeof obj.id === 'string' ? obj.id.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128) : '';
  const id = rawId || `poem_sc_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;

  return {
    id,
    title: rawTitle,
    artist: rawArtist,
    soundcloudUrl: normalizedSc,
    embedTargetUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
  };
}

export function sanitizePoemSoundCloudTracks(
  rawTracks: unknown,
  rawFallbackSingle?: unknown
): PoemSoundCloudTrack[] {
  const result: PoemSoundCloudTrack[] = [];
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();

  const pushCandidate = (item: unknown) => {
    if (result.length >= 10) return;
    const clean = sanitizePoemSoundCloudTrack(item);
    if (!clean) return;
    const urlKey = clean.soundcloudUrl.toLowerCase();
    if (seenUrls.has(urlKey)) return;
    let uniqueId = clean.id;
    if (seenIds.has(uniqueId)) {
      uniqueId = `${clean.id}_${result.length}`;
    }
    seenUrls.add(urlKey);
    seenIds.add(uniqueId);
    result.push({ ...clean, id: uniqueId });
  };

  if (Array.isArray(rawTracks)) {
    for (const item of rawTracks) {
      pushCandidate(item);
    }
  } else if (rawFallbackSingle !== undefined && rawFallbackSingle !== null) {
    pushCandidate(rawFallbackSingle);
  }

  return result;
}

const SOUNDCLOUD_BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

let cachedSoundCloudClientId: string | null = null;
let cachedSoundCloudClientIdAt = 0;
const SOUNDCLOUD_CLIENT_ID_TTL_MS = 6 * 60 * 60 * 1000;

export function isSoundCloudPlaylistUrl(canonicalUrl: string): boolean {
  try {
    const parsed = new URL(canonicalUrl);
    return /^\/[^/]+\/sets\/[^/]+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

export function normalizeSoundCloudPlaylistPageUrl(canonicalUrl: string): string {
  try {
    const parsed = new URL(canonicalUrl);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return canonicalUrl;
  }
}

export function upgradeSoundCloudArtworkUrl(rawUrl: unknown): string | undefined {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) return undefined;
  try {
    const parsed = new URL(rawUrl.trim());
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      !isAllowedSoundCloudArtworkHost(parsed.hostname)
    ) {
      return undefined;
    }
    const upgraded = parsed.toString().replace(/-large\.(jpg|jpeg|png|webp)(\?.*)?$/i, '-t500x500.$1$2');
    return upgraded.slice(0, 500);
  } catch {
    return undefined;
  }
}

function extractSoundCloudHydrationArray(html: string): Array<{ hydratable?: string; data?: unknown }> {
  const match = html.match(/window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/);
  if (!match?.[1]) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function getSoundCloudClientId(forceRefresh = false, htmlHint?: string): Promise<string | null> {
  if (
    !forceRefresh &&
    cachedSoundCloudClientId &&
    Date.now() - cachedSoundCloudClientIdAt < SOUNDCLOUD_CLIENT_ID_TTL_MS
  ) {
    return cachedSoundCloudClientId;
  }

  let html = htmlHint || '';
  if (!html) {
    try {
      const homeRes = await fetch('https://soundcloud.com/', {
        headers: SOUNDCLOUD_BROWSER_HEADERS,
        signal: AbortSignal.timeout(8000),
      });
      if (homeRes.ok) {
        html = await homeRes.text();
      }
    } catch {
      return cachedSoundCloudClientId;
    }
  }

  const scriptUrls = Array.from(
    new Set(
      Array.from(html.matchAll(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"'\s<>]+\.js/g)).map((m) => m[0])
    )
  );

  for (const scriptUrl of scriptUrls.slice(-5).reverse()) {
    try {
      const jsRes = await fetch(scriptUrl, {
        headers: { 'User-Agent': SOUNDCLOUD_BROWSER_HEADERS['User-Agent'] },
        signal: AbortSignal.timeout(7000),
      });
      if (!jsRes.ok) continue;
      const js = await jsRes.text();
      const cidMatch =
        js.match(/client_id\s*:\s*['"]([a-zA-Z0-9]{20,40})['"]/) ||
        js.match(/client_id=([a-zA-Z0-9]{20,40})/);
      if (cidMatch?.[1]) {
        cachedSoundCloudClientId = cidMatch[1];
        cachedSoundCloudClientIdAt = Date.now();
        return cachedSoundCloudClientId;
      }
    } catch {
      // Try next script bundle
    }
  }

  return cachedSoundCloudClientId;
}

interface SoundCloudApiTrackShape {
  id?: unknown;
  title?: unknown;
  permalink_url?: unknown;
  uri?: unknown;
  secret_token?: unknown;
  artwork_url?: unknown;
  user?: { username?: unknown; avatar_url?: unknown } | null;
  publisher_metadata?: { artist?: unknown } | null;
}

function buildRadioTrackFromApiTrack(
  raw: SoundCloudApiTrackShape,
  station: RadioStationId
): RadioTrack | null {
  const numericId =
    typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0 ? raw.id : null;
  const permalink =
    typeof raw.permalink_url === 'string' && normalizeSoundCloudInputUrl(raw.permalink_url)
      ? normalizeSoundCloudInputUrl(raw.permalink_url)!
      : null;

  const fallbackApiUrl = numericId ? `https://api.soundcloud.com/tracks/${numericId}` : null;
  const soundcloudUrl = permalink || fallbackApiUrl;
  if (!soundcloudUrl) return null;

  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
  if (!rawTitle) return null;

  const secretToken =
    typeof raw.secret_token === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(raw.secret_token.trim())
      ? raw.secret_token.trim()
      : null;

  let embedTargetUrl = fallbackApiUrl || soundcloudUrl;
  if (typeof raw.uri === 'string' && /^https:\/\/api\.soundcloud\.com\/tracks\/\d+/.test(raw.uri.trim())) {
    embedTargetUrl = raw.uri.trim();
  }
  if (secretToken && embedTargetUrl.startsWith('https://api.soundcloud.com/') && !embedTargetUrl.includes('secret_token=')) {
    embedTargetUrl = `${embedTargetUrl}?secret_token=${encodeURIComponent(secretToken)}`;
  }

  const rawArtist =
    (typeof raw.user?.username === 'string' && raw.user.username.trim()) ||
    (typeof raw.publisher_metadata?.artist === 'string' && raw.publisher_metadata.artist.trim()) ||
    'SoundCloud';

  const artworkUrl =
    upgradeSoundCloudArtworkUrl(raw.artwork_url) || upgradeSoundCloudArtworkUrl(raw.user?.avatar_url);

  return {
    id: `radio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    title: rawTitle.slice(0, 200),
    artist: rawArtist.slice(0, 140),
    soundcloudUrl,
    embedTargetUrl,
    ...(artworkUrl ? { artworkUrl } : {}),
    station,
    addedAt: new Date().toISOString(),
  };
}

export async function resolveSoundCloudPlaylistTracks(
  rawPlaylistUrl: string,
  station: RadioStationId = 'indie',
  maxTracks = 100
): Promise<
  | {
      ok: true;
      playlistTitle: string;
      soundcloudUrl: string;
      tracks: RadioTrack[];
      totalFound: number;
    }
  | { ok: false; error: string }
> {
  const normalized = normalizeSoundCloudInputUrl(rawPlaylistUrl);
  if (!normalized) {
    return {
      ok: false,
      error: 'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/sets/playlist).',
    };
  }

  const resolvedShort = await resolveSoundCloudShortUrl(normalized);
  const canonicalUrl = normalizeSoundCloudPlaylistPageUrl(resolvedShort);

  let html = '';
  try {
    const pageRes = await fetch(canonicalUrl, {
      headers: SOUNDCLOUD_BROWSER_HEADERS,
      signal: AbortSignal.timeout(10000),
    });
    if (pageRes.ok) {
      html = await pageRes.text();
    }
  } catch {
    // Fallback to resolve endpoint below
  }

  const hydration = html ? extractSoundCloudHydrationArray(html) : [];
  let playlistObj = hydration.find((item) => item.hydratable === 'playlist')?.data as
    | { title?: unknown; tracks?: SoundCloudApiTrackShape[] }
    | undefined;

  let clientId = await getSoundCloudClientId(false, html);

  if (!playlistObj || !Array.isArray(playlistObj.tracks) || playlistObj.tracks.length === 0) {
    if (clientId) {
      const fetchResolve = async (cid: string) =>
        fetch(`https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(canonicalUrl)}&client_id=${encodeURIComponent(cid)}`, {
          headers: { 'User-Agent': SOUNDCLOUD_BROWSER_HEADERS['User-Agent'], Accept: 'application/json' },
          signal: AbortSignal.timeout(9000),
        });
      try {
        let resolveRes = await fetchResolve(clientId);
        if (resolveRes.status === 401 || resolveRes.status === 403) {
          const refreshed = await getSoundCloudClientId(true, html);
          if (refreshed) {
            clientId = refreshed;
            resolveRes = await fetchResolve(refreshed);
          }
        }
        if (resolveRes.ok) {
          const resolvedJson = (await resolveRes.json()) as {
            kind?: unknown;
            title?: unknown;
            tracks?: SoundCloudApiTrackShape[];
          };
          if (resolvedJson.kind === 'playlist' && Array.isArray(resolvedJson.tracks)) {
            playlistObj = resolvedJson;
          }
        }
      } catch {
        // Handle below
      }
    }
  }

  if (!playlistObj || !Array.isArray(playlistObj.tracks) || playlistObj.tracks.length === 0) {
    return {
      ok: false,
      error:
        'Не вдалося витягти треки з цього плейлиста SoundCloud. Перевірте, що посилання веде на відкритий плейлист (/sets/...).',
    };
  }

  const playlistTitle =
    typeof playlistObj.title === 'string' && playlistObj.title.trim()
      ? playlistObj.title.trim().slice(0, 160)
      : 'Плейлист SoundCloud';

  const rawEntries = playlistObj.tracks.slice(0, Math.max(1, maxTracks));
  const stubIds: number[] = [];
  for (const entry of rawEntries) {
    const idNum = typeof entry?.id === 'number' && Number.isInteger(entry.id) ? entry.id : null;
    const hasMeta =
      typeof entry?.title === 'string' &&
      entry.title.trim().length > 0 &&
      typeof entry?.permalink_url === 'string' &&
      entry.permalink_url.trim().length > 0;
    if (!hasMeta && idNum && idNum > 0) {
      stubIds.push(idNum);
    }
  }

  const hydratedById = new Map<number, SoundCloudApiTrackShape>();
  if (stubIds.length > 0) {
    if (!clientId) {
      clientId = await getSoundCloudClientId(true, html);
    }
    if (clientId) {
      for (let i = 0; i < stubIds.length; i += 50) {
        const chunk = stubIds.slice(i, i + 50);
        const fetchBatch = async (cid: string) =>
          fetch(
            `https://api-v2.soundcloud.com/tracks?ids=${chunk.join(',')}&client_id=${encodeURIComponent(cid)}`,
            {
              headers: { 'User-Agent': SOUNDCLOUD_BROWSER_HEADERS['User-Agent'], Accept: 'application/json' },
              signal: AbortSignal.timeout(9000),
            }
          );
        try {
          let batchRes = await fetchBatch(clientId);
          if (batchRes.status === 401 || batchRes.status === 403) {
            const refreshed = await getSoundCloudClientId(true, html);
            if (refreshed) {
              clientId = refreshed;
              batchRes = await fetchBatch(refreshed);
            }
          }
          if (batchRes.ok) {
            const items = (await batchRes.json()) as SoundCloudApiTrackShape[];
            if (Array.isArray(items)) {
              for (const item of items) {
                if (typeof item?.id === 'number') {
                  hydratedById.set(item.id, item);
                }
              }
            }
          }
        } catch {
          // Fallback per-track below if needed
        }
      }
    }
  }

  const tracks: RadioTrack[] = [];
  const seenUrls = new Set<string>();

  for (const entry of rawEntries) {
    const idNum = typeof entry?.id === 'number' && Number.isInteger(entry.id) ? entry.id : null;
    const merged: SoundCloudApiTrackShape =
      idNum && hydratedById.has(idNum)
        ? { ...entry, ...hydratedById.get(idNum) }
        : entry;

    let built = buildRadioTrackFromApiTrack(merged, station);

    if (!built && idNum) {
      const apiTrackUrl = `https://api.soundcloud.com/tracks/${idNum}`;
      try {
        const oeRes = await fetch(
          `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(apiTrackUrl)}`,
          { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) }
        );
        if (oeRes.ok) {
          const oe = (await oeRes.json()) as {
            title?: unknown;
            author_name?: unknown;
            thumbnail_url?: unknown;
          };
          const artist =
            typeof oe.author_name === 'string' && oe.author_name.trim()
              ? oe.author_name.trim().slice(0, 140)
              : 'SoundCloud';
          let title = typeof oe.title === 'string' ? oe.title.trim() : '';
          const suffix = ` by ${artist}`;
          if (title.length > suffix.length && title.toLowerCase().endsWith(suffix.toLowerCase())) {
            title = title.slice(0, title.length - suffix.length).trim();
          }
          if (title) {
            const artworkUrl = upgradeSoundCloudArtworkUrl(oe.thumbnail_url);
            built = {
              id: `radio_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
              title: title.slice(0, 200),
              artist,
              soundcloudUrl: apiTrackUrl,
              embedTargetUrl: apiTrackUrl,
              ...(artworkUrl ? { artworkUrl } : {}),
              station,
              addedAt: new Date().toISOString(),
            };
          }
        }
      } catch {
        // Skip inaccessible private track
      }
    }

    if (!built) continue;
    const dedupKey = built.soundcloudUrl.toLowerCase();
    if (seenUrls.has(dedupKey)) continue;
    seenUrls.add(dedupKey);
    tracks.push(built);
  }

  if (tracks.length === 0) {
    return {
      ok: false,
      error: 'У цьому плейлисті не знайдено жодного доступного для відтворення треку.',
    };
  }

  return {
    ok: true,
    playlistTitle,
    soundcloudUrl: canonicalUrl,
    tracks,
    totalFound: playlistObj.tracks.length,
  };
}

export async function resolvePoemSoundCloudTracksInput(body: {
  url?: unknown;
  urls?: unknown;
}): Promise<{ ok: true; tracks: PoemSoundCloudTrack[] } | { ok: false; error: string }> {
  const candidateInputs: string[] = [];

  if (typeof body.url === 'string' && body.url.trim()) {
    for (const part of body.url.split(/[\r\n]+/)) {
      const clean = part.trim();
      if (clean) candidateInputs.push(clean);
    }
  }
  if (Array.isArray(body.urls)) {
    for (const item of body.urls) {
      if (typeof item === 'string' && item.trim()) {
        candidateInputs.push(item.trim());
      }
    }
  }

  const uniqueInputs = Array.from(new Set(candidateInputs)).slice(0, 10);
  if (uniqueInputs.length === 0) {
    return { ok: false, error: 'Вставте посилання на пісню у SoundCloud.' };
  }

  const canonicalInputs: string[] = [];
  for (const rawUrl of uniqueInputs) {
    const normalized = normalizeSoundCloudInputUrl(rawUrl);
    if (!normalized) {
      return {
        ok: false,
        error:
          'Дозволені лише коректні посилання SoundCloud (наприклад, https://soundcloud.com/artist/track або /sets/playlist).',
      };
    }
    canonicalInputs.push(await resolveSoundCloudShortUrl(normalized));
  }

  const resolvedQueue: Array<{
    title: string;
    artist: string;
    soundcloudUrl: string;
    embedTargetUrl?: string;
    artworkUrl?: string;
  }> = [];
  const singleUrls: string[] = [];

  for (const canonical of canonicalInputs) {
    if (isSoundCloudPlaylistUrl(canonical)) {
      const remaining = Math.max(1, 10 - resolvedQueue.length);
      const playlistRes = await resolveSoundCloudPlaylistTracks(canonical, 'indie', remaining);
      if (!playlistRes.ok) {
        return { ok: false, error: playlistRes.error };
      }
      resolvedQueue.push(...playlistRes.tracks);
    } else {
      singleUrls.push(canonical);
    }
  }

  for (let i = 0; i < singleUrls.length; i += 6) {
    const batch = singleUrls.slice(i, i + 6);
    const batchResults = await Promise.all(
      batch.map((trackUrl) => resolveSoundCloudTrackMetadata(trackUrl, 'indie'))
    );
    for (const result of batchResults) {
      if (!result.ok) {
        return { ok: false, error: result.error };
      }
      resolvedQueue.push(result.track);
    }
  }

  const tracks: PoemSoundCloudTrack[] = [];
  const seenUrls = new Set<string>();
  const nowBase = Date.now();
  for (const resolved of resolvedQueue) {
    const key = resolved.soundcloudUrl.toLowerCase();
    if (seenUrls.has(key)) continue;
    seenUrls.add(key);
    if (tracks.length >= 10) break;
    tracks.push({
      id: `poem_sc_${nowBase}_${tracks.length}_${crypto.randomBytes(3).toString('hex')}`,
      title: resolved.title,
      artist: resolved.artist,
      soundcloudUrl: resolved.soundcloudUrl,
      embedTargetUrl: resolved.embedTargetUrl || resolved.soundcloudUrl,
      ...(resolved.artworkUrl ? { artworkUrl: resolved.artworkUrl } : {}),
    });
  }

  if (tracks.length === 0) {
    return { ok: false, error: 'Не вдалося знайти треки за цим посиланням.' };
  }

  return { ok: true, tracks };
}

export function enrichRadioTrackForPublic(
  track: RadioTrack,
  isAuthorized: boolean,
  db?: SiteDatabase,
  guestAccount?: GuestAccountRecord | null,
  repertoireBucket?: RadioRepertoireBucket | null
): RadioTrack {
  const normalizedStation: RadioStationId =
    track.station === 'electronic' ? 'electronic' : 'indie';
  const likesCount = db ? computeRadioTrackLikesCount(track.id, db) : (track.likesCount ?? 0);
  const isLiked = Boolean(
    isAuthorized &&
      guestAccount &&
      Array.isArray(guestAccount.likedRadioTrackIds) &&
      guestAccount.likedRadioTrackIds.includes(track.id)
  );
  const resolvedBucket = repertoireBucket ?? track.repertoireBucket ?? null;
  const resolvedInRepertoire =
    repertoireBucket !== undefined
      ? repertoireBucket !== null
      : track.inRepertoire ?? true;

  if (isAuthorized) {
    return {
      ...track,
      station: normalizedStation,
      embedTargetUrl: track.embedTargetUrl || track.soundcloudUrl,
      likesCount,
      isLiked,
      inRepertoire: resolvedInRepertoire,
      repertoireBucket: resolvedBucket,
    };
  }
  const { embedTargetUrl: _hiddenEmbed, ...publicTrack } = track;
  return {
    ...publicTrack,
    station: normalizedStation,
    likesCount,
    isLiked: false,
    inRepertoire: resolvedInRepertoire,
    repertoireBucket: resolvedBucket,
  };
}

export function buildRadioTracksWithRepertoire(
  db: SiteDatabase,
  isAuthorized: boolean,
  guestAccount?: GuestAccountRecord | null
): RadioTrack[] {
  const baseEnriched = db.radioTracks.map((track) =>
    enrichRadioTrackForPublic(track, isAuthorized, db, guestAccount)
  );
  const indieRep = selectRadioStationRepertoire(baseEnriched, 'indie');
  const electronicRep = selectRadioStationRepertoire(baseEnriched, 'electronic');
  return baseEnriched.map((track) => {
    const rep = track.station === 'electronic' ? electronicRep : indieRep;
    const bucket = rep.bucketById.get(track.id) ?? null;
    return {
      ...track,
      inRepertoire: bucket !== null,
      repertoireBucket: bucket,
    };
  });
}

async function isUploadUrlAvailable(url: string): Promise<boolean> {
  if (!url.startsWith('/uploads/')) return true;
  const rawName = url.slice('/uploads/'.length).split('?')[0];
  const safeName = path.basename(rawName);
  if (!safeName || safeName !== rawName || safeName.includes('..')) {
    return false;
  }
  const localPath = resolveConfinedFilePath(UPLOADS_DIR, safeName);
  if (localPath && fs.existsSync(localPath)) {
    return true;
  }
  const cachedMissingAt = missingUploadCache.get(safeName);
  if (cachedMissingAt && Date.now() - cachedMissingAt < MISSING_UPLOAD_TTL_MS) {
    return false;
  }
  try {
    const asset = await loadMediaAssetFromFirestore(safeName);
    if (asset) {
      if (localPath) {
        try {
          fs.writeFileSync(localPath, asset.buffer);
        } catch {
          // Ignore disk cache write failure
        }
      }
      missingUploadCache.delete(safeName);
      return true;
    }
  } catch {
    // Fall through to missing cache
  }
  missingUploadCache.set(safeName, Date.now());
  return false;
}

function listAvailableLocalUploadPhotos(): string[] {
  try {
    return fs
      .readdirSync(UPLOADS_DIR)
      .filter((name) => /\.(jpg|jpeg|png|webp|gif)$/i.test(name))
      .sort()
      .slice(0, 20)
      .map((name) => `/uploads/${name}`);
  } catch {
    return [];
  }
}

export async function ensureAvailableAuthorPhotos(db: SiteDatabase): Promise<void> {
  const candidates = Array.isArray(db.authorPhotos) && db.authorPhotos.length > 0
    ? db.authorPhotos
    : db.authorPhotoUrl
      ? [db.authorPhotoUrl]
      : [];
  const checks = await Promise.all(
    candidates.map(async (url) => ({ url, ok: await isUploadUrlAvailable(url) }))
  );
  const available = checks.filter((item) => item.ok).map((item) => item.url);

  let resolved: string[];
  if (available.length > 0) {
    resolved = available;
  } else {
    const localUploads = listAvailableLocalUploadPhotos();
    resolved = localUploads.length > 0 ? localUploads : [DEFAULT_AUTHOR_PHOTO_URL];
  }

  const changed =
    resolved.length !== db.authorPhotos.length ||
    resolved.some((url, idx) => db.authorPhotos[idx] !== url) ||
    db.authorPhotoUrl !== resolved[0];

  if (changed) {
    db.authorPhotos = resolved;
    db.authorPhotoUrl = resolved[0];
    saveDatabase(db, { bumpCatalogRevision: true, slices: ['meta'] });
  }
}

export function registerCatalogRoutes(app: express.Express): void {
  const uploadsLimiter = createEndpointRateLimiter(
    'erl:uploads',
    20,
    10 * 60 * 1000,
    'Забагато завантажень фото. Зачекайте кілька хвилин.'
  );
  const reviewsPostLimiter = createEndpointRateLimiter(
    'erl:reviews-post',
    25,
    10 * 60 * 1000,
    'Забагато відгуків поспіль. Спробуйте через кілька хвилин.'
  );
  const feedbackPostLimiter = createEndpointRateLimiter(
    'erl:feedback-post',
    15,
    10 * 60 * 1000,
    'Забагато звернень поспіль. Спробуйте через кілька хвилин.'
  );

  // Lightweight homepage shell endpoint for instant first paint (public & CDN cacheable)
  app.get('/api/home', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    await ensureAvailableAuthorPhotos(db);

    const etag = `W/"home-${getCatalogRevision()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeActionAboutTitle: db.homeActionAboutTitle || 'Про мене',
      homeActionContactTitle:
        db.homeActionContactTitle &&
        db.homeActionContactTitle !== 'Зв’язатися з автором' &&
        db.homeActionContactTitle !== "Зв'язатися з автором"
          ? db.homeActionContactTitle
          : 'Зв’язок',
      homeActionMonobankTitle: db.homeActionMonobankTitle || 'Підтримати через Монобанк',
      homeActionInterviewsTitle: db.homeActionInterviewsTitle || 'Розмови',
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      proseAuthDiscountPercent: db.proseAuthDiscountPercent ?? 0,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Public catalog (titles & short excerpts for poems/blog; full text loaded on open via /:id/read)
  app.get('/api/catalog', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    await ensureAvailableAuthorPhotos(db);
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const isAuthorized = Boolean(optionalAuth);
    if (optionalAuth?.provider === 'google' && !cloudSyncState.radioHydrated) {
      const bearerToken = extractBearerToken(req);
      if (bearerToken) {
        const radioChanged = await hydrateAuthorizedProseAndRadio(db, bearerToken);
        if (radioChanged) saveDatabase(db, { slices: ['prose', 'radio'] });
      }
    }

    const weeklyRollover = ensureWeeklyWinnersUpToDate(db);
    if (weeklyRollover.changed) {
      saveDatabase(db, { slices: ['poems', 'prose'] });
    }

    res.setHeader('Vary', 'Authorization, Cookie');
    const rev = getCatalogRevision();
    const etag = optionalAuth
      ? `W/"cat-${rev}-${optionalAuth.account.uid}"`
      : `W/"cat-pub-${rev}"`;
    res.setHeader('ETag', etag);
    res.setHeader(
      'Cache-Control',
      optionalAuth
        ? 'private, max-age=0, must-revalidate'
        : 'public, max-age=60, stale-while-revalidate=300'
    );
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }

    const effectiveIpHash = optionalAuth ? getClientIpHash(req) : '';
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);

    res.json({
      heroLeadText: db.heroLeadText,
      authorAboutText: db.authorAboutText,
      authorPhotoUrl: db.authorPhotoUrl,
      authorPhotos: db.authorPhotos,
      socialLinks: db.socialLinks,
      monobankJarUrl: db.monobankJarUrl,
      monobankAcquiringEnabled: Boolean(getMonobankToken()),
      monobankModalTitle: db.monobankModalTitle || DEFAULT_MONOBANK_MODAL_TITLE,
      monobankModalSubtitle: db.monobankModalSubtitle ?? DEFAULT_MONOBANK_MODAL_SUBTITLE,
      monobankCardLabel: db.monobankCardLabel ?? DEFAULT_MONOBANK_CARD_LABEL,
      monobankModalText: db.monobankModalText || DEFAULT_MONOBANK_MODAL_TEXT,
      monobankEmptyText: db.monobankEmptyText ?? DEFAULT_MONOBANK_EMPTY_TEXT,
      contactEmail: db.contactEmail,
      interviews: db.interviews,
      homeActionAboutTitle: db.homeActionAboutTitle || 'Про мене',
      homeActionContactTitle:
        db.homeActionContactTitle &&
        db.homeActionContactTitle !== 'Зв’язатися з автором' &&
        db.homeActionContactTitle !== "Зв'язатися з автором"
          ? db.homeActionContactTitle
          : 'Зв’язок',
      homeActionMonobankTitle: db.homeActionMonobankTitle || 'Підтримати через Монобанк',
      homeActionInterviewsTitle: db.homeActionInterviewsTitle || 'Розмови',
      homeRepeaters: normalizeHomeRepeatersConfig(db.homeRepeaters),
      proseAuthDiscountPercent: db.proseAuthDiscountPercent ?? 0,
      proseTelegramDiscountPercent: db.proseTelegramDiscountPercent ?? 50,
      storeAuthDiscountPercent: 0,
      poems: db.poems.map((poem) =>
        truncatePoemForCatalog(
          enrichPoem(poem, db, effectiveIpHash, optionalAuth?.account, badgeLookup, photoLookup)
        )
      ),
      prose: db.prose.map((work) =>
        enrichProseForPublic(work, db, effectiveIpHash, isAuthorized, false, badgeLookup, optionalAuth?.account, photoLookup)
      ),
      proseTags: db.proseTags,
      blog: db.blog.map((post) => truncateBlogForCatalog(enrichBlogPost(post, db))),
      products: db.products.map((product) =>
        enrichProductForPublic(product, db, effectiveIpHash, badgeLookup, photoLookup, optionalAuth?.account)
      ),
      radioTracks: buildRadioTracksWithRepertoire(db, isAuthorized, optionalAuth?.account),
      monthlySelections: [...(db.monthlySelections || [])].sort((a, b) =>
        a.monthKey !== b.monthKey ? b.monthKey.localeCompare(a.monthKey) : a.order - b.order
      ),
      weeklyMusicSelections: [...(db.weeklyMusicSelections || [])].sort((a, b) =>
        b.periodStart !== a.periodStart
          ? b.periodStart.localeCompare(a.periodStart)
          : b.createdAt.localeCompare(a.createdAt)
      ),
      weeklyPoems: [...(db.weeklyPoems || [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
      weeklyProse: [...(db.weeklyProse || [])].sort((a, b) => b.periodStart.localeCompare(a.periodStart)),
      weeklyCurrentPeriod: getWeekPeriodForDate(),
      recentFeedback: buildRecentFeedback(db, 20, badgeLookup, photoLookup),
      uniqueVisitors: db.visitorIpHashes.length,
    });
  });

  // Full text lazy-loader for truncated poems in catalog
  app.get('/api/poems/:id/read', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }
    const etag = `W/"poem-${poem.id}-${getCatalogRevision()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ id: poem.id, content: poem.content });
  });

  // Full text lazy-loader for truncated blog posts in catalog
  app.get('/api/blog/:id/read', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const post = db.blog.find((b) => b.id === id);
    if (!post) {
      res.status(404).json({ error: 'Допис не знайдено.' });
      return;
    }
    const etag = `W/"blog-${post.id}-${getCatalogRevision()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    res.json({ id: post.id, content: post.content });
  });

  // Public monthly SoundCloud music selections endpoint
  app.get('/api/selections', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const etag = `W/"sel-${getCatalogRevision()}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
    if (req.headers['if-none-match'] === etag) {
      res.status(304).end();
      return;
    }
    const sorted = [...(db.monthlySelections || [])].sort((a, b) =>
      a.monthKey !== b.monthKey ? b.monthKey.localeCompare(a.monthKey) : a.order - b.order
    );
    res.json({ monthlySelections: sorted });
  });

  // Radio playlist endpoint: public metadata cacheable without auth; full playback URLs only for signed-in users
  app.get('/api/radio', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    if (!cloudSyncState.publicHydrated) {
      const hydrated = await hydratePublicCatalogFromFirestore(db);
      if (hydrated) {
        saveDatabase(db, { slices: ['meta', 'poems', 'prose', 'blog', 'products', 'radio'] });
      }
    }
    res.setHeader('Vary', 'Authorization, Cookie');
    const bearer = extractBearerToken(req);
    if (!bearer) {
      const etag = `W/"radio-pub-${getCatalogRevision()}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=120, stale-while-revalidate=600');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.json({
        tracks: buildRadioTracksWithRepertoire(db, false, null),
      });
      return;
    }

    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }
    if (authResult.provider === 'google' && !cloudSyncState.radioHydrated) {
      const changed = await hydrateAuthorizedProseAndRadio(db, bearer);
      if (changed) saveDatabase(db, { slices: ['prose', 'radio'] });
    }
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.json({
      tracks: buildRadioTracksWithRepertoire(db, true, authResult.account),
    });
  });

  const radioWaveformServerCache = new Map<string, number[]>();

  // Authorized-only SoundCloud track waveform samples for live frequency equalizer
  app.get('/api/radio/waveform/:trackId', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const trackId = String(req.params.trackId || '').trim();
    if (!trackId) {
      res.status(400).json({ error: 'Не вказано трек.' });
      return;
    }

    const cached = radioWaveformServerCache.get(trackId);
    if (cached) {
      res.json({ samples: cached });
      return;
    }

    const track = db.radioTracks.find((t) => t.id === trackId);
    if (!track?.soundcloudUrl) {
      res.status(404).json({ error: 'Трек не знайдено.' });
      return;
    }

    const normalizedUrl = normalizeSoundCloudInputUrl(track.soundcloudUrl);
    if (!normalizedUrl) {
      res.status(400).json({ error: 'Недійсне посилання SoundCloud.' });
      return;
    }

    try {
      const pageRes = await fetch(normalizedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RadioEqualizer/1.0)',
          Accept: 'text/html',
        },
        signal: AbortSignal.timeout(7000),
      });
      if (!pageRes.ok) {
        res.status(200).json({ samples: [] });
        return;
      }
      const html = await pageRes.text();
      const waveMatch = html.match(/https:\/\/wave\.sndcdn\.com\/[a-zA-Z0-9_-]+\.(?:json|png)/i);
      if (!waveMatch?.[0]) {
        res.status(200).json({ samples: [] });
        return;
      }
      const waveJsonUrl = waveMatch[0].replace(/\.png$/i, '.json');
      const waveRes = await fetch(waveJsonUrl, { signal: AbortSignal.timeout(6000) });
      if (!waveRes.ok) {
        res.status(200).json({ samples: [] });
        return;
      }
      const waveData = (await waveRes.json()) as { height?: number; samples?: unknown };
      if (!Array.isArray(waveData.samples) || waveData.samples.length === 0) {
        res.status(200).json({ samples: [] });
        return;
      }
      const maxHeight = typeof waveData.height === 'number' && waveData.height > 0 ? waveData.height : 140;
      const samples = waveData.samples.map((v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return Math.min(1, Math.max(0, Number((n / maxHeight).toFixed(4))));
      });
      radioWaveformServerCache.set(trackId, samples);
      res.json({ samples });
    } catch {
      res.status(200).json({ samples: [] });
    }
  });

  // Toggle like on a radio track for authenticated users
  app.post('/api/radio/tracks/:id/like', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`radio-like:${ipHash}`, 80, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато дій за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const trackId = String(req.params.id || '').trim().slice(0, 128);
    if (!trackId) {
      res.status(400).json({ error: 'Не вказано трек.' });
      return;
    }

    const currentLikes = Array.isArray(auth.account.likedRadioTrackIds)
      ? auth.account.likedRadioTrackIds
      : [];
    const alreadyLiked = currentLikes.includes(trackId);
    const nextLikes = alreadyLiked
      ? currentLikes.filter((tid) => tid !== trackId)
      : [trackId, ...currentLikes];

    auth.account.likedRadioTrackIds = nextLikes;
    auth.account.likedUpdatedAt = new Date().toISOString();
    auth.account.updatedAt = auth.account.likedUpdatedAt;
    saveDatabase(db, { flushDelayMs: 1500, slices: ['community'] });

    if (auth.firebaseClaims && auth.firebaseIdToken) {
      recordCloudRadioLikeState(trackId, auth.firebaseClaims.uid, !alreadyLiked);
      void syncGuestLikesToFirestore(
        {
          firebaseUid: auth.firebaseClaims.uid,
          email: auth.account.email,
          displayName: auth.account.displayName,
          likedPoemIds: Array.isArray(auth.account.likedPoemIds) ? auth.account.likedPoemIds : [],
          likedRadioTrackIds: nextLikes,
          photoUrl: auth.account.photoUrl,
          guestUid: auth.account.uid,
          totalTimeSeconds: auth.account.totalTimeSeconds,
          purchasesCount: auth.account.purchasesCount,
          donorChatText: auth.account.donorChatText,
        },
        auth.firebaseIdToken
      );
      void syncRadioLikeEntryToFirestore(
        {
          trackId,
          firebaseUid: auth.firebaseClaims.uid,
          liked: !alreadyLiked,
        },
        auth.firebaseIdToken
      );
    }

    const existingTrack = db.radioTracks.find((t) => t.id === trackId);
    const likesCount = computeRadioTrackLikesCount(trackId, db);
    res.json({
      liked: !alreadyLiked,
      likedRadioTrackIds: nextLikes,
      likesCount,
      track: existingTrack
        ? enrichRadioTrackForPublic(existingTrack, true, db, auth.account)
        : null,
    });
  });

  // Track/refresh unique visitor count and detailed session visit
  app.post('/api/visitors/track', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const ipHash = getClientIpHash(req);
    let isNewVisitor = false;

    if (!visitorIpSet.has(ipHash)) {
      visitorIpSet.add(ipHash);
      db.visitorIpHashes.push(ipHash);
      isNewVisitor = true;
    }

    const body = (req.body && typeof req.body === 'object' ? req.body : {}) as {
      sessionId?: unknown;
      entrySection?: unknown;
      referrer?: unknown;
    };

    const visitRecorded = recordSiteVisit(db, req, ipHash, {
      sessionId: typeof body.sessionId === 'string' ? body.sessionId : undefined,
      entrySection: typeof body.entrySection === 'string' ? body.entrySection : undefined,
      referrer: typeof body.referrer === 'string' ? body.referrer : undefined,
      isNewVisitor,
      source: 'client',
    });

    if (isNewVisitor || visitRecorded) {
      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['community', 'analytics'] });
    }

    res.json({
      uniqueVisitors: db.visitorIpHashes.length,
      isNewVisitor,
    });
  });

  // View counters for Poems and Blog posts
  app.post('/api/poems/:id/view', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }
    db.poemViews[id] = (db.poemViews[id] || 0) + 1;
    saveDatabase(db, { bumpCatalogRevision: true, flushDelayMs: 2500, slices: ['poems'] });
    res.json({ id, viewsCount: db.poemViews[id] });
  });

  app.post('/api/blog/:id/view', (req: Request, res: Response) => {
    const db = ensureDatabase();
    const { id } = req.params;
    const post = db.blog.find((b) => b.id === id);
    if (!post) {
      res.status(404).json({ error: 'Допис не знайдено.' });
      return;
    }
    db.blogViews[id] = (db.blogViews[id] || 0) + 1;
    saveDatabase(db, { bumpCatalogRevision: true, flushDelayMs: 2500, slices: ['blog'] });
    res.json({ id, viewsCount: db.blogViews[id] });
  });

  // Track user behavior telemetry (clicks, dwell duration, exit moments)
  app.post(
    '/api/analytics/event',
    express.text({ type: 'text/plain', limit: '256kb' }),
    (req: Request, res: Response) => {
      let body = req.body as unknown;
      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          res.status(400).json({ error: 'Invalid payload' });
          return;
        }
      }
      if (!body || typeof body !== 'object') {
        res.status(400).json({ error: 'Invalid payload' });
        return;
      }

      const { sessionId, events } = body as {
        sessionId?: string;
        events?: Array<{
          type?: string;
          targetKey?: string;
          label?: string;
          category?: string;
          section?: string;
          durationSeconds?: number;
        }>;
      };

      const cleanSessionId =
        typeof sessionId === 'string' ? sessionId.trim().slice(0, 64) : 'anonymous';
      if (!Array.isArray(events) || events.length === 0) {
        res.status(200).json({ ok: true });
        return;
      }

      const db = ensureDatabase();
      const analytics = db.analytics || createEmptyAnalytics();
      db.analytics = analytics;
      const nowIso = new Date().toISOString();

      if (cleanSessionId && !seenAnalyticsSessionsSet.has(cleanSessionId)) {
        seenAnalyticsSessionsSet.add(cleanSessionId);
        analytics.seenSessionIds.push(cleanSessionId);
        if (analytics.seenSessionIds.length > 2000) {
          analytics.seenSessionIds = analytics.seenSessionIds.slice(-1500);
          seenAnalyticsSessionsSet.clear();
          for (const sid of analytics.seenSessionIds) {
            seenAnalyticsSessionsSet.add(sid);
          }
        }
        analytics.totalSessions += 1;
      }

      for (const rawEv of events.slice(0, 20)) {
        if (!rawEv || typeof rawEv !== 'object') continue;
        const evType = rawEv.type;
        const targetKey =
          typeof rawEv.targetKey === 'string' ? rawEv.targetKey.trim().slice(0, 120) : '';
        const label =
          typeof rawEv.label === 'string' ? rawEv.label.trim().slice(0, 140) : targetKey;
        if (!targetKey || !label) continue;

        if (evType === 'click') {
          const validCategories: AnalyticsClickCategory[] = ['section', 'content', 'store', 'action'];
          const category: AnalyticsClickCategory = validCategories.includes(
            rawEv.category as AnalyticsClickCategory
          )
            ? (rawEv.category as AnalyticsClickCategory)
            : 'action';
          const prev = analytics.clicksByTarget[targetKey];
          analytics.clicksByTarget[targetKey] = {
            targetKey,
            label,
            category,
            clicks: (prev?.clicks || 0) + 1,
            lastClickedAt: nowIso,
          };
          analytics.totalClicks += 1;
          analytics.recentEvents.unshift({
            id: `ev_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
            sessionId: cleanSessionId,
            type: 'click',
            targetKey,
            label,
            createdAt: nowIso,
          });
        } else if (evType === 'dwell') {
          const sec = Math.max(0, Math.min(14400, Math.round(Number(rawEv.durationSeconds) || 0)));
          if (sec < 2) continue;
          const validDwellCategories: AnalyticsDwellCategory[] = [
            'section',
            'poem',
            'prose',
            'blog',
            'product',
          ];
          const category: AnalyticsDwellCategory = validDwellCategories.includes(
            rawEv.category as AnalyticsDwellCategory
          )
            ? (rawEv.category as AnalyticsDwellCategory)
            : 'section';
          const prev = analytics.dwellByTarget[targetKey];
          analytics.dwellByTarget[targetKey] = {
            targetKey,
            label,
            category,
            totalSeconds: (prev?.totalSeconds || 0) + sec,
            sessionsCount: (prev?.sessionsCount || 0) + 1,
            maxSeconds: Math.max(prev?.maxSeconds || 0, sec),
            lastActiveAt: nowIso,
          };
          analytics.totalTrackedSeconds += sec;
          analytics.recentEvents.unshift({
            id: `ev_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
            sessionId: cleanSessionId,
            type: 'dwell',
            targetKey,
            label,
            durationSeconds: sec,
            createdAt: nowIso,
          });
        } else if (evType === 'exit') {
          const sessionSec = Math.max(
            1,
            Math.min(28800, Math.round(Number(rawEv.durationSeconds) || 1))
          );
          const section =
            typeof rawEv.section === 'string' ? rawEv.section.trim().slice(0, 40) : 'home';
          const prev = analytics.exitsByMoment[targetKey];
          const nextExits = (prev?.exits || 0) + 1;
          const nextTotalSessionSec = (prev?.totalSessionSeconds || 0) + sessionSec;
          analytics.exitsByMoment[targetKey] = {
            momentKey: targetKey,
            label,
            section,
            exits: nextExits,
            totalSessionSeconds: nextTotalSessionSec,
            avgSessionSeconds: Math.round(nextTotalSessionSec / nextExits),
            lastExitAt: nowIso,
          };
          analytics.recentEvents.unshift({
            id: `ev_${Date.now().toString(36)}_${crypto.randomBytes(2).toString('hex')}`,
            sessionId: cleanSessionId,
            type: 'exit',
            targetKey,
            label,
            durationSeconds: sessionSec,
            createdAt: nowIso,
          });
        }
      }

      if (analytics.recentEvents.length > 40) {
        analytics.recentEvents = analytics.recentEvents.slice(0, 40);
      }

      saveDatabase(db, { bumpCatalogRevision: false, flushDelayMs: 5000, slices: ['analytics'] });
      res.status(200).json({ ok: true });
    }
  );

  // Public Top-10 User Leaderboard (publicly cacheable for anonymous users with stale-while-revalidate)
  app.get('/api/leaderboard', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    res.setHeader('Vary', 'Authorization, Cookie');

    if (!optionalAuth) {
      const etag = `W/"lb-pub-${getCatalogRevision()}"`;
      res.setHeader('ETag', etag);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
      if (req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
    } else {
      res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    }

    const seniority: LeaderboardSeniorityEntry[] = [...db.guestAccounts]
      .filter((acc) => typeof acc.createdAt === 'string' && acc.displayName)
      .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0))
      .slice(0, 10)
      .map((acc, idx) => ({
        rank: idx + 1,
        uid: acc.uid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        createdAt: acc.createdAt,
      }));

    const time: LeaderboardTimeEntry[] = [...db.guestAccounts]
      .filter((acc) => Math.round(Number(acc.totalTimeSeconds) || 0) > 0)
      .sort((a, b) => {
        const diff = Math.round(Number(b.totalTimeSeconds) || 0) - Math.round(Number(a.totalTimeSeconds) || 0);
        if (diff !== 0) return diff;
        return (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0);
      })
      .slice(0, 10)
      .map((acc, idx) => ({
        rank: idx + 1,
        uid: acc.uid,
        displayName: acc.displayName,
        photoUrl: acc.photoUrl,
        totalTimeSeconds: Math.round(Number(acc.totalTimeSeconds) || 0),
        lastSeenAt: acc.lastSeenAt,
      }));

    const { activityRanked, donorsRanked, lookup: badgeLookup } = computeLeaderboardRankings(db);

    const activity: LeaderboardActivityEntry[] = activityRanked.map(
      ({ googleUid: _gUid, ...entry }) => {
        const badges = badgeLookup.get(entry.uid, entry.displayName);
        return {
          ...entry,
          ...(badges ? { badges } : {}),
        };
      }
    );

    const donors: LeaderboardDonorEntry[] = donorsRanked.map(
      ({ googleUid: _gUid, ...entry }) => {
        const badges = badgeLookup.get(entry.guestUid, entry.displayName);
        return {
          ...entry,
          ...(badges ? { badges } : {}),
        };
      }
    );

    const currentUserBadges = optionalAuth
      ? badgeLookup.get(optionalAuth.account.uid, optionalAuth.account.displayName)
      : undefined;

    const payload: UserLeaderboardResponse = {
      seniority,
      time,
      activity,
      donors,
      totalRegisteredUsers: db.guestAccounts.length,
      currentUserUid: optionalAuth?.account.uid ?? null,
      ...(currentUserBadges ? { currentUserBadges } : {}),
      generatedAt: new Date().toISOString(),
    };

    res.json(payload);
  });

  // Toggle poem favorite / like ("Вподобайка") for authenticated users
  app.post('/api/poems/:id/like', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит із стороннього джерела заблоковано.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`poem-like:${ipHash}`, 80, 5 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато дій за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { id } = req.params;
    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }

    const currentLikes = Array.isArray(auth.account.likedPoemIds) ? auth.account.likedPoemIds : [];
    const alreadyLiked = currentLikes.includes(id);
    const nextLikes = alreadyLiked
      ? currentLikes.filter((pid) => pid !== id)
      : [id, ...currentLikes];

    const nowIso = new Date().toISOString();
    auth.account.likedPoemIds = nextLikes;
    auth.account.likedUpdatedAt = nowIso;
    auth.account.updatedAt = nowIso;
    saveDatabase(db, { flushDelayMs: 1500, slices: ['community'] });

    let cloudSynced = false;
    if (auth.firebaseClaims && auth.firebaseIdToken) {
      const fbUid = auth.firebaseClaims.uid;
      recordCloudPoemLikeState(id, fbUid, !alreadyLiked);
      const [syncedUsersDoc, syncedLikeEntry] = await Promise.all([
        syncGuestLikesToFirestore(
          {
            firebaseUid: fbUid,
            email: auth.account.email,
            displayName: auth.account.displayName,
            likedPoemIds: nextLikes,
            likedRadioTrackIds: auth.account.likedRadioTrackIds,
            photoUrl: auth.account.photoUrl,
            guestUid: auth.account.uid,
            totalTimeSeconds: auth.account.totalTimeSeconds,
            purchasesCount: auth.account.purchasesCount,
            donorChatText: auth.account.donorChatText,
          },
          auth.firebaseIdToken
        ),
        syncPoemLikeEntryToFirestore(
          {
            poemId: id,
            firebaseUid: fbUid,
            liked: !alreadyLiked,
          },
          auth.firebaseIdToken
        ),
      ]);
      if (syncedUsersDoc) {
        hydratedGuestLikesUids.add(fbUid);
      } else {
        hydratedGuestLikesUids.delete(fbUid);
      }
      cloudSynced = syncedUsersDoc || syncedLikeEntry;
      if (!syncedUsersDoc && !syncedLikeEntry) {
        console.warn('[PoemLike] Failed to persist like change to Firestore for uid:', fbUid);
      }
    } else if (auth.account.googleUid) {
      recordCloudPoemLikeState(id, auth.account.googleUid, !alreadyLiked);
      hydratedGuestLikesUids.delete(auth.account.googleUid);
    }

    res.json({
      liked: !alreadyLiked,
      likedPoemIds: nextLikes,
      cloudSynced,
      poem: enrichPoem(poem, db, ipHash, auth.account),
    });
  });

  // Rate a poem (0.1 to 5.0), strictly once per unique user/IP
  app.post('/api/poems/:id/rate', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const { rating } = req.body as { rating?: number };
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const poem = db.poems.find((p) => p.id === id);
    if (!poem) {
      res.status(404).json({ error: 'Вірш не знайдено.' });
      return;
    }

    const numericRating = parseDecimalRating(rating);
    if (numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    if (!db.poemVotes[id]) {
      db.poemVotes[id] = {};
    }

    const { primaryKey, lookupKeys } = getEffectiveVoteKeys(ipHash, optionalAuth?.account);
    const existingVote = findUserRatingInVotes(db.poemVotes[id], lookupKeys);
    if (existingVote !== null) {
      const enriched = enrichPoem(poem, db, ipHash, optionalAuth?.account);
      res.status(409).json({
        error: 'Ви вже оцінили цей вірш.',
        alreadyRated: true,
        poem: enriched,
      });
      return;
    }

    db.poemVotes[id][primaryKey] = numericRating;
    recordWeeklyVoteLog(db, {
      targetType: 'poem',
      targetId: id,
      voterKey: primaryKey,
      rating: numericRating,
    });
    recordRecentRating(db, {
      targetType: 'poem',
      targetId: id,
      rating: numericRating,
      authorUid: optionalAuth?.firebaseClaims?.uid || optionalAuth?.account.googleUid || optionalAuth?.account.uid,
      authorName: optionalAuth?.account.displayName,
      authorPhotoUrl: optionalAuth?.account.photoUrl,
    });
    saveDatabase(db, { flushDelayMs: 1500, slices: ['poems', 'products'] });

    if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
      await syncWorkVoteToFirestore(
        {
          targetType: 'poem',
          targetId: id,
          firebaseUid: optionalAuth.firebaseClaims.uid,
          rating: numericRating,
        },
        optionalAuth.firebaseIdToken
      );
    }

    const enriched = enrichPoem(poem, db, ipHash, optionalAuth?.account);
    res.json({ poem: enriched });
  });

  // Upload a photo for a reader's submitted poem (authenticated users)
  app.post('/api/poems/upload-image', uploadsLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { dataUrl } = req.body as { dataUrl?: unknown };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Файл зображення не передано.' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Підтримуються лише зображення PNG, JPG, WEBP або GIF.' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Розмір зображення не повинен перевищувати 6 МБ.' });
      return;
    }

    let processedBuffer = buffer;
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
    } catch {
      processedBuffer = buffer;
    }

    const filename = `poem-sub-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processedBuffer);
    missingUploadCache.delete(filename);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      try {
        cloudSynced = await saveMediaAssetToFirestore(filename, 'image/jpeg', processedBuffer, auth.firebaseIdToken);
      } catch {
        cloudSynced = false;
      }
    }

    res.status(201).json({ url: `/uploads/${filename}`, cloudSynced });
  });

  // Resolve one or multiple SoundCloud tracks for attaching to a reader's poem submission
  app.post('/api/poems/resolve-soundcloud', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`poem-sc-resolve:${ipHash}`, 30, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато запитів. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body as { url?: unknown; urls?: unknown };
    const resolved = await resolvePoemSoundCloudTracksInput(body);
    if (!resolved.ok) {
      res.status(400).json({ error: resolved.error });
      return;
    }
    res.json({ track: resolved.tracks[0], tracks: resolved.tracks });
  });

  // SSRF-protected pinned-IP image proxy for extracting color palette from external poem image URLs
  app.get('/api/poems/image-proxy', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const rawUrl = typeof req.query.url === 'string' ? req.query.url.trim() : '';
    if (!rawUrl) {
      res.status(400).json({ error: 'Потрібен параметр url.' });
      return;
    }

    let currentValid = await validateExternalImageUrlForProxy(rawUrl);
    if (!currentValid) {
      res.status(400).json({ error: 'Недозволений або небезпечний URL зображення.' });
      return;
    }

    try {
      let response: { status: number; headers: Map<string, string>; buffer: Buffer } | null = null;
      for (let hop = 0; hop < 4; hop += 1) {
        const resHop = await fetchPinnedImageUrl(currentValid.url, currentValid.pinIp, 5 * 1024 * 1024);
        if (!resHop) {
          res.status(502).json({ error: 'Не вдалося завантажити зовнішнє зображення.' });
          return;
        }
        if (resHop.status >= 300 && resHop.status < 400) {
          const location = resHop.headers.get('location');
          if (!location) {
            res.status(400).json({ error: 'Не вдалося обробити перенаправлення зображення.' });
            return;
          }
          const nextTarget = new URL(location, currentValid.url).toString();
          const validatedNext = await validateExternalImageUrlForProxy(nextTarget);
          if (!validatedNext) {
            res.status(400).json({ error: 'Перенаправлення веде на недозволену адресу.' });
            return;
          }
          currentValid = validatedNext;
          continue;
        }
        response = resHop;
        break;
      }

      if (!response || response.status < 200 || response.status >= 300) {
        res.status(502).json({ error: 'Не вдалося завантажити зовнішнє зображення.' });
        return;
      }

      const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
      const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);
      if (!allowedImageTypes.has(contentType)) {
        res.status(400).json({ error: 'Дозволені лише зображення форматів PNG, JPEG, WEBP або GIF.' });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src 'self' data:;");
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(response.buffer);
    } catch {
      res.status(502).json({ error: 'Не вдалося обробити зовнішнє зображення.' });
    }
  });

  // Get current authenticated user's submitted poems & moderation statuses
  app.get('/api/poems/my-submissions', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken) {
      const hydrated = await hydrateUserPoemSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) {
        saveDatabase(db, { slices: ['poems'] });
      }
    }

    const items = (db.poemSubmissions || [])
      .filter(
        (sub) =>
          (fbUid && sub.authorUid === fbUid) ||
          sub.authorUid === auth.account.uid ||
          sub.guestUid === auth.account.uid
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    res.json({ submissions: items });
  });

  // Propose/submit a reader's own poem
  app.post('/api/poems/submissions', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`poem-submit:${ipHash}`, 10, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато поданих віршів за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body as {
      title?: unknown;
      cycle?: unknown;
      content?: unknown;
      note?: unknown;
      authorName?: unknown;
      workStatus?: unknown;
      fontSize?: unknown;
      textAlign?: unknown;
      lineSpacing?: unknown;
      textColor?: unknown;
      backgroundColor?: unknown;
      imageUrl?: unknown;
      imagePalette?: unknown;
      soundcloudTrack?: unknown;
      soundcloudTracks?: unknown;
    };

    const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (!cleanTitle || cleanTitle.length > 200) {
      res.status(400).json({ error: 'Назва вірша має містити від 1 до 200 символів.' });
      return;
    }

    const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
    if (!cleanContent || cleanContent.length > 50000) {
      res.status(400).json({ error: 'Текст вірша має містити від 1 до 50 000 символів.' });
      return;
    }

    const cleanCycle = typeof body.cycle === 'string' ? body.cycle.trim().slice(0, 160) : '';
    const cleanNote = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    const cleanWorkStatus: ProseStatus = body.workStatus === 'in_progress' ? 'in_progress' : 'completed';
    const cleanAuthorName = (
      (typeof body.authorName === 'string' && body.authorName.trim()) ||
      auth.account.displayName ||
      'Читач'
    )
      .trim()
      .slice(0, 80);

    let cleanImageUrl: string | undefined;
    if (body.imageUrl !== undefined && body.imageUrl !== null && body.imageUrl !== '') {
      cleanImageUrl = sanitizePoemImageUrl(body.imageUrl);
      if (!cleanImageUrl) {
        res.status(400).json({ error: 'Некоректне посилання на фото для вірша.' });
        return;
      }
    }

    const cleanImagePalette =
      cleanImageUrl && body.imagePalette ? sanitizePoemImagePalette(body.imagePalette) : undefined;

    let cleanSoundCloudTracks: PoemSoundCloudTrack[] = [];
    if (body.soundcloudTracks !== undefined && body.soundcloudTracks !== null) {
      if (!Array.isArray(body.soundcloudTracks)) {
        res.status(400).json({ error: 'Некоректний список SoundCloud-треків.' });
        return;
      }
      cleanSoundCloudTracks = sanitizePoemSoundCloudTracks(body.soundcloudTracks);
      if (body.soundcloudTracks.length > 0 && cleanSoundCloudTracks.length === 0) {
        res.status(400).json({ error: 'Некоректні дані SoundCloud-треків.' });
        return;
      }
    } else if (body.soundcloudTrack !== undefined && body.soundcloudTrack !== null) {
      const single = sanitizePoemSoundCloudTrack(body.soundcloudTrack);
      if (!single) {
        res.status(400).json({ error: 'Некоректні дані SoundCloud-треку.' });
        return;
      }
      cleanSoundCloudTracks = [single];
    }

    const validFontSize = ['sm', 'base', 'lg', 'xl', '2xl'].includes(String(body.fontSize))
      ? (body.fontSize as PoemSubmissionRecord['fontSize'])
      : undefined;
    const validTextAlign = ['left', 'center', 'right'].includes(String(body.textAlign))
      ? (body.textAlign as PoemSubmissionRecord['textAlign'])
      : undefined;
    const validLineSpacing = ['tight', 'normal', 'relaxed', 'loose'].includes(String(body.lineSpacing))
      ? (body.lineSpacing as PoemSubmissionRecord['lineSpacing'])
      : undefined;
    const validTextColor =
      typeof body.textColor === 'string' && body.textColor.trim()
        ? body.textColor.trim().slice(0, 32)
        : undefined;
    const validBackgroundColor =
      typeof body.backgroundColor === 'string' && body.backgroundColor.trim()
        ? body.backgroundColor.trim().slice(0, 32)
        : undefined;

    const nowIso = new Date().toISOString();
    const authorUid = auth.firebaseClaims?.uid || auth.account.googleUid || auth.account.uid;

    const submission: PoemSubmissionRecord = {
      id: `psub_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      authorUid,
      guestUid: auth.account.uid,
      authorName: cleanAuthorName,
      ...(auth.account.photoUrl ? { authorPhotoUrl: auth.account.photoUrl } : {}),
      title: cleanTitle,
      cycle: cleanCycle,
      year: new Date().getFullYear() || 2026,
      content: cleanContent,
      ...(cleanNote ? { note: cleanNote } : {}),
      ...(validFontSize ? { fontSize: validFontSize } : {}),
      ...(validTextAlign ? { textAlign: validTextAlign } : {}),
      ...(validLineSpacing ? { lineSpacing: validLineSpacing } : {}),
      ...(validTextColor ? { textColor: validTextColor } : {}),
      ...(validBackgroundColor ? { backgroundColor: validBackgroundColor } : {}),
      ...(cleanImageUrl ? { imageUrl: cleanImageUrl } : {}),
      ...(cleanImagePalette ? { imagePalette: cleanImagePalette } : {}),
      ...(cleanSoundCloudTracks.length > 0
        ? {
            soundcloudTrack: cleanSoundCloudTracks[0],
            soundcloudTracks: cleanSoundCloudTracks,
          }
        : {}),
      status: 'pending',
      workStatus: cleanWorkStatus,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!Array.isArray(db.poemSubmissions)) {
      db.poemSubmissions = [];
    }
    db.poemSubmissions.unshift(submission);
    saveDatabase(db, { slices: ['poems'] });

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncPoemSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.status(201).json({ submission, cloudSynced });
  });

  // Update/edit user's own poem submission from cabinet
  app.put('/api/poems/submissions/:id', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { id } = req.params;
    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken && !(db.poemSubmissions || []).some((s) => s.id === id)) {
      const hydrated = await hydrateUserPoemSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) saveDatabase(db, { slices: ['poems'] });
    }

    const submission = (db.poemSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const isOwner =
      (fbUid && submission.authorUid === fbUid) ||
      submission.authorUid === auth.account.uid ||
      submission.guestUid === auth.account.uid;
    if (!isOwner) {
      res.status(403).json({ error: 'Ви можете редагувати лише власні твори.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (body.title !== undefined) {
      const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!cleanTitle || cleanTitle.length > 200) {
        res.status(400).json({ error: 'Назва вірша має містити від 1 до 200 символів.' });
        return;
      }
      submission.title = cleanTitle;
    }
    if (body.cycle !== undefined) {
      submission.cycle = typeof body.cycle === 'string' ? body.cycle.trim().slice(0, 160) : '';
    }
    if (body.content !== undefined) {
      const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanContent || cleanContent.length > 50000) {
        res.status(400).json({ error: 'Текст вірша має містити від 1 до 50 000 символів.' });
        return;
      }
      submission.content = cleanContent;
    }
    if (body.note !== undefined) {
      submission.note =
        typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 1000) : undefined;
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }

    submission.status = 'pending';
    submission.moderationNote = undefined;
    submission.updatedAt = new Date().toISOString();

    const beforePoems = db.poems.length;
    db.poems = db.poems.filter(
      (p) => p.submissionId !== submission.id && (!submission.publishedPoemId || p.id !== submission.publishedPoemId)
    );
    const unpublishedLive = db.poems.length !== beforePoems;

    saveDatabase(db, { slices: ['poems'] });

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncPoemSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.json({ submission, unpublishedLive, cloudSynced });
  });

  // Upload an optional moodboard/cover photo for a reader's submitted prose work
  app.post('/api/prose/upload-image', uploadsLimiter, async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { dataUrl } = req.body as { dataUrl?: unknown };
    if (!dataUrl || typeof dataUrl !== 'string') {
      res.status(400).json({ error: 'Файл зображення не передано.' });
      return;
    }

    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/i);
    if (!match) {
      res.status(400).json({ error: 'Підтримуються лише зображення PNG, JPG, WEBP або GIF.' });
      return;
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0 || buffer.byteLength > 6 * 1024 * 1024) {
      res.status(400).json({ error: 'Розмір зображення не повинен перевищувати 6 МБ.' });
      return;
    }

    let processedBuffer = buffer;
    try {
      processedBuffer = await sharp(buffer)
        .resize({ width: 1600, withoutEnlargement: true })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();
    } catch {
      processedBuffer = buffer;
    }

    const filename = `prose-sub-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.jpg`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), processedBuffer);
    missingUploadCache.delete(filename);

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      try {
        cloudSynced = await saveMediaAssetToFirestore(filename, 'image/jpeg', processedBuffer, auth.firebaseIdToken);
      } catch {
        cloudSynced = false;
      }
    }

    res.status(201).json({ url: `/uploads/${filename}`, cloudSynced });
  });

  // Get current authenticated user's submitted prose works & moderation statuses
  app.get('/api/prose/my-submissions', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken) {
      const hydrated = await hydrateUserProseSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) {
        saveDatabase(db, { slices: ['prose'] });
      }
    }

    const items = (db.proseSubmissions || [])
      .filter(
        (sub) =>
          (fbUid && sub.authorUid === fbUid) ||
          sub.authorUid === auth.account.uid ||
          sub.guestUid === auth.account.uid
      )
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    res.json({ submissions: items });
  });

  // Propose/submit a reader's own prose work
  app.post('/api/prose/submissions', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }
    const ipHash = getClientIpHash(req);
    const rate = checkRateLimit(`prose-submit:${ipHash}`, 10, 10 * 60 * 1000);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfterSec));
      res.status(429).json({ error: 'Забагато поданих творів за короткий час. Зачекайте трохи.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const body = req.body as {
      title?: unknown;
      genre?: unknown;
      slogan?: unknown;
      excerpt?: unknown;
      content?: unknown;
      authorName?: unknown;
      workStatus?: unknown;
      moodboardUrls?: unknown;
    };

    const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
    if (!cleanTitle || cleanTitle.length > 240) {
      res.status(400).json({ error: 'Назва твору має містити від 1 до 240 символів.' });
      return;
    }

    const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
    if (!cleanContent || cleanContent.length > 250000) {
      res.status(400).json({ error: 'Текст твору має містити від 1 до 250 000 символів.' });
      return;
    }

    const cleanGenre =
      typeof body.genre === 'string' && body.genre.trim()
        ? body.genre.trim().slice(0, 120)
        : 'Оповідання';
    const cleanSlogan =
      typeof body.slogan === 'string' && body.slogan.trim()
        ? body.slogan.trim().slice(0, 500)
        : undefined;
    const rawExcerpt =
      typeof body.excerpt === 'string' && body.excerpt.trim()
        ? body.excerpt.trim().slice(0, 2000)
        : '';
    const cleanExcerpt =
      rawExcerpt || getFirstFormattedExcerptLine(cleanContent, 240);
    const cleanWorkStatus: ProseStatus = body.workStatus === 'in_progress' ? 'in_progress' : 'completed';
    const cleanAuthorName = (
      (typeof body.authorName === 'string' && body.authorName.trim()) ||
      auth.account.displayName ||
      'Читач'
    )
      .trim()
      .slice(0, 80);

    let cleanMoodboardUrls: string[] | undefined;
    if (Array.isArray(body.moodboardUrls)) {
      const normalized = Array.from(
        new Set(
          body.moodboardUrls
            .map((item) => sanitizePoemImageUrl(item))
            .filter((item): item is string => Boolean(item))
        )
      ).slice(0, 8);
      if (normalized.length > 0) {
        cleanMoodboardUrls = normalized;
      }
    }

    const computedPages = computeProseWorkPages({ content: cleanContent, fallbackPages: 1 });
    const computedWords = countProseWords(cleanContent);
    const nowIso = new Date().toISOString();
    const authorUid = auth.firebaseClaims?.uid || auth.account.googleUid || auth.account.uid;

    const submission: ProseSubmissionRecord = {
      id: `prsub_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      authorUid,
      guestUid: auth.account.uid,
      authorName: cleanAuthorName,
      ...(auth.account.photoUrl ? { authorPhotoUrl: auth.account.photoUrl } : {}),
      title: cleanTitle,
      genre: cleanGenre,
      ...(cleanSlogan ? { slogan: cleanSlogan } : {}),
      ...(cleanExcerpt ? { excerpt: cleanExcerpt } : {}),
      content: cleanContent,
      pages: computedPages,
      totalWords: computedWords,
      ...(cleanMoodboardUrls ? { moodboardUrls: cleanMoodboardUrls } : {}),
      status: 'pending',
      workStatus: cleanWorkStatus,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    if (!Array.isArray(db.proseSubmissions)) {
      db.proseSubmissions = [];
    }
    db.proseSubmissions.unshift(submission);
    saveDatabase(db, { slices: ['prose'] });

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncProseSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.status(201).json({ submission, cloudSynced });
  });

  // Update/edit user's own prose submission from cabinet
  app.put('/api/prose/submissions/:id', async (req: Request, res: Response) => {
    if (!verifySameOrigin(req)) {
      res.status(403).json({ error: 'Запит з іншого домену відхилено.' });
      return;
    }

    const db = ensureDatabase();
    const auth = await authenticateGuestRequest(req, db);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { id } = req.params;
    const fbUid = auth.firebaseClaims?.uid || auth.account.googleUid || '';
    if (fbUid && auth.firebaseIdToken && !(db.proseSubmissions || []).some((s) => s.id === id)) {
      const hydrated = await hydrateUserProseSubmissionsFromFirestore(db, fbUid, auth.firebaseIdToken);
      if (hydrated) saveDatabase(db, { slices: ['prose'] });
    }

    const submission = (db.proseSubmissions || []).find((s) => s.id === id);
    if (!submission) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const isOwner =
      (fbUid && submission.authorUid === fbUid) ||
      submission.authorUid === auth.account.uid ||
      submission.guestUid === auth.account.uid;
    if (!isOwner) {
      res.status(403).json({ error: 'Ви можете редагувати лише власні твори.' });
      return;
    }

    const body = (req.body || {}) as Record<string, unknown>;
    if (body.title !== undefined) {
      const cleanTitle = typeof body.title === 'string' ? body.title.trim() : '';
      if (!cleanTitle || cleanTitle.length > 240) {
        res.status(400).json({ error: 'Назва твору має містити від 1 до 240 символів.' });
        return;
      }
      submission.title = cleanTitle;
    }
    if (body.genre !== undefined) {
      submission.genre =
        typeof body.genre === 'string' && body.genre.trim()
          ? body.genre.trim().slice(0, 120)
          : 'Оповідання';
    }
    if (body.slogan !== undefined) {
      submission.slogan =
        typeof body.slogan === 'string' && body.slogan.trim()
          ? body.slogan.trim().slice(0, 500)
          : undefined;
    }
    if (body.excerpt !== undefined) {
      submission.excerpt =
        typeof body.excerpt === 'string' && body.excerpt.trim()
          ? body.excerpt.trim().slice(0, 2000)
          : undefined;
    }
    if (body.content !== undefined) {
      const cleanContent = typeof body.content === 'string' ? preserveFormattedText(body.content) : '';
      if (!cleanContent || cleanContent.length > 250000) {
        res.status(400).json({ error: 'Текст твору має містити від 1 до 250 000 символів.' });
        return;
      }
      submission.content = cleanContent;
      submission.pages = computeProseWorkPages({ content: cleanContent, fallbackPages: 1 });
      submission.totalWords = countProseWords(cleanContent);
      if (!submission.excerpt) {
        submission.excerpt = getFirstFormattedExcerptLine(cleanContent, 240) || undefined;
      }
    }
    if (body.workStatus === 'completed' || body.workStatus === 'in_progress') {
      submission.workStatus = body.workStatus;
    }

    submission.status = 'pending';
    submission.moderationNote = undefined;
    submission.updatedAt = new Date().toISOString();

    const beforeProse = db.prose.length;
    db.prose = db.prose.filter(
      (w) => w.submissionId !== submission.id && (!submission.publishedProseId || w.id !== submission.publishedProseId)
    );
    const unpublishedLive = db.prose.length !== beforeProse;

    saveDatabase(db, { slices: ['prose'] });

    let cloudSynced = false;
    if (auth.firebaseIdToken) {
      cloudSynced = await syncProseSubmissionToFirestore(submission, auth.firebaseIdToken);
    }

    res.json({ submission, unpublishedLive, cloudSynced });
  });

  // Rate a prose work (0.1 to 5.0), strictly once per unique user/IP
  app.post('/api/prose/:id/rate', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const { id } = req.params;
    const { rating } = req.body as { rating?: number };
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);

    const work = db.prose.find((p) => p.id === id);
    if (!work) {
      res.status(404).json({ error: 'Твір не знайдено.' });
      return;
    }

    const numericRating = parseDecimalRating(rating);
    if (numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    if (!db.proseVotes[id]) {
      db.proseVotes[id] = {};
    }

    const { primaryKey, lookupKeys } = getEffectiveVoteKeys(ipHash, optionalAuth?.account);
    const existingVote = findUserRatingInVotes(db.proseVotes[id], lookupKeys);
    if (existingVote !== null) {
      const enriched = enrichProseForPublic(work, db, ipHash, Boolean(optionalAuth), false, undefined, optionalAuth?.account);
      res.status(409).json({
        error: 'Ви вже оцінили цей твір.',
        alreadyRated: true,
        prose: enriched,
      });
      return;
    }

    db.proseVotes[id][primaryKey] = numericRating;
    recordWeeklyVoteLog(db, {
      targetType: 'prose',
      targetId: id,
      voterKey: primaryKey,
      rating: numericRating,
    });
    recordRecentRating(db, {
      targetType: 'prose',
      targetId: id,
      rating: numericRating,
      authorUid: optionalAuth?.firebaseClaims?.uid || optionalAuth?.account.googleUid || optionalAuth?.account.uid,
      authorName: optionalAuth?.account.displayName,
      authorPhotoUrl: optionalAuth?.account.photoUrl,
    });
    saveDatabase(db, { flushDelayMs: 1500, slices: ['prose', 'poems', 'products'] });

    if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
      await syncWorkVoteToFirestore(
        {
          targetType: 'prose',
          targetId: id,
          firebaseUid: optionalAuth.firebaseClaims.uid,
          rating: numericRating,
        },
        optionalAuth.firebaseIdToken
      );
    }

    const enriched = enrichProseForPublic(work, db, ipHash, Boolean(optionalAuth), false, undefined, optionalAuth?.account);
    res.json({ prose: enriched });
  });

  // Submit guest review + optional rating (0.1..5.0) for Poem, Prose, or Book/Product
  app.post('/api/reviews', reviewsPostLimiter, async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { targetType, targetId, rating, comment, authorUid, authorName, authorPhotoUrl } = req.body as {
      targetType?: 'poem' | 'prose' | 'product';
      targetId?: string;
      rating?: number | null;
      comment?: string;
      authorUid?: string;
      authorName?: string;
      authorPhotoUrl?: string;
    };

    if ((targetType !== 'poem' && targetType !== 'prose' && targetType !== 'product') || !targetId) {
      res.status(400).json({ error: 'Некоректний об’єкт відгуку.' });
      return;
    }

    const ipHash = getClientIpHash(req);
    const cleanName = (optionalAuth?.account.displayName || authorName?.trim() || 'Гість').slice(0, 80);
    const cleanUid = (
      optionalAuth?.firebaseClaims?.uid ||
      optionalAuth?.account.googleUid ||
      optionalAuth?.account.uid ||
      authorUid?.trim() ||
      `guest_anon_${ipHash.slice(0, 12)}`
    ).slice(0, 128);
    const clientPhoto = typeof authorPhotoUrl === 'string' ? authorPhotoUrl.trim() : '';
    const resolvedPhotoUrl =
      optionalAuth?.account.photoUrl ||
      (clientPhoto && /^https?:\/\//i.test(clientPhoto) ? clientPhoto : undefined);
    const cleanComment = comment?.trim() || '';
    const hasComment = cleanComment.length > 0;
    const hasRatingInput = rating !== undefined && rating !== null;
    const numericRating = hasRatingInput ? parseDecimalRating(rating) : null;

    if (hasRatingInput && numericRating === null) {
      res.status(400).json({ error: 'Оцінка має бути від 0.1 до 5.0.' });
      return;
    }
    if (!hasRatingInput && !hasComment) {
      res.status(400).json({ error: 'Оберіть оцінку або напишіть коментар.' });
      return;
    }
    if (cleanComment.length > 1500) {
      res.status(400).json({ error: 'Текст відгуку не повинен перевищувати 1500 символів.' });
      return;
    }

    const { primaryKey: votePrimaryKey, lookupKeys: voteLookupKeys } = getEffectiveVoteKeys(
      ipHash,
      optionalAuth?.account
    );

    if (targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === targetId);
      if (!poem) {
        res.status(404).json({ error: 'Вірш не знайдено.' });
        return;
      }

      if (!db.poemVotes[targetId]) db.poemVotes[targetId] = {};
      const existingVote = findUserRatingInVotes(db.poemVotes[targetId], voteLookupKeys);
      const alreadyRatedIp = existingVote !== null;
      if (numericRating !== null && !alreadyRatedIp) {
        db.poemVotes[targetId][votePrimaryKey] = numericRating;
        recordWeeklyVoteLog(db, {
          targetType: 'poem',
          targetId,
          voterKey: votePrimaryKey,
          rating: numericRating,
        });
      }

      const finalVoteRating =
        numericRating !== null
          ? alreadyRatedIp
            ? existingVote
            : numericRating
          : null;

      let review: ReviewItem | null = null;
      if (hasComment) {
        review = {
          id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          targetType: 'poem',
          targetId,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
          rating: finalVoteRating,
          comment: cleanComment,
          createdAt: new Date().toISOString(),
        };
        db.reviews.unshift(review);
      } else if (numericRating !== null && !alreadyRatedIp) {
        recordRecentRating(db, {
          targetType: 'poem',
          targetId,
          rating: numericRating,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
        });
      }

      if ((numericRating !== null && !alreadyRatedIp) || hasComment) {
        saveDatabase(db, { flushDelayMs: 1500, slices: ['poems', 'products'] });
      }

      if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
        const fbUid = optionalAuth.firebaseClaims.uid;
        const fbToken = optionalAuth.firebaseIdToken;
        const cloudTasks: Promise<unknown>[] = [];
        if (numericRating !== null && !alreadyRatedIp) {
          cloudTasks.push(
            syncWorkVoteToFirestore(
              { targetType: 'poem', targetId, firebaseUid: fbUid, rating: numericRating },
              fbToken
            )
          );
        }
        if (review) {
          cloudTasks.push(
            syncReviewToFirestore(
              {
                id: review.id,
                targetType: 'poem',
                targetId,
                firebaseUid: fbUid,
                authorName: review.authorName,
                authorPhotoUrl: review.authorPhotoUrl,
                rating: review.rating,
                comment: review.comment,
              },
              fbToken
            )
          );
        }
        if (cloudTasks.length > 0) {
          await Promise.allSettled(cloudTasks);
        }
      }

      const badgeLookup = createBadgeLookup(db);
      const photoLookup = createAccountPhotoLookup(db);
      res.status(201).json({
        review: review ? enrichReviewWithBadges(review, badgeLookup, photoLookup) : null,
        ratingOnly: !hasComment,
        commentOnly: numericRating === null,
        alreadyRatedIp: numericRating !== null && alreadyRatedIp,
        appliedRating: finalVoteRating,
        poem: enrichPoem(poem, db, ipHash, optionalAuth?.account, badgeLookup, photoLookup),
      });
      return;
    }

    if (targetType === 'prose') {
      const work = db.prose.find((p) => p.id === targetId);
      if (!work) {
        res.status(404).json({ error: 'Прозовий твір не знайдено.' });
        return;
      }

      if (!db.proseVotes[targetId]) db.proseVotes[targetId] = {};
      const existingVote = findUserRatingInVotes(db.proseVotes[targetId], voteLookupKeys);
      const alreadyRatedIp = existingVote !== null;
      if (numericRating !== null && !alreadyRatedIp) {
        db.proseVotes[targetId][votePrimaryKey] = numericRating;
        recordWeeklyVoteLog(db, {
          targetType: 'prose',
          targetId,
          voterKey: votePrimaryKey,
          rating: numericRating,
        });
      }

      const finalVoteRating =
        numericRating !== null
          ? alreadyRatedIp
            ? existingVote
            : numericRating
          : null;

      let review: ReviewItem | null = null;
      if (hasComment) {
        review = {
          id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
          targetType: 'prose',
          targetId,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
          rating: finalVoteRating,
          comment: cleanComment,
          createdAt: new Date().toISOString(),
        };
        db.reviews.unshift(review);
      } else if (numericRating !== null && !alreadyRatedIp) {
        recordRecentRating(db, {
          targetType: 'prose',
          targetId,
          rating: numericRating,
          authorUid: cleanUid,
          authorName: cleanName,
          authorPhotoUrl: resolvedPhotoUrl,
        });
      }

      if ((numericRating !== null && !alreadyRatedIp) || hasComment) {
        saveDatabase(db, { flushDelayMs: 1500, slices: ['prose', 'poems', 'products'] });
      }

      if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
        const fbUid = optionalAuth.firebaseClaims.uid;
        const fbToken = optionalAuth.firebaseIdToken;
        const cloudTasks: Promise<unknown>[] = [];
        if (numericRating !== null && !alreadyRatedIp) {
          cloudTasks.push(
            syncWorkVoteToFirestore(
              { targetType: 'prose', targetId, firebaseUid: fbUid, rating: numericRating },
              fbToken
            )
          );
        }
        if (review) {
          cloudTasks.push(
            syncReviewToFirestore(
              {
                id: review.id,
                targetType: 'prose',
                targetId,
                firebaseUid: fbUid,
                authorName: review.authorName,
                authorPhotoUrl: review.authorPhotoUrl,
                rating: review.rating,
                comment: review.comment,
              },
              fbToken
            )
          );
        }
        if (cloudTasks.length > 0) {
          await Promise.allSettled(cloudTasks);
        }
      }

      const badgeLookup = createBadgeLookup(db);
      const photoLookup = createAccountPhotoLookup(db);
      res.status(201).json({
        review: review ? enrichReviewWithBadges(review, badgeLookup, photoLookup) : null,
        ratingOnly: !hasComment,
        commentOnly: numericRating === null,
        alreadyRatedIp: numericRating !== null && alreadyRatedIp,
        appliedRating: finalVoteRating,
        prose: enrichProseForPublic(work, db, ipHash, Boolean(optionalAuth), false, badgeLookup, optionalAuth?.account, photoLookup),
      });
      return;
    }

    const product = db.products.find((p) => p.id === targetId);
    if (!product) {
      res.status(404).json({ error: 'Книгу не знайдено.' });
      return;
    }

    if (!db.productVotes[targetId]) db.productVotes[targetId] = {};
    const existingVote = findUserRatingInVotes(db.productVotes[targetId], voteLookupKeys);
    const alreadyRatedIp = existingVote !== null;
    if (numericRating !== null && !alreadyRatedIp) {
      db.productVotes[targetId][votePrimaryKey] = numericRating;
    }

    const finalVoteRating =
      numericRating !== null
        ? alreadyRatedIp
          ? existingVote
          : numericRating
        : null;

    let review: ReviewItem | null = null;
    if (hasComment) {
      review = {
        id: `rev_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        targetType: 'product',
        targetId,
        authorUid: cleanUid,
        authorName: cleanName,
        authorPhotoUrl: resolvedPhotoUrl,
        rating: finalVoteRating,
        comment: cleanComment,
        createdAt: new Date().toISOString(),
      };
      db.reviews.unshift(review);
    } else if (numericRating !== null && !alreadyRatedIp) {
      recordRecentRating(db, {
        targetType: 'product',
        targetId,
        rating: numericRating,
        authorUid: cleanUid,
        authorName: cleanName,
        authorPhotoUrl: resolvedPhotoUrl,
      });
    }

    if ((numericRating !== null && !alreadyRatedIp) || hasComment) {
      saveDatabase(db, { flushDelayMs: 1500, slices: ['products'] });
    }

    if (optionalAuth?.firebaseClaims && optionalAuth.firebaseIdToken) {
      const fbUid = optionalAuth.firebaseClaims.uid;
      const fbToken = optionalAuth.firebaseIdToken;
      const cloudTasks: Promise<unknown>[] = [];
      if (numericRating !== null && !alreadyRatedIp) {
        cloudTasks.push(
          syncWorkVoteToFirestore(
            { targetType: 'product', targetId, firebaseUid: fbUid, rating: numericRating },
            fbToken
          )
        );
      }
      if (review) {
        cloudTasks.push(
          syncReviewToFirestore(
            {
              id: review.id,
              targetType: 'product',
              targetId,
              firebaseUid: fbUid,
              authorName: review.authorName,
              authorPhotoUrl: review.authorPhotoUrl,
              rating: review.rating,
              comment: review.comment,
            },
            fbToken
          )
        );
      }
      if (cloudTasks.length > 0) {
        await Promise.allSettled(cloudTasks);
      }
    }

    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);
    res.status(201).json({
      review: review ? enrichReviewWithBadges(review, badgeLookup, photoLookup) : null,
      ratingOnly: !hasComment,
      commentOnly: numericRating === null,
      alreadyRatedIp: numericRating !== null && alreadyRatedIp,
      appliedRating: finalVoteRating,
      product: enrichProductForPublic(product, db, ipHash, badgeLookup, photoLookup, optionalAuth?.account),
    });
  });

  // Edit review comment (Admin or comment author)
  app.patch('/api/reviews/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);

    const adminAuth = await authenticateAdminRequest(req);
    const guestAuth = await authenticateGuestRequest(req, db);
    const isAdminActor = adminAuth.ok || (guestAuth.ok && guestAuth.isAdmin);
    const guestAccount = guestAuth.ok ? guestAuth.account : null;

    if (!isAdminActor && !guestAuth.ok) {
      res.status(401).json({ error: 'Потрібно увійти в акаунт, щоб редагувати коментарі.' });
      return;
    }

    const reviewId = req.params.id;
    const review = db.reviews.find((r) => r.id === reviewId);
    if (!review) {
      res.status(404).json({ error: 'Коментар не знайдено.' });
      return;
    }

    if (!isAdminActor) {
      const isOwner = Boolean(
        guestAuth.ok &&
          (guestAuth.account.uid === review.authorUid ||
            guestAuth.account.googleUid === review.authorUid ||
            guestAuth.firebaseClaims?.uid === review.authorUid)
      );
      if (!isOwner) {
        res.status(403).json({ error: 'Редагування дозволено лише автору коментаря або адміністратору.' });
        return;
      }
    }

    const { comment } = req.body as { comment?: string };
    const cleanComment = typeof comment === 'string' ? comment.trim().slice(0, 1500) : '';
    if (!cleanComment) {
      res.status(400).json({ error: 'Текст коментаря не може бути порожнім.' });
      return;
    }

    review.comment = cleanComment;
    saveDatabase(db, { flushDelayMs: 1500, slices: ['products'] });

    const bearerToken = extractBearerToken(req);
    const firebaseToken =
      (guestAuth.ok ? guestAuth.firebaseIdToken : undefined) ||
      (bearerToken && !bearerToken.startsWith('guest_v1.') ? bearerToken : undefined);
    if (firebaseToken) {
      void updateSingleReviewInFirestore(reviewId, cleanComment, firebaseToken);
    }

    const ipHash = getClientIpHash(req);
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);
    const enrichedReview = enrichReviewWithBadges(review, badgeLookup, photoLookup);

    let updatedPoem: Poem | undefined;
    let updatedProse: ProseWork | undefined;
    let updatedProduct: StoreProduct | undefined;

    if (review.targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === review.targetId);
      if (poem) {
        updatedPoem = enrichPoem(poem, db, ipHash, guestAccount ?? undefined, badgeLookup, photoLookup);
      }
    } else if (review.targetType === 'prose') {
      const prose = db.prose.find((p) => p.id === review.targetId);
      if (prose) {
        updatedProse = enrichProseForPublic(
          prose,
          db,
          ipHash,
          Boolean(guestAccount || isAdminActor),
          false,
          badgeLookup,
          guestAccount ?? undefined,
          photoLookup
        );
      }
    } else if (review.targetType === 'product') {
      const product = db.products.find((p) => p.id === review.targetId);
      if (product) {
        updatedProduct = enrichProductForPublic(
          product,
          db,
          ipHash,
          badgeLookup,
          photoLookup,
          guestAccount ?? undefined
        );
      }
    }

    res.json({
      success: true,
      review: enrichedReview,
      poem: updatedPoem,
      prose: updatedProse,
      product: updatedProduct,
    });
  });

  // Delete review comment (Admin or comment author)
  app.delete('/api/reviews/:id', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    await ensureAllPublicStateHydrated(db);

    const adminAuth = await authenticateAdminRequest(req);
    const guestAuth = await authenticateGuestRequest(req, db);
    const isAdminActor = adminAuth.ok || (guestAuth.ok && guestAuth.isAdmin);
    const guestAccount = guestAuth.ok ? guestAuth.account : null;

    if (!isAdminActor && !guestAuth.ok) {
      res.status(401).json({ error: 'Потрібно увійти в акаунт, щоб видаляти коментарі.' });
      return;
    }

    const reviewId = req.params.id;
    const reviewIndex = db.reviews.findIndex((r) => r.id === reviewId);
    if (reviewIndex === -1) {
      res.status(404).json({ error: 'Коментар не знайдено.' });
      return;
    }
    const review = db.reviews[reviewIndex];

    if (!isAdminActor) {
      const isOwner = Boolean(
        guestAuth.ok &&
          (guestAuth.account.uid === review.authorUid ||
            guestAuth.account.googleUid === review.authorUid ||
            guestAuth.firebaseClaims?.uid === review.authorUid)
      );
      if (!isOwner) {
        res.status(403).json({ error: 'Видалення дозволено лише автору коментаря або адміністратору.' });
        return;
      }
    }

    const [removedReview] = db.reviews.splice(reviewIndex, 1);
    saveDatabase(db, { flushDelayMs: 1500, slices: ['products'] });

    const bearerToken = extractBearerToken(req);
    const firebaseToken =
      (guestAuth.ok ? guestAuth.firebaseIdToken : undefined) ||
      (bearerToken && !bearerToken.startsWith('guest_v1.') ? bearerToken : undefined);
    if (firebaseToken) {
      void deleteSingleReviewInFirestore(reviewId, firebaseToken);
    }

    const ipHash = getClientIpHash(req);
    const badgeLookup = createBadgeLookup(db);
    const photoLookup = createAccountPhotoLookup(db);

    let updatedPoem: Poem | undefined;
    let updatedProse: ProseWork | undefined;
    let updatedProduct: StoreProduct | undefined;

    if (removedReview.targetType === 'poem') {
      const poem = db.poems.find((p) => p.id === removedReview.targetId);
      if (poem) {
        updatedPoem = enrichPoem(poem, db, ipHash, guestAccount ?? undefined, badgeLookup, photoLookup);
      }
    } else if (removedReview.targetType === 'prose') {
      const prose = db.prose.find((p) => p.id === removedReview.targetId);
      if (prose) {
        updatedProse = enrichProseForPublic(
          prose,
          db,
          ipHash,
          Boolean(guestAccount || isAdminActor),
          false,
          badgeLookup,
          guestAccount ?? undefined,
          photoLookup
        );
      }
    } else if (removedReview.targetType === 'product') {
      const product = db.products.find((p) => p.id === removedReview.targetId);
      if (product) {
        updatedProduct = enrichProductForPublic(
          product,
          db,
          ipHash,
          badgeLookup,
          photoLookup,
          guestAccount ?? undefined
        );
      }
    }

    res.json({
      success: true,
      reviewId,
      poem: updatedPoem,
      prose: updatedProse,
      product: updatedProduct,
    });
  });

  // Public site feedback submission
  app.post('/api/feedback', feedbackPostLimiter, async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    const { message, displayName, contact } = req.body as {
      message?: string;
      displayName?: string;
      contact?: string;
    };
    if (!message || typeof message !== 'string' || !message.trim()) {
      res.status(400).json({ error: 'Введіть текст відгуку або пропозиції.' });
      return;
    }
    const cleanMessage = message.trim().slice(0, 2000);
    const cleanName = (
      (typeof displayName === 'string' && displayName.trim()) ||
      optionalAuth?.account?.displayName ||
      'Гість'
    )
      .trim()
      .slice(0, 80);
    const cleanContact = typeof contact === 'string' ? contact.trim().slice(0, 100) : '';
    const resolvedFirebaseUid =
      optionalAuth?.firebaseClaims?.uid || optionalAuth?.account?.googleUid || undefined;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    if (!Array.isArray(db.feedback)) {
      db.feedback = [];
    }

    const duplicate = db.feedback.find((existing) => {
      const sameAuthor =
        (optionalAuth?.account?.uid && existing.guestUid === optionalAuth.account.uid) ||
        (resolvedFirebaseUid && existing.firebaseUid === resolvedFirebaseUid) ||
        existing.displayName.trim().toLowerCase() === cleanName.toLowerCase();
      const createdMs = Date.parse(existing.createdAt) || 0;
      return (
        sameAuthor &&
        existing.message.trim().toLowerCase() === cleanMessage.toLowerCase() &&
        nowMs - createdMs >= 0 &&
        nowMs - createdMs <= 15_000
      );
    });
    if (duplicate) {
      res.status(200).json({ success: true, record: duplicate, deduplicated: true });
      return;
    }

    const record: FeedbackRecord = {
      id: `fb_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`,
      ...(optionalAuth?.account?.uid ? { guestUid: optionalAuth.account.uid } : {}),
      ...(resolvedFirebaseUid ? { firebaseUid: resolvedFirebaseUid } : {}),
      displayName: cleanName,
      ...(optionalAuth?.account?.photoUrl ? { authorPhotoUrl: optionalAuth.account.photoUrl } : {}),
      ...(cleanContact ? { contact: cleanContact } : {}),
      message: cleanMessage,
      createdAt: nowIso,
      updatedAt: nowIso,
      readByAdmin: false,
      readByUser: true,
    };

    db.feedback.unshift(record);
    saveDatabase(db, { slices: ['community'] });

    if (optionalAuth?.firebaseIdToken && optionalAuth?.firebaseClaims?.email_verified) {
      void syncSiteFeedbackToFirestore(record, optionalAuth.firebaseIdToken);
    }

    res.status(201).json({ success: true, record });
  });

  // Guest: Get current user's submitted site feedback & admin replies
  app.get('/api/feedback/my', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const optionalAuth = await tryAuthenticateOptionalGuest(req, db);
    if (!optionalAuth) {
      res.json({ feedback: [], unreadRepliesCount: 0 });
      return;
    }

    const fbUid = optionalAuth.firebaseClaims?.uid || optionalAuth.account.googleUid;
    if (fbUid && optionalAuth.firebaseIdToken) {
      const hydrated = await hydrateUserSiteFeedbackFromFirestore(
        db,
        fbUid,
        optionalAuth.firebaseIdToken
      );
      if (hydrated) {
        saveDatabase(db, { slices: ['community'] });
      }
    }

    const items = (db.feedback || [])
      .filter((item) => {
        if (item.guestUid && item.guestUid === optionalAuth.account.uid) return true;
        if (fbUid && item.firebaseUid && item.firebaseUid === fbUid) return true;
        return false;
      })
      .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0));

    const unreadRepliesCount = items.filter(
      (item) => Boolean(item.adminReply?.trim()) && item.readByUser === false
    ).length;

    res.json({ feedback: items, unreadRepliesCount });
  });

  // Guest: Mark admin replies on own site feedback as read
  app.patch('/api/feedback/my/read', async (req: Request, res: Response) => {
    const db = ensureDatabase();
    const authResult = await authenticateGuestRequest(req, db);
    if (!authResult.ok) {
      res.status(authResult.status).json({ error: authResult.error });
      return;
    }

    const fbUid = authResult.firebaseClaims?.uid || authResult.account.googleUid;
    const nowIso = new Date().toISOString();
    const updatedItems: FeedbackRecord[] = [];

    db.feedback = (db.feedback || []).map((item) => {
      const isMine =
        (item.guestUid && item.guestUid === authResult.account.uid) ||
        Boolean(fbUid && item.firebaseUid && item.firebaseUid === fbUid);
      if (isMine && item.adminReply?.trim() && item.readByUser === false) {
        const nextItem: FeedbackRecord = {
          ...item,
          readByUser: true,
          updatedAt: nowIso,
        };
        updatedItems.push(nextItem);
        return nextItem;
      }
      return item;
    });

    if (updatedItems.length > 0) {
      saveDatabase(db, { slices: ['community'] });
      if (authResult.firebaseIdToken && authResult.firebaseClaims?.email_verified) {
        for (const item of updatedItems) {
          void syncSiteFeedbackToFirestore(item, authResult.firebaseIdToken);
        }
      }
    }

    res.json({ ok: true, updatedCount: updatedItems.length });
  });
}
