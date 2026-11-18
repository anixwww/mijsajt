import { ArrowRight, Eye, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlogPost } from '../types.ts';
import { setActiveMoment, trackClick } from '../utils/analytics.ts';
import { EditorialImage } from './EditorialImage.tsx';
import { RegistrationCrosshair } from './EditorialMarks.tsx';
import { ShareButton } from './ShareButton.tsx';

interface BlogSectionProps {
  posts: BlogPost[];
  onPostViewed: (postId: string, viewsCount: number) => void;
  initialPostId?: string | null;
  onActivePostChange?: (postId: string | null) => void;
}

export function BlogSection({
  posts,
  onPostViewed,
  initialPostId,
  onActivePostChange,
}: BlogSectionProps) {
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [largeText, setLargeText] = useState(false);

  const activePost = useMemo(
    () => posts.find((p) => p.id === activePostId) || null,
    [posts, activePostId]
  );

  const handledDeepLinkRef = useRef<string | null>(null);

  const trackPostView = (postId: string) => {
    fetch(`/api/blog/${encodeURIComponent(postId)}/view`, { method: 'POST' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && typeof data.viewsCount === 'number') {
          onPostViewed(postId, data.viewsCount);
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (!initialPostId) {
      handledDeepLinkRef.current = null;
      return;
    }
    if (handledDeepLinkRef.current === initialPostId) return;
    const matched = posts.find((p) => p.id === initialPostId);
    if (matched) {
      handledDeepLinkRef.current = initialPostId;
      setActivePostId(matched.id);
      trackPostView(matched.id);
    }
  }, [initialPostId, posts]);

  useEffect(() => {
    if (activePost) {
      setActiveMoment({
        targetKey: `blog:${activePost.id}`,
        momentKey: `blog:${activePost.id}`,
        label: `Блог: «${activePost.title}»`,
        category: 'blog',
        section: 'blog',
      });
    } else {
      setActiveMoment({
        targetKey: 'section:blog',
        momentKey: 'blog',
        label: 'Розділ: Блог',
        category: 'section',
        section: 'blog',
      });
    }
  }, [activePost]);

  const handleOpenPost = (post: BlogPost) => {
    trackClick(`blog:${post.id}`, `Блог: «${post.title}»`, 'content');
    handledDeepLinkRef.current = post.id;
    setActivePostId(post.id);
    onActivePostChange?.(post.id);
    trackPostView(post.id);
  };

  const handleClosePost = () => {
    setActivePostId(null);
    onActivePostChange?.(null);
  };

  const getBlogShareUrl = (postId: string) =>
    `${window.location.origin}${window.location.pathname}#blog/${encodeURIComponent(postId)}`;

  const featuredPost = posts[0];
  const restPosts = posts.slice(1);

  return (
    <section id="blog" className="pb-12">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* Experimental Editorial Header */}
        <header className="grid grid-cols-1 md:grid-cols-12 gap-6 items-end pb-8 mb-12 border-b border-[#0D0D0C]/16 dark:border-[#252522]">
          <div className="md:col-span-7">
            <div className="flex items-center gap-2.5 font-mono text-[11px] tracking-widest text-[#1E4631] dark:text-[#4E946C] mb-2">
              <RegistrationCrosshair className="w-3.5 h-3.5" />
              <span>03 / НОТАТКИ ТА ПРОЄКТИ</span>
            </div>
            <h2 className="font-serif text-5xl sm:text-6xl font-semibold tracking-[-0.03em] text-[#0D0D0C] dark:text-[#F2F1EC]">
              Блог
            </h2>
          </div>

          <p className="md:col-span-5 text-sm text-[#6B6B65] dark:text-[#94948C] leading-relaxed">
            Нотатки з письмового столу, роздуми про літературу, фрагменти пам’яті та робочі чернетки.
          </p>
        </header>

        {/* Experimental Overlapping Featured Spread */}
        {featuredPost && (
          <motion.article
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="perf-card mb-14 grid grid-cols-1 lg:grid-cols-12 gap-0 border border-[#0D0D0C]/16 dark:border-[#252522] bg-[#0D0D0C] dark:bg-[#141412] text-[#F5F4EF]"
          >
            <div className="lg:col-span-6 p-5 sm:p-7 flex flex-col justify-between gap-4 border-b lg:border-b-0 lg:border-r border-white/15">
              <div className="flex items-center justify-between font-mono text-[11px] text-[#94948C] tabular-nums">
                <span>ЗАПИС № 01</span>
                <span className="inline-flex items-center gap-1">
                  <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>{featuredPost.viewsCount}</span>
                </span>
              </div>

              <EditorialImage
                src={
                  featuredPost.coverImage ||
                  '/src/assets/images/subconscious_fragment_study_1795034932006.jpg'
                }
                alt={featuredPost.title}
                titleFallback={featuredPost.title}
                aspectClassName="aspect-[4/3]"
                className="border border-white/15"
                priority
              />

              <div className="flex items-center justify-between font-mono text-[11px] text-[#94948C]">
                <span>{featuredPost.category}</span>
                <span>{featuredPost.publishedAt}</span>
              </div>
            </div>

            <div className="lg:col-span-6 bg-[#F5F4EF] dark:bg-[#1B1B18] text-[#0D0D0C] dark:text-[#F2F1EC] p-6 sm:p-10 flex flex-col justify-between gap-8">
              <div>
                <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[#6B6B65] dark:text-[#94948C] mb-4 tabular-nums">
                  <span>{featuredPost.readingMinutes} хв читання</span>
                  <span aria-hidden="true">/</span>
                  <span>Головний фрагмент</span>
                </div>

                <h3 className="font-serif text-3xl sm:text-4xl font-semibold leading-[1.1] tracking-tight mb-5">
                  {featuredPost.title}
                </h3>

                <p className="text-sm sm:text-base text-[#3A3A36] dark:text-[#C8C7C0] leading-relaxed">
                  {featuredPost.excerpt}
                </p>
              </div>

              <div className="pt-6 border-t border-[#0D0D0C]/14 dark:border-[#2E2E2A] flex flex-wrap items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={() => handleOpenPost(featuredPost)}
                  className="inline-flex items-center gap-2.5 px-5 py-2.5 text-xs font-semibold text-white bg-[#1E4631] hover:bg-[#153524] dark:bg-[#2D6A4F] dark:hover:bg-[#3A8261] transition-colors cursor-pointer"
                >
                  <span>Читати запис повністю</span>
                  <ArrowRight className="w-4 h-4" strokeWidth={1.75} />
                </button>

                <ShareButton
                  title={`${featuredPost.title} — Блог Андрія Даньківа`}
                  text={`«${featuredPost.title}» — запис у блозі Андрія Даньківа`}
                  url={getBlogShareUrl(featuredPost.id)}
                  variant="inline"
                />
              </div>
            </div>
          </motion.article>
        )}

        {/* Secondary Blog Entries — Experimental Offset List */}
        {restPosts.length > 0 && (
          <div className="divide-y divide-[#0D0D0C]/14 dark:divide-[#252522] border-t border-b border-[#0D0D0C]/14 dark:border-[#252522]">
            {restPosts.map((post, index) => (
              <motion.article
                key={post.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.03, 0.15), ease: [0.16, 1, 0.3, 1] }}
                className="perf-card py-7 grid grid-cols-1 md:grid-cols-12 gap-4 md:gap-8 items-start group"
              >
                <div className="md:col-span-3 flex md:flex-col gap-2 font-mono text-xs text-[#6B6B65] dark:text-[#94948C] tabular-nums">
                  <span className="text-[#1E4631] dark:text-[#4E946C] font-semibold">
                    {String(index + 2).padStart(2, '0')}
                  </span>
                  <span>{post.publishedAt}</span>
                  <span>{post.category}</span>
                </div>

                <div className="md:col-span-7">
                  <h3 className="font-serif text-2xl sm:text-3xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC] mb-2 group-hover:text-[#1E4631] dark:group-hover:text-[#4E946C] transition-colors">
                    {post.title}
                  </h3>
                  <p className="text-sm text-[#3A3A36] dark:text-[#B8B7B0] leading-relaxed max-w-[60ch]">
                    {post.excerpt}
                  </p>
                </div>

                <div className="md:col-span-2 flex md:flex-col items-center md:items-end justify-between gap-3">
                  <span
                    className="inline-flex items-center gap-1 font-mono text-xs text-[#6B6B65] dark:text-[#94948C] tabular-nums"
                    title="Кількість переглядів"
                  >
                    <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                    <span>{post.viewsCount}</span>
                  </span>

                  <div className="flex items-center gap-4">
                    <ShareButton
                      title={`${post.title} — Блог Андрія Даньківа`}
                      text={`«${post.title}» — запис у блозі Андрія Даньківа`}
                      url={getBlogShareUrl(post.id)}
                      variant="inline"
                    />
                    <button
                      type="button"
                      onClick={() => handleOpenPost(post)}
                      className="text-xs font-semibold tracking-wide text-[#0D0D0C] dark:text-[#F2F1EC] underline underline-offset-4 hover:text-[#1E4631] dark:hover:text-[#4E946C] transition-colors whitespace-nowrap cursor-pointer"
                    >
                      Відкрити
                    </button>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </motion.div>

      {/* Blog Article Reader Modal */}
      <AnimatePresence>
        {activePost && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-50 bg-[#0D0D0C]/75 backdrop-blur-xs flex items-center justify-center p-4 md:p-6"
            onClick={handleClosePost}
            role="dialog"
            aria-modal="true"
            aria-labelledby="blog-modal-title"
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.98, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="bg-[#F5F4EF] dark:bg-[#141412] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 md:p-12 shadow-2xl will-change-transform"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4 pb-6 border-b border-[#0D0D0C]/16 dark:border-[#252522]">
                <div>
                  <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-[#6B6B65] dark:text-[#94948C] mb-2 tabular-nums">
                    <span>{activePost.category}</span>
                    <span aria-hidden="true">/</span>
                    <span>{activePost.publishedAt}</span>
                    <span aria-hidden="true">/</span>
                    <span>{activePost.readingMinutes} хв</span>
                    <span aria-hidden="true">/</span>
                    <span className="inline-flex items-center gap-1">
                      <Eye className="w-3.5 h-3.5" strokeWidth={1.5} />
                      <span>{activePost.viewsCount}</span>
                    </span>
                  </div>
                  <h3
                    id="blog-modal-title"
                    className="font-serif text-3xl md:text-5xl font-semibold text-[#0D0D0C] dark:text-[#F2F1EC] leading-tight"
                  >
                    {activePost.title}
                  </h3>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setLargeText((prev) => !prev)}
                    className="px-3 py-1.5 text-xs font-mono font-medium text-[#0D0D0C] dark:text-[#F2F1EC] bg-white dark:bg-[#1E1E1B] border border-[#0D0D0C]/20 dark:border-[#2E2E2A] hover:border-[#1E4631] dark:hover:border-[#4E946C] transition-colors cursor-pointer"
                    aria-label="Змінити розмір шрифту"
                  >
                    {largeText ? 'А' : 'А+'}
                  </button>
                  <button
                    type="button"
                    onClick={handleClosePost}
                    className="p-2 text-[#6B6B65] dark:text-[#94948C] hover:text-[#0D0D0C] dark:hover:text-[#F2F1EC] border border-transparent hover:border-[#0D0D0C]/20 transition-colors cursor-pointer shrink-0"
                    aria-label="Закрити статтю"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              <div
                className={`py-8 max-w-[65ch] mx-auto text-[#0D0D0C] dark:text-[#E8E7E1] space-y-5 leading-[1.8] transition-all ${
                  largeText ? 'text-lg' : 'text-base'
                }`}
              >
                {activePost.content.split('\n\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>

              <div className="pt-6 border-t border-[#0D0D0C]/16 dark:border-[#252522] flex flex-wrap items-center justify-between gap-3">
                <ShareButton
                  title={`${activePost.title} — Блог Андрія Даньківа`}
                  text={`«${activePost.title}» — запис у блозі Андрія Даньківа`}
                  url={getBlogShareUrl(activePost.id)}
                  variant="button"
                />

                <button
                  type="button"
                  onClick={handleClosePost}
                  className="px-6 py-2.5 text-xs font-semibold text-white bg-[#0D0D0C] dark:bg-[#F2F1EC] dark:text-[#0D0D0C] hover:bg-[#1E4631] dark:hover:bg-[#2D6A4F] dark:hover:text-white transition-colors cursor-pointer"
                >
                  Закрити
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
