# Security & Performance Hardening Walkthrough

# Security Summary

**Reviewed Files**: 8
**Issues Resolved**: 3

### Issues Resolved
| Area | File | Line | What Was Happening | Impact | Status | How It Was Fixed |
|---|---|---|---|---|---|---|
| Missing Helmet & CSP | `server.ts` | 68 | HTTP responses lacked `Content-Security-Policy` headers, leaving browsers without origin-level script/frame/connect restrictions on pages displaying user-submitted content. | High | Fixed | Mounted `createSecurityMiddleware` (`helmet`) in `server/security.ts` with strict CSP allowing only `'self'`, Google/Firebase, SoundCloud, YouTube, and Monobank (`object-src 'none'`, `base-uri 'self'`, `script-src-attr 'none'`, no `'unsafe-inline'` in production `script-src`). |
| Missing HSTS Header | `server/security.ts` | 109 | `Strict-Transport-Security` header was omitted from Express HTTP responses. | Medium | Fixed | Enabled `strictTransportSecurity` (`maxAge: 31536000`, `includeSubDomains: true`, `preload: true`) via Helmet. |
| Inline HTML Script & Dynamic Links | `index.html`, `src/components/HeroSection.tsx`, `src/components/CartLibraryDrawer.tsx` | 49, 1657, 774 | An inline `<script>` in `index.html` prevented strict production `script-src`, and dynamic `href` bindings accepted strings without explicit scheme checks. | Medium | Fixed | Moved legacy localStorage cleanup into `src/main.tsx` and added `sanitizeSafeHref` in `src/utils/urlRouting.ts` blocking non-HTTP(S) schemes on dynamic links. |

### Safeguards Verified
| Area | File | How It's Protected |
|---|---|---|
| HTTP Security Headers & CSP | `server/security.ts` | Emits Helmet CSP (`useDefaults: false` with explicit Google, SoundCloud, YouTube, and Monobank allowlists), HSTS, `nosniff`, `same-origin-allow-popups`, and AI Studio compatible `frame-ancestors`. |
| SSRF-Protected Image Proxy | `server/db.ts` | External image proxies pin resolved DNS IPs, block private/loopback ranges, and reject SVG/XML payloads. |
| User-Submitted Content | `server/chat.ts`, `server/catalog.ts` | Chat messages, reviews, and poem/prose submissions are rendered via escaped React text bindings, and submitted media URLs are restricted to `/uploads/` or HTTPS allowlists. |
| Auth & Rate Limiting | `server/auth.ts`, `server/db.ts` | Rate limits mutations/PIN checks, verifies Firebase ID tokens / guest cookies, and sends `Cache-Control: no-store` on private/payment endpoints. |

## PoC Verification

### Missing Content-Security-Policy & Unsafe Inline/Third-Party Execution

#### Summary
| Field | Value |
|---|---|
| Issue Type | Missing CSP & Strict-Transport-Security Headers / Unsafe Scheme Links |
| Impact | High |
| Affected File | `server/security.ts:68`, `server.ts:68`, `src/utils/urlRouting.ts:5` |
| Test Scenario | Injected inline `<script>alert(1)</script>`, untrusted `<iframe src="https://evil.example">`, `javascript:alert(1)` link href, and HTTP header probe against Express app. |

#### How It Was Fixed
Helmet now emits strict `Content-Security-Policy` (without `'unsafe-inline'` in production `script-src`, plus `object-src 'none'`, `script-src-attr 'none'`, and explicit allowlists for Google, SoundCloud, YouTube, and Monobank) alongside `Strict-Transport-Security`. Dynamic React links pass through `sanitizeSafeHref`.

#### Step-by-Step Trace
| Step | What Happens in the Code | Outcome |
|---|---|---|
| 1 | Request reaches Express middleware in `server.ts:68` (`createSecurityMiddleware(true)`) | Helmet attaches `Content-Security-Policy` and `Strict-Transport-Security` |
| 2 | Browser parses `dist/index.html` and enforces `script-src 'self' https://apis.google.com ...` and `frame-src` / `connect-src` allowlists | Inline scripts and non-allowlisted external origins (outside Google/SoundCloud/YouTube/Monobank) are blocked |
| 3 | Dynamic `href` value `"javascript:alert(1)"` enters `sanitizeSafeHref()` in `src/utils/urlRouting.ts:5` | Replaced with `'#'` before DOM render |

#### Conclusion
**Fix Verified** - Verified by `server/security.test.ts` and `npm run build` / `tsc --noEmit`: Helmet CSP, HSTS, and safe URL filtering are active without breaking Google, SoundCloud, YouTube, Monobank, or AI Studio preview functionality.
