// Global router state
let currentRoute = '';
let currentProjectId = null;

// Routing paths
const ROUTES = {
    DASHBOARD: 'dashboard',
    PROJECT_DETAILS: 'project-details',
    LOGS: 'logs',
    DATABASE: 'database'
};

// Date display formatter: converts 'YYYY-MM-DD' to 'DD-MM-YYYY' (e.g. '07-07-2026')
function formatDateDisplay(dateStr) {
    if (!dateStr) return '-';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const year = parts[0];
    const month = parts[1];
    const day = parts[2];
    return `${day}-${month}-${year}`;
}

// Background Sync State & Utilities
let isSyncingInBackground = false;
let isPushingActive = false;

function updateSyncButtonState(active) {
    const btn = document.getElementById('manual-sync-btn');
    if (btn) {
        if (active) {
            btn.classList.add('syncing');
            btn.title = "Syncing database from GitHub...";
        } else {
            btn.classList.remove('syncing');
            btn.title = "Sync database from GitHub";
        }
    }
}

function renderCurrentView() {
    if (currentRoute === ROUTES.DASHBOARD) {
        renderDashboard();
    } else if (currentRoute === ROUTES.PROJECT_DETAILS && currentProjectId !== null) {
        renderProjectDetails(currentProjectId);
    } else if (currentRoute === ROUTES.LOGS) {
        renderLogs();
    } else if (currentRoute === ROUTES.DATABASE) {
        renderDatabaseView();
    }
}

function updateProjectStatsInDOM(projectId) {
    const project = window.Store.getProject(projectId);
    if (!project) return;

    // Update Overall Progress Text
    const progressText = document.getElementById('project-details-progress-text');
    if (progressText) {
        progressText.textContent = `${project.progress.toFixed(1)}%`;
    }

    // Update Status Badge
    const statusBadge = document.getElementById('project-details-status-badge');
    if (statusBadge) {
        statusBadge.textContent = project.status;
        statusBadge.className = `badge status-badge status-${project.status.replace(/ /g, '-').toLowerCase()}`;
    }
}

async function triggerBackgroundSyncCheck() {
    if (isSyncingInBackground || isPushingActive) return;

    const config = window.Store.getGitHubConfig();
    const detected = window.Store.autoDetectGitHubRepo();
    if (!config.enabled && !detected) return; // Sync not active/configured

    // Avoid overwriting active modal fields if the user is typing/editing
    if (document.querySelector('.modal-overlay.active')) return;

    isSyncingInBackground = true;
    updateSyncButtonState(true);

    try {
        const oldSha = localStorage.getItem('sm_progress_loaded_sha');
        await window.Store.initStore();
        const newSha = localStorage.getItem('sm_progress_loaded_sha');

        if (oldSha !== newSha && !document.querySelector('.modal-overlay.active')) {
            renderCurrentView();
            window.UI.showToast("Database auto-updated from GitHub", "info");
        }
    } catch (e) {
        console.error("Background sync check failed:", e);
    } finally {
        isSyncingInBackground = false;
        updateSyncButtonState(false);
    }
}

// Start UI App
window.addEventListener('load', async () => {
    await window.Store.initStore();
    window.UI.setupModalDismissers();
    setupGlobalEventListeners();
    navigate();

    // Wire up the manual sync button (Option 3)
    const manualSyncBtn = document.getElementById('manual-sync-btn');
    if (manualSyncBtn) {
        manualSyncBtn.addEventListener('click', async () => {
            if (isSyncingInBackground) return;
            isSyncingInBackground = true;
            updateSyncButtonState(true);
            try {
                await window.Store.initStore();
                renderCurrentView();
                window.UI.showToast("Database refreshed from GitHub", "success");
            } catch (e) {
                console.error("Manual sync failed:", e);
                window.UI.showToast("Sync failed: " + e.message, "danger");
            } finally {
                isSyncingInBackground = false;
                updateSyncButtonState(false);
            }
        });
    }
});

// On page navigation, render instantly then background-sync (Option 1)
window.addEventListener('hashchange', () => {
    navigate();
    triggerBackgroundSyncCheck();
});

