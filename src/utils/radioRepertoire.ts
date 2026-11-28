import type { RadioStationId, RadioTrack } from '../types.ts';

export const RADIO_TOP_LIKED_LIMIT = 10;
export const RADIO_NEWEST_ADMIN_LIMIT = 10;

export type RadioRepertoireBucket = 'top_liked' | 'newest';

export interface RadioStationRepertoireResult {
  repertoireTracks: RadioTrack[];
  topLikedIds: Set<string>;
  newestIds: Set<string>;
  bucketById: Map<string, RadioRepertoireBucket>;
  tenthTopLikesThreshold: number;
}

function parseAddedAtMs(addedAt?: string): number {
  if (!addedAt) return 0;
  const ms = Date.parse(addedAt);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizedLikes(track: RadioTrack): number {
  const n = Number(track.likesCount ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * Forms the active repertoire for a single radio wave:
 * - Up to 10 tracks with the highest likes count
 * - Up to 10 newest tracks added by admin
 * If any track gains more likes than the 10th top-liked track, it enters the top-10 and replaces it.
 */
export function selectRadioStationRepertoire(
  allTracks: readonly RadioTrack[],
  station: RadioStationId
): RadioStationRepertoireResult {
  const stationTracks = allTracks.filter(
    (track) => (track.station === 'electronic' ? 'electronic' : 'indie') === station
  );

  const byLikes = [...stationTracks].sort((a, b) => {
    const likesDiff = normalizedLikes(b) - normalizedLikes(a);
    if (likesDiff !== 0) return likesDiff;
    const addedDiff = parseAddedAtMs(b.addedAt) - parseAddedAtMs(a.addedAt);
    if (addedDiff !== 0) return addedDiff;
    const orderDiff = (a.order ?? 0) - (b.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return a.id.localeCompare(b.id);
  });

  const topLikedSlice = byLikes.slice(0, RADIO_TOP_LIKED_LIMIT);
  const topLikedIds = new Set(topLikedSlice.map((t) => t.id));
  const tenthTopLikesThreshold =
    topLikedSlice.length >= RADIO_TOP_LIKED_LIMIT
      ? normalizedLikes(topLikedSlice[RADIO_TOP_LIKED_LIMIT - 1])
      : 0;

  const byNewest = [...stationTracks].sort((a, b) => {
    const addedDiff = parseAddedAtMs(b.addedAt) - parseAddedAtMs(a.addedAt);
    if (addedDiff !== 0) return addedDiff;
    const orderDiff = (b.order ?? 0) - (a.order ?? 0);
    if (orderDiff !== 0) return orderDiff;
    return b.id.localeCompare(a.id);
  });

  const newestSlice = byNewest.slice(0, RADIO_NEWEST_ADMIN_LIMIT);
  const newestIds = new Set(newestSlice.map((t) => t.id));

  const bucketById = new Map<string, RadioRepertoireBucket>();
  const repertoireTracks: RadioTrack[] = [];
  const seen = new Set<string>();

  for (const track of newestSlice) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    const bucket: RadioRepertoireBucket = topLikedIds.has(track.id) ? 'top_liked' : 'newest';
    bucketById.set(track.id, bucket);
    repertoireTracks.push({
      ...track,
      inRepertoire: true,
      repertoireBucket: bucket,
    });
  }

  for (const track of topLikedSlice) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    bucketById.set(track.id, 'top_liked');
    repertoireTracks.push({
      ...track,
      inRepertoire: true,
      repertoireBucket: 'top_liked',
    });
  }

  return {
    repertoireTracks,
    topLikedIds,
    newestIds,
    bucketById,
    tenthTopLikesThreshold,
  };
}

export function annotateAllRadioTracksWithRepertoire(
  allTracks: readonly RadioTrack[]
): RadioTrack[] {
  const indieRep = selectRadioStationRepertoire(allTracks, 'indie');
  const electronicRep = selectRadioStationRepertoire(allTracks, 'electronic');

  return allTracks.map((track) => {
    const rep =
      (track.station === 'electronic' ? 'electronic' : 'indie') === 'electronic'
        ? electronicRep
        : indieRep;
    const bucket = rep.bucketById.get(track.id) ?? null;
    return {
      ...track,
      inRepertoire: bucket !== null,
      repertoireBucket: bucket,
    };
  });
}

export function getSavedRadioTracks(
  allTracks: readonly RadioTrack[],
  likedTrackIds?: readonly string[]
): RadioTrack[] {
  const likedOrder = Array.isArray(likedTrackIds) ? likedTrackIds : [];
  const likedSet = new Set(likedOrder);
  const orderIndex = new Map<string, number>();
  likedOrder.forEach((id, idx) => orderIndex.set(id, idx));

  return allTracks
    .filter((track) => Boolean(track.isLiked) || likedSet.has(track.id))
    .sort((a, b) => {
      const idxA = orderIndex.has(a.id) ? orderIndex.get(a.id)! : Number.MAX_SAFE_INTEGER;
      const idxB = orderIndex.has(b.id) ? orderIndex.get(b.id)! : Number.MAX_SAFE_INTEGER;
      if (idxA !== idxB) return idxA - idxB;
      return parseAddedAtMs(b.addedAt) - parseAddedAtMs(a.addedAt);
    });
}
