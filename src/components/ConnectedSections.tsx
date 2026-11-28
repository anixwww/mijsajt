import { lazy, memo, useCallback, useMemo } from 'react';
import { useAuthStore } from '../store/useAuthStore.ts';
import { useCatalogStore } from '../store/useCatalogStore.ts';
import { useRadioStore } from '../store/useRadioStore.ts';
import { useUiStore } from '../store/useUiStore.ts';
import type {
  HomePayload,
  HomeRepeatersConfig,
  InterviewLinkItem,
  SocialLinkItem,
  WeeklyMusicSelection,
} from '../types.ts';
import { useAllRadioTracks, useRadioDerivedState } from '../utils/radioSelectors.ts';
import { sortWeeklyMusicSelections } from '../utils/weeklyMusicFirestore.ts';
import { MinimizedRadioButton } from './MinimizedRadioButton.tsx';
import { FALLBACK_SOCIAL_LINKS } from './SocialIcons.tsx';

export const FALLBACK_AUTHOR_PHOTO_URL = '/src/assets/images/author_portrait_desk_1795025673568.webp';
export const FALLBACK_AUTHOR_ABOUT_TEXT = '';

export const loadPoetrySection = () => import('./PoetrySection.tsx');
export const loadProseSection = () => import('./ProseSection.tsx');
export const loadBlogSection = () => import('./BlogSection.tsx');
export const loadRadioSection = () => import('./RadioSection.tsx');
export const loadStoreSection = () => import('./StoreSection.tsx');

export const AuthorStudioModal = lazy(() =>
  import('./AuthorStudioModal.tsx').then((mod) => ({ default: mod.AuthorStudioModal }))
);
export const BlogSection = lazy(() =>
  loadBlogSection().then((mod) => ({ default: mod.BlogSection }))
);
export const CartLibraryDrawer = lazy(() =>
  import('./CartLibraryDrawer.tsx').then((mod) => ({ default: mod.CartLibraryDrawer }))
);
export const GuestAuthModal = lazy(() =>
  import('./GuestAuthModal.tsx').then((mod) => ({ default: mod.GuestAuthModal }))
);
export const PoetrySection = lazy(() =>
  loadPoetrySection().then((mod) => ({ default: mod.PoetrySection }))
);
export const ProseSection = lazy(() =>
  loadProseSection().then((mod) => ({ default: mod.ProseSection }))
);
export const RadioSection = lazy(() =>
  loadRadioSection().then((mod) => ({ default: mod.RadioSection }))
);
export const StoreSection = lazy(() =>
  loadStoreSection().then((mod) => ({ default: mod.StoreSection }))
);
export const TelegramVerifyModal = lazy(() =>
  import('./TelegramVerifyModal.tsx').then((mod) => ({ default: mod.TelegramVerifyModal }))
);
export const GlobalChatModal = lazy(() =>
  import('./GlobalChatModal.tsx').then((mod) => ({ default: mod.GlobalChatModal }))
);
export const UserLeaderboardModal = lazy(() =>
  import('./UserLeaderboardModal.tsx').then((mod) => ({ default: mod.UserLeaderboardModal }))
);
export const MusicSelectionsModal = lazy(() =>
  import('./MusicSelectionsModal.tsx').then((mod) => ({ default: mod.MusicSelectionsModal }))
);

interface ConnectedRadioProps {
  getGuestToken: (forceRefresh?: boolean) => Promise<string | null>;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
}

