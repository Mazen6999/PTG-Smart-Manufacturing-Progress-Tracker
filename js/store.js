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

// Fetch database from GitHub (optimized to retrieve single database.json)
async function fetchDatabaseFromGitHub(config) {
    const { repo, token, branch, folder } = config;
    const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}database.json?ref=${branch}&t=` + Date.now();
    const res = await fetch(url, { headers, cache: 'no-store' });
    if (res.ok) {
        const fileData = await res.json();
        // Decode base64 safely (preserving UTF-8 Unicode characters)
        const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
        const data = JSON.parse(decoded);
        return {
            projects: data.projects || [],
            steps: data.steps || [],
            logs: data.logs || []
        };
    }
    throw new Error(`Failed to load database.json from GitHub: ${res.statusText}`);
}

// Generic function to save any JSON file to GitHub
async function saveJsonFileToGitHub(config, filename, data, commitMessage, force = false, forceSha = null) {
    const { repo, token, branch, folder } = config;
    const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';
    const headers = {
        'Authorization': `token ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
    };

    // 1. Fetch current file details to get the SHA
    const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}${filename}?ref=${branch}&t=` + Date.now();
    const getRes = await fetch(url, { headers, cache: 'no-store' });
    let sha = forceSha;
    if (!sha && getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
    }

    const contentJson = JSON.stringify(data, null, 2);
    const base64Content = btoa(unescape(encodeURIComponent(contentJson)));

    const body = {
        message: commitMessage || `Update ${filename} via Progress Tracker`,
        content: base64Content,
        branch
    };
    if (sha) {
        body.sha = sha;
    }

    // 2. Write update to GitHub
    const putRes = await fetch(url.split('?')[0], {
        method: 'PUT',
        headers,
        body: JSON.stringify(body)
    });

    if (!putRes.ok) {
        const errData = await putRes.json().catch(() => ({}));
        throw new Error(`Failed to save ${filename}: ${errData.message || putRes.statusText}`);
    }

    try {
        const putResData = await putRes.json();
        if (putResData.content && putResData.content.sha) {
            return putResData.content.sha;
        }
    } catch (e) {
        console.error(`Failed to parse PUT response JSON for ${filename}:`, e);
    }
    return sha;
}

// Save database to GitHub (optimized to write a single database.json)
async function saveDatabaseToGitHub(config, commitMessage = null, force = false) {
    const { repo, token, branch, folder } = config;
    const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    // 1. Fetch current database.json details to get the SHA
    const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}database.json?ref=${branch}&t=` + Date.now();
    const getRes = await fetch(url, { headers, cache: 'no-store' });
    let sha = null;
    if (getRes.ok) {
        const fileData = await getRes.json();
        sha = fileData.sha;
    }

    // Conflict Check
    const loadedSha = localStorage.getItem('sm_progress_loaded_sha');
    if (loadedSha && sha && loadedSha !== sha && !force) {
        console.warn(`Conflict detected! Loaded SHA: ${loadedSha}, Remote SHA: ${sha}`);
        throw new Error("CONFLICT_DETECTED");
    }

    // 2. Prepare unified data payload
    const unifiedData = {
        projects: getItems(STORAGE_KEYS.PROJECTS),
        steps: getItems(STORAGE_KEYS.STEPS),
        logs: getItems(STORAGE_KEYS.LOGS)
    };

    return await saveJsonFileToGitHub(config, 'database.json', unifiedData, commitMessage, force, sha);
}

function autoDetectGitHubRepo() {
    const host = window.location.hostname;
    const path = window.location.pathname;
    if (host.endsWith('github.io')) {
        const owner = host.split('.')[0];
        const repo = path.split('/')[1];
        if (owner && repo) {
            return { owner, repo };
        }
    }
    return null;
}

