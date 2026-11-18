import { motion, useReducedMotion } from 'motion/react';
import { useMemo } from 'react';

interface EditorialTypewriterProps {
  text: string;
  delay?: number;
  charDelay?: number;
  charDuration?: number;
  triggerOnView?: boolean;
  showCaret?: boolean;
  className?: string;
}

export function EditorialTypewriter({
  text,
  delay = 0,
  charDelay = 0.032,
  charDuration = 0.2,
  triggerOnView = false,
  showCaret = false,
  className,
}: EditorialTypewriterProps) {
  const prefersReducedMotion = useReducedMotion();

  const { tokens, totalChars } = useMemo(() => {
    const parts = text.split(/(\s+)/);
    let cursor = 0;
    const mapped = parts.map((part, tokenIdx) => {
      const isSpace = /^\s+$/.test(part);
      const startIndex = cursor;
      const chars = Array.from(part);
      cursor += chars.length;
      return {
        key: `${tokenIdx}-${part}`,
        part,
        isSpace,
        startIndex,
        chars,
      };
    });
    return { tokens: mapped, totalChars: cursor };
  }, [text]);

  if (prefersReducedMotion) {
    return <span className={className}>{text}</span>;
  }

  const totalRevealTime = delay + Math.max(0, totalChars - 1) * charDelay + charDuration;

  const content = (
    <>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {tokens.map((token) =>
          token.isSpace ? (
            <span key={token.key}>{token.part}</span>
          ) : (
            <span key={token.key} className="inline-block whitespace-nowrap">
              {token.chars.map((char, idx) => (
                <motion.span
                  key={`${token.key}-${idx}`}
                  variants={{
                    hidden: { opacity: 0 },
                    visible: {
                      opacity: 1,
                      transition: {
                        duration: charDuration,
                        delay: delay + (token.startIndex + idx) * charDelay,
                        ease: [0.22, 1, 0.36, 1],
                      },
                    },
                  }}
                >
                  {char}
                </motion.span>
              ))}
            </span>
          )
        )}
        {showCaret && (
          <motion.span
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: [0, 0.9, 0.9, 0],
                transition: {
                  duration: totalRevealTime + 0.55,
                  times: [0, 0.04, 0.86, 1],
                  ease: 'linear',
                },
              },
            }}
            className="inline-block align-baseline w-[1.5px] h-[0.78em] ml-1.5 translate-y-[0.06em] bg-[#4E946C]"
          />
        )}
      </span>
    </>
  );

  if (triggerOnView) {
    return (
      <motion.span
        className={className}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, amount: 0.25 }}
      >
        {content}
      </motion.span>
    );
  }

  return (
    <motion.span className={className} initial="hidden" animate="visible">
      {content}
    </motion.span>
  );
}
