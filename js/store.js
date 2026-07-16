// State persistence layer using LocalStorage with background server sync or GitHub API sync

const STORAGE_KEYS = {
    PROJECTS: 'sm_progress_projects',
    STEPS: 'sm_progress_steps',
    LOGS: 'sm_progress_logs',
    GITHUB_CONFIG: 'sm_progress_github_config'
};

// Help query items
function getItems(key) {
    try {
        return JSON.parse(localStorage.getItem(key)) || [];
    } catch (e) {
        console.error("Failed to parse local storage for key", key, e);
        return [];
    }
}

function setItems(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
}

// GitHub Config Accessors
function getGitHubConfig() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEYS.GITHUB_CONFIG)) || {
            enabled: false,
            repo: '',
            token: '',
            branch: 'main',
            folder: ''
        };
    } catch (e) {
        console.error("Failed to parse GitHub config:", e);
        return { enabled: false, repo: '', token: '', branch: 'main', folder: '' };
    }
}

function saveGitHubConfig(config) {
    localStorage.setItem(STORAGE_KEYS.GITHUB_CONFIG, JSON.stringify(config));
}

// Fetch database from GitHub
async function fetchDatabaseFromGitHub(config) {
    const { repo, token, branch, folder } = config;
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    // 1. Fetch directory listing to find target files
    const dirUrl = `https://api.github.com/repos/${repo}/contents/${folder || ''}?ref=${branch}`;
    const dirRes = await fetch(dirUrl, { headers });
    if (!dirRes.ok) {
        throw new Error(`Failed to list GitHub directory: ${dirRes.statusText}`);
    }
    const files = await dirRes.json();

    const projectsFile = files.find(f => f.name === 'projects.json');
    const logFiles = files.filter(f => f.name.startsWith('logs_') && f.name.endsWith('.json'));

    let projects = [];
    let steps = [];
    let logs = [];

    // Helper to fetch file content via the API (avoiding CORS issues on raw.githubusercontent.com)
    async function fetchFileContent(filePath) {
        const url = `https://api.github.com/repos/${repo}/contents/${filePath}?ref=${branch}`;
        const res = await fetch(url, { headers });
        if (res.ok) {
            const fileData = await res.json();
            // Decode base64 (safely preserving UTF-8 Unicode characters)
            const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
            return JSON.parse(decoded);
        }
        throw new Error(`Failed to load file: ${filePath}`);
    }

    // 2. Fetch projects.json (projects + steps)
    if (projectsFile) {
        try {
            const projData = await fetchFileContent(projectsFile.path);
            projects = projData.projects || [];
            steps = projData.steps || [];
        } catch (e) {
            console.error("Failed to read projects.json:", e);
        }
    }

    // 3. Fetch all log files in parallel
    if (logFiles.length > 0) {
        const logPromises = logFiles.map(async (file) => {
            try {
                return await fetchFileContent(file.path);
            } catch (err) {
                console.warn(`Failed to fetch log file ${file.name}:`, err);
            }
            return null;
        });

        const logsArrays = await Promise.all(logPromises);
        logsArrays.forEach(arr => {
            if (arr && Array.isArray(arr)) {
                logs = logs.concat(arr);
            }
        });
    }

    return { projects, steps, logs };
}

