# Prometeon Smart Manufacturing — Progress Tracker (Serverless Edition)

This is the serverless client-side Single Page Application (SPA) for tracking engineering project timelines, daily logs, and visual Gantt charts for the Smart Manufacturing team at **Prometeon Tyre Group**. 

By replacing the local PowerShell HTTP server with direct **GitHub REST API integration**, this application runs 100% serverless and is hosted for free on **GitHub Pages**.

---

## 🌐 Live Web App
👉 **[PTG Smart Manufacturing Progress Tracker](https://mazen6999.github.io/PTG-Smart-Manufacturing-Progress-Tracker/)**

---

## 👥 Team Setup (One-Time Instruction)
To protect editing capabilities while keeping the site public, data updates require a Personal Access Token (PAT):

1. **Generate Token:** Click **[Generate GitHub PAT](https://github.com/settings/tokens/new?scopes=repo&description=SM%20Progress%20Tracker)** (pre-checks the `repo` scope for you).
2. **Save Token:** Scroll to the bottom, click **Generate token**, and copy the code starting with `ghp_`.
3. **Configure App:** Open the live website URL, navigate to the **Settings** page, check **Enable GitHub Sync**, and fill in the details:
   * **Repository**: `Mazen6999/PTG-Smart-Manufacturing-Progress-Tracker`
   * **Token**: *Paste your generated ghp_ token*
   * **Branch**: `main`
4. Click **Save GitHub Settings**. The app will immediately synchronize the latest timeline data and daily logs directly from the repository.

---

## 📂 Web App Structure
```
sm-progress-tracker-github-web/
├── index.html              # Dynamic SPA shell: dashboard, timelines, modals
├── projects.json           # Projects and schedule steps (updated by REST API)
├── logs_*.json             # Per-engineer daily log files (segregated to prevent conflicts)
├── css/
│   └── styles.css          # Design system: glassmorphism, responsive, dark elements
├── js/
│   ├── app.js              # Router, Settings console UI, and custom sync toast wiring
│   ├── store.js            # Hybrid storage sync driver (local storage + GitHub REST API)
│   ├── gantt.js            # Pure client-side SVG Gantt chart engine
│   └── components.js       # Global overlays, toasts, and modal dismissers
└── README.md               # Development & deployment documentation (this file)
```

---

## 🛠️ Step-by-Step Build & Deployment History

This project was successfully migrated from a local Excel/PowerShell setup to a serverless cloud setup through the following steps:

### Step 1: Standalone Folder Separation
The frontend assets (`index.html`, `js/`, `css/`, initial JSONs) were separated from the legacy directory (which housed Matplotlib scripts and Excel sheets) into a clean, standalone folder:
* **Directory Name:** `sm-progress-tracker-github-web/`

### Step 2: Implementation of GitHub API Sync Driver
* **Storage Engine ([js/store.js](js/store.js)):**
  - Extended the CRUD store to check if `sm_progress_github_config` is enabled in `localStorage`.
  - Added `fetchDatabaseFromGitHub()` to list files in the repo, retrieve `projects.json`, pull engineer log files `logs_*.json` in parallel, and merge them.
  - Added `saveDatabaseToGitHub()` to parse changes, group logs by engineer, write files as Base64 UTF-8 payloads, and delete unreferenced engineer files.
  - **CORS Resolution:** Initially, fetching raw files directly from the `raw.githubusercontent.com` domain with authorization headers triggered browser CORS blocks. We resolved this by querying the main `api.github.com/repos/.../contents` endpoint and decoding the base64 content via client-side Javascript.
* **User Interface ([js/app.js](js/app.js)):**
  - Added a configuration panel to the Settings page.
  - Registered global event listeners (`github-sync-start`, `github-sync-success`, `github-sync-error`) to display visual success/failure toast messages on save operations.

### Step 3: Git Initialization & Commit
A local Git repository was initialized, and all standalone files were staged and committed:
```bash
git init
git config user.name "Mazen"
git config user.email "mazen.shams@prometeon.com"
git add .
git commit -m "Initialize standalone serverless progress tracker"
```

### Step 4: GitHub Repository Creation & Pushing
A new repository was created on GitHub using a Personal Access Token via the GitHub REST API from the terminal, and the commits were pushed:
```bash
# 1. Create repo via API
Invoke-RestMethod -Uri "https://api.github.com/user/repos" -Method Post -Headers $headers -Body $body

# 2. Add authenticated remote and push
git remote add origin https://Mazen6999:<token>@github.com/Mazen6999/PTG-Smart-Manufacturing-Progress-Tracker.git
git branch -M main
git push -u origin main

# 3. Clean local remote URL for security
git remote set-url origin https://github.com/Mazen6999/PTG-Smart-Manufacturing-Progress-Tracker.git
```

### Step 5: Enabling GitHub Pages
GitHub Pages was activated on the repository to deploy from the `/ (root)` folder of the `main` branch, making the Single Page Application instantly available on the web.

---

## ⚙️ Offline & Local Fallback
If you ever want to work offline or test modifications locally:
1. Turn **GitHub Sync** to **OFF** in Settings.
2. Launch the local PowerShell server by double-clicking `run_static_web.bat`.
3. The app will automatically fall back to local disk persistence on port `8000`.