// --- APP ROUTER ---
function navigate() {
    const hash = window.location.hash || '#/';
    
    // Toast container checks
    if (!document.getElementById('toast-container')) {
        const container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Sidebar active item styling
    updateSidebarActiveState(hash);

    if (hash === '#/' || hash === '' || hash === '#/dashboard') {
        currentRoute = ROUTES.DASHBOARD;
        renderDashboard();
    } else if (hash.startsWith('#/project/')) {
        currentRoute = ROUTES.PROJECT_DETAILS;
        const id = hash.split('#/project/')[1];
        currentProjectId = Number(id);
        renderProjectDetails(id);
    } else if (hash === '#/logs') {
        currentRoute = ROUTES.LOGS;
        renderLogs();
    } else if (hash === '#/database') {
        currentRoute = ROUTES.DATABASE;
        renderDatabaseView();
    } else {
        // Fallback
        window.location.hash = '#/';
    }
}

function updateSidebarActiveState(hash) {
    // Desktop Top Nav highlights
    document.querySelectorAll('.nav-links a').forEach(link => {
        const href = link.getAttribute('href');
        if (hash === href || (hash.startsWith('#/project/') && href === '#/dashboard')) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });

    // Right-aligned settings button highlight
    const settingsNavBtn = document.getElementById('settings-nav-btn');
    if (settingsNavBtn) {
        if (hash === '#/database') {
            settingsNavBtn.classList.add('active');
        } else {
            settingsNavBtn.classList.remove('active');
        }
    }

    // Mobile Bottom Nav highlights
    document.querySelectorAll('.mobile-bottom-nav a').forEach(link => {
        const href = link.getAttribute('href');
        if (hash === href || (hash.startsWith('#/project/') && href === '#/dashboard')) {
            link.classList.add('active');
        } else {
            link.classList.remove('active');
        }
    });
}

// --- VIEW RENDERERS ---

// 1. DASHBOARD VIEW
function renderDashboard() {
    const mainViewport = document.getElementById('main-viewport');
    const projects = window.Store.getProjects();

    const statusPriority = {
        'in progress': 1,
        'on hold': 2,
        'not started': 3,
        'completed': 4
    };

    // Sort projects: In progress -> On Hold -> Not started -> Completed (case-insensitive)
    projects.sort((a, b) => {
        const valA = statusPriority[(a.status || '').toLowerCase().trim()] || 99;
        const valB = statusPriority[(b.status || '').toLowerCase().trim()] || 99;
        if (valA !== valB) {
            return valA - valB;
        }
        const prioA = Number(a.priority) || 9999;
        const prioB = Number(b.priority) || 9999;
        if (prioA !== prioB) {
            return prioA - prioB;
        }
        return a.name.localeCompare(b.name);
    });

    const inProgressCount = projects.filter(p => (p.status || '').toLowerCase().trim() === 'in progress').length;
    const blockedCount = projects.filter(p => p.blocked_by && p.blocked_by.trim() !== '').length;
    const completedCount = projects.filter(p => (p.status || '').toLowerCase().trim() === 'completed').length;

    mainViewport.innerHTML = `
        <div class="metrics-grid">
            <div class="metric-card glass">
                <div class="metric-icon blue">📁</div>
                <div class="metric-info">
                    <h3>Total Projects</h3>
                    <span class="metric-value">${projects.length}</span>
                </div>
            </div>
            <div class="metric-card glass">
                <div class="metric-icon orange">⚡</div>
                <div class="metric-info">
                    <h3>In Progress</h3>
                    <span class="metric-value">${inProgressCount}</span>
                </div>
            </div>
            <div class="metric-card glass">
                <div class="metric-icon red">🛑</div>
                <div class="metric-info">
                    <h3>Blocked Projects</h3>
                    <span class="metric-value">${blockedCount}</span>
                </div>
            </div>
            <div class="metric-card glass">
                <div class="metric-icon green">✅</div>
                <div class="metric-info">
                    <h3>Completed</h3>
                    <span class="metric-value">${completedCount}</span>
                </div>
            </div>
        </div>

        <div class="toolbar-container glass">
            <div class="toolbar-left">
                <div class="search-box">
                    <span class="search-icon">🔍</span>
                    <input type="text" id="search-input" placeholder="Search projects by name, status, or owner...">
                </div>
            </div>
            <div class="toolbar-right">
                <button class="btn btn-primary" id="open-new-project-btn">➕ New Project</button>
            </div>
        </div>

        <div class="table-card glass">
            <div class="table-responsive">
                <table class="data-table dashboard-table" id="projects-table">
                    <thead>
                        <tr>
                            <th style="width: 70px;" class="text-center">Priority</th>
                            <th>Work Item</th>
                            <th style="width: 140px;">Progress</th>
                            <th style="width: 150px;">Status</th>
                            <th style="width: 110px;" class="text-center">Start Date</th>
                            <th style="width: 110px;" class="text-center">Due Date</th>
                            <th style="width: 120px;">Assigned To</th>
                            <th>Latest Update (Last Done)</th>
                            <th>Next Step</th>
                            <th>Blocked By</th>
                            <th style="width: 80px;" class="text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody id="projects-table-body">
                        ${projects.length > 0 ? projects.map(proj => {
                            const isBlocked = proj.blocked_by && proj.blocked_by.trim() !== '';
                            const blockedClass = isBlocked ? 'text-danger font-semibold bg-danger-light' : '';
                            return `
                            <tr class="project-row" data-search="${proj.name.toLowerCase()} ${proj.status.toLowerCase()} ${(proj.assigned_to || '').toLowerCase()}">
                                <td class="text-center font-bold text-muted">${proj.priority !== 9999 ? proj.priority : '-'}</td>
                                <td>
                                    <a href="#/project/${proj.id}" class="project-link font-semibold">
                                        ${proj.name}
                                    </a>
                                </td>
                                <td>
                                    <div class="progress-container">
                                        <div class="progress-bar-outer">
                                            <div class="progress-bar-inner" style="width: ${proj.progress}%"></div>
                                        </div>
                                        <span class="progress-text">${proj.progress.toFixed(1)}%</span>
                                    </div>
                                </td>
                                <td>
                                    <select class="status-select status-${proj.status.replace(/ /g, '-').toLowerCase()}" data-id="${proj.id}">
                                        <option value="Not started" ${proj.status === 'Not started' ? 'selected' : ''}>Not started</option>
                                        <option value="In progress" ${proj.status === 'In progress' ? 'selected' : ''}>In progress</option>
                                        <option value="On Hold" ${proj.status === 'On Hold' ? 'selected' : ''}>On Hold</option>
                                        <option value="Completed" ${proj.status === 'Completed' ? 'selected' : ''}>Completed</option>
                                    </select>
                                </td>
                                <td class="text-center date-cell text-muted">${formatDateDisplay(proj.start_date)}</td>
                                <td class="text-center date-cell text-muted">${formatDateDisplay(proj.due_date)}</td>
                                <td>🧑‍💻 ${proj.assigned_to || 'Team'}</td>
                                <td class="text-small">${proj.latest_update || '-'}</td>
                                <td class="text-small font-semibold text-primary">${proj.next_step || '-'}</td>
                                <td class="${blockedClass} text-small">${proj.blocked_by || '-'}</td>
                                <td class="text-center actions-cell" style="display: flex; gap: 8px; justify-content: center; align-items: center;">
                                    <button class="btn-icon text-primary edit-project-btn" data-id="${proj.id}" title="Edit Project">✏️</button>
                                    <button class="btn-icon text-danger delete-project-btn" data-id="${proj.id}" data-name="${proj.name}" title="Delete Project">🗑️</button>
                                </td>
                            </tr>
                            `;
                        }).join('') : `<tr><td colspan="11" class="text-center text-muted">No projects found. Clear your database or import a SQLite db to get started!</td></tr>`}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    // Event hooks
    document.getElementById('open-new-project-btn').addEventListener('click', () => window.UI.openModal('new-project-modal'));
    
    // Project status quick changes
    document.querySelectorAll('.status-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const id = e.target.getAttribute('data-id');
            const newStatus = e.target.value;
            window.Store.updateProject(id, { status: newStatus });
            
            // Re-style element select box dynamically
            e.target.className = `status-select status-${newStatus.replace(/ /g, '-').toLowerCase()}`;
            
            // Trigger toast
            window.UI.showToast(`Project status updated to '${newStatus}'!`, 'success');
            
            // Re-render to refresh counts metrics cards
            setTimeout(renderDashboard, 800);
        });
    });

    // Project edits trigger
    document.querySelectorAll('.edit-project-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = Number(btn.getAttribute('data-id'));
            const proj = projects.find(p => p.id === id);
            if (proj) {
                document.getElementById('edit_proj_id').value = proj.id;
                document.getElementById('edit_proj_name').value = proj.name || '';
                document.getElementById('edit_proj_desc').value = proj.description || '';
                document.getElementById('edit_proj_priority').value = proj.priority !== 9999 ? proj.priority : '9999.0';
                document.getElementById('edit_proj_assign').value = proj.assigned_to || '';
                document.getElementById('edit_proj_start').value = proj.start_date || '';
                document.getElementById('edit_proj_due').value = proj.due_date || '';
                window.UI.openModal('edit-project-modal');
            }
        });
    });

    // Project deletes
    document.querySelectorAll('.delete-project-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            if (confirm(`Are you sure you want to delete the project '${name}'? This deletes all associated schedule steps.`)) {
                window.Store.deleteProject(id);
                window.UI.showToast(`Project '${name}' deleted successfully!`, 'success');
                renderDashboard();
            }
        });
    });

    // Real-time client-side search filtering
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.project-row').forEach(row => {
                const searchData = row.getAttribute('data-search');
                if (searchData.includes(query)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    }
}

// 2. PROJECT DETAILS VIEW
function renderProjectDetails(id) {
    const mainViewport = document.getElementById('main-viewport');
    const project = window.Store.getProject(id);

    if (!project) {
        mainViewport.innerHTML = `
            <div class="back-link-container">
                <a href="#/" class="back-link">← Back to Dashboard</a>
            </div>
            <div class="glass card text-center p-large" style="padding: 40px;">
                <h2>🛑 Project Not Found</h2>
                <p class="text-muted">The project with ID ${id} was not found in storage.</p>
            </div>
        `;
        return;
    }

    const steps = window.Store.getSteps(id);
    const logs = window.Store.getLogs(id);

    mainViewport.innerHTML = `
        <div class="back-link-container">
            <a href="#/" class="back-link">← Back to Dashboard</a>
        </div>

        <div class="project-header-card glass">
            <div class="header-main-info" style="width: 100%;">
                <div class="title-and-status" style="width: 100%; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <h2>${project.name}</h2>
                        <span id="project-details-status-badge" class="badge status-badge status-${project.status.replace(/ /g, '-').toLowerCase()}">
                            ${project.status}
                        </span>
                    </div>
                    <button class="btn btn-secondary btn-sm edit-project-btn" data-id="${project.id}" style="padding: 6px 12px; font-size: 13.5px; line-height: 1;">✏️ Edit Project</button>
                </div>
                <p class="project-desc" style="margin-top: 8px;">${project.description || 'No description provided.'}</p>
            </div>
            
            <div class="header-metadata-grid">
                <div class="meta-item">
                    <span class="meta-label">Overall Progress</span>
                    <span id="project-details-progress-text" class="meta-value text-primary font-bold">${project.progress.toFixed(1)}%</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Assigned To</span>
                    <span class="meta-value">🧑‍💻 ${project.assigned_to || 'Unassigned'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Start Date</span>
                    <span class="meta-value">📅 ${project.start_date || '-'}</span>
                </div>
                <div class="meta-item">
                    <span class="meta-label">Due Date</span>
                    <span class="meta-value">📅 ${project.due_date || '-'}</span>
                </div>
                ${project.blocked_by ? `
                <div class="meta-item blocked">
                    <span class="meta-label">Blocked By</span>
                    <span class="meta-value font-semibold text-danger">${project.blocked_by}</span>
                </div>
                ` : ''}
            </div>
        </div>

        <!-- Dynamic Gantt Chart container rendered as client-side SVG vector -->
        <div class="gantt-card glass">
            <div class="gantt-header">
                <div>
                    <h3>📊 Dynamic Gantt Timeline</h3>
                    <span class="text-muted text-small">Refreshes in real-time as steps are updated</span>
                </div>
                <div class="gantt-actions" style="display: flex; gap: 8px;">
                    <button class="btn btn-sm btn-secondary" id="download-gantt-svg-btn" title="Download Gantt Chart as SVG image">
                        📥 Download SVG
                    </button>
                    <button class="btn btn-sm btn-secondary" id="download-gantt-png-btn" title="Download Gantt Chart as PNG image">
                        🖼️ Download PNG
                    </button>
                </div>
            </div>
            <div class="gantt-image-container" id="gantt-chart-container">
                <!-- SVG injected by renderer -->
            </div>
        </div>

        <div class="details-workspace-grid">
            <!-- Steps Schedule Section -->
            <section class="steps-section glass">
                <div class="section-header">
                    <h3>📋 Steps Schedule</h3>
                    <button class="btn btn-sm btn-primary" id="open-new-step-btn">➕ Add Step</button>
                </div>
                
                <div class="table-responsive">
                    <table class="data-table steps-table">
                        <thead>
                            <tr>
                                <th style="width: 60px;" class="text-center">ID</th>
                                <th>Step Name</th>
                                <th style="width: 100px;">Assigned</th>
                                <th style="width: 60px;" class="text-center">Days</th>
                                <th style="width: 105px;" class="text-center">Start</th>
                                <th style="width: 105px;" class="text-center">End</th>
                                <th style="width: 95px;" class="text-center">Progress</th>
                                <th style="width: 125px;">Status</th>
                                <th style="width: 50px;" class="text-center">Dep.</th>
                                <th style="width: 75px;">Section</th>
                                <th style="width: 90px;">Ext. Dep</th>
                                <th style="width: 90px;" class="text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="steps-table-body">
                            ${steps.length > 0 ? steps.map(step => `
                            <tr id="step-row-${step.id}">
                                <td class="text-center font-bold text-primary">${step.step_code}</td>
                                <td class="font-semibold">${step.name}</td>
                                <td>${step.assigned_to || '-'}</td>
                                <td class="text-center">${step.duration}</td>
                                <td class="text-center text-small">${step.start_date || '-'}</td>
                                <td class="text-center text-small">${step.end_date || '-'}</td>
                                <td class="text-center">
                                    <select class="progress-select status-select-progress font-bold" data-id="${step.id}">
                                        <option value="0" ${Number(step.progress) === 0 ? 'selected' : ''}>0%</option>
                                        <option value="25" ${Number(step.progress) === 25 ? 'selected' : ''}>25%</option>
                                        <option value="50" ${Number(step.progress) === 50 ? 'selected' : ''}>50%</option>
                                        <option value="75" ${Number(step.progress) === 75 ? 'selected' : ''}>75%</option>
                                        <option value="100" ${Number(step.progress) === 100 ? 'selected' : ''}>100%</option>
                                    </select>
                                </td>
                                <td>
                                    <select class="status-select status-select-step status-${(step.status || '').replace(/ /g, '-').toLowerCase()}" data-id="${step.id}">
                                        <option value="Not started" ${(step.status || '').toLowerCase().trim() === 'not started' ? 'selected' : ''}>Not started</option>
                                        <option value="In progress" ${(step.status || '').toLowerCase().trim() === 'in progress' ? 'selected' : ''}>In progress</option>
                                        <option value="On Hold" ${(step.status || '').toLowerCase().trim() === 'on hold' ? 'selected' : ''}>On Hold</option>
                                        <option value="Completed" ${(step.status || '').toLowerCase().trim() === 'completed' ? 'selected' : ''}>Completed</option>
                                    </select>
                                </td>
                                <td class="text-center text-muted">${step.dependencies || '-'}</td>
                                <td><span class="badge-section">${step.section || '-'}</span></td>
                                <td class="${step.external_dep ? 'text-danger font-semibold' : ''}">${step.external_dep || '-'}</td>
                                <td class="text-center actions-cell">
                                    <button class="btn-icon edit-step-trigger" data-id="${step.id}">✏️</button>
                                    <button class="btn-icon text-danger delete-step-trigger" data-id="${step.id}" data-name="${step.name}">🗑️</button>
                                </td>
                            </tr>
                            `).join('') : `<tr><td colspan="12" class="text-center text-muted">No steps defined for this project timeline. Add one above!</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </section>

            <!-- Logs/Jargon/Update Section -->
            <section class="logs-section glass" style="background: none; border: none; box-shadow: none; padding: 0;">
                
                <!-- Dynamic Jargon Sticky Notes Card -->
                <div class="sticky-notes-card" id="project-sticky-notes-container">
                    <div class="sticky-notes-header">
                        <h3>📌 Jargon & Wiki Notes</h3>
                        <button class="btn-edit-notes" id="edit-notes-btn">✏️ Edit Notes</button>
                    </div>
                    <div class="sticky-notes-body" id="sticky-notes-display">${project.notes ? project.notes : `<div class="sticky-notes-empty">No notes or jargon defined yet. Click Edit to add abbreviations or quick links.</div>`}</div>
                    <div id="sticky-notes-editor" style="display: none;">
                        <textarea class="sticky-notes-textarea" id="notes-textarea" placeholder="Enter project terminology, acronym definitions, or wiki links...">${project.notes || ''}</textarea>
                        <div class="sticky-notes-actions">
                            <button class="btn-cancel" id="cancel-notes-btn">Cancel</button>
                            <button class="btn-save" id="save-notes-btn">Save Notes</button>
                        </div>
                    </div>
                </div>

                <!-- Project Logs Section card -->
                <div class="logs-history-container glass" style="padding: 24px; border-radius: var(--radius-lg);">
                    <div class="section-header" style="margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                        <h3 style="font-size: 15px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">📝 Project Logs</h3>
                        <button class="btn btn-sm btn-primary" id="open-new-log-btn">✍️ Log Update</button>
                    </div>
                    
                    <div class="logs-list">
                        ${logs.length > 0 ? logs.map(log => `
                        <div class="log-card">
                            <div class="log-card-header">
                                <span class="log-engineer">🧑‍💻 ${log.engineer}</span>
                                <span class="log-date">📅 ${formatDateDisplay(log.date)}</span>
                            </div>
                            <div class="log-card-body">
                                <p class="log-planned"><strong>Planned:</strong> ${log.planned_today || '-'}</p>
                                <p class="log-done"><strong>Done:</strong> ${log.actually_done || '-'}</p>
                                ${log.comments ? `<p class="log-comments"><strong>Notes:</strong> <em>${log.comments}</em></p>` : ''}
                            </div>
                            <div class="log-card-footer">
                                <button class="btn-text-danger delete-log-trigger" data-id="${log.id}">Delete Entry</button>
                            </div>
                        </div>
                        `).join('') : `
                        <div class="no-logs">
                            <p>No logged updates for this project yet.</p>
                        </div>
                        `}
                    </div>
                </div>
            </section>
        </div>
    `;

    // Render SVG Gantt Chart in the layout
    window.Gantt.renderGanttChart(steps, 'gantt-chart-container', project.name);

    // Wire up download Gantt buttons
    const downloadSvgBtn = document.getElementById('download-gantt-svg-btn');
    const downloadPngBtn = document.getElementById('download-gantt-png-btn');
    
    const getSvgSourceAndDimensions = () => {
        const container = document.getElementById('gantt-chart-container');
        const svgElement = container ? container.querySelector('svg') : null;
        if (!svgElement) return null;

        const viewBox = svgElement.getAttribute('viewBox');
        let width = 1350;
        let height = 600;
        if (viewBox) {
            const parts = viewBox.split(' ');
            if (parts.length === 4) {
                width = parseFloat(parts[2]);
                height = parseFloat(parts[3]);
            }
        }

        const serializer = new XMLSerializer();
        let source = serializer.serializeToString(svgElement);
        
        if (!source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)) {
            source = source.replace(/^<svg/, '<svg xmlns="http://www.w3.org/2000/svg"');
        }
        if (!source.match(/^<svg[^>]+xmlns\:xlink="http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
            source = source.replace(/^<svg/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
        }
        source = '<?xml version="1.0" encoding="utf-8"?>\n' + source;

        return { source, width, height, element: svgElement };
    };

    if (downloadSvgBtn) {
        downloadSvgBtn.addEventListener('click', () => {
            const svgData = getSvgSourceAndDimensions();
            if (!svgData) {
                window.UI.showToast("No Gantt chart found to download", "warning");
                return;
            }
            
            const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgData.source);
            const downloadLink = document.createElement("a");
            downloadLink.href = url;
            downloadLink.download = `Gantt_${project.name.replace(/[^a-z0-9_-]/gi, '_')}.svg`;
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            window.UI.showToast("Gantt Chart SVG downloaded successfully!", "success");
        });
    }

    if (downloadPngBtn) {
        downloadPngBtn.addEventListener('click', () => {
            const svgData = getSvgSourceAndDimensions();
            if (!svgData) {
                window.UI.showToast("No Gantt chart found to download", "warning");
                return;
            }

            const svgBlob = new Blob([svgData.source], { type: 'image/svg+xml;charset=utf-8' });
            const url = URL.createObjectURL(svgBlob);
            const img = new Image();

            img.onload = () => {
                const canvas = document.createElement('canvas');
                // 2x scale for high resolution print quality
                const scale = 2;
                canvas.width = svgData.width * scale;
                canvas.height = svgData.height * scale;

                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                
                // Draw white background
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Draw SVG image
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                URL.revokeObjectURL(url);

                // Export to PNG data url and download
                const pngUrl = canvas.toDataURL('image/png');
                const downloadLink = document.createElement('a');
                downloadLink.href = pngUrl;
                downloadLink.download = `Gantt_${project.name.replace(/[^a-z0-9_-]/gi, '_')}.png`;
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                window.UI.showToast("Gantt Chart PNG downloaded successfully!", "success");
            };

            img.onerror = (err) => {
                console.error("Error generating Gantt PNG from canvas:", err);
                window.UI.showToast("Failed to render PNG. Please use SVG download.", "danger");
            };

            img.src = url;
        });
    }

    // Modal click triggers
    document.getElementById('open-new-step-btn').addEventListener('click', () => {
        // Set dynamic field for step code default
        const stepCodeInput = document.getElementById('step_code');
        if (stepCodeInput) {
            stepCodeInput.value = `s${steps.length + 1}`;
            stepCodeInput.removeAttribute('readonly');
        }
        
        // Ensure form is cleared and reset to Add Mode
        const form = document.getElementById('new-step-form');
        if (form) {
            form.reset();
            form.removeAttribute('data-edit-id');
        }
        
        document.getElementById('step-modal-title').innerText = "Add New Schedule Timeline Step";
        document.getElementById('step-modal-submit-btn').innerText = "Add Step";
        
        window.UI.openModal('new-step-modal');
    });

    document.getElementById('open-new-log-btn').addEventListener('click', () => {
        window.UI.openModal('new-log-modal');
    });

    // Wire up Edit Project button on header
    const editProjBtn = document.querySelector('.project-header-card .edit-project-btn');
    if (editProjBtn) {
        editProjBtn.addEventListener('click', () => {
            document.getElementById('edit_proj_id').value = project.id;
            document.getElementById('edit_proj_name').value = project.name || '';
            document.getElementById('edit_proj_desc').value = project.description || '';
            document.getElementById('edit_proj_priority').value = project.priority !== 9999 ? project.priority : '9999.0';
            document.getElementById('edit_proj_assign').value = project.assigned_to || '';
            document.getElementById('edit_proj_start').value = project.start_date || '';
            document.getElementById('edit_proj_due').value = project.due_date || '';
            window.UI.openModal('edit-project-modal');
        });
    }

    // Wire up Sticky Notes edit / save event handlers
    const editNotesBtn = document.getElementById('edit-notes-btn');
    const saveNotesBtn = document.getElementById('save-notes-btn');
    const cancelNotesBtn = document.getElementById('cancel-notes-btn');
    const notesDisplay = document.getElementById('sticky-notes-display');
    const notesEditor = document.getElementById('sticky-notes-editor');
    const notesTextarea = document.getElementById('notes-textarea');

    if (editNotesBtn && saveNotesBtn && cancelNotesBtn && notesDisplay && notesEditor && notesTextarea) {
        editNotesBtn.addEventListener('click', () => {
            notesDisplay.style.display = 'none';
            editNotesBtn.style.display = 'none';
            notesEditor.style.display = 'block';
            notesTextarea.focus();
        });

        cancelNotesBtn.addEventListener('click', () => {
            notesDisplay.style.display = 'block';
            editNotesBtn.style.display = 'block';
            notesEditor.style.display = 'none';
            notesTextarea.value = project.notes || '';
        });

        saveNotesBtn.addEventListener('click', () => {
            const newNotes = notesTextarea.value.trim();
            window.Store.updateProject(project.id, { notes: newNotes });
            window.UI.showToast("Sticky notes saved successfully!", "success");
            renderProjectDetails(project.id);
        });
    }

    // Delete steps hooks
    document.querySelectorAll('.delete-step-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.target.getAttribute('data-id');
            const name = e.target.getAttribute('data-name');
            if (confirm(`Are you sure you want to delete step '${name}'?`)) {
                window.Store.deleteStep(stepId);
                window.UI.showToast(`Step '${name}' deleted successfully!`, 'success');
                renderProjectDetails(id);
            }
        });
    });

    // Delete logs hooks
    document.querySelectorAll('.delete-log-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const logId = e.target.getAttribute('data-id');
            if (confirm('Delete this daily log update entry?')) {
                window.Store.deleteLog(logId);
                window.UI.showToast('Log entry removed', 'info');
                renderProjectDetails(id);
            }
        });
    });

    // Modal-based step edits triggers
    document.querySelectorAll('.edit-step-trigger').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const stepId = e.target.getAttribute('data-id');
            openStepModalForEdit(id, stepId);
        });
    });

    // Step status quick changes
    document.querySelectorAll('.status-select-step').forEach(select => {
        select.addEventListener('change', (e) => {
            const stepId = e.target.getAttribute('data-id');
            const newStatus = e.target.value;
            
            const steps = window.Store.getSteps(id);
            const currentStep = steps.find(s => s.id === Number(stepId));
            const currentProgress = currentStep ? Number(currentStep.progress) : 0;
            
            const updateFields = { status: newStatus };
            if (newStatus === 'Completed') {
                updateFields.progress = 100;
            } else if (newStatus === 'Not started') {
                updateFields.progress = 0;
            } else if (currentProgress === 100 || currentProgress === 0) {
                updateFields.progress = 50;
            }
            
            window.Store.updateStep(stepId, updateFields);
            
            // Re-style element select box dynamically
            e.target.className = `status-select status-select-step status-${newStatus.replace(/ /g, '-').toLowerCase()}`;
            
            // Inline DOM updates: update progress dropdown in the same row!
            if (updateFields.progress !== undefined) {
                const row = document.getElementById(`step-row-${stepId}`);
                if (row) {
                    const progressSelect = row.querySelector('.status-select-progress');
                    if (progressSelect) {
                        progressSelect.value = String(updateFields.progress);
                    }
                }
            }
            
            // Inline DOM updates: update overall project progress stats!
            updateProjectStatsInDOM(id);
            
            // Redraw Gantt chart inline!
            const updatedSteps = window.Store.getSteps(id);
            const project = window.Store.getProject(id);
            window.Gantt.renderGanttChart(updatedSteps, 'gantt-chart-container', project.name);
            
            window.UI.showToast(`Step status updated to '${newStatus}'!`, 'success');
        });
    });

    // Step progress quick changes
    document.querySelectorAll('.status-select-progress').forEach(select => {
        select.addEventListener('change', (e) => {
            const stepId = e.target.getAttribute('data-id');
            const newProgress = Number(e.target.value);
            
            const steps = window.Store.getSteps(id);
            const currentStep = steps.find(s => s.id === Number(stepId));
            const currentStatus = (currentStep ? currentStep.status : '').toLowerCase().trim();
            
            const updateFields = { progress: newProgress };
            if (newProgress === 100) {
                updateFields.status = 'Completed';
            } else if (newProgress === 0) {
                updateFields.status = 'Not started';
            } else if (currentStatus === 'completed' || currentStatus === 'not started') {
                updateFields.status = 'In progress';
            }
            
            window.Store.updateStep(stepId, updateFields);
            
            // Inline DOM updates: update status dropdown in the same row!
            if (updateFields.status !== undefined) {
                const row = document.getElementById(`step-row-${stepId}`);
                if (row) {
                    const statusSelect = row.querySelector('.status-select-step');
                    if (statusSelect) {
                        statusSelect.value = updateFields.status;
                        statusSelect.className = `status-select status-select-step status-${updateFields.status.replace(/ /g, '-').toLowerCase()}`;
                    }
                }
            }
            
            // Inline DOM updates: update overall project progress stats!
            updateProjectStatsInDOM(id);
            
            // Redraw Gantt chart inline!
            const updatedSteps = window.Store.getSteps(id);
            const project = window.Store.getProject(id);
            window.Gantt.renderGanttChart(updatedSteps, 'gantt-chart-container', project.name);
            
            window.UI.showToast(`Step progress updated to ${newProgress}%!`, 'success');
        });
    });
}