// Save database to GitHub (creates/updates files and deletes unreferenced logs)
async function saveDatabaseToGitHub(config) {
    const { repo, token, branch, folder } = config;
    const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';
    const headers = {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
    };

    // 1. Fetch current directory state to get SHAs
    const dirUrl = `https://api.github.com/repos/${repo}/contents/${folder || ''}?ref=${branch}`;
    const dirRes = await fetch(dirUrl, { headers: { 'Authorization': `token ${token}` } });
    let existingFiles = [];
    if (dirRes.ok) {
        existingFiles = await dirRes.json();
    } else if (dirRes.status !== 404) {
        throw new Error(`Failed to fetch current directory state: ${dirRes.statusText}`);
    }

    // 2. Write projects.json
    const projectsData = {
        projects: getItems(STORAGE_KEYS.PROJECTS),
        steps: getItems(STORAGE_KEYS.STEPS)
    };
    const projectsJson = JSON.stringify(projectsData, null, 2);
    const projectsSha = existingFiles.find(f => f.name === 'projects.json')?.sha;

    // Helper to upload a file to GitHub
    async function uploadFile(filename, content, sha) {
        const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}${filename}`;
        const base64Content = btoa(unescape(encodeURIComponent(content)));
        
        const body = {
            message: `Update ${filename} via Progress Tracker`,
            content: base64Content,
            branch
        };
        if (sha) {
            body.sha = sha;
        }

        const res = await fetch(url, {
            method: 'PUT',
            headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`Failed to save ${filename}: ${errData.message || res.statusText}`);
        }
    }

    // Helper to delete a file from GitHub
    async function deleteFile(filename, sha) {
        const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}${filename}`;
        const body = {
            message: `Delete ${filename} (unreferenced engineer logs)`,
            sha,
            branch
        };

        const res = await fetch(url, {
            method: 'DELETE',
            headers,
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            throw new Error(`Failed to delete ${filename}: ${errData.message || res.statusText}`);
        }
    }

    // Upload projects.json
    await uploadFile('projects.json', projectsJson, projectsSha);

    // 3. Upload engineer logs
    const logs = getItems(STORAGE_KEYS.LOGS);
    const writtenLogFiles = new Set();
    const savePromises = [];

    if (logs.length > 0) {
        const groupedLogs = {};
        logs.forEach(log => {
            const engineer = log.engineer || 'Unknown';
            const safeName = engineer.replace(/[^a-zA-Z0-9]/g, '');
            const key = safeName || 'Unknown';
            if (!groupedLogs[key]) {
                groupedLogs[key] = [];
            }
            groupedLogs[key].push(log);
        });

        for (const [engineerName, engineerLogs] of Object.entries(groupedLogs)) {
            const filename = `logs_${engineerName}.json`;
            writtenLogFiles.add(filename);

            const content = JSON.stringify(engineerLogs, null, 2);
            const sha = existingFiles.find(f => f.name === filename)?.sha;
            
            savePromises.push(uploadFile(filename, content, sha));
        }
    }

    await Promise.all(savePromises);

    // 4. Delete old log files no longer referenced
    const deletePromises = [];
    existingFiles.forEach(file => {
        if (file.name.startsWith('logs_') && file.name.endsWith('.json')) {
            if (!writtenLogFiles.has(file.name)) {
                deletePromises.push(deleteFile(file.name, file.sha));
            }
        }
    });

    await Promise.all(deletePromises);
}

// Check if storage is empty and initialize (syncs from server or GitHub if configured)
async function initStore() {
    const gitHubConfig = getGitHubConfig();
    if (gitHubConfig.enabled && gitHubConfig.repo && gitHubConfig.token) {
        try {
            console.log("GitHub Sync is active. Synchronizing from GitHub repo...");
            const data = await fetchDatabaseFromGitHub(gitHubConfig);
            if (data && data.projects && data.steps && data.logs) {
                setItems(STORAGE_KEYS.PROJECTS, data.projects);
                setItems(STORAGE_KEYS.STEPS, data.steps);
                setItems(STORAGE_KEYS.LOGS, data.logs);
                console.log("Database successfully synced from GitHub.");
                return;
            }
        } catch (e) {
            console.warn("Could not sync database from GitHub (offline fallback active):", e);
        }
    } else {
        try {
            // Try fetching database.json from local server
            const res = await fetch('database.json?t=' + Date.now());
            if (res.ok) {
                const data = await res.json();
                if (data.projects && data.steps && data.logs) {
                    setItems(STORAGE_KEYS.PROJECTS, data.projects);
                    setItems(STORAGE_KEYS.STEPS, data.steps);
                    setItems(STORAGE_KEYS.LOGS, data.logs);
                    console.log("Database successfully synced from local server database.json");
                    return;
                }
            }
        } catch (e) {
            console.warn("Could not sync database from local server (offline fallback active):", e);
        }
    }

    // Fallback if no server or error
    if (!localStorage.getItem(STORAGE_KEYS.PROJECTS)) {
        localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(MOCK_PROJECTS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.STEPS)) {
        localStorage.setItem(STORAGE_KEYS.STEPS, JSON.stringify(MOCK_STEPS));
    }
    if (!localStorage.getItem(STORAGE_KEYS.LOGS)) {
        localStorage.setItem(STORAGE_KEYS.LOGS, JSON.stringify(MOCK_LOGS));
    }
}

