# 🏭 PTG Smart Manufacturing Progress Tracker - Agent Instructions

Welcome, Agent! This file outlines critical guidelines and architectural constraints for this project workspace.

---

## 📖 Essential Knowledge
1. **Vision:** This is a serverless, client-side Single Page Application (SPA) for the Prometeon Smart Manufacturing Team.
2. **Context Document:** Refer to [CONTEXT_HANDOFF.md](CONTEXT_HANDOFF.md) in the project root for full architectural details, database formats (`database.json` & `database_archive.json`), and folder layouts.
3. **Database Engine:** Data is purely JSON-based. The active database is `database.json` in the root folder, synchronized bi-directionally via the GitHub REST API.
4. **GitHub API Sync & Conflict Prevention:** 
   - Direct base64 content retrieval via `/contents` REST API endpoint in `js/store.js` is used to load/save the unified `database.json`. This bypasses browser CORS and raw CDN caches.
   - **Conflict Checks:** On load, the remote Git SHA is saved in localStorage (`sm_progress_loaded_sha`). Saving compares this loaded SHA with the live remote repository SHA. A mismatch prompts the user to force-overwrite or reload.
   - Public unauthenticated visitors on `github.io` fetch `database.json` unauthenticated with automatic static CDN fallback upon reaching rate limits. Auto-detection is handled by `window.Store.autoDetectGitHubRepo()`.
5. **Log Partitioning/Archiving:**
   - Active database keeps only the latest 30 daily log entries. Older logs are moved to `database_archive.json` in the repository.
   - The full history is loaded on-demand in the UI Console by merging `database_archive.json` dynamically.
6. **Background Sync & Manual Sync:**
   - **On navigation (hashchange):** The app renders instantly from local cache, then silently calls `triggerBackgroundSyncCheck()` which fetches the latest database from GitHub. If the SHA has changed, it re-renders the current view and shows an info toast. Skips re-render if a modal is open.
   - **Manual 🔄 button (`#manual-sync-btn`):** Located in the top navbar. Clicking triggers a full `initStore()` pull and `renderCurrentView()` refresh. Button spins via `.syncing` CSS class during sync.

---

## 🛠️ Code Modification Rules
1. **Frontend Only:** DO NOT attempt to write or configure Node.js, Python, or Go backends. All rendering and routes are managed client-side inside `js/app.js` using location hashes (`#/dashboard`, `#/project/{id}`, `#/logs`, `#/database`).
2. **Vanilla CSS & Cache Busting:** Styling must be written in vanilla CSS in `css/styles.css`. Whenever you modify `css/styles.css`, `js/*.js`, or core brand assets, you MUST increment the query parameter version in `index.html` (e.g. `href="css/styles.css?v=2.0"` or `src="js/app.js?v=2.0"`) to force immediate reload on all client browsers. Current versions (July 2026): CSS `v=2.0`, all JS `v=2.0`, gantt.js `v=1.1`.
3. **Modal Close Handlers:** Never close modal cards manually with inline CSS triggers (e.g., `classList.remove('active')`). You MUST trigger `window.UI.closeModal(modalId)` to correctly clear the background scroll lock (`body { overflow: hidden }`).
4. **Layout Clamping (Horizontal Scrolling):**
   - Keep horizontal scrolling isolated inside overflow containers (`.table-responsive` and `.gantt-image-container`).
   - Cards in the details viewport and logs view (`.steps-section`, `.gantt-card`, `.log-form-container`, `.log-archive-container`, and `.modal-card`) MUST have `min-width: 0` or `min-width: 0 !important` to prevent wide children from stretching the viewport width.
   - Layout grids stack vertically on viewport widths under `768px`.
5. **Date Column Sizing:** Steps table date cells use `white-space: nowrap` at `font-size: 11px` to prevent wrapping in 1080p split-screen views.
6. **Brand Assets:**
   - Prometeon main logo is `logo.png` (left navbar brand image).
   - Prometeon P symbol badge mark is `p_logo.png` (right user profile badge image and favicon).
7. **Sync Button:** The `🔄` button (`#manual-sync-btn`) in the navbar uses `.settings-btn` styling. The `.syncing` class adds a spin animation. Do not duplicate or relocate this element.
