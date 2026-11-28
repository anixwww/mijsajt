import { useEffect, useState } from 'react';
import type { PoemImagePalette } from '../types.ts';

const paletteMemoryCache = new Map<string, PoemImagePalette>();

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => clampByte(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function parseHexRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(clean)) {
    return {
      r: parseInt(clean[0] + clean[0], 16),
      g: parseInt(clean[1] + clean[1], 16),
      b: parseInt(clean[2] + clean[2], 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(clean)) {
    return {
      r: parseInt(clean.slice(0, 2), 16),
      g: parseInt(clean.slice(2, 4), 16),
      b: parseInt(clean.slice(4, 6), 16),
    };
  }
  return null;
}

export function getRelativeLuminance(r: number, g: number, b: number): number {
  const toLinear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function isHexColorDark(hex?: string): boolean {
  if (!hex) return false;
  const rgb = parseHexRgb(hex);
  if (!rgb) return false;
  return getRelativeLuminance(rgb.r, rgb.g, rgb.b) < 0.34;
}

function contrastRatio(lum1: number, lum2: number): number {
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case rn:
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
      break;
    case gn:
      h = (bn - rn) / d + 2;
      break;
    case bn:
      h = (rn - gn) / d + 4;
      break;
  }
  h *= 60;
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360;
  if (s === 0) {
    const v = clampByte(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hNorm = hn / 360;
  return {
    r: clampByte(hue2rgb(p, q, hNorm + 1 / 3) * 255),
    g: clampByte(hue2rgb(p, q, hNorm) * 255),
    b: clampByte(hue2rgb(p, q, hNorm - 1 / 3) * 255),
  };
}

function ensureAccessibleTextContrast(baseRgb: { r: number; g: number; b: number }): {
  background: string;
  text: string;
  isDark: boolean;
  rgb: { r: number; g: number; b: number };
} {
  const lightInk = { hex: '#FDFCFA', lum: getRelativeLuminance(253, 252, 250) };
  const darkInk = { hex: '#141413', lum: getRelativeLuminance(20, 20, 19) };

  let current = { ...baseRgb };
  let bgLum = getRelativeLuminance(current.r, current.g, current.b);
  let whiteContrast = contrastRatio(lightInk.lum, bgLum);
  let darkContrast = contrastRatio(bgLum, darkInk.lum);

  // If contrast is below 4.6 for both inks, nudge lightness slightly while preserving hue & saturation
  if (Math.max(whiteContrast, darkContrast) < 4.6) {
    const hsl = rgbToHsl(current.r, current.g, current.b);
    const goDarker = hsl.l <= 0.58;
    for (let step = 1; step <= 12; step += 1) {
      const nextL = goDarker
        ? Math.max(0.08, hsl.l - step * 0.035)
        : Math.min(0.92, hsl.l + step * 0.035);
      const candidate = hslToRgb(hsl.h, hsl.s, nextL);
      const lum = getRelativeLuminance(candidate.r, candidate.g, candidate.b);
      const wc = contrastRatio(lightInk.lum, lum);
      const dc = contrastRatio(lum, darkInk.lum);
      current = candidate;
      bgLum = lum;
      whiteContrast = wc;
      darkContrast = dc;
      if (Math.max(wc, dc) >= 4.7) break;
    }
  }

  const useLightText = whiteContrast >= darkContrast;
  return {
    background: rgbToHex(current.r, current.g, current.b),
    text: useLightText ? lightInk.hex : darkInk.hex,
    isDark: useLightText,
    rgb: current,
  };
}

function deriveSecondaryBackground(
  primaryRgb: { r: number; g: number; b: number },
  secondaryCandidateRgb: { r: number; g: number; b: number } | null,
  isDark: boolean
): string {
  const pHsl = rgbToHsl(primaryRgb.r, primaryRgb.g, primaryRgb.b);

  if (secondaryCandidateRgb) {
    const sHsl = rgbToHsl(
      secondaryCandidateRgb.r,
      secondaryCandidateRgb.g,
      secondaryCandidateRgb.b
    );
    // Blend candidate towards primary richness so the overall card stays unmistakably the dominant hue
    const blendedR = primaryRgb.r * 0.62 + secondaryCandidateRgb.r * 0.38;
    const blendedG = primaryRgb.g * 0.62 + secondaryCandidateRgb.g * 0.38;
    const blendedB = primaryRgb.b * 0.62 + secondaryCandidateRgb.b * 0.38;
    const bHsl = rgbToHsl(blendedR, blendedG, blendedB);
    // Keep luminosity consistent with primary ink choice so text remains readable everywhere on card
    const targetL = isDark
      ? Math.max(0.07, Math.min(pHsl.l * 0.94, Math.min(0.42, bHsl.l)))
      : Math.min(0.94, Math.max(pHsl.l * 0.95, Math.max(0.68, bHsl.l)));
    const safeRgb = hslToRgb(bHsl.h, Math.max(sHsl.s * 0.7, pHsl.s * 0.85), targetL);
    return rgbToHex(safeRgb.r, safeRgb.g, safeRgb.b);
  }

  // Monochromatic atmospheric depth shade
  const shiftedH = (pHsl.h + 8) % 360;
  const shiftedL = isDark
    ? Math.max(0.06, pHsl.l - 0.08)
    : Math.max(0.65, pHsl.l - 0.06);
  const shiftedRgb = hslToRgb(shiftedH, Math.min(1, pHsl.s * 1.05), shiftedL);
  return rgbToHex(shiftedRgb.r, shiftedRgb.g, shiftedRgb.b);
}

export function extractPaletteFromImageElement(img: HTMLImageElement): PoemImagePalette | null {
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) return null;

  const maxSide = 72;
  const scale = Math.min(1, maxSide / Math.max(naturalW, naturalH));
  const width = Math.max(1, Math.round(naturalW * scale));
  const height = Math.max(1, Math.round(naturalH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height).data;

  const HUE_BINS = 24; // 15° per bin
  interface HueBucket {
    weight: number;
    count: number;
    rSum: number;
    gSum: number;
    bSum: number;
  }

  const hueBuckets: HueBucket[] = Array.from({ length: HUE_BINS }, () => ({
    weight: 0,
    count: 0,
    rSum: 0,
    gSum: 0,
    bSum: 0,
  }));

  // 4 achromatic lightness buckets: dark, mid-dark, mid-light, light
  const neutralBuckets: HueBucket[] = Array.from({ length: 4 }, () => ({
    weight: 0,
    count: 0,
    rSum: 0,
    gSum: 0,
    bSum: 0,
  }));

  let totalOpaquePixels = 0;
  let chromaticPixels = 0;

  for (let i = 0; i < imageData.length; i += 4) {
    const a = imageData[i + 3];
    if (a < 140) continue;

    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    totalOpaquePixels += 1;

    const { h, s, l } = rgbToHsl(r, g, b);

    if (s >= 0.14 && l >= 0.05 && l <= 0.94) {
      chromaticPixels += 1;
      const bin = Math.floor(((h % 360) + 360) % 360 / (360 / HUE_BINS)) % HUE_BINS;
      // Emphasize saturated tones modestly while keeping pixel-count majority dominant
      const weight = 1 + s * 1.5;
      const bucket = hueBuckets[bin];
      bucket.weight += weight;
      bucket.count += 1;
      bucket.rSum += r * weight;
      bucket.gSum += g * weight;
      bucket.bSum += b * weight;
    } else {
      const nBin = l < 0.25 ? 0 : l < 0.5 ? 1 : l < 0.78 ? 2 : 3;
      const bucket = neutralBuckets[nBin];
      bucket.weight += 1;
      bucket.count += 1;
      bucket.rSum += r;
      bucket.gSum += g;
      bucket.bSum += b;
    }
  }

  if (totalOpaquePixels === 0) return null;

  const chromaticShare = chromaticPixels / totalOpaquePixels;
  let primaryRgb: { r: number; g: number; b: number } | null = null;
  let secondaryCandidateRgb: { r: number; g: number; b: number } | null = null;

  if (chromaticShare >= 0.12) {
    // Score each hue sector with its +/- 1 circular neighbors (45° window) so red (345°-15°) never splits
    const windowScores = hueBuckets.map((_, idx) => {
      const prev = (idx - 1 + HUE_BINS) % HUE_BINS;
      const next = (idx + 1) % HUE_BINS;
      return hueBuckets[prev].weight + hueBuckets[idx].weight + hueBuckets[next].weight;
    });

    let bestBin = 0;
    for (let i = 1; i < HUE_BINS; i += 1) {
      if (windowScores[i] > windowScores[bestBin]) {
        bestBin = i;
      }
    }

    const bestClusterBins = [
      (bestBin - 1 + HUE_BINS) % HUE_BINS,
      bestBin,
      (bestBin + 1) % HUE_BINS,
    ];
    let totalW = 0;
    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    for (const bIdx of bestClusterBins) {
      totalW += hueBuckets[bIdx].weight;
      rSum += hueBuckets[bIdx].rSum;
      gSum += hueBuckets[bIdx].gSum;
      bSum += hueBuckets[bIdx].bSum;
    }
    if (totalW > 0) {
      primaryRgb = {
        r: clampByte(rSum / totalW),
        g: clampByte(gSum / totalW),
        b: clampByte(bSum / totalW),
      };
    }

    // Find a secondary hue bin at least 3 bins (45°) away
    let secondBin = -1;
    let secondScore = 0;
    for (let i = 0; i < HUE_BINS; i += 1) {
      const dist = Math.min(Math.abs(i - bestBin), HUE_BINS - Math.abs(i - bestBin));
      if (dist >= 3 && windowScores[i] > secondScore) {
        secondScore = windowScores[i];
        secondBin = i;
      }
    }
    if (secondBin !== -1 && secondScore > windowScores[bestBin] * 0.14) {
      const sb = hueBuckets[secondBin];
      if (sb.weight > 0) {
        secondaryCandidateRgb = {
          r: clampByte(sb.rSum / sb.weight),
          g: clampByte(sb.gSum / sb.weight),
          b: clampByte(sb.bSum / sb.weight),
        };
      }
    }
  }

  if (!primaryRgb) {
    // Achromatic / monochrome photo: choose largest neutral bucket
    let bestNeutral = neutralBuckets[0];
    for (let i = 1; i < neutralBuckets.length; i += 1) {
      if (neutralBuckets[i].count > bestNeutral.count) {
        bestNeutral = neutralBuckets[i];
      }
    }
    if (bestNeutral.count === 0) return null;
    primaryRgb = {
      r: clampByte(bestNeutral.rSum / bestNeutral.count),
      g: clampByte(bestNeutral.gSum / bestNeutral.count),
      b: clampByte(bestNeutral.bSum / bestNeutral.count),
    };
  }

  const accessible = ensureAccessibleTextContrast(primaryRgb);
  const secondaryBackground = deriveSecondaryBackground(
    accessible.rgb,
    secondaryCandidateRgb,
    accessible.isDark
  );

  return {
    background: accessible.background,
    secondaryBackground,
    text: accessible.text,
    isDark: accessible.isDark,
  };
}

function loadImageForCanvas(src: string, useCors: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (useCors) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image for palette extraction'));
    img.src = src;
  });
}

function isSameOriginOrInlineUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('/')) {
    return true;
  }
  if (typeof window === 'undefined') return false;
  try {
    const parsed = new URL(trimmed, window.location.origin);
    return parsed.origin === window.location.origin;
  } catch {
    return false;
  }
}