// Trigger background server file write sync or GitHub update sync
async function triggerSync() {
    const gitHubConfig = getGitHubConfig();
    if (gitHubConfig.enabled && gitHubConfig.repo && gitHubConfig.token) {
        try {
            console.log("GitHub Sync is active. Syncing data to GitHub...");
            window.dispatchEvent(new CustomEvent('github-sync-start'));
            await saveDatabaseToGitHub(gitHubConfig);
            console.log("Database successfully synced to GitHub.");
            window.dispatchEvent(new CustomEvent('github-sync-success'));
        } catch (e) {
            console.error("Could not sync database to GitHub:", e);
            window.dispatchEvent(new CustomEvent('github-sync-error', { detail: e.message }));
        }
        return;
    }

    try {
        const data = {
            projects: getItems(STORAGE_KEYS.PROJECTS),
            steps: getItems(STORAGE_KEYS.STEPS),
            logs: getItems(STORAGE_KEYS.LOGS)
        };
        
        await fetch('api/save', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        });
        console.log("Database changes successfully saved to server disk.");
    } catch (e) {
        console.warn("Could not save database changes to server disk (offline storage active):", e);
    }
}

// --- PROJECTS CRUD ---
function getProjects() {
    const projects = getItems(STORAGE_KEYS.PROJECTS);
    const steps = getItems(STORAGE_KEYS.STEPS);

    // Calculate progress dynamically for each project based on steps average
    return projects.map(proj => {
        const projSteps = steps.filter(s => s.project_id === proj.id);
        const progress = projSteps.length > 0
            ? projSteps.reduce((acc, s) => acc + (Number(s.progress) || 0), 0) / projSteps.length
            : 0;
        return { ...proj, progress };
    });
}

function getProject(id) {
    const projects = getProjects();
    return projects.find(p => p.id === Number(id));
}

function addProject(project) {
    const projects = getItems(STORAGE_KEYS.PROJECTS);
    const newId = projects.length > 0 ? Math.max(...projects.map(p => p.id)) + 1 : 1;
    
    const newProject = {
        id: newId,
        name: project.name,
        description: project.description || '',
        status: project.status || 'Not started',
        priority: Number(project.priority) || 9999.0,
        start_date: project.start_date || null,
        due_date: project.due_date || null,
        assigned_to: project.assigned_to || null,
        latest_update: null,
        next_step: null,
        blocked_by: null
    };
    
    projects.push(newProject);
    setItems(STORAGE_KEYS.PROJECTS, projects);

    // Seed project with two default steps
    const today = new Date().toISOString().split('T')[0];
    const inTwoDays = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const inSevenDays = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    addStep({
        project_id: newId,
        step_code: 's1',
        name: 'Kickoff & Planning',
        assigned_to: newProject.assigned_to || 'Team',
        duration: 2,
        start_date: today,
        end_date: inTwoDays,
        progress: 100,
        status: 'Completed',
        section: 'SETUP',
        dependencies: null,
        external_dep: null
    });

    addStep({
        project_id: newId,
        step_code: 's2',
        name: 'Requirements Definition',
        assigned_to: newProject.assigned_to || 'Team',
        duration: 5,
        start_date: inTwoDays,
        end_date: inSevenDays,
        progress: 0,
        status: 'Not started',
        section: 'SETUP',
        dependencies: 's1',
        external_dep: null
    });

    recalculateProjectStats(newId);
    triggerSync();
    return newProject;
}

function updateProject(id, fields) {
    const projects = getItems(STORAGE_KEYS.PROJECTS);
    const index = projects.findIndex(p => p.id === Number(id));
    if (index !== -1) {
        projects[index] = { ...projects[index], ...fields };
        setItems(STORAGE_KEYS.PROJECTS, projects);
        recalculateProjectStats(id);
        triggerSync();
        return projects[index];
    }
    return null;
}