export const RadioSectionConnected = memo(function RadioSectionConnected({
  getGuestToken,
  getAdminToken,
}: ConnectedRadioProps) {
  const guestUser = useAuthStore((s) => s.guestUser);
  const isAdmin = useAuthStore((s) => s.isAdmin);
  const setGuestUser = useAuthStore((s) => s.setGuestUser);
  const setAuthModalOpen = useUiStore((s) => s.setAuthModalOpen);
  const updateRadioTrackLikeInCatalog = useCatalogStore((s) => s.updateRadioTrackLikeInCatalog);

  const activeStation = useRadioStore((s) => s.activeRadioStation);
  const playbackScope = useRadioStore((s) => s.radioPlaybackScope);
  const isPlaying = useRadioStore((s) => s.radioIsPlaying);
  const isLoadingTrack = useRadioStore((s) => s.radioIsLoadingTrack);
  const positionMs = useRadioStore((s) => s.radioPositionMs);
  const durationMs = useRadioStore((s) => s.radioDurationMs);
  const volume = useRadioStore((s) => s.radioVolume);
  const isMuted = useRadioStore((s) => s.radioIsMuted);
  const playerError = useRadioStore((s) => s.radioPlayerError);
  const showDirectEmbed = useRadioStore((s) => s.radioShowDirectEmbed);
  const setPlaybackScope = useRadioStore((s) => s.setRadioPlaybackScope);
  const setShowDirectEmbed = useRadioStore((s) => s.setRadioShowDirectEmbed);
  const setFirestoreRadioTracks = useRadioStore((s) => s.setFirestoreRadioTracks);
  const handlers = useRadioStore((s) => s.handlers);

  const { allRadioTracks, activeRadioTrack } = useRadioDerivedState();

  const handleTrackLiked = useCallback(
    (trackId: string, likesCount: number, isLiked: boolean, likedRadioTrackIds: string[]) => {
      updateRadioTrackLikeInCatalog(trackId, likesCount, isLiked);
      setFirestoreRadioTracks((prev) =>
        prev ? prev.map((t) => (t.id === trackId ? { ...t, likesCount, isLiked } : t)) : prev
      );
      setGuestUser((prev) => (prev ? { ...prev, likedRadioTrackIds } : prev));
    },
    [setFirestoreRadioTracks, setGuestUser, updateRadioTrackLikeInCatalog]
  );

  const handleOpenAuth = useCallback(() => setAuthModalOpen(true), [setAuthModalOpen]);
  const handleToggleDirectEmbed = useCallback(
    () => setShowDirectEmbed((prev) => !prev),
    [setShowDirectEmbed]
  );

  return (
    <RadioSection
      allTracks={allRadioTracks}
      activeStation={activeStation}
      onSelectStation={handlers.changeStation}
      playbackScope={playbackScope}
      onChangePlaybackScope={setPlaybackScope}
      guestUser={guestUser}
      getGuestToken={getGuestToken}
      isAdmin={isAdmin}
      getAdminToken={getAdminToken}
      onOpenAuthModal={handleOpenAuth}
      onTracksUpdated={handlers.notifyTracksUpdated}
      onTrackLiked={handleTrackLiked}
      currentTrackId={activeRadioTrack?.id ?? null}
      isPlaying={isPlaying}
      isLoadingTrack={isLoadingTrack}
      positionMs={positionMs}
      durationMs={durationMs}
      volume={volume}
      isMuted={isMuted}
      playerError={playerError}
      showDirectEmbed={showDirectEmbed}
      onToggleDirectEmbed={handleToggleDirectEmbed}
      onTogglePlay={handlers.togglePlay}
      onSelectTrack={handlers.selectTrack}
      onNextTrack={handlers.nextTrack}
      onPrevTrack={handlers.prevTrack}
      onSeekTo={handlers.seekTo}
      onVolumeChange={handlers.setVolume}
      onToggleMute={handlers.toggleMute}
    />
  );
});

export const MinimizedRadioButtonConnected = memo(function MinimizedRadioButtonConnected({
  onClick,
}: {
  onClick: () => void;
}) {
  const isPlaying = useRadioStore((s) => s.radioIsPlaying);
  const isMuted = useRadioStore((s) => s.radioIsMuted);
  const volume = useRadioStore((s) => s.radioVolume);
  const positionMs = useRadioStore((s) => s.radioPositionMs);
  const durationMs = useRadioStore((s) => s.radioDurationMs);
  const { activeRadioTrack } = useRadioDerivedState();

  return (
    <MinimizedRadioButton
      isPlaying={isPlaying}
      isMuted={isMuted}
      volume={volume}
      positionMs={positionMs}
      durationMs={durationMs}
      trackTitle={activeRadioTrack?.title}
      onClick={onClick}
    />
  );
});

