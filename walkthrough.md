# Security & Performance Hardening Walkthrough

This document outlines the security audit, performance optimizations, and architectural hardening measures implemented for the application.

## 1. Security Summary
- **Helmet & Content Security Policy (CSP)**: Integrated `helmet` with strict security headers while maintaining compatibility with AI Studio iframe embedding and popup auth flows (`same-origin-allow-popups`).
- **SSRF-Protected Image Proxy**: Upgraded external image proxy endpoints (`/api/poems/image-proxy` and `/api/author/image-proxy`) to pin resolved DNS IPs (`dns.lookup`), blocking private/loopback IP ranges (preventing SSRF and DNS rebinding TOCTOU attacks) and rejecting SVG payloads (`image/svg+xml` and XML/script signatures).
- **Authentication & Rate Limiting**: Enforced rate limiting on sensitive API routes and PIN verification endpoints with account lockout protection. Hardened Firebase ID token verification caching (30s TTL).
- **Firestore Security Rules**: Hardened `firestore.rules` by removing unauthenticated test endpoints (`/test/connection`), adding strict array element validation, validating URL schemas (`https://`), and protecting user private profiles.

## 2. Performance Optimizations
- **Image Asset Attributes**: Added `loading="lazy"`, `decoding="async"`, and explicit `width`/`height` or aspect ratio attributes to all images across components to prevent Cumulative Layout Shifts (CLS).
- **LCP Optimization**: Configured critical hero imagery with `fetchPriority="high"` and explicit dimensions.
- **Bundle Splitting**: Optimized vendor chunking in `vite.config.ts` to ensure administrative and heavy libraries are loaded efficiently.

## 3. Verification & Testing
- **Test Suite**: Automated tests for authentication roles and Monobank invoice validation pass successfully (`npm test`).
- **TypeScript & Build Check**: Clean compilation (`compile_applet`) and zero lint errors (`lint_applet` / `tsc --noEmit`).
- **Production Build**: Verified successful production bundle output (`npm run build`).