function deleteProject(id) {
    // Delete project
    const projects = getItems(STORAGE_KEYS.PROJECTS).filter(p => p.id !== Number(id));
    setItems(STORAGE_KEYS.PROJECTS, projects);

    // Cascade delete steps
    const steps = getItems(STORAGE_KEYS.STEPS).filter(s => s.project_id !== Number(id));
    setItems(STORAGE_KEYS.STEPS, steps);

    // Set project_id to null for historical logs
    const logs = getItems(STORAGE_KEYS.LOGS).map(l => {
        if (l.project_id === Number(id)) {
            return { ...l, project_id: null, type: 'Extra' };
        }
        return l;
    });
    setItems(STORAGE_KEYS.LOGS, logs);
    triggerSync();
}

// --- STEPS CRUD ---
// Helper to compare step codes numerically/naturally (e.g. s1 < s2 < s10)
function compareStepCodes(a, b) {
    const parseNum = (code) => {
        if (!code) return 0;
        const match = code.toString().match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    };
    const numA = parseNum(a.step_code);
    const numB = parseNum(b.step_code);
    if (numA !== numB) {
        return numA - numB;
    }
    return (a.step_code || '').localeCompare(b.step_code || '');
}

function getSteps(projectId) {
    const steps = getItems(STORAGE_KEYS.STEPS);
    const pid = Number(projectId);
    return steps.filter(s => s.project_id === pid).sort(compareStepCodes);
}

function addStep(step) {
    const steps = getItems(STORAGE_KEYS.STEPS);
    const newId = steps.length > 0 ? Math.max(...steps.map(s => s.id)) + 1 : 1;
    
    // Calculate duration if not provided
    let duration = Number(step.duration);
    if ((!duration || isNaN(duration)) && step.start_date && step.end_date) {
        const start = new Date(step.start_date);
        const end = new Date(step.end_date);
        duration = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
    }

    const newStep = {
        id: newId,
        project_id: Number(step.project_id),
        step_code: step.step_code || `s${getSteps(step.project_id).length + 1}`,
        name: step.name,
        assigned_to: step.assigned_to || null,
        duration: duration || 1,
        start_date: step.start_date || null,
        end_date: step.end_date || null,
        progress: Number(step.progress) || 0,
        status: step.status || 'Not started',
        dependencies: step.dependencies || null,
        section: step.section || null,
        external_dep: step.external_dep || null
    };

    steps.push(newStep);
    setItems(STORAGE_KEYS.STEPS, steps);
    recalculateProjectStats(step.project_id);
    triggerSync();
    return newStep;
}

function updateStep(stepId, fields) {
    const steps = getItems(STORAGE_KEYS.STEPS);
    const index = steps.findIndex(s => s.id === Number(stepId));
    if (index !== -1) {
        let duration = fields.duration;
        if (fields.start_date && fields.end_date) {
            const start = new Date(fields.start_date);
            const end = new Date(fields.end_date);
            duration = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60 * 24)));
        }

        steps[index] = { 
            ...steps[index], 
            ...fields, 
            duration: duration !== undefined ? duration : steps[index].duration 
        };
        setItems(STORAGE_KEYS.STEPS, steps);
        recalculateProjectStats(steps[index].project_id);
        triggerSync();
        return steps[index];
    }
    return null;
}

function deleteStep(stepId) {
    const steps = getItems(STORAGE_KEYS.STEPS);
    const step = steps.find(s => s.id === Number(stepId));
    if (step) {
        const filteredSteps = steps.filter(s => s.id !== Number(stepId));
        setItems(STORAGE_KEYS.STEPS, filteredSteps);
        recalculateProjectStats(step.project_id);
        triggerSync();
    }
}

// Recalculate latest update, next step, blocked by based on active steps
function recalculateProjectStats(projectId) {
    const pid = Number(projectId);
    const steps = getSteps(pid);
    
    // Sort steps by code order
    const sortedSteps = [...steps].sort(compareStepCodes);
    
    // 1. Latest completed step (progress = 100)
    const completedSteps = sortedSteps.filter(s => s.progress === 100);
    const latestUpdate = completedSteps.length > 0 ? completedSteps[completedSteps.length - 1].name : null;

    // 2. Next uncompleted step
    const nextStepRow = sortedSteps.find(s => s.progress < 100);
    const nextStep = nextStepRow ? nextStepRow.name : null;

    // 3. Blocked by (first step with external dependency and incomplete)
    const blockedStep = sortedSteps.find(s => s.progress < 100 && s.external_dep);
    const blockedBy = blockedStep ? blockedStep.external_dep : null;

    // Directly update local array values before writing to localstorage
    const projects = getItems(STORAGE_KEYS.PROJECTS);
    const index = projects.findIndex(p => p.id === pid);
    if (index !== -1) {
        projects[index].latest_update = latestUpdate;
        projects[index].next_step = nextStep;
        projects[index].blocked_by = blockedBy;
        setItems(STORAGE_KEYS.PROJECTS, projects);
    }
}

