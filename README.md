# Prometeon Smart Manufacturing — Progress Tracker (Serverless Edition)

This is the serverless client-side Single Page Application (SPA) for tracking engineering project timelines, daily logs, and visual Gantt charts for the Smart Manufacturing team at **Prometeon Tyre Group**. 

By replacing the local PowerShell HTTP server with direct **GitHub REST API integration**, this application runs 100% serverless and is hosted for free on **GitHub Pages**.

---

## 🌐 Live Web App
👉 **[PTG Smart Manufacturing Progress Tracker](https://mazen6999.github.io/PTG-Smart-Manufacturing-Progress-Tracker/)**

---

## 👥 Team & Collaborators Setup (Onboarding)

Since this repository is public, anyone can **view** the dashboards, Gantt charts, and daily logs. However, **only authorized team members** can add projects, edit schedule steps, or submit logs.

Follow these two quick steps to authorize a team member (e.g. Nada, Tareq, Ramy):

### Step 1: Add them as Repository Collaborators (Admin Action)
1. Go to your repository settings page: **[Settings → Collaborators](https://github.com/Mazen6999/PTG-Smart-Manufacturing-Progress-Tracker/settings/collaboration)**.
2. Click **Add People** and invite them using their GitHub username or email.
3. Once they accept the invitation, they are authorized to commit changes to the database.

### Step 2: Connect the Web App (Team Member Action)
Each authorized engineer performs this one-time setup on their browser:
1. Open the live site: **[PTG Smart Manufacturing Progress Tracker](https://mazen6999.github.io/PTG-Smart-Manufacturing-Progress-Tracker/)**.
2. Click **[Generate GitHub PAT](https://github.com/settings/tokens/new?scopes=repo&description=SM%20Progress%20Tracker)** to generate a Personal Access Token (PAT) with `repo` scope from their GitHub account.
3. Copy the token code (starts with `ghp_`).
4. In the web app, navigate to the **Settings & SQLite** page, check **Enable GitHub Sync**, and fill in the details:
   - **Repository**: `Mazen6999/PTG-Smart-Manufacturing-Progress-Tracker`
   - **Personal Access Token**: *Paste their ghp_ token*
   - **Branch**: `main`
5. Click **Save GitHub Settings**. The app will immediately pull the latest projects and logs, and enable full read/write editing capabilities!

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
