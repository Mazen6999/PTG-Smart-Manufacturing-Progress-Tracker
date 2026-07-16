# Agent Rules & Context for SM Progress Tracker

## Project Identity
This is the **Prometeon Smart Manufacturing Progress Tracker** — a web-based SPA used by a team of 5–10 engineers (Mazen, Nada, Tareq/Taric, Ramy, and others) at Prometeon Tyre Group to manage engineering project timelines, daily logs, and Gantt charts.

## Architecture Overview
The active web application lives in `progress_tracker_static_web/`. It is a **100% client-side Single Page Application (SPA)** — no Node.js, no npm, no build steps. It runs on a lightweight PowerShell HTTP server (`server.ps1`) that serves static files and handles JSON persistence.

### Tech Stack
- **Frontend**: Pure HTML + Vanilla CSS + Vanilla JavaScript (no frameworks, no React, no Tailwind)
- **Backend**: PowerShell HTTP listener (`server.ps1`) — serves static files and provides a `/api/save` POST endpoint
- **Database**: JSON files on disk (`projects.json`, `logs_*.json`), synced via OneDrive
- **Gantt Charts**: Pure client-side SVG rendering (`js/gantt.js`) — no external chart libraries
- **SQLite Import**: Client-side WebAssembly via `sql.js` CDN for importing legacy `.db` files

### Key Design Principles
1. **Zero installation required** — double-click `run_static_web.bat` and it works
2. **OneDrive-safe** — data files are designed for shared folder sync without corruption
3. **Offline-capable** — falls back to localStorage when the server is not running
4. **No build step** — all JS is vanilla, loaded via `<script>` tags in `index.html`

## File Structure (Relative Paths)
```
progress_tracker_static_web/
├── index.html              # Single-page shell: navbar, modal overlays, script tags
├── run_static_web.bat      # Double-click launcher (starts server + opens browser)
├── stop_static_web.bat     # Stops the running server
├── server.ps1              # PowerShell HTTP listener (port 8000)
│                             - Serves static files
│                             - GET /database.json → merges projects.json + logs_*.json
│                             - POST /api/save → splits data into projects.json + logs_*.json
├── database.json           # Legacy unified DB (read-only fallback)
├── projects.json           # Active project + steps data (written by server)
├── logs_Mazen.json         # Per-engineer daily log files (written by server)
├── logs_Nada.json
├── server.pid              # PID tracking for server process management
│
├── css/
│   └── styles.css          # Complete design system: glassmorphism, dark accents,
│                             responsive layout, sticky notes card, autocomplete styles
│
└── js/
    ├── app.js              # Main SPA router + view renderers + event wiring
    │                         - Hash-based routing (#/dashboard, #/project/:id, #/logs, #/database)
    │                         - renderDashboard(), renderProjectDetails(), renderLogs(), renderDatabaseView()
    │                         - Search-as-you-type autocomplete for project/engineer fields
    │                         - Gantt download (SVG + PNG export)
    │                         - Sticky notes edit/save handlers
    │                         - Step modal reuse (add/edit modes via data-edit-id attribute)
    │
    ├── store.js            # State persistence layer (localStorage + server sync)
    │                         - CRUD: getProjects, addProject, updateProject, deleteProject
    │                         - CRUD: getSteps, addStep, updateStep, deleteStep
    │                         - CRUD: getLogs, addLog, deleteLog
    │                         - recalculateProjectStats() — auto-derives latest_update, next_step, blocked_by
    │                         - triggerSync() — POST to /api/save after every mutation
    │                         - exportJSON / importJSON / importSQLite (WebAssembly)
    │                         - Natural sort for step codes (s1 < s2 < s10)
    │
    ├── gantt.js            # Pure SVG Gantt chart renderer
    │                         - Calculates date ranges, draws bars with progress fills
    │                         - Today marker (red dashed line), month boundary lines
    │                         - Section labels, dependency arrows
    │                         - Configurable layout: leftAxisWidth=330, bottomPadding=60
    │
    └── components.js       # UI utilities (window.UI namespace)
                              - showToast(message, type) — success/error/warning/info alerts
                              - openModal / closeModal — overlay controllers
                              - setupModalDismissers — click-outside + Escape key handlers
```

## Data Model
### Project Object
```json
{
  "id": 1,
  "name": "Technical Support Ai Agent",
  "description": "...",
  "status": "In progress",       // "Not started" | "In progress" | "Completed" | "On Hold"
  "priority": 1.0,               // Sort order (lower = higher priority)
  "start_date": "2026-07-01",
  "due_date": "2026-08-15",
  "assigned_to": "Mazen",
  "latest_update": "...",         // Auto-derived from steps
  "next_step": "...",             // Auto-derived from steps
  "blocked_by": null,             // Auto-derived from steps with external_dep
  "notes": "DELTAX: AI Camera..." // Project-specific jargon/wiki sticky notes (freeform text)
}
```