// Check if storage is empty and initialize (syncs from server or GitHub if configured)
async function initStore() {
    const gitHubConfig = getGitHubConfig();
    const detected = autoDetectGitHubRepo();

    // If GitHub Sync is enabled, or if we auto-detect that we are hosted on GitHub Pages
    if ((gitHubConfig.enabled && gitHubConfig.repo) || detected) {
        try {
            const repo = gitHubConfig.repo || `${detected.owner}/${detected.repo}`;
            const branch = gitHubConfig.branch || 'main';
            const token = gitHubConfig.token; // may be undefined for guest users
            const folder = gitHubConfig.folder || '';
            const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';

            console.log(`GitHub environment detected. Pulling database from repo: ${repo} (branch: ${branch})...`);
            
            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (token) {
                headers['Authorization'] = `token ${token}`;
            }

            const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}database.json?ref=${branch}&t=` + Date.now();
            const res = await fetch(url, { headers, cache: 'no-store' });
            
            if (res.ok) {
                const fileData = await res.json();
                const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
                const data = JSON.parse(decoded);
                if (data.projects && data.steps && data.logs) {
                    setItems(STORAGE_KEYS.PROJECTS, data.projects);
                    setItems(STORAGE_KEYS.STEPS, data.steps);
                    setItems(STORAGE_KEYS.LOGS, data.logs);
                    if (fileData.sha) {
                        localStorage.setItem('sm_progress_loaded_sha', fileData.sha);
                        console.log("Saved loaded database SHA:", fileData.sha);
                    }
                    console.log("Database successfully synced in real-time from GitHub API.");
                    return;
                }
            }
        } catch (e) {
            console.warn("Could not sync database from GitHub API (falling back to static URL):", e);
        }
    }

    // Fallback: fetch database.json from standard static website hosting (or local server if running locally)
    try {
        const res = await fetch('database.json?t=' + Date.now());
        if (res.ok) {
            const data = await res.json();
            if (data.projects && data.steps && data.logs) {
                setItems(STORAGE_KEYS.PROJECTS, data.projects);
                setItems(STORAGE_KEYS.STEPS, data.steps);
                setItems(STORAGE_KEYS.LOGS, data.logs);
                console.log("Database successfully synced from static file URL.");
                return;
            }
        }
    } catch (e) {
        console.warn("Could not sync database from static file URL:", e);
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
async function triggerSync(commitMessage = null, force = false) {
    const gitHubConfig = getGitHubConfig();
    if (gitHubConfig.enabled && gitHubConfig.repo && gitHubConfig.token) {
        try {
            console.log("GitHub Sync is active. Syncing data to GitHub...");
            window.dispatchEvent(new CustomEvent('github-sync-start'));
            const newSha = await saveDatabaseToGitHub(gitHubConfig, commitMessage, force);
            if (newSha) {
                localStorage.setItem('sm_progress_loaded_sha', newSha);
            }
            console.log("Database successfully synced to GitHub.");
            window.dispatchEvent(new CustomEvent('github-sync-success'));
        } catch (e) {
            console.error("Could not sync database to GitHub:", e);
            if (e.message === "CONFLICT_DETECTED") {
                window.dispatchEvent(new CustomEvent('github-sync-conflict'));
                const doForce = confirm(
                    "⚠️ CONFLICT DETECTED!\n\n" +
                    "Another team member has updated the database since you loaded or refreshed the page.\n" +
                    "Overwriting will erase their changes.\n\n" +
                    "Do you want to FORCE overwrite the repository with your local changes?"
                );
                if (doForce) {
                    try {
                        console.log("Forcing sync to GitHub...");
                        window.dispatchEvent(new CustomEvent('github-sync-start'));
                        const forcedSha = await saveDatabaseToGitHub(gitHubConfig, commitMessage, true);
                        if (forcedSha) {
                            localStorage.setItem('sm_progress_loaded_sha', forcedSha);
                        }
                        console.log("Database successfully synced to GitHub (forced).");
                        window.dispatchEvent(new CustomEvent('github-sync-success'));
                    } catch (retryError) {
                        console.error("Forced sync failed:", retryError);
                        window.dispatchEvent(new CustomEvent('github-sync-error', { detail: retryError.message }));
                    }
                } else {
                    window.UI.showToast("Sync cancelled. Please reload the page to pull the latest changes.", "warning");
                }
            } else {
                window.dispatchEvent(new CustomEvent('github-sync-error', { detail: e.message }));
            }
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
    triggerSync(`Add project: "${newProject.name}"`);
    return newProject;
}

function updateProject(id, fields) {
    const projects = getItems(STORAGE_KEYS.PROJECTS);
    const index = projects.findIndex(p => p.id === Number(id));
    if (index !== -1) {
        const oldName = projects[index].name;
        projects[index] = { ...projects[index], ...fields };
        setItems(STORAGE_KEYS.PROJECTS, projects);
        recalculateProjectStats(id);
        triggerSync(`Update project: "${oldName}"`);
        return projects[index];
    }
    return null;
}

function deleteProject(id) {
    // Retrieve project name before delete
    const projects = getItems(STORAGE_KEYS.PROJECTS);
    const proj = projects.find(p => p.id === Number(id));
    const projName = proj ? proj.name : `ID ${id}`;

    // Delete project
    const filteredProjects = projects.filter(p => p.id !== Number(id));
    setItems(STORAGE_KEYS.PROJECTS, filteredProjects);

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
    triggerSync(`Delete project: "${projName}"`);
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
    
    const proj = getProject(step.project_id);
    const projName = proj ? proj.name : `ID ${step.project_id}`;
    triggerSync(`Add schedule step "${newStep.step_code}" to project "${projName}"`);
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

        const stepCode = steps[index].step_code;
        const proj = getProject(steps[index].project_id);
        const projName = proj ? proj.name : `ID ${steps[index].project_id}`;

        steps[index] = { 
            ...steps[index], 
            ...fields, 
            duration: duration !== undefined ? duration : steps[index].duration 
        };
        setItems(STORAGE_KEYS.STEPS, steps);
        recalculateProjectStats(steps[index].project_id);
        triggerSync(`Update step "${stepCode}" in project "${projName}"`);
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
        
        const proj = getProject(step.project_id);
        const projName = proj ? proj.name : `ID ${step.project_id}`;
        triggerSync(`Delete step "${step.step_code}" from project "${projName}"`);
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
    triggerSync(`Add daily log by ${newLog.engineer} for project "${projectName}"`);
    return newLog;
}

function deleteLog(logId) {
    const logs = getItems(STORAGE_KEYS.LOGS);
    const log = logs.find(l => l.id === Number(logId));
    const logDetails = log ? `by ${log.engineer} on ${log.date}` : `ID ${logId}`;
    
    const filteredLogs = logs.filter(l => l.id !== Number(logId));
    setItems(STORAGE_KEYS.LOGS, filteredLogs);
    triggerSync(`Delete daily log entry ${logDetails}`);
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
        triggerSync("Import full database backup from JSON file");
        return true;
    } catch (e) {
        console.error("Failed to import JSON", e);
        return false;
    }
}



// Archive older logs to database_archive.json
async function archiveOlderLogs(keepCount = 30) {
    const gitHubConfig = getGitHubConfig();
    if (!gitHubConfig.enabled || !gitHubConfig.repo || !gitHubConfig.token) {
        throw new Error("GitHub Sync must be enabled and configured to archive logs.");
    }

    const { repo, token, branch, folder } = gitHubConfig;
    const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';
    const headers = {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
    };

    // 1. Fetch all local logs
    const allLogs = getItems(STORAGE_KEYS.LOGS);
    if (allLogs.length <= keepCount) {
        return { success: true, message: `Only ${allLogs.length} logs exist. No need to archive (keep limit is ${keepCount}).` };
    }

    // Sort logs descending by date and then by ID to identify latest logs
    const sortedLogs = [...allLogs].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    
    // Split into recent and archived
    const recentLogs = sortedLogs.slice(0, keepCount);
    const toArchiveLogs = sortedLogs.slice(keepCount);

    // 2. Fetch current database_archive.json to merge
    let existingArchiveLogs = [];
    const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}database_archive.json?ref=${branch}&t=` + Date.now();
    
    try {
        const getRes = await fetch(url, { headers, cache: 'no-store' });
        if (getRes.ok) {
            const fileData = await getRes.json();
            const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
            const data = JSON.parse(decoded);
            existingArchiveLogs = data.logs || [];
        }
    } catch (e) {
        console.warn("No existing database_archive.json found, or failed to parse. Creating new archive.", e);
    }

    // Merge logs ensuring no duplicate IDs
    const mergedArchiveLogs = [...existingArchiveLogs];
    toArchiveLogs.forEach(log => {
        if (!mergedArchiveLogs.some(existing => existing.id === log.id)) {
            mergedArchiveLogs.push(log);
        }
    });

    // 3. Write database_archive.json to GitHub
    const archiveData = { logs: mergedArchiveLogs };
    await saveJsonFileToGitHub(gitHubConfig, 'database_archive.json', archiveData, "Archive older daily logs to database_archive.json");

    // 4. Update local storage for active database (projects & steps remain unchanged)
    setItems(STORAGE_KEYS.LOGS, recentLogs);

    // 5. Save updated database.json to GitHub
    const newDbSha = await saveDatabaseToGitHub(gitHubConfig, "Trim daily logs to database.json after archiving");
    if (newDbSha) {
        localStorage.setItem('sm_progress_loaded_sha', newDbSha);
    }

    return {
        success: true,
        archivedCount: toArchiveLogs.length,
        totalArchived: mergedArchiveLogs.length
    };
}

// Fetch and merge archived logs from GitHub (or static fallbacks)
async function loadArchivedLogs() {
    const gitHubConfig = getGitHubConfig();
    const detected = autoDetectGitHubRepo();
    let archiveData = { logs: [] };

    // If GitHub Sync is configured or host is github.io
    if ((gitHubConfig.enabled && gitHubConfig.repo) || detected) {
        try {
            const repo = gitHubConfig.repo || `${detected.owner}/${detected.repo}`;
            const branch = gitHubConfig.branch || 'main';
            const token = gitHubConfig.token;
            const folder = gitHubConfig.folder || '';
            const pathPrefix = folder ? `${folder.replace(/\/$/, '')}/` : '';

            const headers = { 'Accept': 'application/vnd.github.v3+json' };
            if (token) {
                headers['Authorization'] = `token ${token}`;
            }

            const url = `https://api.github.com/repos/${repo}/contents/${pathPrefix}database_archive.json?ref=${branch}&t=` + Date.now();
            const res = await fetch(url, { headers, cache: 'no-store' });
            if (res.ok) {
                const fileData = await res.json();
                const decoded = decodeURIComponent(escape(atob(fileData.content.replace(/\s/g, ''))));
                archiveData = JSON.parse(decoded);
                console.log(`Loaded ${archiveData.logs?.length || 0} logs from database_archive.json via GitHub API.`);
            }
        } catch (e) {
            console.warn("Could not load database_archive.json from GitHub API, trying static fallback:", e);
        }
    }

    // Fallback: static file URL
    if (archiveData.logs.length === 0) {
        try {
            const res = await fetch('database_archive.json?t=' + Date.now());
            if (res.ok) {
                archiveData = await res.json();
                console.log(`Loaded ${archiveData.logs?.length || 0} logs from database_archive.json via static file.`);
            }
        } catch (e) {
            console.warn("Could not load database_archive.json from static URL:", e);
        }
    }

    // Merge active logs and archived logs dynamically
    const activeLogs = getItems(STORAGE_KEYS.LOGS);
    const combinedLogs = [...activeLogs];

    if (archiveData.logs && Array.isArray(archiveData.logs)) {
        archiveData.logs.forEach(log => {
            if (!combinedLogs.some(existing => existing.id === log.id)) {
                combinedLogs.push(log);
            }
        });
    }

    // Return sorted logs descending by date & ID
    return combinedLogs.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
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
    getGitHubConfig,
    saveGitHubConfig,
    archiveOlderLogs,
    loadArchivedLogs
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
