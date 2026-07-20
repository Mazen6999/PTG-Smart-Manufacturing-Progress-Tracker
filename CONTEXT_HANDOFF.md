# 🏭 PTG Smart Manufacturing Progress Tracker - Context & Handoff

This document details the vision, architecture, and core design principles of the **PTG Smart Manufacturing Progress Tracker**. It serves as a master handoff file for future developers and AI coding agents.

---

## 🎯 1. Project Vision & Purpose
* **The Goal:** Migrate legacy Excel progress trackers into an interactive, high-fidelity client-side Single Page Application (SPA).
* **The Target Audience:** The Prometeon Smart Manufacturing Team (including Mazen, Nada, Tareq, Ramy, and other collaborators).
* **Deployment:** Hosted completely serverless on **GitHub Pages**: [Live Website](https://mazen-shams.github.io/PTG-Smart-Manufacturing-Progress-Tracker/).
* **Sync Mode:** Real-time bi-directional sync with the GitHub repository, with background auto-refresh on navigation and a manual sync button.

---

## 🛠️ 2. Technology Stack & Architecture
This is a **purely client-side SPA** with zero database server backends:
1. **Core:** Vanilla HTML5, CSS3, and JavaScript (ES6 Modules).
2. **Database:** JSON-based client-side structure. Active items are stored in `database.json`. Archived logs are partitioned into `database_archive.json`.
3. **Storage Sync:**
   - When **GitHub Sync** is enabled: The app reads and writes files directly to the GitHub repository using the GitHub REST API.
   - When **GitHub Sync** is disabled: The app falls back to **Local Storage** in the user's browser.

---

## ⚡ 3. Critical Architectural Decisions

### 📡 GitHub Sync Driver & CORS Bypass
* **API Content Loading:** Standard raw file links (like `raw.githubusercontent.com`) are heavily cached by GitHub's CDN (60-second delay) and blocked by browser CORS policies when queried directly. 
* **The Solution:** The app uses the GitHub contents API `/repos/{owner}/{repo}/contents/{path}` which returns the file content as a Base64-encoded string. This bypasses the CDN caching layer and CORS, achieving **0s latency** updates on page refresh.
* **Write Pipeline:** Changes are pushed using a standard HTTP `PUT` request with a commit message and the parent file's SHA hash.
* **Conflict Prevention:** Uses a comparison step verifying that the locally stored load SHA matches the live remote repository SHA before committing, prompting the user if a concurrent edit conflict is detected.
* **Audit Trails:** Dynamic commit messages describe CRUD updates in detail (e.g. `"Add project: \"Name\""`).

### 🔄 Background Sync on Navigation & Manual Sync Button
The app implements two complementary mechanisms to keep data fresh without requiring full page reloads:

1. **Background sync on page navigation (Option 1):** Every `hashchange` event fires `navigate()` immediately (rendering from local cache for instant responsiveness), then asynchronously calls `triggerBackgroundSyncCheck()` in `js/app.js`. This function:
   - Checks if GitHub sync is active (via config or auto-detected `github.io` hosting).
   - Skips if a modal overlay is open (to avoid disrupting in-progress edits).
   - Calls `window.Store.initStore()` to fetch the latest `database.json` from GitHub.
   - Compares the old and new SHA values from localStorage (`sm_progress_loaded_sha`).
   - If the SHA differs, calls `renderCurrentView()` to silently refresh the active page and shows an info toast: *"Database auto-updated from GitHub"*.

2. **Manual sync button (Option 3):** A `🔄` button (`#manual-sync-btn`) in the top-right navbar using the `.settings-btn` class. On click:
   - Calls `window.Store.initStore()` to pull the full latest database.
   - Calls `renderCurrentView()` to refresh the page.
   - Shows a success/failure toast.
   - During sync, the button receives a `.syncing` CSS class that applies a spinning rotation animation and disables interaction.

### 👥 Bidirectional Step Status & Progress Sync
* **Interactive Dropdowns**: Both **Status** and **Progress** columns in the steps schedule table are styled select dropdowns. Changing either dropdown updates the database and immediately updates the neighboring dropdown value in the DOM.
* **Overall Stats Refresh**: The overall project progress percentage and status badge in the header are recalculated and updated inline in the DOM (using `#project-details-progress-text` and `#project-details-status-badge`) alongside redrawing the Gantt SVG canvas. This completely avoids destroying the steps table elements, resolving select menus self-closing.
* **Autofill Rules**:
  - Setting status to `"Completed"` forces progress to `100%`.
  - Setting status to `"Not started"` forces progress to `0%`.
  - Setting status to `"In progress"` or `"On Hold"` (if progress is currently `100%` or `0%`) resets progress to `50%`.
  - Selecting progress to `100%` sets status to `"Completed"`. Selecting `0%` sets status to `"Not started"`. Selecting `25%`/`50%`/`75%` sets status to `"In progress"` (if it was previously `"Completed"` or `"Not started"`).

### 🏎️ Sequential Push Queue & Debounced Autosave
* **Push Serialization Queue**: Background writes are serialized through a promise queue (`syncPromiseChain`) in `js/store.js`. This guarantees that consecutive saves run sequentially, fetching the latest remote SHA and preventing branch conflict errors.
* **Debounced Pushes**: Auto-save updates are debounced by `2000ms`. Rapid successive modifications are consolidated locally and committed in a single batch, minimizing GitHub API consumption.
* **Write Lock**: A state boolean (`isPushingActive`) locks background sync checks while a write is in flight, preventing old remote content from overriding your local workspace during commits.

### 📏 Dynamic Gantt Axis Width
* The left-axis labels column width (`leftAxisWidth` in `js/gantt.js`) is calculated dynamically on-demand:
  ```javascript
  const leftAxisWidth = Math.max(120, Math.min(280, Math.ceil(maxLabelLength * 6.8 + 25)));
  ```
  This automatically fits long assignee/ext-dependency labels to prevent text cropping on the left border of the SVG canvas, while shrinking on short label charts to maximize grid width.

---

## 🎨 4. Branding & Visual Assets
* **Brand Logo (Left Navbar):** Located at `logo.png` (Prometeon main logo). Scaled via CSS `.brand-logo-img` to `38px` height.
* **Team Badge (Right Navbar):** Displayed as **PTG Smart Manufacturing Team** with the custom Prometeon "P" symbol mark icon (`p_logo.png?v=1.2`). Styled via CSS `.profile-logo-img` to `18px` square.
* **Sync Button (Right Navbar):** A `🔄` button placed between the settings gear and the team badge. Uses `.settings-btn` styling with a `.syncing` animation class.
* **Tab Favicon:** Displayed as the Prometeon "P" symbol mark icon (`p_logo.png?v=1.2`).
* **Interactive Elements:** The settings gear `⚙️` is placed on the far right. Hovering over it triggers a modern spin micro-animation.

---

## 📱 5. Responsive Design & Layout Rules
To support standard 1080p, 1360x720, and mobile screens, the app conforms to these layout rules:

1. **Card Stacking:** Layout grids (like the `.details-workspace-grid` and `.settings-grid`) display side-by-side on desktop, but stack vertically (`grid-template-columns: 1fr`) on screens under `768px`.
2. **Scroll Lock Resolution:** Any custom dismiss triggers (Cancel buttons, modal top-right close buttons) must call `window.UI.closeModal(modalId)` instead of manually manipulating CSS classes. This ensures the background scroll-lock (`body { overflow: hidden }`) is correctly released.
3. **Responsive Modals:** The `.modal-card` uses a flexible flex-column layout. Its body (`.modal-body`) has `overflow-y: auto`, `min-width: 0`, and a maximum height constraint (`max-height: calc(92vh - 120px)`) to ensure forms never overflow the screen boundaries on small mobile devices.
4. **Horizontal Scroll Containment & Mobile Clamping:** To prevent wide tables (like the 12-column `.steps-table`) or Gantt SVGs from stretching the page layout, we apply width constraints:
   - The `.steps-section`, `.gantt-card`, `.log-form-container`, `.log-archive-container`, and `.modal-card` use `min-width: 0` or `min-width: 0 !important`.
   - The table container `.table-responsive` displays as `block` with `width: 100%; overflow-x: auto`.
   - This keeps horizontal swiping isolated inside the table or Gantt cards, leaving the main viewport perfectly aligned.
5. **Date Column Sizing:** Steps table date cells (`.steps-table td.text-small`) use `white-space: nowrap` with `font-size: 11px` to prevent wrapping in 1080p split-screen layouts.
6. **Cache-Busting Versioning:** Whenever modifying CSS styles or assets, increment the query parameter version in `index.html` (e.g. `<link rel="stylesheet" href="css/styles.css?v=2.0">` or `<script src="js/app.js?v=2.0"></script>`) to force browsers to reload immediately. Current versions (July 2026): CSS `v=2.5`, app.js `v=3.0`, store.js `v=2.2`, gantt.js `v=1.3`, components.js `v=2.0`.

---

## 📂 6. Directory File Index
* **`index.html`:** Root entrypoint containing SPA shells, responsive navigation blocks, the manual sync `🔄` button, and modal form layouts.
* **`css/styles.css`:** Core stylesheets containing color variables, premium cards, animation timelines, sync button spin animation, and media query breakpoints.
* **`js/store.js`:** The database engine. Manages state, drives GitHub API sync, handles loaded Git SHA conflict verification, maintains daily logs archiving, and exports `autoDetectGitHubRepo()` for guest access.
* **`js/app.js`:** The application controller. Directs routing, renders HTML templates, manages background sync on navigation (`triggerBackgroundSyncCheck`), wires up the manual sync button, formats UI date strings, and wires up form event listeners.
* **`js/components.js`:** UI components. Handles toast alerts and modal show/close animations.
* **`js/gantt.js`:** Gantt chart engine. Dynamically renders SVG timelines based on project schedule steps.
