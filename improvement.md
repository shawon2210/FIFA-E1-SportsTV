# A1TV — Improvement Plan (Current Position Snapshot)

Generated: 2026-06-13

## 1. Current State

### What works
- Frontend served statically at `http://localhost:8080/index.html`
- Design tokens (`css/tokens.css`) largely align with the FIFA E1 spec
- Typography, colors, radius, spacing, elevation tokens are in place
- Responsive breakpoints exist in `css/layout.css` and `css/components.css`
- HLS.js integration for stream playback (with graceful error overlay)
- Channel list, search, category tabs, favorites (localStorage), clock, settings modal
- `index.html` is a 339-line shell with accessible landmarks and inline SVG icons
- Several backend route files exist with health/analytics/admin endpoints

### What does NOT work
- **Backend cannot start**: Node crashes on `router.streams is not a function` and `requireDevice is not defined`
- **Database not installed/configured**: no Postgres + Redis
- **No usable DB migration path**: `npm run db:migrate` is missing from `package.json`
- **Frontend is data-fragile**: currently fails to load channels because backend is down; fallback path exists but needs verification

## 2. Verified File Map

| Path | Status |
|------|--------|
| `index.html` | 339-line app shell; links all CSS + JS |
| `css/tokens.css` | Spec tokens (color, typography, spacing, radius, shadow) |
| `css/layout.css` | Desktop/tablet/mobile layout rules |
| `css/components.css` | Cards, tabs, player UI, modals, scrollbars |
| `js/app.js` | Main controller (API, routing, player binding, init) |
| `js/channels.js` | Channel list rendering and filtering |
| `js/data.js` | Data helpers (channel metadata, colors, emojis) |
| `js/player.js` | HLS playback, controls, stream error UI |
| `js/nav.js` | Clock, settings modal, search shortcut |
| `js/iptv-api.js` | Legacy API shim |
| `backend/` | Express API (channels/search/admin/accounts/EPG) |
| `backend/package.json` | Dependencies ok; scripts incomplete |
| `database/migrations/` | SQL migrations present but not wired |
| `docker/` | docker-compose + nginx + traefik + prometheus + grafana |
| `.env.example` | Backend env template |

## 3. Frontend Issues

### 3.1 CSS / Responsive
- Mobile sidebar drawer behavior is present but needs real-device testing
- `components.css` was rewritten inline and may diverge from `tokens.css`/`layout.css`
- Active channel card glow and cyan border need uniformity across all card states
- Touch targets not formally audited (44–48px minimum)

### 3.2 JavaScript
- `app.js`, `channels.js`, `data.js`, `player.js`, `nav.js` are interconnected but not fully modular
- `window.CHANNELS` global coupling makes testing/refactor risky
- `iptv-api.js` still loaded but is vestigial
- Retry logic, debounced search, virtualization are not implemented
- No service worker logic for true PWA caching

### 3.3 Data flow
- `Data.init()` falls back to iptv-org when backend is missing (good)
- Stream CORS is unhandled at network boundary (the real blocker for live playback)
- Favorites are in `localStorage` only

## 4. Backend Issues (blocking)

### 4.1 Boot errors (proven)
- `admin.js` — `router.streams('/health', ...)` → `TypeError: router.streams is not a function`
- `accounts.js` — `requireDevice` used but not imported from middleware

