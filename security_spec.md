# Security Specification for Firestore Rules

## 1. Data Invariants
1. All writes require an authenticated, email-verified user (`request.auth != null && request.auth.token.email_verified == true`).
2. User PII (`/users/{userId}`) is strictly isolated to the owning user (`request.auth.uid == userId`) or the bootstrapped admin (`andrijdankiv5@gmail.com`).
3. Reviews (`/reviews/{reviewId}`) enforce `authorUid == request.auth.uid`, valid `targetType` (`poem` | `product`), `rating` integer 1..5, bounded `comment` (`<= 1500` chars), and server timestamp `request.time`.
4. `createdAt` and `authorUid` are immutable on update.
5. All document IDs match `^[a-zA-Z0-9_-]+$` and `<= 128` characters.

## 2. Dirty Dozen Adversarial Payloads
1. Unauthenticated write to `/reviews/r1` -> PERMISSION_DENIED
2. Unverified email (`email_verified: false`) write to `/reviews/r1` -> PERMISSION_DENIED
3. Spoofed `authorUid` (`authorUid !== request.auth.uid`) -> PERMISSION_DENIED
4. Ghost field injection (`isAdmin: true`) on `/reviews/r1` -> PERMISSION_DENIED
5. Out-of-range rating (`rating: 6` or `rating: 0`) -> PERMISSION_DENIED
6. Oversized comment (`comment.size() > 1500`) -> PERMISSION_DENIED
7. Invalid document ID (`id` with `/` or `> 128` chars) -> PERMISSION_DENIED
8. Cross-user PII read (`/users/otherUid` read by non-owner) -> PERMISSION_DENIED
9. Spoofed admin email with `email_verified: false` -> PERMISSION_DENIED
10. Client-forged `createdAt` timestamp (`createdAt !== request.time`) -> PERMISSION_DENIED
11. Mutating `authorUid` on review update -> PERMISSION_DENIED
12. Deleting another user's review -> PERMISSION_DENIED