// Open existing step inside new-step-modal dynamically formatted as editor
function openStepModalForEdit(projectId, stepId) {
    const steps = window.Store.getSteps(projectId);
    const step = steps.find(s => s.id === Number(stepId));
    if (!step) return;

    const form = document.getElementById('new-step-form');
    if (!form) return;

    // Reset and set edit mode attribute identifier
    form.reset();
    form.setAttribute('data-edit-id', stepId);

    // Populate inputs
    document.getElementById('step_code').value = step.step_code;
    document.getElementById('step_code').setAttribute('readonly', 'true');
    document.getElementById('step_name').value = step.name;
    document.getElementById('step_assigned_to').value = step.assigned_to || '';
    document.getElementById('step_progress').value = step.progress || 0;
    document.getElementById('step_start_date').value = step.start_date || '';
    document.getElementById('step_end_date').value = step.end_date || '';
    document.getElementById('step_dependencies').value = step.dependencies || '';
    document.getElementById('step_status').value = step.status || 'Not started';
    document.getElementById('step_section').value = step.section || '';
    document.getElementById('step_external_dep').value = step.external_dep || '';

    // Update modal title and submit button text
    document.getElementById('step-modal-title').innerText = `✏️ Edit Step: ${step.step_code}`;
    document.getElementById('step-modal-submit-btn').innerText = "Save Changes";

    // Show modal
    window.UI.openModal('new-step-modal');
}