export interface AuthorStudioModalConnectedProps {
  isOpen: boolean;
  isAdmin: boolean;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
  onClose: () => void;
  onCatalogUpdated: () => Promise<void>;
  homeViewData: HomePayload | null;
  uniqueVisitors: number;
  onHeroLeadUpdated: (nextText: string) => void;
  onAuthorAboutUpdated: (nextAbout: string) => void;
  onAuthorPhotoUpdated: (nextPhotoUrl: string) => void;
  onAuthorPhotosUpdated: (nextPhotos: string[]) => void;
  onSocialLinksUpdated: (nextLinks: SocialLinkItem[]) => void;
  onMonobankJarUpdated: (nextUrl: string) => void;
  onMonobankModalTextsUpdated: (next: {
    monobankModalTitle: string;
    monobankModalSubtitle: string;
    monobankCardLabel: string;
    monobankModalText: string;
    monobankEmptyText: string;
  }) => void;
  onContactEmailUpdated: (nextEmail: string) => void;
  onInterviewsUpdated: (nextInterviews: InterviewLinkItem[]) => void;
  onHomeActionAboutUpdated: (title: string) => void;
  onHomeActionContactUpdated: (title: string) => void;
  onHomeActionMonobankUpdated: (title: string) => void;
  onHomeActionInterviewsUpdated: (title: string) => void;
  onHomeRepeatersUpdated: (nextRepeaters: HomeRepeatersConfig) => void;
}

export const AuthorStudioModalConnected = memo(function AuthorStudioModalConnected({
  isOpen,
  isAdmin,
  getAdminToken,
  onClose,
  onCatalogUpdated,
  homeViewData,
  uniqueVisitors,
  onHeroLeadUpdated,
  onAuthorAboutUpdated,
  onAuthorPhotoUpdated,
  onAuthorPhotosUpdated,
  onSocialLinksUpdated,
  onMonobankJarUpdated,
  onMonobankModalTextsUpdated,
  onContactEmailUpdated,
  onInterviewsUpdated,
  onHomeActionAboutUpdated,
  onHomeActionContactUpdated,
  onHomeActionMonobankUpdated,
  onHomeActionInterviewsUpdated,
  onHomeRepeatersUpdated,
}: AuthorStudioModalConnectedProps) {
  const allRadioTracks = useAllRadioTracks();
  const notifyTracksUpdated = useRadioStore((s) => s.handlers.notifyTracksUpdated);

  return (
    <AuthorStudioModal
      isOpen={isOpen}
      isAdmin={isAdmin}
      getAdminToken={getAdminToken}
      onClose={onClose}
      onCatalogUpdated={onCatalogUpdated}
      heroLeadText={homeViewData?.heroLeadText || ''}
      onHeroLeadUpdated={onHeroLeadUpdated}
      authorAboutText={homeViewData?.authorAboutText ?? FALLBACK_AUTHOR_ABOUT_TEXT}
      onAuthorAboutUpdated={onAuthorAboutUpdated}
      authorPhotoUrl={homeViewData?.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL}
      authorPhotos={
        homeViewData?.authorPhotos && homeViewData.authorPhotos.length > 0
          ? homeViewData.authorPhotos
          : [homeViewData?.authorPhotoUrl ?? FALLBACK_AUTHOR_PHOTO_URL]
      }
      onAuthorPhotoUpdated={onAuthorPhotoUpdated}
      onAuthorPhotosUpdated={onAuthorPhotosUpdated}
      socialLinks={homeViewData?.socialLinks ?? FALLBACK_SOCIAL_LINKS}
      onSocialLinksUpdated={onSocialLinksUpdated}
      monobankJarUrl={homeViewData?.monobankJarUrl ?? ''}
      onMonobankJarUpdated={onMonobankJarUpdated}
      monobankModalTitle={homeViewData?.monobankModalTitle ?? 'Підтримати через Монобанк'}
      monobankModalSubtitle={homeViewData?.monobankModalSubtitle ?? ''}
      monobankCardLabel={homeViewData?.monobankCardLabel ?? 'Банка Монобанку'}
      monobankModalText={homeViewData?.monobankModalText ?? ''}
      monobankEmptyText={homeViewData?.monobankEmptyText ?? ''}
      onMonobankModalTextsUpdated={onMonobankModalTextsUpdated}
      contactEmail={homeViewData?.contactEmail ?? ''}
      onContactEmailUpdated={onContactEmailUpdated}
      interviews={homeViewData?.interviews ?? []}
      onInterviewsUpdated={onInterviewsUpdated}
      homeActionAboutTitle={homeViewData?.homeActionAboutTitle ?? 'Про мене'}
      onHomeActionAboutUpdated={onHomeActionAboutUpdated}
      homeActionContactTitle={homeViewData?.homeActionContactTitle ?? 'Зв’язок'}
      onHomeActionContactUpdated={onHomeActionContactUpdated}
      homeActionMonobankTitle={homeViewData?.homeActionMonobankTitle ?? 'Підтримати через Монобанк'}
      onHomeActionMonobankUpdated={onHomeActionMonobankUpdated}
      homeActionInterviewsTitle={homeViewData?.homeActionInterviewsTitle ?? 'Розмови'}
      onHomeActionInterviewsUpdated={onHomeActionInterviewsUpdated}
      homeRepeaters={homeViewData?.homeRepeaters}
      onHomeRepeatersUpdated={onHomeRepeatersUpdated}
      radioTracks={allRadioTracks}
      onRadioTracksChanged={notifyTracksUpdated}
      uniqueVisitors={uniqueVisitors}
    />
  );
});