// --- LOGS CRUD ---
function getLogs(projectId = null) {
    const logs = getItems(STORAGE_KEYS.LOGS);
    if (projectId) {
        return logs.filter(l => l.project_id === Number(projectId)).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }
    return logs.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
}

function addLog(log) {
    const logs = getItems(STORAGE_KEYS.LOGS);
    const newId = logs.length > 0 ? Math.max(...logs.map(l => l.id)) + 1 : 1;
    
    let projectId = log.project_id ? Number(log.project_id) : null;
    let projectName = log.project_name || "Ad-hoc task";
    let logType = 'Extra';

    if (projectId) {
        const proj = getProject(projectId);
        if (proj) {
            projectName = proj.name;
            logType = 'Primary';
        }
    }

    const newLog = {
        id: newId,
        project_id: projectId,
        project_name: projectName,
        date: log.date || new Date().toISOString().split('T')[0],
        engineer: log.engineer || 'Unknown',
        planned_today: log.planned_today || null,
        actually_done: log.actually_done || null,
        comments: log.comments || null,
        type: logType
    };

    logs.push(newLog);
    setItems(STORAGE_KEYS.LOGS, logs);
    triggerSync();
    return newLog;
}

function deleteLog(logId) {
    const logs = getItems(STORAGE_KEYS.LOGS).filter(l => l.id !== Number(logId));
    setItems(STORAGE_KEYS.LOGS, logs);
    triggerSync();
}

// --- BACKUP & EXPORT/IMPORT ---
function exportJSON() {
    const data = {
        projects: getItems(STORAGE_KEYS.PROJECTS),
        steps: getItems(STORAGE_KEYS.STEPS),
        logs: getItems(STORAGE_KEYS.LOGS)
    };
    return JSON.stringify(data, null, 2);
}

function importJSON(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        if (data.projects && Array.isArray(data.projects)) {
            setItems(STORAGE_KEYS.PROJECTS, data.projects);
        }
        if (data.steps && Array.isArray(data.steps)) {
            setItems(STORAGE_KEYS.STEPS, data.steps);
        }
        if (data.logs && Array.isArray(data.logs)) {
            setItems(STORAGE_KEYS.LOGS, data.logs);
        }
        
        // Recalculate stats for all projects
        const projects = getItems(STORAGE_KEYS.PROJECTS);
        projects.forEach(p => recalculateProjectStats(p.id));
        triggerSync();
        return true;
    } catch (e) {
        console.error("Failed to import JSON", e);
        return false;
    }
}

// SQLite File Importer using sql.js WebAssembly
async function importSQLite(arrayBuffer, SQL) {
    try {
        const db = new SQL.Database(new Uint8Array(arrayBuffer));
        
        // Helper to query and map results
        const queryTable = (tableName) => {
            const res = db.exec(`SELECT * FROM ${tableName}`);
            if (res.length === 0) return [];
            
            const columns = res[0].columns;
            const values = res[0].values;
            
            return values.map(row => {
                const obj = {};
                columns.forEach((col, idx) => {
                    obj[col] = row[idx];
                });
                return obj;
            });
        };

        const sqliteProjects = queryTable('projects');
        const sqliteSteps = queryTable('steps');
        const sqliteLogs = queryTable('daily_logs');

        if (sqliteProjects.length === 0) {
            throw new Error("No projects found in the sqlite database.");
        }

        // Write directly to localstorage
        setItems(STORAGE_KEYS.PROJECTS, sqliteProjects);
        setItems(STORAGE_KEYS.STEPS, sqliteSteps);
        setItems(STORAGE_KEYS.LOGS, sqliteLogs);

        // Run dynamic stats update
        sqliteProjects.forEach(p => recalculateProjectStats(p.id));
        triggerSync();
        return {
            success: true,
            projects: sqliteProjects.length,
            steps: sqliteSteps.length,
            logs: sqliteLogs.length
        };
    } catch (err) {
        console.error("Failed parsing SQLite database in client WebAssembly:", err);
        return { success: false, error: err.message };
    }
}