// 3. DAILY LOGS CONSOLE VIEW
function renderLogs() {
    const mainViewport = document.getElementById('main-viewport');
    const projects = window.Store.getProjects();
    const logs = window.Store.getLogs();

    mainViewport.innerHTML = `
        <div class="logs-layout-grid">
            <!-- Submit logs form -->
            <div class="log-form-container glass">
                <h3>✍️ Log Daily Update</h3>
                <form id="global-log-form" class="standard-form">
                    <div class="form-row">
                        <div class="form-group">
                            <label for="log_date">Date *</label>
                            <input type="date" id="log_date" name="date" required value="${new Date().toISOString().split('T')[0]}">
                        </div>
                        <div class="form-group" style="position: relative;">
                            <label for="log_engineer">Engineer *</label>
                            <input type="text" id="log_engineer" name="engineer" required placeholder="e.g. Eng. Mazen" autocomplete="off">
                            <!-- Autocomplete Suggestions List for Engineer -->
                            <div id="engineer-suggestions-list" class="suggestions-list glass" style="display: none;"></div>
                        </div>
                    </div>
                    
                    <div class="form-group" style="position: relative;">
                        <label for="log_project_input">Project *</label>
                        <input type="text" id="log_project_input" placeholder="Type to search project..." required autocomplete="off">
                        <!-- Hidden input to store selected project ID -->
                        <input type="hidden" id="log_project_select" name="project_select" required>
                        <!-- Autocomplete Suggestions List -->
                        <div id="project-suggestions-list" class="suggestions-list glass" style="display: none;"></div>
                    </div>

                    <!-- Revealed if Custom is selected -->
                    <div class="form-group" id="custom-project-group" style="display: none;">
                        <label for="log_custom_project">Custom Task Name *</label>
                        <input type="text" id="log_custom_project" name="custom_project_name" placeholder="e.g. General Meeting, Training">
                    </div>

                    <div class="form-group">
                        <label for="log_planned">Planned Today</label>
                        <textarea id="log_planned" name="planned_today" rows="2" placeholder="What was planned for today..."></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label for="log_done">Actually Done *</label>
                        <textarea id="log_done" name="actually_done" rows="2" required placeholder="Describe task achievements..."></textarea>
                    </div>
                    
                    <div class="form-group">
                        <label for="log_comments">Comments / Notes</label>
                        <textarea id="log_comments" name="comments" rows="2" placeholder="Any blockers, dependencies, or notes..."></textarea>
                    </div>
                    
                    <button type="submit" class="btn btn-primary btn-full">Submit Daily Log</button>
                </form>
            </div>

            <!-- Historical logs table container -->
            <div class="log-archive-container glass">
                <div class="archive-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
                    <h3>📁 Historical Log Archive</h3>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <button class="btn btn-secondary btn-sm" id="load-archived-logs-btn" style="padding: 6px 12px; font-size: 13px; line-height: 1;">📂 Load Full History</button>
                        <div class="search-box">
                            <span class="search-icon">🔍</span>
                            <input type="text" id="log-search-input" placeholder="Search archive logs...">
                        </div>
                    </div>
                </div>

                <div class="table-responsive">
                    <table class="data-table log-table" id="archive-logs-table">
                        <thead>
                            <tr>
                                <th style="width: 100px;" class="text-center">Date</th>
                                <th style="width: 200px;">Project</th>
                                <th style="width: 110px;">Engineer</th>
                                <th>Planned Today</th>
                                <th>Actually Done</th>
                                <th>Comments / Notes</th>
                                <th style="width: 90px;" class="text-center">Type</th>
                                <th style="width: 60px;" class="text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody id="logs-archive-tbody">
                            ${logs.length > 0 ? logs.map(log => {
                                const projLink = log.project_id 
                                    ? `<a href="#/project/${log.project_id}" class="project-link font-semibold">${log.project_name}</a>` 
                                    : `<span class="font-semibold">${log.project_name}</span>`;
                                return `
                                <tr class="log-row" data-search="${log.project_name.toLowerCase()} ${log.engineer.toLowerCase()} ${(log.actually_done || '').toLowerCase()} ${(log.comments || '').toLowerCase()}">
                                    <td class="text-center text-muted text-small">${formatDateDisplay(log.date)}</td>
                                    <td>${projLink}</td>
                                    <td>🧑‍💻 ${log.engineer}</td>
                                    <td class="text-small text-muted">${log.planned_today || '-'}</td>
                                    <td class="text-small font-semibold">${log.actually_done}</td>
                                    <td class="text-small"><em>${log.comments || '-'}</em></td>
                                    <td class="text-center">
                                        <span class="badge badge-sm badge-${log.type.toLowerCase()}">
                                            ${log.type}
                                        </span>
                                    </td>
                                    <td class="text-center">
                                        <button class="btn-icon text-danger delete-archive-log-btn" data-id="${log.id}">🗑️</button>
                                    </td>
                                </tr>
                                `;
                            }).join('') : `<tr><td colspan="8" class="text-center text-muted">No log history stored yet. Fill the left form to add updates.</td></tr>`}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // Searchable Autocomplete project selection wiring
    const projectInput = document.getElementById('log_project_input');
    const projectSelect = document.getElementById('log_project_select');
    const suggestionsList = document.getElementById('project-suggestions-list');
    const customGroup = document.getElementById('custom-project-group');

    if (projectInput && projectSelect && suggestionsList && customGroup) {
        const showSuggestions = () => {
            const filterText = projectInput.value.toLowerCase().trim();
            const matches = projects.filter(p => p.name.toLowerCase().includes(filterText));
            
            let html = matches.map(p => `
                <div class="suggestion-item" data-value="${p.id}" data-name="${p.name}">
                    📁 ${p.name}
                </div>
            `).join('');

            html += `
                <div class="suggestion-item custom-task-option" data-value="__custom__" data-name="-- Ad-hoc / Custom task --">
                    ⚙️ -- Ad-hoc / Custom task --
                </div>
            `;

            suggestionsList.innerHTML = html;
            suggestionsList.style.display = 'flex';

            // Click listener for suggestion items
            suggestionsList.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    const val = item.getAttribute('data-value');
                    const name = item.getAttribute('data-name');

                    projectInput.value = name;
                    projectSelect.value = val;
                    suggestionsList.style.display = 'none';

                    if (val === '__custom__') {
                        customGroup.style.display = 'block';
                        document.getElementById('log_custom_project').setAttribute('required', 'true');
                        document.getElementById('log_custom_project').focus();
                    } else {
                        customGroup.style.display = 'none';
                        document.getElementById('log_custom_project').removeAttribute('required');
                    }
                });
            });
        };

        // Event hooks
        projectInput.addEventListener('focus', showSuggestions);
        
        projectInput.addEventListener('input', () => {
            projectSelect.value = ''; // Reset selected ID during typing
            customGroup.style.display = 'none';
            document.getElementById('log_custom_project').removeAttribute('required');
            showSuggestions();
        });

        // Close suggestions when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!projectInput.contains(e.target) && !suggestionsList.contains(e.target)) {
                suggestionsList.style.display = 'none';
            }
        });
    }

    // Searchable Autocomplete engineer selection wiring
    const engineerInput = document.getElementById('log_engineer');
    const engSuggestionsList = document.getElementById('engineer-suggestions-list');

    if (engineerInput && engSuggestionsList) {
        // Collect unique engineer list dynamically
        const getUniqueEngineers = () => {
            const cleanName = (name) => {
                if (!name) return "";
                // Strip "Eng.", "Eng", "eng.", "eng" prefixes case-insensitively
                let clean = name.replace(/^(eng\.?|eng)\b/i, '').trim();
                if (clean.length > 0) {
                    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
                }
                // Map Taric/Tarif to Tareq
                if (clean.toLowerCase() === 'taric') {
                    clean = 'Tareq';
                }
                return clean;
            };

            const engineers = new Set();
            projects.forEach(p => { 
                if (p.assigned_to) {
                    const cleaned = cleanName(p.assigned_to);
                    if (cleaned) engineers.add(cleaned);
                }
            });
            logs.forEach(l => { 
                if (l.engineer) {
                    const cleaned = cleanName(l.engineer);
                    if (cleaned) engineers.add(cleaned);
                }
            });
            // Standard seeds
            engineers.add("Mazen");
            engineers.add("Nada");
            engineers.add("Tareq");

            return Array.from(engineers).sort();
        };

        const showEngSuggestions = () => {
            const filterText = engineerInput.value.toLowerCase().trim();
            const engineers = getUniqueEngineers();
            const matches = engineers.filter(eng => eng.toLowerCase().includes(filterText));

            if (matches.length === 0) {
                engSuggestionsList.style.display = 'none';
                return;
            }

            let html = matches.map(eng => `
                <div class="suggestion-item" data-name="${eng}">
                    🧑‍💻 ${eng}
                </div>
            `).join('');

            engSuggestionsList.innerHTML = html;
            engSuggestionsList.style.display = 'flex';

            // Click listener for suggestion items
            engSuggestionsList.querySelectorAll('.suggestion-item').forEach(item => {
                item.addEventListener('click', () => {
                    const name = item.getAttribute('data-name');
                    engineerInput.value = name;
                    engSuggestionsList.style.display = 'none';
                });
            });
        };

        // Event hooks
        engineerInput.addEventListener('focus', showEngSuggestions);
        engineerInput.addEventListener('input', showEngSuggestions);

        // Close suggestions when clicking elsewhere
        document.addEventListener('click', (e) => {
            if (!engineerInput.contains(e.target) && !engSuggestionsList.contains(e.target)) {
                engSuggestionsList.style.display = 'none';
            }
        });
    }

    // Submit form handler
    document.getElementById('global-log-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const pSel = projectSelect.value;
        if (!pSel) {
            window.UI.showToast("Please select a project from the search suggestions.", "warning");
            projectInput.focus();
            return;
        }
        
        const logData = {
            date: document.getElementById('log_date').value,
            engineer: document.getElementById('log_engineer').value,
            project_id: pSel !== '__custom__' ? pSel : null,
            project_name: pSel === '__custom__' ? document.getElementById('log_custom_project').value : null,
            planned_today: document.getElementById('log_planned').value,
            actually_done: document.getElementById('log_done').value,
            comments: document.getElementById('log_comments').value
        };

        window.Store.addLog(logData);
        window.UI.showToast("Daily log update submitted and archived!", "success");
        renderLogs();
    });

    // Delete log triggers
    document.querySelectorAll('.delete-archive-log-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.getAttribute('data-id');
            if (confirm('Delete this historical log update entry?')) {
                window.Store.deleteLog(id);
                window.UI.showToast('Log entry removed', 'info');
                renderLogs();
            }
        });
    });

    // Archive dynamic filter search
    const logSearchInput = document.getElementById('log-search-input');
    if (logSearchInput) {
        logSearchInput.addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase().trim();
            document.querySelectorAll('.log-row').forEach(row => {
                const searchData = row.getAttribute('data-search');
                if (searchData.includes(query)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        });
    }

    // Load archived logs trigger
    const loadArchiveBtn = document.getElementById('load-archived-logs-btn');
    if (loadArchiveBtn) {
        loadArchiveBtn.addEventListener('click', async () => {
            loadArchiveBtn.disabled = true;
            loadArchiveBtn.textContent = "⏱️ Loading...";
            try {
                window.UI.showToast("Fetching database_archive.json...", "info");
                const mergedLogs = await window.Store.loadArchivedLogs();
                window.UI.showToast(`Merged ${mergedLogs.length} total logs!`, "success");
                
                // Re-render the table body dynamically
                const tbody = document.getElementById('logs-archive-tbody');
                if (tbody) {
                    tbody.innerHTML = mergedLogs.map(log => {
                        const projLink = log.project_id 
                            ? `<a href="#/project/${log.project_id}" class="project-link font-semibold">${log.project_name}</a>` 
                            : `<span class="font-semibold">${log.project_name}</span>`;
                        return `
                        <tr class="log-row" data-search="${log.project_name.toLowerCase()} ${log.engineer.toLowerCase()} ${(log.actually_done || '').toLowerCase()} ${(log.comments || '').toLowerCase()}">
                            <td class="text-center text-muted text-small">${formatDateDisplay(log.date)}</td>
                            <td>${projLink}</td>
                            <td>🧑‍💻 ${log.engineer}</td>
                            <td class="text-small text-muted">${log.planned_today || '-'}</td>
                            <td class="text-small font-semibold">${log.actually_done}</td>
                            <td class="text-small"><em>${log.comments || '-'}</em></td>
                            <td class="text-center">
                                <span class="badge badge-sm badge-${log.type.toLowerCase()}">
                                    ${log.type}
                                </span>
                            </td>
                            <td class="text-center">
                                <button class="btn-icon text-danger delete-archive-log-btn" data-id="${log.id}">🗑️</button>
                            </td>
                        </tr>
                        `;
                    }).join('');

                    // Re-bind delete buttons for the new items
                    document.querySelectorAll('.delete-archive-log-btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            const id = e.target.getAttribute('data-id');
                            if (confirm('Delete this historical log update entry?')) {
                                window.Store.deleteLog(id);
                                window.UI.showToast('Log entry removed', 'info');
                                renderLogs();
                            }
                        });
                    });
                }
                loadArchiveBtn.textContent = "✅ Loaded";
            } catch (err) {
                loadArchiveBtn.disabled = false;
                loadArchiveBtn.textContent = "📂 Load Full History";
                window.UI.showToast(`Failed to load archive: ${err.message}`, 'danger');
            }
        });
    }
}

// 4. DATABASE & MIGRATION CONSOLE VIEW
function renderDatabaseView() {
    const mainViewport = document.getElementById('main-viewport');
    mainViewport.innerHTML = `
        <div class="settings-grid">
            <!-- GitHub API Sync Settings -->
            <div class="settings-card glass">
                <div class="settings-card-header">
                    <h3>🌐 GitHub API Sync Settings</h3>
                    <p class="text-muted text-small">Configure serverless synchronization using a GitHub repository. Great for free hosting on GitHub Pages, Vercel, Netlify, or Cloudflare Pages.</p>
                </div>
                
                <div class="settings-actions">
                    <div class="form-group" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 15px;">
                        <label for="gh-sync-enabled" class="font-bold" style="margin-bottom: 0;">Enable GitHub Sync</label>
                        <input type="checkbox" id="gh-sync-enabled" style="width: 20px; height: 20px; cursor: pointer;">
                    </div>
                    
                    <div class="form-group">
                        <label for="gh-repo" class="font-bold">Repository (owner/name)</label>
                        <input type="text" id="gh-repo" placeholder="e.g. MazenShams/SM-Excel-Progress-tracker" class="file-input-field" style="width: 100%; border-radius: 6px; padding: 8px;">
                    </div>

                    <div class="form-group">
                        <label for="gh-token" class="font-bold">Personal Access Token (PAT)</label>
                        <input type="password" id="gh-token" placeholder="Paste your classic or fine-grained repo PAT here" class="file-input-field" style="width: 100%; border-radius: 6px; padding: 8px;">
                    </div>

                    <div class="form-group" style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                        <div>
                            <label for="gh-branch" class="font-bold">Branch</label>
                            <input type="text" id="gh-branch" placeholder="main" class="file-input-field" style="width: 100%; border-radius: 6px; padding: 8px;">
                        </div>
                        <div>
                            <label for="gh-folder" class="font-bold">Folder in Repo</label>
                            <input type="text" id="gh-folder" placeholder="leave blank if files are at root" class="file-input-field" style="width: 100%; border-radius: 6px; padding: 8px;">
                        </div>
                    </div>

                    <button class="btn btn-primary btn-full" id="save-gh-settings-btn" style="margin-top: 15px;">💾 Save GitHub Settings</button>
                </div>
            </div>



            <!-- JSON Backup Export & Restorer -->
            <div class="settings-card glass">
                <div class="settings-card-header">
                    <h3>⚙️ JSON Backup Console</h3>
                    <p class="text-muted text-small">Export full project timelines and daily logs to a single JSON backup file, or restore storage content from an exported JSON backup file.</p>
                </div>

                <div class="settings-actions">
                    <button class="btn btn-primary" id="export-json-btn">📥 Export JSON Backup</button>
                    
                    <hr class="spacer-hr">
                    
                    <div class="form-group">
                        <label for="json-restore-file" class="font-bold">Restore from JSON backup</label>
                        <input type="file" id="json-restore-file" accept=".json" class="file-input-field">
                    </div>
                    <button class="btn btn-secondary btn-full" id="import-json-btn">📤 Upload & Restore Backup</button>
                </div>
            </div>

            <!-- Logs Archive Console -->
            <div class="settings-card glass">
                <div class="settings-card-header">
                    <h3>📦 Archive Historical Daily Logs</h3>
                    <p class="text-muted text-small">Keep the main database lightweight. Move daily logs older than the 30 most recent entries to a separate <code>database_archive.json</code> file in your repository.</p>
                </div>
                <div class="settings-actions">
                    <button class="btn btn-secondary btn-full" id="archive-older-logs-btn">📦 Move Older Logs to Archive</button>
                    <p class="text-muted text-small" id="archive-status-msg" style="margin-top: 10px; display: none;"></p>
                </div>
            </div>

            <!-- Danger zone card -->
            <div class="settings-card danger-card glass">
                <div class="settings-card-header">
                    <h3>⚠️ Danger Zone</h3>
                    <p class="text-danger text-small">Actions here reset or delete all local storage contents. Please handle with care.</p>
                </div>
                <div class="settings-actions">
                    <button class="btn btn-danger btn-full" id="reset-storage-btn">Reset Database to Default (Mock Data)</button>
                    <button class="btn btn-danger btn-full" id="clear-storage-btn" style="margin-top: 10px; background-color: #b91c1c;">Wipe Local Storage Completely</button>
                </div>
            </div>
        </div>
    `;

    // Populate GitHub settings inputs
    const ghConfig = window.Store.getGitHubConfig();
    const enabledInput = document.getElementById('gh-sync-enabled');
    const repoInput = document.getElementById('gh-repo');
    const tokenInput = document.getElementById('gh-token');
    const branchInput = document.getElementById('gh-branch');
    const folderInput = document.getElementById('gh-folder');

    if (enabledInput && repoInput && tokenInput && branchInput && folderInput) {
        enabledInput.checked = ghConfig.enabled || false;
        repoInput.value = ghConfig.repo || '';
        tokenInput.value = ghConfig.token || '';
        branchInput.value = ghConfig.branch || 'main';
        folderInput.value = ghConfig.folder || '';
    }

    // Save GitHub Settings button action
    const saveGhBtn = document.getElementById('save-gh-settings-btn');
    if (saveGhBtn) {
        saveGhBtn.addEventListener('click', async () => {
            const config = {
                enabled: enabledInput.checked,
                repo: repoInput.value.trim(),
                token: tokenInput.value.trim(),
                branch: branchInput.value.trim() || 'main',
                folder: folderInput.value.trim().replace(/\/$/, '')
            };

            if (config.enabled && (!config.repo || !config.token)) {
                window.UI.showToast('Repository and Access Token are required when GitHub Sync is enabled.', 'danger');
                return;
            }

            window.Store.saveGitHubConfig(config);
            window.UI.showToast('GitHub Sync settings saved successfully!', 'success');

            if (config.enabled) {
                window.UI.showToast('Synchronizing database with GitHub...', 'info');
                try {
                    await window.Store.initStore();
                    window.UI.showToast('Successfully pulled latest database from GitHub!', 'success');
                    renderDatabaseView();
                } catch (err) {
                    window.UI.showToast(`Failed to pull from GitHub: ${err.message}`, 'danger');
                }
            }
        });
    }



    // Export JSON Backup
    document.getElementById('export-json-btn').addEventListener('click', () => {
        const dataStr = window.Store.exportJSON();
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `progress_tracker_backup_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        window.UI.showToast('JSON Backup downloaded!', 'success');
    });

    // Import JSON Backup
    document.getElementById('import-json-btn').addEventListener('click', () => {
        const fileInput = document.getElementById('json-restore-file');
        if (fileInput.files.length === 0) {
            window.UI.showToast('Please select a JSON backup file first.', 'warning');
            return;
        }

        const file = fileInput.files[0];
        const reader = new FileReader();
        reader.onload = function(e) {
            const success = window.Store.importJSON(e.target.result);
            if (success) {
                window.UI.showToast('Storage restored from backup JSON successfully!', 'success');
                renderDatabaseView();
            } else {
                window.UI.showToast('Invalid backup file. JSON parsing failed.', 'danger');
            }
        };
        reader.readAsText(file);
    });

    // Reset database to mock seed data
    document.getElementById('reset-storage-btn').addEventListener('click', () => {
        if (confirm("Restore database back to standard default seed data? All custom projects/logs will be overwritten.")) {
            localStorage.clear();
            window.Store.initStore();
            window.UI.showToast('Database reset to mock seed data.', 'info');
            renderDatabaseView();
        }
    });

    // Wipe storage completely
    document.getElementById('clear-storage-btn').addEventListener('click', () => {
        if (confirm("Wipe all project records, step timelines, and daily archives? This action is irreversible.")) {
            localStorage.clear();
            window.UI.showToast('All browser local storage database items deleted.', 'danger');
            renderDatabaseView();
        }
    });

    // Archive older logs to GitHub
    const archiveBtn = document.getElementById('archive-older-logs-btn');
    if (archiveBtn) {
        archiveBtn.addEventListener('click', async () => {
            const config = window.Store.getGitHubConfig();
            if (!config.enabled || !config.repo || !config.token) {
                window.UI.showToast('Please enable and configure GitHub Sync settings first to archive logs.', 'danger');
                return;
            }

            if (confirm("Are you sure you want to move daily logs older than the latest 30 entries to the repository archive file?")) {
                archiveBtn.disabled = true;
                const statusMsg = document.getElementById('archive-status-msg');
                if (statusMsg) {
                    statusMsg.style.display = 'block';
                    statusMsg.style.color = '#38bdf8';
                    statusMsg.textContent = '⏱️ Running log archiving pipeline. Writing to GitHub contents API...';
                }
                
                try {
                    window.UI.showToast("Archiving daily logs...", "info");
                    const res = await window.Store.archiveOlderLogs(30);
                    archiveBtn.disabled = false;
                    
                    if (statusMsg) {
                        if (res.archivedCount > 0) {
                            statusMsg.style.color = '#4ade80';
                            statusMsg.textContent = `✅ Successfully archived ${res.archivedCount} older daily logs (Total in archive: ${res.totalArchived} logs). Main database.json is now optimized!`;
                            window.UI.showToast(`Archived ${res.archivedCount} older logs successfully!`, 'success');
                        } else {
                            statusMsg.style.color = '#fbbf24';
                            statusMsg.textContent = `ℹ️ ${res.message || "No logs needed archiving."}`;
                            window.UI.showToast("No logs needed archiving.", "info");
                        }
                    }
                } catch (err) {
                    archiveBtn.disabled = false;
                    if (statusMsg) {
                        statusMsg.style.color = '#f87171';
                        statusMsg.textContent = `❌ Archive failed: ${err.message}`;
                    }
                    window.UI.showToast(`Log Archiving failed: ${err.message}`, 'danger');
                }
            }
        });
    }
}