export const MusicSelectionsModalConnected = memo(function MusicSelectionsModalConnected({
  isOpen,
  onClose,
  isAdmin,
  getAdminToken,
}: {
  isOpen: boolean;
  onClose: () => void;
  isAdmin: boolean;
  getAdminToken: (forceRefresh?: boolean) => Promise<string | null>;
}) {
  const serverList = useCatalogStore((s) => s.catalog?.weeklyMusicSelections);
  const currentPeriod = useCatalogStore((s) => s.catalog?.weeklyCurrentPeriod);
  const setWeeklySelectionsInCatalog = useCatalogStore((s) => s.setWeeklySelectionsInCatalog);
  const firestoreWeeklyMusic = useRadioStore((s) => s.firestoreWeeklyMusic);
  const setFirestoreWeeklyMusic = useRadioStore((s) => s.setFirestoreWeeklyMusic);
  const pauseRadio = useRadioStore((s) => s.handlers.pauseRadio);

  const weeklyMusicSelections = useMemo(() => {
    const fallbackList = serverList ?? [];
    if (firestoreWeeklyMusic === null) {
      return sortWeeklyMusicSelections(fallbackList);
    }
    if (firestoreWeeklyMusic.length === 0 && fallbackList.length > 0) {
      return sortWeeklyMusicSelections(fallbackList);
    }
    return sortWeeklyMusicSelections(firestoreWeeklyMusic);
  }, [serverList, firestoreWeeklyMusic]);

  const handleWeeklySelectionsUpdated = useCallback(
    (nextSelections: WeeklyMusicSelection[]) => {
      const sorted = sortWeeklyMusicSelections(nextSelections);
      setFirestoreWeeklyMusic(sorted);
      setWeeklySelectionsInCatalog(sorted);
    },
    [setFirestoreWeeklyMusic, setWeeklySelectionsInCatalog]
  );

  return (
    <MusicSelectionsModal
      isOpen={isOpen}
      onClose={onClose}
      selections={weeklyMusicSelections}
      currentPeriod={currentPeriod}
      isAdmin={isAdmin}
      getAdminToken={getAdminToken}
      onSelectionsUpdated={handleWeeklySelectionsUpdated}
      onBeforePlay={pauseRadio}
    />
  );
});
