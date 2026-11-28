import type { SiteDatabase } from './seedData.ts';

export type PendingMonobankStoreInvoice = any;
export type PendingMonobankProseInvoice = any;

export const cloudSyncState = {
  publicHydrated: true,
  communityHydrated: true,
  cloudConfigExists: false,
  radioHydrated: true,
  adminSecretsHydrated: true,
};

export const paymentSessions = new Map<string, any>();
export const pendingMonobankStoreInvoices = new Map<string, any>();
export const pendingMonobankProseInvoices = new Map<string, any>();

export function getMonobankToken(): string {
  return process.env.MONOBANK_TOKEN || '';
}

export function persistPendingInvoices(..._args: any[]): void {}
export function ensurePendingInvoicesLoaded(..._args: any[]): void {}
export function queueDatabaseSyncToFirestore(..._args: any[]): void {}

export async function syncWorkVoteToFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncReviewToFirestore(..._args: any[]): Promise<any> { return true; }
export async function updateSingleReviewInFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteSingleReviewInFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateAdminPoemSubmissionsFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateAdminProseSubmissionsFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateAdminOrdersFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateAdminSiteFeedbackFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncDonationToFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteDonationInFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncSiteFeedbackToFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateUserSiteFeedbackFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteSiteFeedbackInFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteReviewsForTargetInFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncPoemSubmissionToFirestore(..._args: any[]): Promise<any> { return true; }
export async function saveMediaAssetToFirestore(..._args: any[]): Promise<any> { return ''; }
export async function loadMediaAssetFromFirestore(..._args: any[]): Promise<any> { return ''; }
export async function deletePoemSubmissionInFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncProseSubmissionToFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteProseSubmissionInFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteRadioTrackInFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncSingleWeeklyMusicSelectionInFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteWeeklyMusicSelectionInFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncPublicUserProfileToFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateSingleAuthorizedProse(..._args: any[]): Promise<any> { return true; }
export async function syncChatMessageToFirestore(..._args: any[]): Promise<any> { return true; }
export async function deleteChatMessageInFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncAdminTelegramTokenToFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateAuthorizedProseAndRadio(..._args: any[]): Promise<any> { return true; }
export async function hydratePublicCatalogFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateUserPoemSubmissionsFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function hydrateUserProseSubmissionsFromFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncGuestLikesToFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncRadioLikeEntryToFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncUserPoemLikeEntriesToFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncPoemLikeEntryToFirestore(..._args: any[]): Promise<any> { return true; }
export async function syncOrderToFirestore(..._args: any[]): Promise<any> { return true; }

export async function hydratePoemLikesFromFirestore(..._args: any[]): Promise<any> {
  return { ok: true, likesByPoemId: new Map(), likesByUid: new Map() };
}

export async function hydrateRadioLikesFromFirestore(..._args: any[]): Promise<any> {
  return { ok: true, likesByTrackId: new Map(), likesByUid: new Map() };
}

export async function hydrateCommunityStateFromFirestore(..._args: any[]): Promise<any> {
  return true;
}

export async function hydrateGuestLikesFromFirestore(..._args: any[]): Promise<any> {
  return { ok: true, likedPoemIds: [], likedRadioTrackIds: [] };
}

export async function hydrateAdminSecretsFromFirestore(..._args: any[]): Promise<any> {
  return true;
}
