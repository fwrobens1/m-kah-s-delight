/* ── State ────────────────────────────────────────────────── */
let selectedClientId = null;
let currentView = 'clients';
let dashboardMode = 'home'; // 'home' or 'client'
let clients = [];
let toolCallCount = 0;
let currentRelays = 0;
let currentConnected = false;
let settingsProvider = 'openai';

let startTime = Date.now();

/* ── DOM refs ────────────────────────────────────────────── */
const $ = (id) => document.getElementById(id);

const topbarSection = $('topbarSection');
const topbarStatus = $('topbarStatus');
const topbarRole = $('topbarRole');
const clientSelectorBtn = $('clientSelectorBtn');
const clientSelectorAvatar = $('clientSelectorAvatar');
const clientSelectorName = $('clientSelectorName');
const clientDropdown = $('clientDropdown');
const clientDropdownSearch = $('clientDropdownSearch');
const clientDropdownList = $('clientDropdownList');
const uptimeChip = $('uptimeChip');

const viewClients = $('viewClients');
const viewOverview = $('viewOverview');
const viewTools = $('viewTools');
const viewServer = $('viewServer');
const viewSettings = $('viewSettings');
const viewServerLogs = $('viewServerLogs');
const viewScripts = $('viewScripts');
const viewAiChat = $('viewAiChat');
const topbarBack = $('topbarBack');
const sidebarNavHome = $('sidebarNavHome');
const sidebarNavClient = $('sidebarNavClient');

const noClientSearch = $('noClientSearch');
const noClientList = $('noClientList');

const toolPanel = $('toolPanel');
const toolPanelName = $('toolPanelName');
const toolPanelBody = $('toolPanelBody');
const toolPanelClose = $('toolPanelClose');
const toolRunBtn = $('toolRunBtn');
const toolPanelOutput = $('toolPanelOutput');
const toolOutputBody = $('toolOutputBody');
const semanticIndexBtn = $('semanticIndexBtn');
const semanticIndexStatus = $('semanticIndexStatus');
const scriptsFileMenu = $('scriptsFileMenu');
const scriptsCodeMenuBtn = $('scriptsCodeMenuBtn');
const scriptsCodeMenu = $('scriptsCodeMenu');
const scriptsCodeSaveBtn = $('scriptsCodeSaveBtn');
const scriptsCodeView = $('scriptsCodeView');

function updateCodeOverflowHint() {
    if (!scriptsCodeView) return;
    const hasOverflow = scriptsCodeView.scrollWidth > scriptsCodeView.clientWidth;
    const atEnd = scriptsCodeView.scrollLeft + scriptsCodeView.clientWidth >= scriptsCodeView.scrollWidth - 8;
    scriptsCodeView.classList.toggle('has-overflow-x', hasOverflow && !atEnd);
}

// Dynamic right-edge overflow hint
if (scriptsCodeView) scriptsCodeView.addEventListener('scroll', updateCodeOverflowHint);
window.addEventListener('resize', updateCodeOverflowHint);

let semanticIndexJobId = null;

/* ── Helpers ──────────────────────────────────────────────── */
function getInitials(name) { return name.slice(0, 2).toUpperCase(); }

function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
    return String(str).replace(/[&<>"']/g, m => map[m]);
}

function formatTime(date) {
    const d = date instanceof Date ? date : new Date(date);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatTimeFull(date) {
    const d = date instanceof Date ? date : new Date(date);
    const mon = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const day = String(d.getDate()).padStart(2, '0');
    return `${mon} ${day} ${formatTime(d)}`;
}

function avatarHtml(userId, name, size) {
    const sz = size || 28;
    if (userId && userId > 0) {
        return `<img src="/api/avatar?userId=${userId}" onerror="this.parentNode.textContent='${getInitials(name)}'" style="width:${sz}px;height:${sz}px;object-fit:cover;">`;
    }
    return getInitials(name);
}

function transportClass(t) { return t === 'ws' ? 'transport-ws' : 'transport-http'; }

/* ── Uptime ──────────────────────────────────────────────── */
function updateUptime() {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
    const s = String(elapsed % 60).padStart(2, '0');
    const str = h + ':' + m + ':' + s;
    uptimeChip.textContent = str;
    const tu = $('tileUptime');
    if (tu) tu.textContent = str;
}
setInterval(updateUptime, 1000);

/* ── View switching ──────────────────────────────────────── */
const allViews = () => [viewClients, viewOverview, viewTools, viewServer, viewSettings, viewServerLogs, viewScripts, viewAiChat];

function setSidebarMode(mode) {
    dashboardMode = mode;
    sidebarNavHome.style.display = mode === 'home' ? 'flex' : 'none';
    sidebarNavClient.style.display = mode === 'client' ? 'flex' : 'none';
    topbarBack.style.display = mode === 'client' ? 'inline-flex' : 'none';
}

function showView(name) {
    const prevView = currentView;
    currentView = name;
    allViews().forEach(v => {
        v.style.display = 'none';
        v.classList.remove('view--entering');
    });
    const labels = {clients:'Clients',server:'Server','server-logs':'Logs',settings:'Settings',overview:'Overview',tools:'Tools',scripts:'Scripts','ai-chat':'AI Chat'};
    topbarSection.textContent = labels[name] || name;

    let targetView = null;
    if (name === 'clients') { targetView = viewClients; viewClients.style.display = 'flex'; }
    else if (name === 'server') { targetView = viewServer; viewServer.style.display = 'block'; renderServerGraph(); renderOverviewClients(); }
    else if (name === 'server-logs') { targetView = viewServerLogs; viewServerLogs.style.display = 'block'; fetchServerLogs(); }
    else if (name === 'settings') { targetView = viewSettings; viewSettings.style.display = 'block'; loadSettings(); }
    else if (name === 'overview') { targetView = viewOverview; viewOverview.style.display = 'block'; }
    else if (name === 'tools') { 
        targetView = viewTools;
        viewTools.style.display = 'block'; 
        if (!activeTool) selectTool('script-grep');
    }
    else if (name === 'scripts') { 
        targetView = viewScripts;
        viewScripts.style.display = 'block'; 
        fetchScripts(); 
        if (scriptsData.length > 0 && !scriptsViewingFile) renderScriptsBrowser();
    }

    // Only animate on actual navigation, not on re-entry to the same view
    if (targetView && prevView !== name) {
        targetView.classList.add('view--entering');
        targetView.addEventListener('animationend', () => {
            targetView.classList.remove('view--entering');
        }, { once: true });
    }

    const activeNav = dashboardMode === 'home' ? sidebarNavHome : sidebarNavClient;
    activeNav.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.classList.toggle('sidebar-item--active', btn.dataset.view === name);
    });
}

function bindSidebarNav(nav) {
    nav.querySelectorAll('.sidebar-item').forEach(btn => {
        btn.addEventListener('click', () => showView(btn.dataset.view));
    });
}
bindSidebarNav(sidebarNavHome);
bindSidebarNav(sidebarNavClient);

topbarBack.addEventListener('click', () => {
    selectedClientId = null;
    clientSelectorName.textContent = 'Select Client';
    clientSelectorAvatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
    setSidebarMode('home');
    showView('clients');
    renderNoClientList('');
});

/* ── Client selector dropdown ────────────────────────────── */
clientSelectorBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    clientDropdown.classList.toggle('open');
    if (clientDropdown.classList.contains('open')) {
        clientDropdownSearch.value = '';
        clientDropdownSearch.focus();
        renderDropdownClients('');
    }
});

document.addEventListener('click', (e) => {
    if (!clientDropdown.contains(e.target) && !clientSelectorBtn.contains(e.target)) {
        clientDropdown.classList.remove('open');
    }
});

clientDropdownSearch.addEventListener('input', () => {
    renderDropdownClients(clientDropdownSearch.value.toLowerCase());
});

