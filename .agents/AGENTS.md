# 🏭 PTG Smart Manufacturing Progress Tracker - Agent Instructions

Welcome, Agent! This file outlines critical guidelines and architectural constraints for this project workspace.

---

## 📖 Essential Knowledge
1. **Vision:** This is a serverless, client-side Single Page Application (SPA) for the Prometeon Smart Manufacturing Team.
2. **Context Document:** Refer to [CONTEXT_HANDOFF.md](CONTEXT_HANDOFF.md) in the project root for full architectural details, database formats (`database.json`), and folder layouts.
3. **Wasm SQLite Parser:** SQLite loading/saving is parsed locally in the client via [sql.js WebAssembly](https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/sql-wasm.js).
4. **GitHub API Sync Driver:** 
   - Direct base64 content retrieval via `/contents` REST API endpoint in `js/store.js` is used to load/save the unified `database.json`. This bypasses browser CORS and raw CDN caches.
   - Public unauthenticated visitors on `github.io` fetch `database.json` unauthenticated with automatic static CDN fallback upon reaching rate limits.

---

## 🛠️ Code Modification Rules
1. **Frontend Only:** DO NOT attempt to write or configure Node.js, Python, or Go backends. All rendering and routes are managed client-side inside `js/app.js` using location hashes (`#/dashboard`, `#/project/{id}`, etc.).
2. **Vanilla CSS & Cache Busting:** Styling must be written in vanilla CSS in `css/styles.css`. Whenever you modify `css/styles.css`, you MUST increment the stylesheet query parameter version in `index.html` (e.g. `href="css/styles.css?v=1.5"`) to force immediate reload on all client browsers.
3. **Modal Close Handlers:** Never close modal cards manually with inline CSS triggers (e.g., `classList.remove('active')`). You MUST trigger `window.UI.closeModal(modalId)` to correctly clear the background scroll lock (`body { overflow: hidden }`).
4. **Layout Clamping (Horizontal Scrolling):**
   - Keep horizontal scrolling isolated inside overflow containers (`.table-responsive` and `.gantt-image-container`).
   - Cards in the details viewport (`.steps-section` and `.gantt-card`) MUST have `min-width: 0` to prevent wide children from stretching the viewport width.
   - Layout grids stack vertically on viewport widths under `768px`.
5. **Brand Assets:**
   - Prometeon main logo is `logo.png` (left navbar brand image).
   - Prometeon P symbol badge mark is `p_logo.png` (right user profile badge image).