// --- GLOBAL DIALOG MODAL SUBMISSIONS ---
function setupGlobalEventListeners() {
    // Two-way synchronization in the step modal form between progress and status select elements
    const stepProgressSelect = document.getElementById('step_progress');
    const stepStatusSelect = document.getElementById('step_status');
    if (stepProgressSelect && stepStatusSelect) {
        stepStatusSelect.addEventListener('change', (e) => {
            const statusVal = e.target.value;
            if (statusVal === 'Completed') {
                stepProgressSelect.value = '100';
            } else if (statusVal === 'Not started') {
                stepProgressSelect.value = '0';
            } else {
                if (stepProgressSelect.value === '100' || stepProgressSelect.value === '0') {
                    stepProgressSelect.value = '50';
                }
            }
        });

        stepProgressSelect.addEventListener('change', (e) => {
            const progressVal = Number(e.target.value);
            const statusVal = stepStatusSelect.value.toLowerCase().trim();
            if (progressVal === 100) {
                stepStatusSelect.value = 'Completed';
            } else if (progressVal === 0) {
                stepStatusSelect.value = 'Not started';
            } else {
                if (statusVal === 'completed' || statusVal === 'not started') {
                    stepStatusSelect.value = 'In progress';
                }
            }
        });
    }

    // 1. Submit New Project
    const projForm = document.getElementById('new-project-form');
    if (projForm) {
        projForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const fields = {
                name: document.getElementById('new_proj_name').value,
                description: document.getElementById('new_proj_desc').value,
                priority: document.getElementById('new_proj_priority').value,
                assigned_to: document.getElementById('new_proj_assign').value,
                start_date: document.getElementById('new_proj_start').value,
                due_date: document.getElementById('new_proj_due').value
            };

            const proj = window.Store.addProject(fields);
            window.UI.closeModal('new-project-modal');
            window.UI.showToast(`Project '${proj.name}' created with 2 seed steps!`, 'success');
            projForm.reset();
            
            // Redirect to the newly created project's timeline details page
            window.location.hash = `#/project/${proj.id}`;
        });
    }

    // Submit Edit Project
    const editProjForm = document.getElementById('edit-project-form');
    if (editProjForm) {
        editProjForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const id = Number(document.getElementById('edit_proj_id').value);
            const fields = {
                name: document.getElementById('edit_proj_name').value,
                description: document.getElementById('edit_proj_desc').value,
                priority: Number(document.getElementById('edit_proj_priority').value) || 9999.0,
                assigned_to: document.getElementById('edit_proj_assign').value,
                start_date: document.getElementById('edit_proj_start').value,
                due_date: document.getElementById('edit_proj_due').value
            };

            window.Store.updateProject(id, fields);
            window.UI.closeModal('edit-project-modal');
            window.UI.showToast(`Project changes saved successfully!`, 'success');
            
            // Re-render view based on current route
            if (currentRoute === ROUTES.DASHBOARD) {
                renderDashboard();
            } else if (currentRoute === ROUTES.PROJECT_DETAILS && currentProjectId === id) {
                renderProjectDetails(id);
            }
        });
    }

    // 2. Submit New / Edit Step (Project-Level Modal)
    const stepForm = document.getElementById('new-step-form');
    if (stepForm) {
        stepForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (currentRoute !== ROUTES.PROJECT_DETAILS || !currentProjectId) return;

            const editId = stepForm.getAttribute('data-edit-id');
            const fields = {
                project_id: currentProjectId,
                step_code: document.getElementById('step_code').value,
                name: document.getElementById('step_name').value,
                assigned_to: document.getElementById('step_assigned_to').value,
                start_date: document.getElementById('step_start_date').value,
                end_date: document.getElementById('step_end_date').value,
                progress: Number(document.getElementById('step_progress').value) || 0,
                status: document.getElementById('step_status').value,
                dependencies: document.getElementById('step_dependencies').value,
                section: document.getElementById('step_section').value,
                external_dep: document.getElementById('step_external_dep').value
            };

            if (editId) {
                // Edit mode
                window.Store.updateStep(editId, fields);
                window.UI.showToast("Step schedule updated successfully!", "success");
            } else {
                // Creation mode
                window.Store.addStep(fields);
                window.UI.showToast("New schedule step added!", "success");
            }

            window.UI.closeModal('new-step-modal');
            stepForm.reset();
            stepForm.removeAttribute('data-edit-id');
            document.getElementById('step_code').removeAttribute('readonly');
            renderProjectDetails(currentProjectId);
        });
    }

    // 3. Submit New Log (Project-Level Modal)
    const logForm = document.getElementById('new-log-form');
    if (logForm) {
        logForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (currentRoute !== ROUTES.PROJECT_DETAILS || !currentProjectId) return;

            const fields = {
                project_id: currentProjectId,
                date: document.getElementById('log_entry_date').value,
                engineer: document.getElementById('log_entry_engineer').value,
                planned_today: document.getElementById('log_entry_planned').value,
                actually_done: document.getElementById('log_entry_done').value,
                comments: document.getElementById('log_entry_comments').value
            };

            window.Store.addLog(fields);
            window.UI.closeModal('new-log-modal');
            window.UI.showToast("Daily log submitted to project archive!", "success");
            logForm.reset();
            renderProjectDetails(currentProjectId);
        });
    }

    // 4. GitHub API Sync Status Toast Listeners
    window.addEventListener('github-sync-start', () => {
        isPushingActive = true;
        window.UI.showToast("Syncing changes with GitHub repository...", "info");
    });
    window.addEventListener('github-sync-success', () => {
        isPushingActive = false;
        window.UI.showToast("Changes successfully committed to GitHub!", "success");
    });
    window.addEventListener('github-sync-error', (e) => {
        isPushingActive = false;
        window.UI.showToast(`GitHub Sync Failed: ${e.detail || 'Unknown Error'}`, "danger");
    });
    window.addEventListener('github-sync-conflict', () => {
        isPushingActive = false;
    });
}