function renderDropdownClients(filter) {
    const filtered = clients.filter(c => !filter || c.username.toLowerCase().includes(filter) || c.placeName.toLowerCase().includes(filter));
    if (filtered.length === 0) {
        clientDropdownList.innerHTML = '<div class="client-dropdown-empty">No clients found</div>';
        return;
    }
    clientDropdownList.innerHTML = filtered.map(c => {
        const active = c.clientId === selectedClientId ? ' active' : '';
        return `<div class="client-dropdown-item${active}" data-cid="${c.clientId}">
            <div class="client-dropdown-item-avatar">${avatarHtml(c.userId, c.username)}</div>
            <div class="client-dropdown-item-info">
                <div class="client-dropdown-item-name">${c.username}</div>
                <div class="client-dropdown-item-place">${c.placeName}</div>
            </div>
            <span class="client-dropdown-item-transport ${transportClass(c.transport)}">${c.transport}</span>
        </div>`;
    }).join('');

    clientDropdownList.querySelectorAll('.client-dropdown-item').forEach(el => {
        el.addEventListener('click', () => {
            selectClient(el.dataset.cid);
            clientDropdown.classList.remove('open');
        });
    });
}

/* ── No-client picker list ───────────────────────────────── */
noClientSearch.addEventListener('input', () => {
    renderNoClientList(noClientSearch.value.toLowerCase());
});

function renderNoClientList(filter) {
    const filtered = clients.filter(c => !filter || c.username.toLowerCase().includes(filter) || c.placeName.toLowerCase().includes(filter));
    if (filtered.length === 0) {
        noClientList.innerHTML = `<div class="no-client-empty">
            <div class="no-client-empty-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg></div>
            <span>No clients connected</span>
        </div>`;
        return;
    }
    noClientList.innerHTML = filtered.map(c => {
        return `<div class="no-client-item" data-cid="${c.clientId}">
            <div class="no-client-item-avatar">${avatarHtml(c.userId, c.username, 32)}</div>
            <span class="no-client-item-name">${c.username}</span>
            <span class="no-client-item-transport ${transportClass(c.transport)}">${c.transport}</span>
        </div>`;
    }).join('');

    noClientList.querySelectorAll('.no-client-item').forEach(el => {
        el.addEventListener('click', () => selectClient(el.dataset.cid));
    });
}

/* ── Select client ───────────────────────────────────────── */
function selectClient(clientId) {
    selectedClientId = clientId;
    const c = clients.find(x => x.clientId === clientId);
    if (c) {
        clientSelectorName.textContent = c.username;
        clientSelectorAvatar.innerHTML = avatarHtml(c.userId, c.username, 24);
    }
    setSidebarMode('client');
    showView('overview');
    updateOverview();
}

/* ── Update overview ─────────────────────────────────────── */
function updateOverview() {
    const c = clients.find(x => x.clientId === selectedClientId);
    if (!c) return;

    $('overviewUsername').textContent = c.username;
    $('overviewPlace').textContent = c.placeName;
    $('overviewClientId').textContent = c.clientId;
    $('overviewPlaceId').textContent = c.placeId || '—';
    $('overviewUserId').textContent = c.userId || '—';
    $('overviewJobId').textContent = c.jobId || '—';

    const oa = $('overviewAvatar');
    oa.innerHTML = avatarHtml(c.userId, c.username, 56);

    const ot = $('overviewTransport');
    ot.textContent = c.transport.toUpperCase();
    ot.className = 'overview-transport ' + transportClass(c.transport);

    $('tileTransport').textContent = c.transport === 'ws' ? 'WebSocket' : 'HTTP Polling';

    const sync = c.scriptSync || { mappedSources: 0, sourcesToMap: 0, hasFinishedMapping: false };
    const mapped = Number(sync.mappedSources) || 0;
    const processed = Number(sync.processedSources) || mapped;
    const skipped = Number(sync.skippedSources) || Math.max(0, processed - mapped);
    const total = Number(sync.sourcesToMap) || 0;
    const syncDone = sync.hasFinishedMapping === true;
    const ssv = $('scriptsSyncCount'); if (ssv) ssv.textContent = `${mapped}/${total}`;
    
    // Update Sync Progress
    const syncPerc = total > 0 ? Math.round((mapped / total) * 100) : 0;
    const spv = $('scriptsSyncPerc'); if (spv) spv.textContent = `${syncPerc}%`;
    const spf = $('syncProgressFill'); if (spf) spf.style.width = `${syncPerc}%`;

    const sss = $('scriptsSyncStatus');
    if (sss) {
        sss.textContent = syncDone ? (skipped > 0 ? 'Synced (skips)' : 'Synced') : 'Syncing';
        sss.className = 'scripts-sync-badge' + (syncDone ? ' scripts-sync-badge--synced' : '');
    }

    const oss = $('overviewScriptsSynced');
    if (oss) oss.textContent = mapped;

    const semantic = c.semanticIndex || { embeddedChunks: 0, chunkCount: 0 };
    const embeddedChunks = Number(semantic.embeddedChunks) || 0;
    const chunkCount = Number(semantic.chunkCount) || 0;
    const isFullyIndexed = chunkCount > 0 && embeddedChunks >= chunkCount;
    const scv = $('scriptsChunkCount'); if (scv) scv.textContent = `${embeddedChunks}/${chunkCount}`;
    
    // Update Index Progress
    const indexPerc = chunkCount > 0 ? Math.round((embeddedChunks / chunkCount) * 100) : 0;
    const ipv = $('scriptsIndexPerc'); if (ipv) ipv.textContent = `${indexPerc}%`;
    const ipf = $('indexProgressFill'); if (ipf) ipf.style.width = `${indexPerc}%`;

    if (!semanticIndexJobId && semanticIndexStatus) {
        if (mapped === 0) {
            semanticIndexStatus.textContent = 'Waiting for scripts';
        } else if (isFullyIndexed && syncDone) {
            semanticIndexStatus.textContent = 'Codebase fully indexed';
        } else {
            semanticIndexStatus.textContent = syncDone
                ? `Ready to index ${mapped} scripts`
                : `Ready to index ${mapped} synced scripts`;
        }
    }
    if (semanticIndexBtn) {
        semanticIndexBtn.disabled = mapped === 0 || !!semanticIndexJobId || (isFullyIndexed && syncDone);
    }
}

/* ── Render overview clients ─────────────────────────────── */
function renderOverviewClients() {
    const el = $('overviewClientsList');
    const count = $('overviewClientCount');
    count.textContent = clients.length;

    if (clients.length === 0) {
        el.innerHTML = '<div class="no-client-empty"><span>No clients connected</span></div>';
        return;
    }
    el.innerHTML = clients.map(c => {
        return `<div class="section-client" data-cid="${c.clientId}">
            <div class="section-client-avatar">${avatarHtml(c.userId, c.username, 32)}</div>
            <div class="section-client-info">
                <div class="section-client-name">${c.username}</div>
                <div class="section-client-meta">${c.placeName} · ${c.clientId.slice(0, 8)}…</div>
            </div>
            <span class="section-client-transport ${transportClass(c.transport)}">${c.transport}</span>
        </div>`;
    }).join('');

    el.querySelectorAll('.section-client').forEach(item => {
        item.addEventListener('click', () => selectClient(item.dataset.cid));
    });
}


