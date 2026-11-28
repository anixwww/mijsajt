import { useCallback, useEffect, useRef, useState } from 'react';
import { Flame, Heart, Trophy, User, X, Plus, Trash2 } from 'lucide-react';
import type { UserLeaderboardResponse } from '../types.ts';
import { UserRankBadges } from './UserRankBadges.tsx';

interface UserLeaderboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  guestUser?: {
    uid: string;
    firebaseUid?: string;
    displayName?: string;
    guestToken?: string;
    isAdmin?: boolean;
  } | null;
  isAdmin?: boolean;
  getAdminToken?: (forceRefresh?: boolean) => Promise<string | null>;
  getGuestToken?: (forceRefresh?: boolean) => Promise<string | null>;
  authToken?: string | null;
}

type ActiveLeaderboardTab = 'activity' | 'donors';

function formatPointsLabel(points: number): string {
  const abs = Math.abs(Math.round(points));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) return `${abs} балів`;
  if (mod10 === 1) return `${abs} бал`;
  if (mod10 >= 2 && mod10 <= 4) return `${abs} бали`;
  return `${abs} балів`;
}

function LeaderboardAvatar({ photoUrl }: { photoUrl?: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  return (
    <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#323232] flex items-center justify-center overflow-hidden text-[#E5E5E5] font-semibold text-xs shrink-0">
      {photoUrl && !failed ? (
        <img
          src={photoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <User className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
      )}
    </div>
  );
}

export function UserLeaderboardModal({
  isOpen,
  onClose,
  guestUser,
  isAdmin = false,
  getAdminToken,
  getGuestToken,
  authToken,
}: UserLeaderboardModalProps) {
  const [activeTab, setActiveTab] = useState<ActiveLeaderboardTab>('activity');
  const [data, setData] = useState<UserLeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Author donor form state
  const [showAddDonor, setShowAddDonor] = useState(false);
  const [donorName, setDonorName] = useState('');
  const [donorAmount, setDonorAmount] = useState('500');
  const [donorNote, setDonorNote] = useState('');
  const [submittingDonor, setSubmittingDonor] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const getGuestTokenRef = useRef(getGuestToken);
  getGuestTokenRef.current = getGuestToken;
  const authTokenRef = useRef(authToken);
  authTokenRef.current = authToken;

  const fetchLeaderboard = useCallback(async () => {
    try {
      setLoading(true);
      const token = (await getGuestTokenRef.current?.().catch(() => null)) || authTokenRef.current;

      try {
        const rawIntent = localStorage.getItem('dankiv_pending_monobank_intent');
        if (rawIntent) {
          const parsed = JSON.parse(rawIntent) as {
            intentId?: string;
            createdAtMs?: number;
            donorName?: string;
          };
          if (
            parsed?.intentId &&
            typeof parsed.createdAtMs === 'number' &&
            Date.now() - parsed.createdAtMs < 60 * 60 * 1000
          ) {
            const checkHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              'X-Requested-With': 'XMLHttpRequest',
            };
            if (token) checkHeaders['Authorization'] = `Bearer ${token}`;
            const checkRes = await fetch('/api/monobank/jar/check', {
              method: 'POST',
              credentials: 'include',
              headers: checkHeaders,
              body: JSON.stringify({
                intentId: parsed.intentId,
                donorName: parsed.donorName,
              }),
            }).catch(() => null);
            if (checkRes?.ok) {
              const checkData = (await checkRes.json().catch(() => null)) as {
                status?: string;
              } | null;
              if (checkData?.status === 'credited' || checkData?.status === 'expired') {
                localStorage.removeItem('dankiv_pending_monobank_intent');
              }
            }
          } else {
            localStorage.removeItem('dankiv_pending_monobank_intent');
          }
        }
      } catch {
        // Ignore transient jar check / storage errors
      }

      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/leaderboard', { headers, credentials: 'include' });
      if (!res.ok) throw new Error('Помилка завантаження рейтингу');
      const json = (await res.json()) as UserLeaderboardResponse;
      setData(json);
      setError(null);
    } catch (err: any) {
      setError(err?.message || 'Не вдалося завантажити дані');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void fetchLeaderboard();
      const interval = window.setInterval(() => {
        void fetchLeaderboard();
      }, 15000);
      return () => window.clearInterval(interval);
    }
    setConfirmDeleteId(null);
  }, [isOpen, fetchLeaderboard]);

  const handleAddDonor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!donorName.trim() || !donorAmount) return;
    try {
      setSubmittingDonor(true);
      setError(null);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const resolvedAdminToken = (await getAdminToken?.()) || authToken;
      if (resolvedAdminToken) headers['Authorization'] = `Bearer ${resolvedAdminToken}`;
      if (guestUser?.guestToken) headers['X-Guest-Token'] = guestUser.guestToken;

      const res = await fetch('/api/author/donations', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          displayName: donorName.trim(),
          amountUah: Number(donorAmount) || 0,
          note: donorNote.trim(),
        }),
      });
      if (!res.ok) throw new Error('Не вдалося додати донат');
      setDonorName('');
      setDonorAmount('500');
      setDonorNote('');
      setShowAddDonor(false);
      await fetchLeaderboard();
    } catch (err: any) {
      setError(err?.message || 'Помилка додавання донату');
    } finally {
      setSubmittingDonor(false);
    }
  };

  const handleDeleteDonor = async (donationId: string) => {
    if (confirmDeleteId !== donationId) {
      setConfirmDeleteId(donationId);
      return;
    }
    try {
      setError(null);
      const headers: Record<string, string> = {};
      const resolvedAdminToken = (await getAdminToken?.()) || authToken;
      if (resolvedAdminToken) headers['Authorization'] = `Bearer ${resolvedAdminToken}`;
      if (guestUser?.guestToken) headers['X-Guest-Token'] = guestUser.guestToken;

      const res = await fetch(`/api/author/donations/${donationId}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error('Не вдалося видалити');
      setConfirmDeleteId(null);
      await fetchLeaderboard();
    } catch (err: any) {
      setError(err?.message || 'Помилка видалення');
    }
  };

  if (!isOpen) return null;

  const formatDate = (isoStr: string): string => {
    try {
      const d = new Date(isoStr);
      if (Number.isNaN(d.getTime())) return isoStr;
      return d.toLocaleDateString('uk-UA', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    } catch {
      return isoStr;
    }
  };

  const activityEntries = data?.activity ?? [];

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-black/65 backdrop-blur-xs animate-fadeIn"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-xl bg-[#202020] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90dvh] sm:max-h-[88vh]"
      >
        {/* Header */}
        <div className="px-4 py-3.5 sm:px-6 sm:py-5 flex items-center justify-between gap-2 bg-[#262626]">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#323232] flex items-center justify-center text-[#E5E5E5] shrink-0">
              <Trophy className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-[#FAF9F5] tracking-tight truncate">
                Рейтинг учасників
              </h2>
              <p className="text-[11px] sm:text-xs text-[#C4BFB4] truncate">
                Всього учасників: {data?.totalRegisteredUsers || 0}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl hover:bg-white/10 flex items-center justify-center text-[#FAF9F5]/70 transition-colors cursor-pointer shrink-0"
            aria-label="Закрити"
          >
            <X className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-2 p-1.5 sm:p-2 gap-1.5 bg-[#262626] border-t border-white/5">
          <button
            type="button"
            onClick={() => setActiveTab('activity')}
            className={`py-2 px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'activity'
                ? 'bg-[#E5E5E5] text-[#181818] shadow-sm'
                : 'text-[#FAF9F5]/70 hover:bg-white/5'
            }`}
          >
            <Flame className="w-3.5 h-3.5 shrink-0" />
            <span>Активність</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('donors')}
            className={`py-2 px-2.5 sm:px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 whitespace-nowrap cursor-pointer ${
              activeTab === 'donors'
                ? 'bg-[#E5E5E5] text-[#181818] shadow-sm'
                : 'text-[#FAF9F5]/70 hover:bg-white/5'
            }`}
          >
            <Heart className="w-3.5 h-3.5 shrink-0" />
            <span>Донатери</span>
          </button>
        </div>

        {/* Content body */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 sm:p-4 space-y-2.5">
          {loading && !data && (
            <div className="py-12 text-center text-sm text-[#C4BFB4] animate-pulse">
              Завантаження рейтингу...
            </div>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 text-red-400 text-xs sm:text-sm text-center">
              {error}
            </div>
          )}

          {data && activeTab === 'activity' && (
            <div className="space-y-2">
              <p className="text-[11px] sm:text-xs text-[#FAF9F5]/65 px-1 mb-1.5 leading-relaxed font-medium">
                Коментар, вподобайка, покупка в Прозі чи Крамниці = 1 бал
              </p>
              {activityEntries.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#FAF9F5]/50">
                  Ще немає активності учасників
                </div>
              ) : (
                activityEntries.map((item) => {
                  const isCurrent = Boolean(
                    (data.currentUserUid && data.currentUserUid === item.uid) ||
                      (guestUser?.uid && guestUser.uid === item.uid) ||
                      (guestUser?.firebaseUid && guestUser.firebaseUid === item.uid)
                  );
                  return (
                    <div
                      key={item.uid}
                      className={`flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-xl transition-all ${
                        isCurrent ? 'bg-[#343434]' : 'bg-[#262626]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                        <span
                          className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                            item.rank === 1
                              ? 'bg-amber-500 text-white shadow-sm'
                              : item.rank === 2
                              ? 'bg-slate-400 text-white'
                              : item.rank === 3
                              ? 'bg-amber-700 text-white'
                              : 'bg-white/10 text-[#FAF9F5]'
                          }`}
                        >
                          {item.rank}
                        </span>
                        <LeaderboardAvatar photoUrl={item.photoUrl} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            <p className="text-xs sm:text-sm font-semibold text-[#FAF9F5] truncate max-w-full">
                              {item.displayName}
                            </p>
                            <UserRankBadges badges={item.badges} size="xs" />
                            {isCurrent && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#E5E5E5] text-[#181818] font-medium shrink-0">
                                Ви
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] sm:text-[11px] text-[#FAF9F5]/60 truncate">
                            Коментарі: {item.commentsCount} · Вподобайки: {item.likesCount} · Покупки: {item.purchasesCount}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs sm:text-sm font-bold text-[#E5E5E5] whitespace-nowrap tabular-nums">
                          {formatPointsLabel(item.points)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {data && activeTab === 'donors' && (
            <div className="space-y-2.5 sm:space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-[11px] sm:text-xs text-[#FAF9F5]/60">
                  Топ-10 меценатів та донатерів проєкту:
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setShowAddDonor(!showAddDonor)}
                    className="text-xs px-2.5 py-1 rounded-lg bg-[#E5E5E5] text-[#181818] font-medium flex items-center gap-1 cursor-pointer whitespace-nowrap shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Додати донат</span>
                  </button>
                )}
              </div>

              {/* Author add donor form */}
              {isAdmin && showAddDonor && (
                <form
                  onSubmit={handleAddDonor}
                  className="p-3 sm:p-3.5 rounded-xl bg-[#262626] space-y-2.5 sm:space-y-3"
                >
                  <p className="text-xs font-bold text-[#FAF9F5]">
                    Ручне додавання донату (адмін)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] text-[#FAF9F5]/60 mb-1">
                        Ім'я мецената
                      </label>
                      <input
                        type="text"
                        value={donorName}
                        onChange={(e) => setDonorName(e.target.value)}
                        placeholder="Наприклад: Олександр К."
                        required
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[#202020] focus:bg-[#323232] text-[#FAF9F5] focus:outline-none transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-[#FAF9F5]/60 mb-1">
                        Сума (₴)
                      </label>
                      <input
                        type="number"
                        value={donorAmount}
                        onChange={(e) => setDonorAmount(e.target.value)}
                        placeholder="500"
                        required
                        min="1"
                        className="w-full px-3 py-1.5 text-xs rounded-lg bg-[#202020] focus:bg-[#323232] text-[#FAF9F5] focus:outline-none transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] text-[#FAF9F5]/60 mb-1">
                      Коментар / Примітка (необов'язково)
                    </label>
                    <input
                      type="text"
                      value={donorNote}
                      onChange={(e) => setDonorNote(e.target.value)}
                      placeholder="Наприклад: На нову збірку"
                      className="w-full px-3 py-1.5 text-xs rounded-lg bg-[#202020] focus:bg-[#323232] text-[#FAF9F5] focus:outline-none transition-colors"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShowAddDonor(false)}
                      className="px-3 py-1 rounded-lg text-xs text-[#FAF9F5]/70 hover:bg-white/10 cursor-pointer"
                    >
                      Скасувати
                    </button>
                    <button
                      type="submit"
                      disabled={submittingDonor}
                      className="px-3.5 py-1 rounded-lg text-xs bg-[#E5E5E5] text-[#181818] font-semibold cursor-pointer"
                    >
                      {submittingDonor ? 'Збереження...' : 'Зберегти донат'}
                    </button>
                  </div>
                </form>
              )}

              {data.donors.length === 0 ? (
                <div className="py-10 text-center text-sm text-[#FAF9F5]/50">
                  Ще немає зареєстрованих донатів
                </div>
              ) : (
                data.donors.map((item) => {
                  const isConfirming = confirmDeleteId === item.id;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 p-2.5 sm:p-3 rounded-xl bg-[#262626]"
                    >
                      <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                        <span
                          className={`w-6 h-6 sm:w-7 sm:h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                            item.rank === 1
                              ? 'bg-amber-500 text-white shadow-sm'
                              : item.rank === 2
                              ? 'bg-slate-400 text-white'
                              : item.rank === 3
                              ? 'bg-amber-700 text-white'
                              : 'bg-white/10 text-[#FAF9F5]'
                          }`}
                        >
                          {item.rank}
                        </span>
                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-[#323232] flex items-center justify-center overflow-hidden text-[#E5E5E5] font-semibold text-xs shrink-0">
                          {item.photoUrl ? (
                            <img src={item.photoUrl} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Heart className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            <p className="text-xs sm:text-sm font-semibold text-[#FAF9F5] truncate max-w-full">
                              {item.displayName}
                            </p>
                            <UserRankBadges badges={item.badges} size="xs" />
                          </div>
                          <p className="text-[10px] sm:text-[11px] text-[#FAF9F5]/60 truncate">
                            Донатів: {item.donationsCount} · {formatDate(item.lastDonatedAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                        <p className="text-xs sm:text-sm font-bold text-[#E5E5E5] whitespace-nowrap tabular-nums">
                          {item.totalAmountUah.toLocaleString('uk-UA')} ₴
                        </p>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteDonor(item.id)}
                            className={`px-1.5 py-1 rounded-lg transition-colors cursor-pointer ${
                              isConfirming
                                ? 'bg-red-500 text-white text-[10px] font-semibold'
                                : 'text-red-400 hover:bg-red-500/10'
                            }`}
                            title={isConfirming ? 'Натисніть ще раз для підтвердження' : 'Видалити запис донату'}
                          >
                            {isConfirming ? 'Видалити?' : <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
