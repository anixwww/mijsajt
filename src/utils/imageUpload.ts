const DEFAULT_MAX_DATA_URL_BYTES = 780_000;
const MAX_IMAGE_DIMENSION = 1600;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Помилка читання файлу'));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не вдалося декодувати зображення'));
    img.src = src;
  });
}

export async function readImageAsOptimizedDataUrl(
  file: File,
  maxDataUrlBytes = DEFAULT_MAX_DATA_URL_BYTES
): Promise<string> {
  const rawDataUrl = await readFileAsDataUrl(file);
  if (!rawDataUrl) {
    throw new Error('Помилка читання файлу');
  }

  // Keep animated GIFs or already-compact images intact
  if (file.type === 'image/gif' || rawDataUrl.length <= maxDataUrlBytes) {
    return rawDataUrl;
  }

  try {
    const img = await loadImageElement(rawDataUrl);
    const srcWidth = img.naturalWidth || img.width;
    const srcHeight = img.naturalHeight || img.height;
    if (!srcWidth || !srcHeight) {
      return rawDataUrl;
    }

    const baseScale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(srcWidth, srcHeight));
    const scaleSteps = [baseScale, baseScale * 0.78, baseScale * 0.6];
    const qualitySteps = [0.86, 0.76, 0.66, 0.54];
    const targetMime =
      file.type === 'image/png' || file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return rawDataUrl;
    }

    let bestCandidate = rawDataUrl;

    for (const scale of scaleSteps) {
      const width = Math.max(1, Math.round(srcWidth * scale));
      const height = Math.max(1, Math.round(srcHeight * scale));
      canvas.width = width;
      canvas.height = height;
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const quality of qualitySteps) {
        const candidate = canvas.toDataURL(targetMime, quality);
        if (candidate.startsWith(`data:${targetMime}`) && candidate.length < bestCandidate.length) {
          bestCandidate = candidate;
        }
        if (candidate.startsWith(`data:${targetMime}`) && candidate.length <= maxDataUrlBytes) {
          return candidate;
        }
      }
    }

    return bestCandidate;
  } catch {
    return rawDataUrl;
  }
}