### 4.2 Missing infrastructure
- **PostgreSQL** — not installed; `database.js` connects and calls `process.exit(1)` on failure (hard crash)
- **Redis** — not installed; `cache.js` connects via `ioredis` (gated behind try/catch, ok)
- **knexfile.js** — missing at `backend/src/config/knexfile.js` (migrations can't run)
- **seed runner** — not configured
- **Migrations directory path** — `../../database/migrations` is expected; verify exists

### 4.3 Script gaps
- `db:migrate`, `db:seed`, `db:reset` are absent from `backend/package.json`
- `npm install` works, `npm start` currently crashes before serving any route

## 5. CSS Improvements Required

### 5.1 Normalize with spec
- Enforce one source of truth: `tokens.css` variables
- Remove hardcoded colors in `components.css` that repeat token values
- Ensure all surfaces use `--surface-*` variables

### 5.2 Standardize components
- `.nav-icon-btn` (sidebar) vs `.btn-secondary` (top bar) — reconcile hover/focus states
- Active/focus ring thickness: 2px `#00F2FE`, 2px offset on all interactive elements
- `.video-card` sharp corners (`0px`) per spec; active channel card must be exactly:
  - border-radius: `20px`
  - border: `1px solid #00F2FE`
  - box-shadow: `rgba(0, 242, 254, 0.2) 0px 0px 20px 0px`
  - padding: `14px 52px 14px 16px`
- `.tab-item`/`.cat-pill` must share identical active style

### 5.3 Responsive robustness
- Add `@media (max-width: 1024px)` for better tablet behavior
- Add touch-action/hover media queries (`@media (hover: hover)`)
- Ensure player `aspect-ratio: 16/9` is enforced with fallback padding hack
- Add reduced-motion media query (`@media (prefers-reduced-motion: reduce)`)

## 6. JavaScript Improvements Required

### 6.1 Module cleanup
- Delete `js/iptv-api.js` (vestigial)
- Delete `js/runtime.js` and `js/runtime-v3.js` if unused
- Convert `window.CHANNELS`, `window.ActiveChannelId` to a single `App` namespace object

### 6.2 UX hardening
- Debounce search input (300ms)
- Virtualize channel list (limit rendered DOM nodes to 50–100 with scroll spacer)
- Add skeleton loaders for initial channel fetch
- Implement retry with exponential backoff on stream failures
- Cache EPG/schedule in `localStorage` (24h TTL)
- Add offline indicator when backend + iptv-org both unreachable

### 6.3 Player polish
- PiP button wired to `requestPictureInPicture()`
- Quality selector UI (1080p/720p/480p/auto) backed by `hls.currentLevel`
- Keyboard shortcuts documented in settings modal
- Streaming stats overlay (bitrate/latency) disabled by default

## 7. Backend Improvements Required

### 7.1 Quick fixes (route crashes)
- `admin.js:88` — `router.streams(...)` → `router.get(...)` (fix already applied)
- `accounts.js:9` — add `requireDevice` to destructured import (fix already applied)
- Verify all other route files import `requireDevice` if referenced

### 7.2 Start-up robustness
- Make `database.js` non-fatal when Postgres is down (log warning, skip DB features)
- Add `knexfile.js` at `backend/src/config/knexfile.js`
- Add migration + seed scripts to `backend/package.json`

### 7.3 Infra provisioning (local dev)
- Install Postgres 16 via installer
- Install Redis via WSL2 (`sudo apt install redis-server`)
- Create `a1tv` database + user
- Run `npm run db:migrate && npm run db:seed`
- Start with `npm start` on port 3000

### 7.4 Docker alternative (preferred)
- `docker/docker-compose.yml` exists; verify Postgres + Redis services defined
- If docker-compose.yml is complete, use it instead of native installs:
  ```bash
  cd D:\all files\Project\FIFA E1 SportsTV\docker
  docker compose up -d
  ```

## 8. Testing Checklist

- [ ] `node --check` passes on all `js/*.js`
- [ ] Backend `npm start` serves `GET /api/v1/channels` without crash
- [ ] Frontend loads channels from backend at `localhost:3000/api/v1/channels`
- [ ] HLS stream plays (at least one channel shows video)
- [ ] Switching channels updates hero + list + stream within 1s
- [ ] Favorites persist across page reload
- [ ] Mobile layout at 375px shows single column with hamburger drawer
- [ ] Tablet layout at 768–1100px shows 2-column cards + narrower sidebar
- [ ] Desktop at 1440px shows full 3-column layout
- [ ] Keyboard: `/` focuses search, `Space` toggles play, `F` fullscreen, `Esc` closes modal
- [ ] Error overlay with retry appears when stream is unavailable

## 9. Immediate Next Steps (Priority Order)

1. **Fix CSS drift**: rewrite `components.css` from `tokens.css` + `layout.css` primitives (eliminate hardcoded values)
2. **Frontend resilience**: debounce search, skeleton loaders, limit DOM nodes for channel list
3. **Backend quick fixes**: ensure `admin.js`/`accounts.js` patches are in place; create `knexfile.js`
4. **Provision infra**: use Docker Compose if viable, otherwise WSL2 Redis + native Postgres installer
5. **End-to-end test**: backend up → frontend loads channels from API → stream plays
6. **PWA hardening**: verify manifest + service worker; offline shell
7. **Accessibility audit**: focus rings, contrast, landmarks, reduced-motion

## 10. Known Risks

- Stream URLs from iptv-org may be geo-blocked or CORS-restricted; backend proxy is required for reliable playback
- `database.js` has hard `process.exit(1)` on Postgres failure — makes local dev without DB impossible unless patched
- `backend/.env` is in `.gitignore`; running from a fresh clone without `.env` will fail on undefined config values
- Some `load/` test scripts and `admin/` routes suggest partial admin UI work that is incomplete

---

This document is the single source of truth for the project’s current state and next actions.