### Step Object
```json
{
  "id": 1,
  "project_id": 1,
  "step_code": "s1",
  "name": "Kickoff & Requirements",
  "assigned_to": "Mazen",
  "duration": 5,                  // Auto-calculated from date diff
  "start_date": "2026-07-01",
  "end_date": "2026-07-06",
  "progress": 100,               // 0–100
  "status": "Completed",         // "Not started" | "In progress" | "Completed"
  "dependencies": "s1",          // Predecessor step code
  "section": "PREPARATION",      // Grouping label
  "external_dep": null            // External blocker text
}
```

### Log Object
```json
{
  "id": 1,
  "project_id": 1,
  "project_name": "...",
  "date": "2026-07-15",
  "engineer": "Mazen",
  "planned_today": "...",
  "actually_done": "...",
  "comments": "...",
  "type": "Primary"               // "Primary" (project-linked) | "Extra" (ad-hoc)
}
```

## UI/UX Patterns & Conventions
1. **Engineer Names**: Deduplicated and stripped of "Eng." prefix. Canonical names: Mazen, Nada, Tareq (mapped from Taric/Tarek variants)
2. **Search-as-you-type**: Project and engineer fields use custom autocomplete overlays (not native `<select>` dropdowns)
3. **Step Modal Reuse**: The single `#new-step-modal` is dynamically reused for both adding and editing steps. Edit mode sets `data-edit-id` on the form; add mode removes it
4. **Sticky Notes**: Each project has a yellow post-it card for freeform jargon/wiki text. Newlines are converted to `<br>` on display
5. **Gantt Downloads**: SVG (vector) and PNG (2x scaled canvas render) export buttons in the Gantt header
6. **Layout**: Top navbar (no sidebar), full-width content viewport, responsive mobile bottom nav at <768px

## How to Launch
1. Double-click `progress_tracker_static_web/run_static_web.bat`
2. Browser opens at `http://localhost:8000`
3. To stop: close the console window or run `stop_static_web.bat`

## Sync Architecture
```
Browser (localStorage) ──POST /api/save──► server.ps1 ──writes──► projects.json + logs_*.json
                                                                        │
Browser (page load) ◄──GET /database.json── server.ps1 ◄──reads+merges──┘
```
- On every mutation (add/edit/delete), `triggerSync()` POSTs the full state to the server
- The server splits data: projects+steps → `projects.json`, logs → per-engineer `logs_*.json`
- On page load, `initStore()` fetches `/database.json` which the server dynamically merges from these files
- Files live on OneDrive, so they auto-sync to all team members

## Known Limitations
- **Last-Write-Wins**: If two users save at the exact same second, the last write overwrites. Acceptable for a team of 5–10 updating at different times
- **No authentication**: The app is designed for a trusted LAN/OneDrive team environment
- **No real-time push**: Users must refresh to see others' changes (acceptable for daily log workflows)

## Legacy Components (Can Be Ignored)
- `progress_tracker_web/` — Old Python/FastAPI web app (deleted by user, may still have remnants)
- `generate_gantt.py` — Original Python Gantt generator for Excel (superseded by JS Gantt in the SPA)
- `Progress tracker list.xlsx` — Original Excel workbook (data was migrated to JSON via SQLite import)

## Local Network Sharing & Troubleshooting
The server runs on port 8000 and is configured to bind to wildcard `http://*:8000/` so other devices in the local network (such as engineers accessing it via the host's IP `http://<host-ip>:8000/`) can load the app.

### 1. Fallback Behavior
- **Wildcard Bind**: The server tries to listen on `http://*:8000/` first. If successful, it displays the network IP addresses (e.g. `http://10.132.98.220:8000`).
- **Localhost Fallback**: If the wildcard bind fails (typically because of lack of Administrator privileges or URL ACL reservation on Windows), the server automatically falls back to loopback-only mode (`http://localhost:8000/`) and shows instructions on how to enable external sharing.

### 2. Granting Network Permissions (One-Time Setup)
To run the server without Administrator privileges and allow other devices to connect, run this command once in an elevated (Administrator) Command Prompt or PowerShell:
```cmd
netsh http add urlacl url=http://*:8000/ user=Everyone
```
*(If Windows is non-English, use: `netsh http add urlacl url=http://*:8000/ sddl="D:(A;;GX;;;WD)"`)*

### 3. Firewall Rules
If other devices cannot reach the host IP (connection times out), verify that port 8000 is open in the Windows Defender Firewall. You can add a rule by running this command once as Administrator:
```cmd
netsh advfirewall firewall add rule name="Prometeon Progress Tracker" dir=in action=allow protocol=TCP localport=8000
```
