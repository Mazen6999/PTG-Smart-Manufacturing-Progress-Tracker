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

### 🏎️ Single-File Database Model & Partitioned Archiving
* We use a unified **`database.json`** format to keep network requests to a minimum:
  ```json
  {
    "projects": [...],
    "steps": [...],
    "logs": [...]
  }
  ```
  This dropped API overhead to exactly **1 read request** and **2 write requests** (saving and verifying), bringing sync times down to **~150ms** (loads) and **~400ms** (saves).
* **Logs Archive Partitioning:** To keep load times fast, only the latest 30 daily logs are stored in `database.json`. Older logs are merged into `database_archive.json` in the repository. The full history is loaded on-demand in the UI.

### ✏️ Project Metadata Editing
* **Inline Updates:** Users can edit project names, descriptions, priorities, assignees, and dates inline via a dedicated `#edit-project-modal` form.
* **Dynamic Re-calculation:** Editing project parameters invokes `window.Store.updateProject()` which saves the updates, triggers recalculations (such as progress and stats), commits changes dynamically, and instantly re-renders active dashboard tables or timeline headers.

### 👥 Unauthenticated Guest Access (Auto-Detect)
* If the app is opened on `github.io` by a user without a Personal Access Token (PAT) configured, it auto-detects hosting via `window.Store.autoDetectGitHubRepo()` and makes an unauthenticated REST API call to fetch `database.json`.
* This allows general team visitors to view real-time roadmap updates instantly on page reload. If the public rate limit (60 requests/hour per IP) is reached, it falls back to the static raw CDN URL.

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
6. **Cache-Busting Versioning:** Whenever modifying CSS styles or assets, increment the query parameter version in `index.html` (e.g. `<link rel="stylesheet" href="css/styles.css?v=2.0">` or `<script src="js/app.js?v=2.0"></script>`) to force browsers to reload immediately instead of serving a cached version.

---

## 📂 6. Directory File Index
* **`index.html`:** Root entrypoint containing SPA shells, responsive navigation blocks, the manual sync `🔄` button, and modal form layouts.
* **`css/styles.css`:** Core stylesheets containing color variables, premium cards, animation timelines, sync button spin animation, and media query breakpoints.
* **`js/store.js`:** The database engine. Manages state, drives GitHub API sync, handles loaded Git SHA conflict verification, maintains daily logs archiving, and exports `autoDetectGitHubRepo()` for guest access.
* **`js/app.js`:** The application controller. Directs routing, renders HTML templates, manages background sync on navigation (`triggerBackgroundSyncCheck`), wires up the manual sync button, formats UI date strings, and wires up form event listeners.
* **`js/components.js`:** UI components. Handles toast alerts and modal show/close animations.
* **`js/gantt.js`:** Gantt chart engine. Dynamically renders SVG timelines based on project schedule steps.