/* ── Tools ───────────────────────────────────────────────── */
const toolDefs = {
    'script-grep': {
        name: 'Script Grep',
        desc: 'Search across all decompiled scripts using regex or literal patterns',
        fields: [
            { key: 'query', label: 'Search Pattern', type: 'text', placeholder: 'e.g. RemoteEvent or \\bfunction\\b' },
            { key: 'literal', label: 'Literal Match', type: 'select', options: [['false','Regex'],['true','Literal']], default: 'false' },
            { key: 'caseSensitive', label: 'Case Sensitive', type: 'select', options: [['true','Yes'],['false','No']], default: 'true' },
            { key: 'limit', label: 'Max Scripts', type: 'text', placeholder: '50', default: '50' },
        ],
        buildPayload(vals) {
            return { type: 'script-grep', query: vals.query, literal: vals.literal === 'true', caseSensitive: vals.caseSensitive === 'true', limit: parseInt(vals.limit) || 50 };
        }
    },
    'semantic-search': {
        name: 'Semantic Search',
        desc: 'Natural language search across script sources using embeddings',
        fields: [
            { key: 'query', label: 'Natural Language Query', type: 'text', placeholder: 'e.g. inventory management logic' },
            { key: 'limit', label: 'Max Results', type: 'text', placeholder: '10', default: '10' },
        ],
        buildPayload(vals) {
            return { type: 'semantic-search', query: vals.query, limit: parseInt(vals.limit) || 10 };
        }
    },
    'get-data-by-code': {
        name: 'Get Data by Code',
        desc: 'Execute Luau code and retrieve the returned values',
        fields: [
            { key: 'code', label: 'Luau Code (must return a value)', type: 'textarea', placeholder: 'return game.PlaceId' },
            { key: 'timeout', label: 'Timeout (ms)', type: 'text', placeholder: '15000', default: '15000' },
        ],
        buildPayload(vals) {
            return { type: 'get-data-by-code', code: vals.code, timeout: parseInt(vals.timeout) || 15000 };
        }
    },
    'execute': {
        name: 'Execute Code',
        desc: 'Run Luau code in the Roblox client (fire-and-forget)',
        fields: [
            { key: 'code', label: 'Luau Code', type: 'textarea', placeholder: 'print("Hello from dashboard!")' },
        ],
        buildPayload(vals) { return { type: 'execute', code: vals.code }; }
    },
    'search-instances': {
        name: 'Search Instances',
        desc: 'Query game instances with QueryDescendants selectors',
        fields: [
            { key: 'selector', label: 'QueryDescendants Selector', type: 'text', placeholder: 'e.g. Part, Model > Humanoid, .Tagged' },
            { key: 'root', label: 'Root', type: 'text', placeholder: 'game', default: 'game' },
            { key: 'limit', label: 'Max Results', type: 'text', placeholder: '50', default: '50' },
        ],
        buildPayload(vals) {
            return { type: 'search-instances', selector: vals.selector, root: vals.root || 'game', limit: parseInt(vals.limit) || 50 };
        }
    },
    'get-console-output': {
        name: 'Console Output',
        desc: 'Retrieve the client\'s console/output log',
        fields: [
            { key: 'limit', label: 'Max Lines', type: 'text', placeholder: '50', default: '50' },
            { key: 'filter', label: 'Filter (optional)', type: 'text', placeholder: 'Only include lines containing this text' },
        ],
        buildPayload(vals) {
            const payload = { type: 'get-console-output', limit: parseInt(vals.limit) || 50 };
            if (vals.filter) payload.filter = vals.filter;
            return payload;
        }
    },
    'get-descendants-tree': {
        name: 'Descendants Tree',
        desc: 'Explore the game instance hierarchy tree',
        fields: [
            { key: 'root', label: 'Root Instance', type: 'text', placeholder: 'game.Workspace' },
            { key: 'maxDepth', label: 'Max Depth', type: 'text', placeholder: '3', default: '3' },
            { key: 'classFilter', label: 'Class Filter (optional)', type: 'text', placeholder: 'e.g. BasePart' },
        ],
        buildPayload(vals) {
            const p = { type: 'get-descendants-tree', root: vals.root, maxDepth: parseInt(vals.maxDepth) || 3 };
            if (vals.classFilter) p.classFilter = vals.classFilter;
            return p;
        }
    },
    'get-game-info': {
        name: 'Game Info',
        desc: 'Get PlaceId, GameId, version, and other metadata',
        fields: [],
        buildPayload() { return { type: 'get-game-info' }; }
    },
};

let activeTool = null;

function selectTool(toolKey) {
    const def = toolDefs[toolKey];
    if (!def) return;

    activeTool = toolKey;

    // Update Sidebar
    document.querySelectorAll('.tools-list-item').forEach(item => {
        item.classList.toggle('active', item.dataset.tool === toolKey);
    });

    // Update Header
    $('toolExecName').textContent = def.name;
    $('toolExecDesc').textContent = def.desc;

    // Reset Result
    $('toolOutputBody').textContent = 'Click Send to execute the tool';
    $('toolResponseStatus').textContent = '';
    $('toolResponseTime').textContent = '';

    toolRunBtn.disabled = false;
    toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

    // Build Form (Table Rows)
    if (def.fields.length === 0) {
        $('toolParamsBody').innerHTML = '<tr><td colspan="2" style="color:var(--text-tertiary);font-size:13px;padding:20px 32px;">No parameters required. Click Send to execute.</td></tr>';
    } else {
        $('toolParamsBody').innerHTML = def.fields.map(f => {
            let input;
            if (f.type === 'textarea') {
                input = `<textarea id="tf_${f.key}" placeholder="${f.placeholder || ''}">${f.default || ''}</textarea>`;
            } else if (f.type === 'select') {
                const opts = f.options.map(([v, l]) => `<option value="${v}"${v === f.default ? ' selected' : ''}>${l}</option>`).join('');
                input = `<select id="tf_${f.key}">${opts}</select>`;
            } else {
                input = `<input type="text" id="tf_${f.key}" placeholder="${f.placeholder || ''}" value="${f.default || ''}">`;
            }
            return `<tr><td>${f.label}</td><td>${input}</td></tr>`;
        }).join('');
    }
}

// Sidebar listeners
document.querySelectorAll('.tools-list-item').forEach(item => {
    item.addEventListener('click', () => selectTool(item.dataset.tool));
});