export async function extractImagePalette(
  imageUrl: string,
  options?: { proxyUrl?: string; proxyHeaders?: HeadersInit }
): Promise<PoemImagePalette | null> {
  const cleanUrl = imageUrl.trim();
  if (!cleanUrl) return null;

  const cached = paletteMemoryCache.get(cleanUrl);
  if (cached) return cached;

  try {
    const sameOrigin = isSameOriginOrInlineUrl(cleanUrl);
    const img = await loadImageForCanvas(cleanUrl, !sameOrigin);
    const extracted = extractPaletteFromImageElement(img);
    if (extracted) {
      paletteMemoryCache.set(cleanUrl, extracted);
      return extracted;
    }
  } catch {
    // Fallback to proxy if supplied (for external URLs without CORS headers)
  }

  if (options?.proxyUrl) {
    let objectUrl: string | null = null;
    try {
      const res = await fetch(options.proxyUrl, {
        headers: options.proxyHeaders,
      });
      if (res.ok) {
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        const img = await loadImageForCanvas(objectUrl, false);
        const extracted = extractPaletteFromImageElement(img);
        if (extracted) {
          paletteMemoryCache.set(cleanUrl, extracted);
          return extracted;
        }
      }
    } catch {
      // Ignore proxy extraction failure
    } finally {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    }
  }

  return null;
}

export function usePoemImagePalette(
  imageUrl?: string,
  storedPalette?: PoemImagePalette
): PoemImagePalette | null {
  const cleanUrl = imageUrl?.trim() || '';
  const [extracted, setExtracted] = useState<PoemImagePalette | null>(() => {
    if (storedPalette?.background) return storedPalette;
    if (cleanUrl && paletteMemoryCache.has(cleanUrl)) {
      return paletteMemoryCache.get(cleanUrl) || null;
    }
    return null;
  });

  useEffect(() => {
    if (storedPalette?.background) {
      if (cleanUrl) {
        paletteMemoryCache.set(cleanUrl, storedPalette);
      }
      setExtracted(storedPalette);
      return;
    }

    if (!cleanUrl) {
      setExtracted(null);
      return;
    }

    const memHit = paletteMemoryCache.get(cleanUrl);
    if (memHit) {
      setExtracted(memHit);
      return;
    }

    let cancelled = false;
    extractImagePalette(cleanUrl).then((palette) => {
      if (!cancelled) {
        setExtracted(palette);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [cleanUrl, storedPalette]);

  return storedPalette?.background ? storedPalette : extracted;
}
