// Pure Javascript client-side SVG Gantt Chart Renderer

function renderGanttChart(steps, containerId, title = "Project Schedule Timeline") {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    if (!steps || steps.length === 0) {
        container.innerHTML = '<div class="no-gantt-data">No active steps defined to generate timeline.</div>';
        return;
    }

    // 1. Parsed Dates and Boundaries
    let parsedSteps = [];
    let minDate = null;
    let maxDate = null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    steps.forEach((s, idx) => {
        let startDt = s.start_date ? new Date(s.start_date) : new Date(today);
        let endDt = s.end_date ? new Date(s.end_date) : new Date(today);
        
        // Sanity correction
        if (isNaN(startDt.getTime())) startDt = new Date(today);
        if (isNaN(endDt.getTime())) {
            const dur = Number(s.duration) || 1;
            endDt = new Date(startDt.getTime() + dur * 24 * 60 * 60 * 1000);
        }

        // Clamp dates
        startDt.setHours(0, 0, 0, 0);
        endDt.setHours(0, 0, 0, 0);

        if (startDt > endDt) {
            // Swap if start is after end
            const temp = startDt;
            startDt = endDt;
            endDt = temp;
        }

        if (minDate === null || startDt < minDate) minDate = new Date(startDt);
        if (maxDate === null || endDt > maxDate) maxDate = new Date(endDt);

        parsedSteps.push({
            id: s.step_code || `s${idx+1}`,
            name: s.name,
            start: startDt,
            end: endDt,
            progress: Number(s.progress) || 0,
            status: s.status || 'Not started',
            assigned: s.assigned_to || 'Team',
            external_dep: s.external_dep || ''
        });
    });

    if (!minDate) minDate = new Date(today);
    if (!maxDate) maxDate = new Date(today.getTime() + 10 * 24 * 60 * 60 * 1000);

    // Padding margins
    const totalDays = Math.max(1, Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24)));
    
    // Add 2 days padding to the left, and max(5, 20% of span) to the right
    const leftPadDays = 2;
    const rightPadDays = Math.max(5, Math.ceil(totalDays * 0.2));
    
    const chartStart = new Date(minDate.getTime() - leftPadDays * 24 * 60 * 60 * 1000);
    const chartEnd = new Date(maxDate.getTime() + rightPadDays * 24 * 60 * 60 * 1000);
    const totalChartDays = Math.ceil((chartEnd - chartStart) / (1000 * 60 * 60 * 24));

    // Dimensions
    const width = 1350;
    const rowHeight = 45;
    const leftAxisWidth = 150;
    const rightMargin = 40;
    const topPadding = 60;
    const bottomPadding = 60;
    
    const chartWidth = width - leftAxisWidth - rightMargin;
    const height = topPadding + parsedSteps.length * rowHeight + bottomPadding;
    const pixelsPerDay = chartWidth / totalChartDays;

    // Helper functions for coordinates
    const getX = (date) => {
        const diffTime = date - chartStart;
        const diffDays = diffTime / (1000 * 60 * 60 * 24);
        return leftAxisWidth + diffDays * pixelsPerDay;
    };

    // Begin SVG Construction
    let svg = `<svg viewBox="0 0 ${width} ${height}" class="gantt-svg" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">`;
    
    // Background card style
    svg += `<rect width="${width}" height="${height}" rx="12" fill="#ffffff" stroke="rgba(226,232,240,0.8)" stroke-width="1" />`;

    // 2. GRIDLINES & AXES CALCULATION
    // Grid densities
    let gridInterval = 7; // Weekly
    if (pixelsPerDay >= 24) gridInterval = 1;      // Daily
    else if (pixelsPerDay >= 12) gridInterval = 2; // Every 2 days
    else if (pixelsPerDay >= 5) gridInterval = 5;  // Every 5 days

    let dateCursor = new Date(chartStart);
    let index = 0;

    // Grid vertical lines and dates ticks
    while (dateCursor <= chartEnd) {
        // Draw normal gridline depending on density
        if (index % gridInterval === 0) {
            const x = getX(dateCursor);
            svg += `<line x1="${x}" y1="${topPadding - 10}" x2="${x}" y2="${height - bottomPadding}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3" />`;
            
            // Draw x-axis labels (Day/Month)
            const dayStr = String(dateCursor.getDate()).padStart(2, '0');
            const monthStr = String(dateCursor.getMonth() + 1).padStart(2, '0');
            svg += `
                <text x="${x}" y="${height - bottomPadding + 18}" text-anchor="middle" font-size="10.5" font-weight="bold" fill="#64748b">
                    ${dayStr}
                </text>
                <text x="${x}" y="${height - bottomPadding + 30}" text-anchor="middle" font-size="9" font-weight="bold" fill="#94a3b8">
                    ${monthStr}
                </text>
            `;
        }

        // Draw month boundaries (Solid gridline on the first day of each month)
        if (dateCursor.getDate() === 1) {
            const x = getX(dateCursor);
            svg += `<line x1="${x}" y1="${topPadding - 15}" x2="${x}" y2="${height - bottomPadding}" stroke="#1e4e78" stroke-width="1.5" stroke-opacity="0.4" />`;
            // Label month name
            const monthName = dateCursor.toLocaleString('default', { month: 'short' });
            svg += `
                <text x="${x + 6}" y="${topPadding - 22}" text-anchor="start" font-size="11.5" font-weight="bold" fill="#1e4e78" opacity="0.8">
                    📅 ${monthName} ${dateCursor.getFullYear()}
                </text>
            `;
        }

        dateCursor.setDate(dateCursor.getDate() + 1);
        index++;
    }

    // Horizontal baseline below top padding
    svg += `<line x1="${leftAxisWidth - 10}" y1="${topPadding - 10}" x2="${width - rightMargin}" y2="${topPadding - 10}" stroke="#cbd5e1" stroke-width="1.5" />`;
    // Horizontal baseline above bottom padding
    svg += `<line x1="${leftAxisWidth - 10}" y1="${height - bottomPadding}" x2="${width - rightMargin}" y2="${height - bottomPadding}" stroke="#cbd5e1" stroke-width="1.5" />`;

    // 3. STEPS BARS & Y-AXIS LABELS
    parsedSteps.forEach((s, idx) => {
        const y = topPadding + idx * rowHeight + 10; // Row vertical start position
        const barHeight = 25;
        
        // Coordinates
        const xStart = getX(s.start);
        const xEnd = getX(s.end);
        let barWidth = xEnd - xStart;
        if (barWidth <= 0) barWidth = pixelsPerDay; // 0-day task renders as 1 day width

        // Status-based coloring
        let colors = {
            bg: "#F2F2F2",
            border: "#7F7F7F",
            progress: "#D9D9D9"
        };
        const statusLower = s.status.toLowerCase();
        if (statusLower === 'completed') {
            colors = { bg: "#e2f0d9", border: "#385723", progress: "#a9d08e" };
        } else if (statusLower === 'in progress' || statusLower === 'active') {
            colors = { bg: "#ddebf7", border: "#1f4e78", progress: "#9bc2e6" };
        } else if (statusLower === 'on hold' || statusLower === 'delayed' || statusLower === 'blocked') {
            colors = { bg: "#fff2cc", border: "#c65911", progress: "#f4b183" };
        }

        // Draw Row hover background guide line
        svg += `<rect x="5" y="${y - 8}" width="${width - 10}" height="${rowHeight}" fill="rgba(241,245,249,0.3)" opacity="0" class="gantt-row-hover" rx="6" />`;

        // Draw Y-Axis label ticks
        const cleanAssigned = (s.assigned || 'Team').trim();
        const cleanExtDep = (s.external_dep || '').trim();
        const hasOverlap = cleanExtDep && cleanAssigned.toLowerCase().includes(cleanExtDep.toLowerCase());
        const extDepText = (cleanExtDep && !hasOverlap) ? ` / ${cleanExtDep}` : '';
        const yLabelText = `${s.id} (${cleanAssigned}${extDepText})`;
        
        svg += `
            <text x="${leftAxisWidth - 15}" y="${y + barHeight/2 + 4}" text-anchor="end" font-size="11.5" font-weight="bold" fill="#1f4e78">
                ${yLabelText}
            </text>
        `;

        // Render main task bar rectangle
        svg += `
            <rect x="${xStart}" y="${y}" width="${barWidth}" height="${barHeight}" rx="4"
                  fill="${colors.bg}" stroke="${colors.border}" stroke-width="1.5" />
        `;

        // Render progress fill rectangle inside
        if (s.progress > 0) {
            const progWidth = barWidth * (s.progress / 100);
            svg += `
                <rect x="${xStart}" y="${y}" width="${progWidth}" height="${barHeight}" rx="4"
                      fill="${colors.progress}" stroke="none" />
                <!-- Redraw left & horizontal borders to overlay clean progress shapes -->
                <path d="M ${xStart} ${y} L ${xStart} ${y+barHeight}" stroke="${colors.border}" stroke-width="1.5" />
            `;
        }

        // Text Label Placement Logic (Inside vs. Outside Bar)
        const labelText = s.name;
        // Estimate characters width (approx 6.8px per character)
        const estimatedTextWidth = labelText.length * 6.8;
        const fitsInside = barWidth > (estimatedTextWidth + 30);

        if (fitsInside) {
            // Render inside bar center
            svg += `
                <text x="${xStart + barWidth / 2}" y="${y + barHeight/2 + 4.5}" text-anchor="middle" 
                      font-size="9.5" font-weight="bold" fill="#333333">
                    ${labelText}
                </text>
            `;
        } else {
            // Render outside bar aligned left, anchored to the visual end of bar
            svg += `
                <text x="${xStart + barWidth + 8}" y="${y + barHeight/2 + 4.5}" text-anchor="start" 
                      font-size="9.5" font-weight="bold" fill="#1f4e78">
                    ${labelText}
                </text>
            `;
        }
    });

    // 4. DRAW TODAY INDICATOR LINE (if within boundaries)
    const todayTime = today.getTime();
    if (todayTime >= chartStart.getTime() && todayTime <= chartEnd.getTime()) {
        const todayX = getX(today);
        svg += `
            <line x1="${todayX}" y1="${topPadding - 15}" x2="${todayX}" y2="${height - bottomPadding}" 
                  stroke="#c00000" stroke-width="1.8" stroke-dasharray="4,4" />
            <rect x="${todayX - 25}" y="${topPadding - 32}" width="50" height="18" rx="4" fill="#c00000" />
            <text x="${todayX}" y="${topPadding - 20}" text-anchor="middle" font-size="9.5" font-weight="bold" fill="#ffffff">
                TODAY
            </text>
        `;
    }

    // Main Chart Title
    svg += `
        <text x="${leftAxisWidth}" y="${topPadding - 35}" font-size="14" font-weight="bold" fill="#1f4e78">
            📊 ${title}
        </text>
    `;

    svg += '</svg>';
    container.innerHTML = svg;
}

// Attach to window global object
window.Gantt = {
    renderGanttChart
};