function formatProgress(job) {
    const total = Number(job.total) || 0;
    const completed = Number(job.completed) || 0;
    const percent = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    const count = total > 0 ? `\n${completed}/${total} · ${percent}%` : '';
    return `${job.message || 'Running…'}${count}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollToolProgress(jobId, def) {
    const startTime = performance.now();
    $('toolOutputBody').textContent = 'Initializing…';
    $('toolResponseStatus').textContent = 'Pending';
    $('toolResponseStatus').className = 'tool-res-badge';
    $('toolResponseTime').textContent = '';

    while (true) {
        const res = await fetch('/api/tool-progress?id=' + encodeURIComponent(jobId));
        const job = await res.json();
        
        if (!res.ok || (job.error && !job.status)) {
            throw new Error(job.error || 'Progress lookup failed');
        }

        if (job.status === 'done') {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = typeof job.result === 'string' ? job.result : JSON.stringify(job.result, null, 2);
            $('toolResponseStatus').textContent = '200 OK';
            $('toolResponseStatus').classList.add('tool-res-badge--success');
            $('toolResponseTime').textContent = duration + ' ms';
            toolRunBtn.disabled = false;
            toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
            return;
        }

        if (job.status === 'error') {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = 'Error: ' + (job.error || job.message || 'Failed');
            $('toolResponseStatus').textContent = 'Error';
            $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
            $('toolResponseTime').textContent = duration + ' ms';
            toolRunBtn.disabled = false;
            toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
            return;
        }

        const progressText = formatProgress(job);
        $('toolOutputBody').textContent = progressText;
        toolRunBtn.innerHTML = '<span>' + progressText.split('\n')[0] + '</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin"><circle cx="12" cy="12" r="10" stroke-dasharray="50" stroke-dashoffset="20"/></svg>';
        await sleep(750);
    }
}

async function pollOverviewIndexProgress(jobId) {
    semanticIndexJobId = jobId;
    if (semanticIndexBtn) semanticIndexBtn.disabled = true;

    while (true) {
        const res = await fetch('/api/tool-progress?id=' + encodeURIComponent(jobId));
        const job = await res.json();
        if (!res.ok || job.error && !job.status) {
            throw new Error(job.error || 'Progress lookup failed');
        }

        if (job.status === 'done') {
            semanticIndexStatus.textContent = job.result || 'Index ready';
            semanticIndexJobId = null;
            updateStatus();
            return;
        }

        if (job.status === 'error') {
            semanticIndexStatus.textContent = 'Error: ' + (job.error || job.message || 'Failed');
            semanticIndexJobId = null;
            updateOverview();
            return;
        }

        semanticIndexStatus.textContent = formatProgress(job).replace('\n', ' · ');
        await sleep(750);
    }
}

async function triggerSemanticIndex() {
    if (!selectedClientId || semanticIndexJobId) return;
    semanticIndexStatus.textContent = 'Starting...';
    semanticIndexBtn.disabled = true;

    try {
        const res = await fetch('/api/tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                type: 'semantic-search',
                clientId: selectedClientId,
                query: 'codebase overview',
                limit: 1,
                indexOnly: true,
            }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        if (!data.jobId) throw new Error('No progress job returned');
        await pollOverviewIndexProgress(data.jobId);
    } catch (e) {
        semanticIndexStatus.textContent = 'Error: ' + (e.message || e);
        semanticIndexJobId = null;
        updateOverview();
    }
}

if (semanticIndexBtn) {
    semanticIndexBtn.addEventListener('click', () => triggerSemanticIndex());
}

toolRunBtn.addEventListener('click', async () => {
    if (!activeTool || !selectedClientId) return;
    const def = toolDefs[activeTool];
    if (!def) return;

    const vals = {};
    def.fields.forEach(f => {
        const el = document.getElementById('tf_' + f.key);
        if (el) vals[f.key] = el.value;
    });

    const payload = def.buildPayload(vals);
    payload.clientId = selectedClientId;

    toolRunBtn.disabled = true;
    toolRunBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 1s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="50" stroke-dashoffset="20"/></svg> Running…';


    const startTime = performance.now();
    try {
        const res = await fetch('/api/tool', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (data.error) {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = 'Error: ' + data.error;
            $('toolResponseStatus').textContent = 'ERROR';
            $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
            $('toolResponseTime').textContent = duration + ' ms';
        } else if (data.jobId) {
            await pollToolProgress(data.jobId, def);
        } else {
            const duration = Math.round(performance.now() - startTime);
            $('toolOutputBody').textContent = typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2);
            $('toolResponseStatus').textContent = '200 OK';
            $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--success';
            $('toolResponseTime').textContent = duration + 'ms';
        }
    } catch (e) {
        const duration = Math.round(performance.now() - startTime);
        $('toolOutputBody').textContent = 'Network error: ' + e.message;
        $('toolResponseStatus').textContent = 'ERROR';
        $('toolResponseStatus').className = 'tool-res-badge tool-res-badge--error';
        $('toolResponseTime').textContent = duration + ' ms';
    }

    toolRunBtn.disabled = false;
    toolRunBtn.innerHTML = '<span>Send</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
});

/* ── CSS spin animation ──────────────────────────────────── */
const spinStyle = document.createElement('style');
spinStyle.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(spinStyle);

/* ── Server logs ─────────────────────────────────────────── */
let serverLogsLive = true;
async function fetchServerLogs() {
    try {
        const res = await fetch('/api/server-logs?limit=200');
        const data = await res.json();
        renderServerLogs(data.logs || []);
    } catch(e) {}
}
function renderServerLogs(entries) {
    const body = $('serverLogsTableBody');
    if (!entries.length) { body.innerHTML = '<div class="logs-empty">No server logs yet</div>'; return; }
    
    // Preserve scroll position during live updates
    const savedScroll = body.scrollTop;
    const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30;
    
    body.innerHTML = entries.map(e => {
        const d = new Date(e.timestamp);
        const time = formatTimeFull(d);
        const lvlClass = e.level === 'error' ? 'logs-type-error' : e.level === 'warn' ? 'logs-type-event' : 'logs-type-info';
        const rowClass = e.level === 'error' ? ' logs-row--error' : '';
        return `<div class="logs-row${rowClass}" style="grid-template-columns:160px 80px 1fr">
            <div class="logs-col logs-col--time">${time}</div>
            <div class="logs-col logs-col--type"><span class="${lvlClass}">${e.level}</span></div>
            <div class="logs-col logs-col--message">${escapeHtml(e.message)}</div>
        </div>`;
    }).join('');
    
    // Restore scroll: if user was near bottom, auto-scroll to bottom; otherwise preserve position
    if (wasAtBottom) {
        body.scrollTop = body.scrollHeight;
    } else {
        body.scrollTop = savedScroll;
    }
}
$('serverLogsClearBtn').addEventListener('click', async () => {
    await fetch('/api/server-logs', { method: 'DELETE' });
    renderServerLogs([]);
    showToast('Server logs cleared', 'info');
});
$('serverLogsLiveBtn').addEventListener('click', () => {
    serverLogsLive = !serverLogsLive;
    const btn = $('serverLogsLiveBtn');
    btn.classList.toggle('logs-btn--live', serverLogsLive);
});

/* ── Scripts view ────────────────────────────────────────── */
let scriptsData = [];
let scriptsSearchQuery = '';
let scriptsBrowsePath = []; // current folder path segments
let scriptsViewingFile = null; // currently viewing file debugId
let scriptsViewingFileHasEmbeddings = false;
let scriptsScrollPos = 0; // saved scroll position for the file list

const FOLDER_ICON = '<svg class="scripts-ficon scripts-ficon--folder" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M2 6a2 2 0 012-2h5l2 2h9a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V6z"/></svg>';
const FILE_ICON = '<img class="scripts-ficon" src="luau.svg" width="16" height="16">';

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function fetchScripts() {
    if (!selectedClientId) return;
    try {
        const res = await fetch(`/api/scripts?clientId=${selectedClientId}`);
        const data = await res.json();
        const newScripts = Array.isArray(data) ? data : (data.scripts || []);
        
        // Update and re-render if count changed or if currently viewing the empty state
        if (newScripts.length !== scriptsData.length || (newScripts.length > 0 && $('scriptsFileList').querySelector('.logs-empty'))) {
            scriptsData = newScripts;
            $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
            if (!scriptsViewingFile && !scriptsSearchQuery) {
                renderScriptsBrowser();
            }
        }
    } catch(e) {}
}

// Build tree from flat script list
function buildScriptTree(scripts) {
    const root = { children: {}, scripts: [] };
    for (const s of scripts) {
        const parts = s.path.split('.');
        let node = root;
        for (let i = 0; i < parts.length - 1; i++) {
            const seg = parts[i];
            if (!node.children[seg]) node.children[seg] = { children: {}, scripts: [] };
            node = node.children[seg];
        }
        node.scripts.push({ ...s, name: parts[parts.length - 1] });
    }
    return root;
}

function getNodeAt(tree, pathSegs) {
    let node = tree;
    for (const seg of pathSegs) {
        if (!node.children[seg]) return null;
        node = node.children[seg];
    }
    return node;
}

function countScriptsRecursive(node) {
    let c = node.scripts.length;
    for (const k of Object.keys(node.children)) c += countScriptsRecursive(node.children[k]);
    return c;
}

function showFileMode() {
    $('scriptsFileMode').style.display = '';
    $('scriptsCodeMode').style.display = 'none';
    scriptsViewingFile = null;
    
    // Restore scroll position after a short delay to ensure DOM is updated
    setTimeout(() => {
        const list = $('scriptsFileList');
        if (list) list.scrollTop = scriptsScrollPos;
    }, 0);
}

function showCodeMode() {
    $('scriptsFileMode').style.display = 'none';
    $('scriptsCodeMode').style.display = '';
    setCodeTab('code');
}

function setCodeTab(tab) {
    const tabs = document.querySelectorAll('.scripts-code-tab');
    tabs.forEach(t => t.classList.toggle('scripts-code-tab--active', t.dataset.tab === tab));
    const codeEl = $('scriptsCodeBody');
    const isEdit = tab === 'edit';
    
    codeEl.contentEditable = isEdit ? 'true' : 'false';
    codeEl.classList.toggle('scripts-edit-active', isEdit);
    if (isEdit) {
        codeEl.focus();
        codeEl.addEventListener('input', onCodeEditInput);
    } else {
        codeEl.removeEventListener('input', onCodeEditInput);
    }
    
    // Show/hide save button
    scriptsCodeSaveBtn.style.display = isEdit ? '' : 'none';
}

function renderBreadcrumb(fileName) {
    const bc = $('scriptsBreadcrumb');
    const atRoot = scriptsBrowsePath.length === 0;
    
    if (atRoot && !fileName) {
        bc.style.display = 'none';
        return;
    }
    
    bc.style.display = 'flex';
    let html = '<button class="scripts-bc-seg' + (!fileName && scriptsBrowsePath.length === 0 ? ' scripts-bc-seg--current' : '') + '" data-bc-idx="-1">game</button>';
    scriptsBrowsePath.forEach((seg, i) => {
        const isCurrent = !fileName && i === scriptsBrowsePath.length - 1;
        html += '<span class="scripts-bc-sep">/</span>';
        html += '<button class="scripts-bc-seg' + (isCurrent ? ' scripts-bc-seg--current' : '') + '" data-bc-idx="' + i + '">' + escapeHtml(seg) + '</button>';
    });
    if (fileName) {
        html += '<span class="scripts-bc-sep">/</span>';
        html += '<span class="scripts-bc-seg scripts-bc-seg--current">' + escapeHtml(fileName) + '</span>';
    }
    bc.innerHTML = html;
}

function renderScriptsBrowser() {
    // Ensure file mode is showing (but don't reset scriptsViewingFile or touch scroll)
    $('scriptsFileMode').style.display = '';
    $('scriptsCodeMode').style.display = 'none';
    
    const tree = buildScriptTree(scriptsData);
    renderBreadcrumb();

    const node = getNodeAt(tree, scriptsBrowsePath);
    const list = $('scriptsFileList');
    if (!list) return;

    // Save current scroll before re-rendering
    const currentScroll = list.scrollTop;

    if (!node) {
        list.innerHTML = '<div class="logs-empty">Path not found</div>';
        return;
    }

    const folderNames = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
    const scripts = [...node.scripts].sort((a, b) => a.name.localeCompare(b.name));

    if (folderNames.length === 0 && scripts.length === 0) {
        list.innerHTML = '<div class="logs-empty">No scripts indexed yet</div>';
        return;
    }

    let html = '';

    // ".." go up row
    if (scriptsBrowsePath.length > 0) {
        html += '<div class="scripts-frow scripts-frow--up" data-action="up"><div class="scripts-fname">' + FOLDER_ICON + '<span class="scripts-fname-text">..</span></div><div></div><div></div><div></div></div>';
    }

    // Folders first
    for (const name of folderNames) {
        const count = countScriptsRecursive(node.children[name]);
        html += '<div class="scripts-frow scripts-frow--folder" data-folder="' + escapeHtml(name) + '">';
        html += '<div class="scripts-fname">' + FOLDER_ICON + '<span class="scripts-fname-text">' + escapeHtml(name) + '</span><span class="scripts-fname-count">' + count + '</span></div>';
        html += '<div class="scripts-fmeta"></div>';
        html += '<div class="scripts-fmeta"></div>';
        html += '<div class="scripts-fmeta scripts-factions"></div>';
        html += '</div>';
    }

    // Scripts
    for (const s of scripts) {
        html += '<div class="scripts-frow scripts-frow--file" data-debug-id="' + escapeHtml(s.debugId) + '" data-path="' + escapeHtml(s.path) + '">';
        html += '<div class="scripts-fname">' + FILE_ICON + '<span class="scripts-fname-text">' + escapeHtml(s.name) + '</span></div>';
        html += '<div class="scripts-fmeta">' + s.lines + '</div>';
        html += '<div class="scripts-fmeta">' + formatBytes(s.bytes) + '</div>';
        html += '<div class="scripts-fmeta scripts-factions"><button class="scripts-menu-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button></div>';
        html += '</div>';
    }

    list.innerHTML = html;
    
    // Restore scroll position
    list.scrollTop = currentScroll;
}

// Search — shows flat filtered results
function renderScriptsSearchResults() {
    $('scriptsFileMode').style.display = '';
    $('scriptsCodeMode').style.display = 'none';
    const q = scriptsSearchQuery;
    const filtered = scriptsData.filter(s => s.path.toLowerCase().includes(q) || s.debugId.toLowerCase().includes(q));
    $('scriptsCount').textContent = filtered.length + ' result' + (filtered.length !== 1 ? 's' : '');
    $('scriptsBreadcrumb').innerHTML = '<span class="scripts-bc-seg scripts-bc-seg--current">Search results</span>';
    const list = $('scriptsFileList');

    if (!filtered.length) {
        list.innerHTML = '<div class="logs-empty">No matching scripts</div>';
        return;
    }

    list.innerHTML = filtered.map(s => {
        return '<div class="scripts-frow scripts-frow--file" data-debug-id="' + escapeHtml(s.debugId) + '" data-path="' + escapeHtml(s.path) + '">' +
            '<div class="scripts-fname">' + FILE_ICON + '<span class="scripts-fname-text">' + escapeHtml(s.path) + '</span></div>' +
            '<div class="scripts-fmeta">' + s.lines + '</div>' +
            '<div class="scripts-fmeta">' + formatBytes(s.bytes) + '</div>' +
            '<div class="scripts-fmeta scripts-factions"><button class="scripts-menu-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg></button></div>' +
            '</div>';
    }).join('');
}

$('scriptsSearch').addEventListener('input', (e) => {
    scriptsSearchQuery = e.target.value.toLowerCase().trim();
    if (scriptsSearchQuery) {
        renderScriptsSearchResults();
    } else {
        $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
        renderScriptsBrowser();
    }
});

// Navigation clicks
$('scriptsFileList').addEventListener('click', (e) => {
    // Three-dot menu button clicks
    const menuBtn = e.target.closest('.scripts-menu-btn');
    if (menuBtn) {
        e.stopPropagation();
        showFileContextMenu(menuBtn);
        return;
    }

    const row = e.target.closest('.scripts-frow');
    if (!row) return;

    if (row.dataset.action === 'up') {
        scriptsBrowsePath.pop();
        renderScriptsBrowser();
        return;
    }
    if (row.dataset.folder) {
        scriptsBrowsePath.push(row.dataset.folder);
        renderScriptsBrowser();
        return;
    }
    if (row.dataset.debugId) {
        // Find the script to navigate to its parent folder first
        const script = scriptsData.find(s => s.debugId === row.dataset.debugId);
        if (script) {
            const parts = script.path.split('.');
            scriptsBrowsePath = parts.slice(0, -1);
            // Clear search when navigating from search results
            if (scriptsSearchQuery) {
                scriptsSearchQuery = '';
                $('scriptsSearch').value = '';
                $('scriptsCount').textContent = scriptsData.length + (scriptsData.length === 1 ? ' script' : ' scripts');
            }
        }
        openScriptSource(row.dataset.debugId);
    }
});

// Breadcrumb clicks
$('scriptsBreadcrumb').addEventListener('click', (e) => {
    const btn = e.target.closest('.scripts-bc-seg');
    if (!btn || btn.classList.contains('scripts-bc-seg--current')) return;
    const idx = parseInt(btn.dataset.bcIdx, 10);
    scriptsBrowsePath = idx < 0 ? [] : scriptsBrowsePath.slice(0, idx + 1);
    scriptsViewingFile = null;
    renderScriptsBrowser();
});

// Inline code viewer
async function openScriptSource(debugId) {
    if (!selectedClientId) return;
    
    // Save current scroll position before switching to code mode
    const list = $('scriptsFileList');
    if (list) scriptsScrollPos = list.scrollTop;

    try {
        const res = await fetch(`/api/scripts/source?clientId=${selectedClientId}&debugId=${encodeURIComponent(debugId)}`);
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }

        scriptsViewingFile = debugId;
        const lines = data.source.split('\n');
        const fileName = data.path.split('.').pop();

        // Track whether this script has embeddings
        const scriptMeta = scriptsData.find(s => s.debugId === debugId);
        scriptsViewingFileHasEmbeddings = scriptMeta ? !!scriptMeta.hasEmbeddings : false;

        // Update breadcrumb to show file
        renderBreadcrumb(fileName);

        // Update code info bar
        $('scriptsCodeInfo').textContent = lines.length + ' lines (' + lines.filter(l => l.trim()).length + ' loc) · ' + formatBytes(data.source.length);

        // Build line number gutter
        let gutterHtml = '';
        for (let i = 1; i <= lines.length; i++) {
            gutterHtml += '<span>' + i + '</span>';
        }
        $('scriptsCodeGutter').innerHTML = gutterHtml;

        // Set code and highlight
        const codeEl = $('scriptsCodeBody');
        codeEl.textContent = data.source;
        codeEl.className = 'language-lua';
        
        if (typeof hljs !== 'undefined') {
            delete codeEl.dataset.highlighted;
            hljs.highlightElement(codeEl);
        }

        showCodeMode();
        updateCodeMenuReindex();

        requestAnimationFrame(updateCodeOverflowHint);
    } catch(e) {
        showToast('Failed to load script source', 'error');
    }
}

/* ── Code viewer tab switching ───────────────────────────── */
document.querySelectorAll('.scripts-code-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        setCodeTab(tab.dataset.tab);
    });
});

/* ── Cursor preservation helpers ───────────────────────────── */
function saveCaret(el) {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return null;
    const preRange = range.cloneRange();
    preRange.selectNodeContents(el);
    preRange.setEnd(range.endContainer, range.endOffset);
    const offset = preRange.toString().length;
    return { offset, collapsed: range.collapsed };
}

function restoreCaret(el, saved) {
    if (!saved) { el.focus(); return; }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    let pos = 0, node;
    while ((node = walker.nextNode())) {
        const len = node.nodeValue.length;
        if (pos + len >= saved.offset) {
            const range = document.createRange();
            range.setStart(node, saved.offset - pos);
            range.collapse(true);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            return;
        }
        pos += len;
    }
    el.focus();
}

let codeEditDebounce = null;

function onCodeEditInput() {
    const codeEl = $('scriptsCodeBody');
    clearTimeout(codeEditDebounce);

    // Update line count gutter
    syncGutterFromCode();
    
    codeEditDebounce = setTimeout(() => {
        if (typeof hljs === 'undefined') return;
        const saved = saveCaret(codeEl);
        codeEl.className = 'language-lua';
        delete codeEl.dataset.highlighted;
        hljs.highlightElement(codeEl);
        restoreCaret(codeEl, saved);
    }, 300);
}

function syncGutterFromCode() {
    const codeEl = $('scriptsCodeBody');
    const text = codeEl.textContent || '';
    const lines = text.split('\n');
    const oldCount = $('scriptsCodeGutter').childElementCount;
    if (lines.length === oldCount) return;
    let html = '';
    for (let i = 1; i <= lines.length; i++) {
        html += '<span>' + i + '</span>';
    }
    $('scriptsCodeGutter').innerHTML = html;
    $('scriptsCodeInfo').textContent = lines.length + ' lines (' + lines.filter(l => l.trim()).length + ' loc) · ' + formatBytes(text.length);
}

/* ── Save button ───────────────────────────────────────────── */
scriptsCodeSaveBtn.addEventListener('click', async () => {
    const codeEl = $('scriptsCodeBody');
    const source = codeEl.textContent || '';
    scriptsCodeSaveBtn.disabled = true;
    scriptsCodeSaveBtn.textContent = 'Saving…';
    try {
        const res = await fetch('/api/scripts/source', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: selectedClientId,
                debugId: scriptsViewingFile,
                source,
            }),
        });
        const data = await res.json();
        if (res.ok) {
            showToast('Source saved', 'success');
            $('scriptsCodeInfo').textContent =
                data.lines + ' lines (' + source.split('\n').filter(l => l.trim()).length + ' loc) · ' + formatBytes(data.bytes);
            // Update the script in scriptsData so hasEmbeddings stays in sync
            const script = scriptsData.find(s => s.debugId === scriptsViewingFile);
            if (script) {
                script.lines = data.lines;
                script.bytes = data.bytes;
            }
        } else {
            showToast(data.error || 'Failed to save', 'error');
        }
    } catch(e) {
        showToast('Failed to save source', 'error');
    }
    scriptsCodeSaveBtn.disabled = false;
    scriptsCodeSaveBtn.textContent = 'Save';
});

/* ── Code viewer three-dot menu ──────────────────────────── */
function updateCodeMenuReindex() {
    const item = scriptsCodeMenu.querySelector('[data-action="reindex"]');
    if (item) {
        item.style.display = '';
        item.textContent = scriptsViewingFileHasEmbeddings ? 'Re-index' : 'Index';
    }
}

scriptsCodeMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    updateCodeMenuReindex();
    scriptsCodeMenu.classList.toggle('open');
    closeFileMenu();
});

scriptsCodeMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.scripts-menu-item');
    if (!item) return;
    scriptsCodeMenu.classList.remove('open');

    const action = item.dataset.action;
    if (action === 'copy-source') {
        const codeEl = $('scriptsCodeBody');
        const source = codeEl.textContent || '';
        navigator.clipboard.writeText(source).then(() => {
            showToast('Source copied to clipboard', 'success');
        }).catch(() => {
            showToast('Failed to copy', 'error');
        });
    } else if (action === 'reindex') {
        triggerSemanticIndex();
    }
});

/* ── File row context menu ───────────────────────────────── */
let activeFileMenuDebugId = null;

function showFileContextMenu(btn) {
    const row = btn.closest('.scripts-frow');
    const debugId = row.dataset.debugId;
    activeFileMenuDebugId = debugId;

    // Always show re-index, but change label based on index status
    const script = scriptsData.find(s => s.debugId === debugId);
    const reindexItem = scriptsFileMenu.querySelector('[data-action="reindex"]');
    if (reindexItem) {
        reindexItem.style.display = '';
        reindexItem.textContent = (script && script.hasEmbeddings) ? 'Re-index' : 'Index';
    }

    // Close code menu if open
    scriptsCodeMenu.classList.remove('open');

    // Position menu near the button
    const rect = btn.getBoundingClientRect();
    scriptsFileMenu.style.top = (rect.bottom + 4) + 'px';
    scriptsFileMenu.style.left = Math.min(rect.right - 160, window.innerWidth - 170) + 'px';
    
    // Always close first, then open (handles re-opening for same/different file)
    scriptsFileMenu.classList.remove('open');
    requestAnimationFrame(() => {
        scriptsFileMenu.classList.add('open');
    });
}

function closeFileMenu() {
    scriptsFileMenu.classList.remove('open');
    activeFileMenuDebugId = null;
}

// File menu item clicks
scriptsFileMenu.addEventListener('click', (e) => {
    const item = e.target.closest('.scripts-menu-item');
    if (!item || !activeFileMenuDebugId) return;
    e.stopPropagation();
    const action = item.dataset.action;
    const debugId = activeFileMenuDebugId;
    closeFileMenu();

    if (action === 'edit') {
        openScriptSource(debugId).then(() => setCodeTab('edit'));
    } else if (action === 'open') {
        openScriptSource(debugId);
    } else if (action === 'reindex') {
        triggerSemanticIndex();
    }
});

// Click outside to close menus
document.addEventListener('click', (e) => {
    if (!scriptsCodeMenuBtn.contains(e.target) && !scriptsCodeMenu.contains(e.target)) {
        scriptsCodeMenu.classList.remove('open');
    }
    if (!scriptsFileMenu.contains(e.target) && !e.target.closest('.scripts-menu-btn')) {
        closeFileMenu();
    }
});


/* ── Server graph ────────────────────────────────────────── */
let lastGraphKey = '';

function layoutGraphSide(count, side, w, h, makeNode) {
    if (count <= 0) return [];

    const cx = w / 2;
    const cy = h / 2;
    const yPad = 28;
    const availableY = Math.max(120, h - yPad * 2);
    const minRowGap = 44;
    const maxRows = Math.max(1, Math.floor(availableY / minRowGap) + 1);
    const sidePad = Math.max(42, Math.min(64, w * 0.05));
    const hubGap = Math.max(48, Math.min(120, w * 0.12));
    const outerX = side === 'l' ? sidePad : w - sidePad;
    const innerX = side === 'l' ? cx - hubGap : cx + hubGap;
    const availableX = Math.max(1, Math.abs(innerX - outerX));
    const minColGap = 36;
    const maxCols = Math.max(1, Math.floor(availableX / minColGap) + 1);
    const cols = Math.max(1, Math.min(count, maxCols, Math.ceil(count / maxRows)));
    const rows = Math.ceil(count / cols);
    const rowGap = rows > 1 ? availableY / (rows - 1) : 0;
    const colGap = cols > 1 ? Math.min(96, availableX / (cols - 1)) : 0;
    const density = Math.min(rowGap || 999, colGap || 999);
    const radius = density < 28 ? 11 : density < 36 ? 13 : density < 44 ? 16 : 20;
    const fontSize = radius <= 12 ? 8 : radius <= 14 ? 9 : 10;
    const nodes = [];

    for (let col = 0; col < cols; col++) {
        const first = col * rows;
        const rowsInCol = Math.min(rows, count - first);
        const columnHeight = rowsInCol > 1 ? rowGap * (rowsInCol - 1) : 0;
        const x = side === 'l' ? outerX + col * colGap : outerX - col * colGap;

        for (let row = 0; row < rowsInCol; row++) {
            const index = first + row;
            nodes.push({
                ...makeNode(index),
                x,
                y: cy - columnHeight / 2 + row * rowGap,
                r: radius,
                fontSize
            });
        }
    }

    return nodes;
}

function renderServerGraph() {
    const el = $('serverGraph'); if (!el) return;
    const rc = Math.max(currentRelays, 0), cc = clients.length;
    const w = Math.max(320, Math.round(el.clientWidth || 600));
    const h = Math.max(260, Math.round(el.clientHeight || 300));
    const graphKey = w + ':' + h + ':' + rc + ':' + cc + ':' + clients.map(c => [c.clientId, c.userId, c.username].join('/')).join(',');
    $('serverStatClients').textContent = cc;
    $('serverStatRelays').textContent = rc;
    const ss = $('serverStatStatus');
    ss.textContent = currentConnected ? 'Connected' : 'Disconnected';
    ss.className = 'server-stat-value' + (currentConnected ? ' server-stat-value--green' : '');
    if (graphKey === lastGraphKey) return;
    lastGraphKey = graphKey;
    const cx = w/2, cy = h/2;
    const leftNodes = layoutGraphSide(rc, 'l', w, h, (i) => ({ label: 'R' + (i + 1) }));
    const rightNodes = layoutGraphSide(cc, 'r', w, h, (i) => ({
        label: getInitials(clients[i].username || ''),
        userId: clients[i].userId
    }));
    const colors = ['#a855f7','#f97316','#3b82f6','#22c55e','#ec4899'];
    let s = '<svg viewBox="0 0 '+w+' '+h+'" xmlns="http://www.w3.org/2000/svg"><defs>';
    const allN = [...leftNodes.map((n,i)=>({...n,side:'l',i})), ...rightNodes.map((n,i)=>({...n,side:'r',i}))];
    allN.forEach((n,idx) => {
        const c = colors[idx % colors.length];
        s += '<linearGradient id="bg'+idx+'" x1="0" y1="0" x2="1" y2="0">';
        s += '<stop offset="0%" stop-color="'+c+'" stop-opacity="0"/><stop offset="50%" stop-color="'+c+'"/><stop offset="100%" stop-color="'+c+'" stop-opacity="0"/></linearGradient>';
    });
    rightNodes.forEach((n,i) => {
        s += '<clipPath id="ac'+i+'"><circle cx="'+n.x+'" cy="'+n.y+'" r="'+Math.max(8, n.r - 2)+'"/></clipPath>';
    });
    s += '</defs>';
    allN.forEach((n,idx) => {
        const dx = n.side==='l' ? (cx-n.x)*0.4 : (n.x-cx)*0.4;
        const c1x = n.side==='l' ? n.x+dx : cx+dx, c2x = n.side==='l' ? cx-dx : n.x-dx;
        const p = 'M'+n.x+','+n.y+' C'+c1x+','+n.y+' '+c2x+','+cy+' '+cx+','+cy;
        // Static base line
        s += '<path d="'+p+'" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1.5" pathLength="100"/>';
        // Animated beam using SMIL
        const fromOff = n.side==='l' ? '0' : '-100';
        const toOff = n.side==='l' ? '-100' : '0';
        const delay = (idx * 0.4);
        const c = colors[idx % colors.length];
        s += '<path d="'+p+'" fill="none" stroke="'+c+'" stroke-width="2.5" pathLength="100" stroke-dasharray="20 80" stroke-dashoffset="'+fromOff+'" opacity="0.85">';
        s += '<animate attributeName="stroke-dashoffset" from="'+fromOff+'" to="'+toOff+'" dur="2.5s" begin="'+delay+'s" repeatCount="indefinite"/>';
        s += '</path>';
    });
    s += '<circle cx="'+cx+'" cy="'+cy+'" r="28" fill="#111" stroke="var(--border-light)" stroke-width="1.5"/>';
    s += '<g transform="translate('+(cx-10)+','+(cy-10)+')">';
    s += '<path d="M8.4 1.4L0.6 5.4l8.4 4.2 8.4-4.2-8.4-4z" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>';
    s += '<path d="M0.6 10.2l8.4 4.2 8.4-4.2" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>';
    s += '<path d="M0.6 14.8l8.4 4.2 8.4-4.2" fill="none" stroke="var(--text)" stroke-width="1.5" stroke-linejoin="round"/>';
    s += '</g>';
    leftNodes.forEach(n => {
        s += '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="#111" stroke="var(--border)" stroke-width="1"/>';
        s += '<text x="'+n.x+'" y="'+(n.y+Math.max(3, n.fontSize/2.5))+'" text-anchor="middle" fill="var(--text-secondary)" font-size="'+n.fontSize+'" font-family="var(--mono)">'+escapeHtml(n.label)+'</text>';
    });
    rightNodes.forEach((n,i) => {
        s += '<circle cx="'+n.x+'" cy="'+n.y+'" r="'+n.r+'" fill="#111" stroke="var(--border)" stroke-width="1"/>';
        if (n.userId) {
            const avatarSize = Math.max(16, (n.r - 2) * 2);
            s += '<image href="/api/avatar?userId='+encodeURIComponent(String(n.userId))+'" x="'+(n.x-avatarSize/2)+'" y="'+(n.y-avatarSize/2)+'" width="'+avatarSize+'" height="'+avatarSize+'" clip-path="url(#ac'+i+')" preserveAspectRatio="xMidYMid slice"/>';
        } else {
            s += '<text x="'+n.x+'" y="'+(n.y+Math.max(3, n.fontSize/2.5))+'" text-anchor="middle" fill="var(--text-secondary)" font-size="'+n.fontSize+'" font-family="var(--mono)">'+escapeHtml(n.label)+'</text>';
        }
    });
    if (rc===0 && cc===0) {
        s += '<text x="'+cx+'" y="'+(cy+50)+'" text-anchor="middle" fill="var(--text-tertiary)" font-size="13">No peers connected</text>';
    }
    s += '</svg>';
    el.innerHTML = s;
}

window.addEventListener('resize', () => {
    lastGraphKey = '';
    if (dashboardMode === 'home' && currentView === 'server') renderServerGraph();
});

/* ── Settings ────────────────────────────────────────────── */
/* Toast notifications */
const toastIcons = {
    success: '<svg class="toast-icon toast-icon--success" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>',
    error: '<svg class="toast-icon toast-icon--error" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg class="toast-icon toast-icon--info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};
function showToast(message, type = 'info', duration = 3500) {
    const container = $('toastContainer');
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = (toastIcons[type]||toastIcons.info) +
        '<span class="toast-msg">' + escapeHtml(message) + '</span>' +
        '<button class="toast-close" onclick="this.parentElement.classList.add(\'toast--removing\');setTimeout(()=>this.parentElement.remove(),200)">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    container.appendChild(toast);
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('toast--removing');
            setTimeout(() => toast.remove(), 200);
        }
    }, duration);
}

async function loadSettings() {
    try {
        const res = await fetch('/api/semantic-settings');
        const d = await res.json();
        settingsProvider = d.provider || 'openai';
        updateProviderUI();
        $('settingsOpenaiUrl').value = d.openaiBaseUrl || '';
        $('settingsOpenaiModel').value = d.openaiModel || '';
        $('settingsOpenaiKey').value = d.openaiApiKeySet ? '••••••••' : '';
        $('settingsOllamaUrl').value = d.ollamaBaseUrl || '';
        $('settingsOllamaModel').value = d.ollamaModel || '';
        $('settingsSaveEmbeddings').checked = d.saveEmbeddingsToDisk === true;
    } catch(e) {}
}
function updateProviderUI() {
    document.querySelectorAll('#providerToggle .settings-provider-btn').forEach(b => {
        b.classList.toggle('settings-provider-btn--active', b.dataset.provider === settingsProvider);
    });
    $('settingsOpenai').style.display = settingsProvider === 'openai' ? 'block' : 'none';
    $('settingsOllama').style.display = settingsProvider === 'ollama' ? 'block' : 'none';
}
document.querySelectorAll('#providerToggle .settings-provider-btn').forEach(b => {
    b.addEventListener('click', () => { settingsProvider = b.dataset.provider; updateProviderUI(); });
});
async function saveSettings(body) {
    try {
        const res = await fetch('/api/semantic-settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
        if (res.ok) {
            await loadSettings();
            showToast('Settings saved successfully', 'success');
        } else {
            showToast('Failed to save settings', 'error');
        }
    } catch(e) {
        showToast('Network error saving settings', 'error');
    }
}
$('saveProviderBtn').addEventListener('click', () => saveSettings({provider:settingsProvider}));
$('saveOpenaiBtn').addEventListener('click', () => {
    const key = $('settingsOpenaiKey').value;
    const body = {
        openaiBaseUrl: $('settingsOpenaiUrl').value,
        openaiModel: $('settingsOpenaiModel').value
    };
    if (key && !key.startsWith('••')) body.openaiApiKey = key;
    saveSettings(body);
});
$('saveOllamaBtn').addEventListener('click', () => saveSettings({ollamaBaseUrl:$('settingsOllamaUrl').value,ollamaModel:$('settingsOllamaModel').value}));
async function showConfirmDialog({ title, desc }) {
    return new Promise((resolve) => {
        const modal = $('confirmModal');
        const okBtn = $('confirmOkBtn');
        const cancelBtn = $('confirmCancelBtn');
        const titleEl = $('confirmTitle');
        const descEl = $('confirmDesc');

        titleEl.textContent = title || 'Are you absolutely sure?';
        descEl.textContent = desc || 'This action cannot be undone.';
        
        modal.classList.add('open');

        const cleanup = (val) => {
            modal.classList.remove('open');
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(val);
        };

        const onOk = () => cleanup(true);
        const onCancel = () => cleanup(false);

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

async function deleteEmbeddingCache() {
    const confirmed = await showConfirmDialog({
        title: 'Delete Embedding Cache?',
        desc: 'This will clear all stored script embeddings. They will need to be re-indexed, which may take some time depending on your the game\'s size.'
    });

    if (!confirmed) return;

    try {
        const res = await fetch('/api/semantic-settings', { method:'DELETE' });
        if (res.ok) {
            showToast('Embedding cache cleared', 'success');
        } else {
            const data = await res.json();
            showToast(data.error || 'Failed to clear cache', 'error');
        }
    } catch(e) {
        showToast('Network error clearing cache', 'error');
    }
}
$('saveEmbeddingCacheBtn').addEventListener('click', () => saveSettings({saveEmbeddingsToDisk:$('settingsSaveEmbeddings').checked}));
$('deleteEmbeddingCacheBtn').addEventListener('click', () => deleteEmbeddingCache());
$('settingsTestBtn').addEventListener('click', async () => {
    const r = $('settingsTestResult'); r.innerHTML = 'Testing…'; r.className = '';
    try {
        const body = {
            provider: settingsProvider,
            openaiBaseUrl: $('settingsOpenaiUrl').value,
            openaiModel: $('settingsOpenaiModel').value,
            ollamaBaseUrl: $('settingsOllamaUrl').value,
            ollamaModel: $('settingsOllamaModel').value
        };
        const key = $('settingsOpenaiKey').value;
        if (key && !key.startsWith('••')) body.openaiApiKey = key;
        const res = await fetch('/api/semantic-settings/test', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
        const d = await res.json();
        r.textContent = d.ok ? `✓ Success (${d.dimensions||'?'}d, ${d.latencyMs||'?'}ms)` : '✗ ' + (d.error||'Failed');
        r.className = 'settings-test-result ' + (d.ok ? 'settings-test-result--ok' : 'settings-test-result--err');
        showToast(d.ok ? 'Connection test passed' : 'Connection test failed', d.ok ? 'success' : 'error');
    } catch(e) { r.textContent = '✗ Network error'; r.className = 'settings-test-result settings-test-result--err'; showToast('Network error testing connection', 'error'); }
});

/* ── Polling ─────────────────────────────────────────────── */
async function updateStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        clients = data.clients || [];
        currentRelays = data.relayClients || 0;
        currentConnected = !!data.connected;
        if (data.startedAt) startTime = data.startedAt;

        // Overview tiles
        const cb = $('connBadge'); if(cb) { cb.textContent = data.connected?'Active':'Inactive'; cb.className='status-tile-badge '+(data.connected?'status-tile-badge--green':''); }

        if (selectedClientId && !clients.find(c => c.clientId === selectedClientId)) {
            showToast('Client disconnected', 'error');
            selectedClientId = null;
            clientSelectorName.textContent = 'Select Client';
            clientSelectorAvatar.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 1 0-16 0"/></svg>';
            setSidebarMode('home');
            showView('clients');
        }

        if (dashboardMode === 'home' && currentView === 'clients') {
            renderNoClientList(noClientSearch.value.toLowerCase());
        } else if (dashboardMode === 'home' && currentView === 'server') {
            renderServerGraph();
            renderOverviewClients();
        } else if (dashboardMode === 'home' && currentView === 'server-logs' && serverLogsLive) {
            fetchServerLogs();
        } else if (dashboardMode === 'client' && selectedClientId) {
            updateOverview();
        }
    } catch (e) {}
}

setInterval(updateStatus, 2000);
setInterval(() => {
    if (dashboardMode === 'client' && currentView === 'scripts' && !scriptsViewingFile) {
        fetchScripts();
    }
}, 5000);

updateStatus();
setSidebarMode('home');
showView('clients');
