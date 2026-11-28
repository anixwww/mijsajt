import helmet from 'helmet';
import type { RequestHandler } from 'express';

const GOOGLE_SCRIPT_ORIGINS = [
  'https://apis.google.com',
  'https://www.gstatic.com',
  'https://www.google.com',
  'https://recaptcha.net',
];

const SOUNDCLOUD_SCRIPT_ORIGINS = ['https://w.soundcloud.com'];

const GOOGLE_CONNECT_ORIGINS = [
  'https://*.googleapis.com',
  'https://*.firebaseio.com',
  'wss://*.firebaseio.com',
  'https://*.firebaseapp.com',
  'https://*.web.app',
  'https://accounts.google.com',
  'https://www.google.com',
  'https://recaptcha.net',
  'https://fonts.gstatic.com',
];

const SOUNDCLOUD_CONNECT_ORIGINS = [
  'https://soundcloud.com',
  'https://w.soundcloud.com',
  'https://api.soundcloud.com',
  'https://api-v2.soundcloud.com',
  'https://*.sndcdn.com',
];

const YOUTUBE_CONNECT_ORIGINS = ['https://www.youtube.com', 'https://i.ytimg.com'];

const MONOBANK_CONNECT_ORIGINS = ['https://api.monobank.ua', 'https://send.monobank.ua'];

const GOOGLE_FRAME_ORIGINS = [
  'https://accounts.google.com',
  'https://www.google.com',
  'https://recaptcha.net',
  'https://*.firebaseapp.com',
  'https://*.web.app',
];

const SOUNDCLOUD_FRAME_ORIGINS = ['https://w.soundcloud.com', 'https://soundcloud.com'];

const YOUTUBE_FRAME_ORIGINS = ['https://www.youtube.com', 'https://www.youtube-nocookie.com'];

const MONOBANK_FRAME_ORIGINS = ['https://send.monobank.ua', 'https://pay.mbnk.biz'];

const GOOGLE_IMG_ORIGINS = ['https://*.googleusercontent.com', 'https://www.gstatic.com'];
const SOUNDCLOUD_IMG_ORIGINS = ['https://*.sndcdn.com', 'https://w.soundcloud.com'];
const YOUTUBE_IMG_ORIGINS = ['https://i.ytimg.com', 'https://img.youtube.com'];
const MONOBANK_IMG_ORIGINS = ['https://api.monobank.ua', 'https://send.monobank.ua'];

const SOUNDCLOUD_MEDIA_ORIGINS = ['https://*.sndcdn.com', 'https://soundcloud.com'];

const AI_STUDIO_FRAME_ANCESTORS = [
  'https://aistudio.google.com',
  'https://*.google.com',
  'https://*.googleusercontent.com',
  'https://*.usercontent.goog',
];

export function buildCspDirectives(isProduction: boolean) {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    scriptSrc: [
      "'self'",
      ...GOOGLE_SCRIPT_ORIGINS,
      ...SOUNDCLOUD_SCRIPT_ORIGINS,
      // Vite dev HMR injects an inline React Refresh preamble only outside production
      ...(isProduction ? [] : ["'unsafe-inline'"]),
    ],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", "'unsafe-inline'"],
    styleSrcElem: ["'self'", "'unsafe-inline'"],
    imgSrc: [
      "'self'",
      'data:',
      'blob:',
      ...GOOGLE_IMG_ORIGINS,
      ...SOUNDCLOUD_IMG_ORIGINS,
      ...YOUTUBE_IMG_ORIGINS,
      ...MONOBANK_IMG_ORIGINS,
    ],
    fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
    connectSrc: [
      "'self'",
      'wss:',
      ...(isProduction ? [] : ['ws:']),
      ...GOOGLE_CONNECT_ORIGINS,
      ...SOUNDCLOUD_CONNECT_ORIGINS,
      ...YOUTUBE_CONNECT_ORIGINS,
      ...MONOBANK_CONNECT_ORIGINS,
    ],
    frameSrc: [
      "'self'",
      ...GOOGLE_FRAME_ORIGINS,
      ...SOUNDCLOUD_FRAME_ORIGINS,
      ...YOUTUBE_FRAME_ORIGINS,
      ...MONOBANK_FRAME_ORIGINS,
    ],
    frameAncestors: ["'self'", ...AI_STUDIO_FRAME_ANCESTORS],
    mediaSrc: ["'self'", 'blob:', ...SOUNDCLOUD_MEDIA_ORIGINS],
    workerSrc: ["'self'", 'blob:'],
    manifestSrc: ["'self'"],
    formAction: ["'self'", ...MONOBANK_FRAME_ORIGINS],
    upgradeInsecureRequests: isProduction ? [] : null,
  };
}

export function createSecurityMiddleware(
  isProduction = process.env.NODE_ENV === 'production'
): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: buildCspDirectives(isProduction),
    },
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    xFrameOptions: false,
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xContentTypeOptions: true,
    xPoweredBy: false,
  });
}