// Attach to window global namespace
window.Store = {
    initStore,
    getProjects,
    getProject,
    addProject,
    updateProject,
    deleteProject,
    getSteps,
    addStep,
    updateStep,
    deleteStep,
    recalculateProjectStats,
    getLogs,
    addLog,
    deleteLog,
    exportJSON,
    importJSON,
    importSQLite,
    getGitHubConfig,
    saveGitHubConfig
};

// --- MOCK SEED DATA ---
const MOCK_PROJECTS = [
    {
        id: 1,
        name: "Technical Support Ai Agent",
        description: "Develop a custom generative AI agent to troubleshoot PLC & shop floor issues.",
        status: "In progress",
        priority: 1.0,
        start_date: "2026-07-01",
        due_date: "2026-08-15",
        assigned_to: "Eng. Mazen",
        latest_update: "Kickoff & Requirements Gathering",
        next_step: "Model Training & Context Injection",
        blocked_by: null
    },
    {
        id: 2,
        name: "PolyShield Coating Rollout",
        description: "Deploy new PolyShield protective layering systems across conveyors compound mixer.",
        status: "On Hold",
        priority: 2.0,
        start_date: "2026-06-15",
        due_date: "2026-07-30",
        assigned_to: "Eng. Taric",
        latest_update: "Material sourcing & selection",
        next_step: "Trial installation on Mixer 1",
        blocked_by: "Supplier delayed"
    }
];

const MOCK_STEPS = [
    {
        id: 1,
        project_id: 1,
        step_code: "s1",
        name: "Kickoff & Requirements Gathering",
        assigned_to: "Eng. Mazen",
        duration: 5,
        start_date: "2026-07-01",
        end_date: "2026-07-06",
        progress: 100,
        status: "Completed",
        dependencies: null,
        section: "PREPARATION",
        external_dep: null
    },
    {
        id: 2,
        project_id: 1,
        step_code: "s2",
        name: "Model Training & Context Injection",
        assigned_to: "Eng. Mazen",
        duration: 12,
        start_date: "2026-07-07",
        end_date: "2026-07-19",
        progress: 40,
        status: "In progress",
        dependencies: "s1",
        section: "CORE",
        external_dep: null
    },
    {
        id: 3,
        project_id: 1,
        step_code: "s3",
        name: "UI Layout Integration",
        assigned_to: "Eng. Nada",
        duration: 8,
        start_date: "2026-07-20",
        end_date: "2026-07-28",
        progress: 0,
        status: "Not started",
        dependencies: "s2",
        section: "FRONTEND",
        external_dep: null
    },
    {
        id: 4,
        project_id: 2,
        step_code: "s1",
        name: "Material sourcing & selection",
        assigned_to: "Eng. Taric",
        duration: 10,
        start_date: "2026-06-15",
        end_date: "2026-06-25",
        progress: 100,
        status: "Completed",
        dependencies: null,
        section: "SUPPLY",
        external_dep: null
    },
    {
        id: 5,
        project_id: 2,
        step_code: "s2",
        name: "Trial installation on Mixer 1",
        assigned_to: "Eng. Taric",
        duration: 15,
        start_date: "2026-06-26",
        end_date: "2026-07-11",
        progress: 20,
        status: "In progress",
        dependencies: "s1",
        section: "TRIAL",
        external_dep: "Supplier delayed"
    }
];

const MOCK_LOGS = [
    {
        id: 1,
        project_id: 1,
        project_name: "Technical Support Ai Agent",
        date: "2026-07-15",
        engineer: "Eng. Mazen",
        planned_today: "Upload knowledge files to LLM model embedding store.",
        actually_done: "Knowledge files parsed and injected. Query response time improved.",
        comments: "Will prepare for UI layout tests next.",
        type: "Primary"
    },
    {
        id: 2,
        project_id: 2,
        project_name: "PolyShield Coating Rollout",
        date: "2026-07-14",
        engineer: "Eng. Taric",
        planned_today: "Follow up with chemical compounds supplier.",
        actually_done: "Supplier confirmed delivery holds due to transport customs lock.",
        comments: "Blocked by supplier delivery timeline.",
        type: "Primary"
    }
];
