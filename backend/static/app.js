if ('Notification' in window) { Notification.requestPermission(); }
const API = 'http://127.0.0.1:8000/api';

let currentServer   = '';
let statInterval    = null;
let consoleInterval = null;
let currentPath     = '';
let selectedFiles   = new Set();
let lastLogCount    = 0;
let currentVersion  = '';

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
    await fetchServersList();
}

async function fetchServersList() {
    try {
        const servers = await apiGet('/servers');
        const sel = document.getElementById('global-server-select');
        sel.innerHTML = '';
        servers.forEach(s => sel.appendChild(new Option((s.display_name || s.name).replace(/§[0-9a-fk-or]/gi, ''), s.name)));

        // Toggle empty state vs full app
        if (servers.length === 0) {
            document.getElementById('empty-state').style.display = 'flex';
            document.getElementById('app-container').style.display = 'none';
            currentServer = '';
            clearInterval(statInterval); clearInterval(consoleInterval);
            return;
        }
        document.getElementById('empty-state').style.display = 'none';
        document.getElementById('app-container').style.display = 'flex';

        if (!currentServer || !servers.find(s => s.name === currentServer)) {
            currentServer = servers[0].name;
            sel.value = currentServer;
            onServerChange();
        }
    } catch(e) {}
}

function onServerChange() {
    currentServer = document.getElementById('global-server-select').value;
    clearInterval(statInterval); clearInterval(consoleInterval);
    if (!currentServer) return;
    installedModsCache = []; // Clear cache so it reloads for new server
    currentVersion = '';      // Reset until fetchStats provides it
    currentPlatform = 'vanilla';
    syncPlatformUI();
    document.getElementById('no-server-warning').style.display = 'none';
    document.getElementById('content-area').style.display = 'block';
    document.getElementById('btn-delete-server').style.display = 'inline-flex';
    lastLogCount = 0;
    switchTab('dashboard');
    statInterval    = setInterval(fetchStats,   4000);
    consoleInterval = setInterval(fetchConsole, 2000);
    fetchStats();
    fetchConsole();
    fetchConfig();
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiGet(path) {
    const r = await fetch(API + path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
}
async function apiPost(path, body) {
    const r = await fetch(API + path, {
        method: 'POST',
        headers: body ? {'Content-Type': 'application/json'} : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    return r;
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');
    document.querySelectorAll('nav li').forEach(li => li.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).style.display = 'block';
    document.getElementById(`nav-${tabId}`).classList.add('active');
    if (tabId === 'files' && currentServer) { currentPath = ''; fetchFiles(); }
    if (tabId === 'settings') fetchConfig();
    if (tabId === 'players' && currentServer) loadPlayers();
    if (tabId === 'modrinth') { syncPlatformUI(); searchModrinth(); }
    if (tabId === 'backups' && currentServer) { fetchBackupSettings(); fetchBackups(); }

    lucide.createIcons();
}

// ─── Power buttons ────────────────────────────────────────────────────────────
function setButtons(phase) {
    const startRow   = document.getElementById('btn-row-start');
    const controlRow = document.getElementById('btn-row-controls');
    const startBtn   = document.getElementById('btn-start');

    if (phase === 'stopped') {
        startRow.style.display   = 'flex';
        controlRow.style.display = 'none';
        startBtn.disabled = false;
        startBtn.innerHTML = '▶ Start';
    } else if (phase === 'starting') {
        startRow.style.display   = 'flex';
        controlRow.style.display = 'none';
        startBtn.disabled = true;
        startBtn.innerHTML = '⚙ Starting…';
    } else { // running
        startRow.style.display   = 'none';
        controlRow.style.display = 'flex';
    }

    // Console input enable/disable
    const consoleInput = document.getElementById('console-input');
    const consoleSend  = document.getElementById('console-send');
    const chatMsg      = document.getElementById('chat-message');
    const chatSend     = document.getElementById('chat-send');
    const offline      = document.getElementById('console-offline');
    const isRunning    = phase === 'running';
    const isStopped    = phase === 'stopped';
    if (consoleInput) consoleInput.disabled = !isRunning;
    if (consoleSend)  consoleSend.disabled  = !isRunning;
    if (chatMsg)      chatMsg.disabled      = !isRunning;
    if (chatSend)     chatSend.disabled     = !isRunning;
    // Show offline overlay ONLY when fully stopped (not during starting — boot logs should be visible)
    if (offline)      offline.style.display = isStopped ? 'flex' : 'none';
}

async function startServer() {
    const btn = document.getElementById('btn-start');
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;animation:spin 2s linear infinite;"></i> Starting…';
    const r = await apiPost(`/servers/${encodeURIComponent(currentServer)}/start`);
    if (!r.ok) {
        const detail = (await r.json()).detail || 'Failed to start';
        alert('Error: ' + detail);
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="play" style="width:16px;height:16px;vertical-align:text-bottom;"></i> Start';
        return;
    }
    switchTab('console');
    fetchStats();
}

async function stopServer() {
    const r = await apiPost(`/servers/${encodeURIComponent(currentServer)}/stop`);
    if (!r.ok) {
        const d = (await r.json()).detail;
        if (confirm(d + '\n\nForce stop?'))
            await apiPost(`/servers/${encodeURIComponent(currentServer)}/stop?force=true`);
    }
    fetchStats();
}

async function restartServer() {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/restart`);
    lastLogCount = 0;
    fetchStats();
}

async function killServer() {
    if (!confirm('Kill the server process immediately? This may corrupt world data!')) return;
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/kill`);
    fetchStats();
}

async function deleteCurrentServer() {
    if (!currentServer) return;
    if (!confirm(`Permanently delete server "${currentServer}" and ALL its data? This cannot be undone!`)) return;
    const r = await fetch(`${API}/servers/${encodeURIComponent(currentServer)}`, {method: 'DELETE'});
    if (!r.ok) {
        alert((await r.json()).detail || 'Failed to delete');
        return;
    }
    currentServer = '';
    clearInterval(statInterval); clearInterval(consoleInterval);
    setButtons('stopped');
    await fetchServersList();
    showToast('Server deleted.');
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function fmtBytes(b) {
    if (!b) return '0 B';
    const k = 1024, s = ['B','KB','MB','GB','TB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return (b/k**i).toFixed(2) + ' ' + s[i];
}
function fmtUptime(sec) {
    const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = Math.floor(sec%60);
    return `${h}h ${m}m ${s}s`;
}
function fmtAgo(ts) {
    const d = Math.floor(Date.now()/1000 - ts);
    if (d < 60)    return d + 's ago';
    if (d < 3600)  return Math.floor(d/60) + 'm ago';
    if (d < 86400) return Math.floor(d/3600) + 'h ago';
    return Math.floor(d/86400) + 'd ago';
}

async function fetchStats() {
    if (!currentServer) return;
    try {
        const st = await apiGet(`/servers/${encodeURIComponent(currentServer)}/stats`);
        setButtons(st.phase);

        const badge = { stopped: '● Offline', starting: '<i data-lucide="loader" style="width:12px;height:12px;vertical-align:middle;animation:spin 2s linear infinite;"></i> Starting…', running: '● Online' };
        const cls   = { stopped: 'stopped', starting: 'starting', running: 'running' };
        document.getElementById('stat-status').innerHTML =
            `<span class="badge ${cls[st.phase]}">${badge[st.phase]}</span>`;

        const ramGB = st.ram || 4; // Fallback to 4GB if missing
        
        document.getElementById('stat-cpu').innerText   = st.cpu.toFixed(1) + '%';
        document.getElementById('stat-cpu-sub').innerText = `of ${ramGB * 100 / 2}% allocated`; // rough mapping
        document.getElementById('bar-cpu').style.width  = Math.min(st.cpu / (ramGB * 50), 1) * 100 + '%';
        
        document.getElementById('stat-mem').innerText   = fmtBytes(st.memory);
        document.getElementById('stat-mem-sub').innerText = `of ${ramGB} GB allocated`;
        document.getElementById('bar-mem').style.width  = Math.min(st.memory / (ramGB * 1024**3) * 100, 100) + '%';
        
        document.getElementById('stat-disk').innerText  = fmtBytes(st.disk);
        document.getElementById('stat-disk-sub').innerHTML = `<a href="file:///${st.sp.replace(/\\/g, '/')}" target="_blank" style="color:var(--text); text-decoration:underline;">Open folder</a>`;
        
        document.getElementById('dash-title').innerHTML = `${renderMcText(st.display_name || currentServer)} - ${st.type} ${st.version}`;
        if (document.getElementById('dash-motd-title')) {
            document.getElementById('dash-motd-title').innerHTML = renderMcText(st.display_name || currentServer);
        }
        currentVersion = st.version || '';
        document.getElementById('dash-mods').innerText = st.mods_count || 0;
        document.getElementById('dash-rp').innerText = st.rp_count || 0;
        document.getElementById('dash-sp').innerText = st.sp_count || 0;

        document.getElementById('stat-uptime').innerText = st.phase === 'running' ? fmtUptime(st.uptime) : '—';
        document.getElementById('stat-players').innerText = st.phase === 'running' ? st.players_online : '—';
        document.getElementById('stat-players-sub').innerText = st.phase === 'running' ? `${st.players_online}/${st.players_max} online` : '0/0 online';
        document.getElementById('bar-players').style.width = st.phase === 'running' && st.players_max > 0 ? `${(st.players_online / st.players_max) * 100}%` : '0%';

        // Tunnel & IP
        const servers = await apiGet('/servers');
        const sd = servers.find(s => s.name === currentServer);
        const tb = document.getElementById('tunnel-info-box');
        // Update server icon — use dedicated icon endpoint, fallback to logo
        const iconEl = document.getElementById('dash-server-icon');
        iconEl.onerror = () => { iconEl.src = '/static/logo.png'; iconEl.onerror = null; };
        iconEl.src = `/api/servers/${encodeURIComponent(currentServer)}/icon?t=${Date.now()}`;
        // Sync Mods tab filter based on server platform
        const newPlatform = (st.platform || 'vanilla').toLowerCase();
        if (newPlatform !== currentPlatform) {
            currentPlatform = newPlatform;
            syncPlatformUI();
        }
        const lb = document.getElementById('local-ip-box');
        if (sd?.tunnel?.public_ip) {
            tb.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;">
                <div><i data-lucide="globe" style="width:14px;height:14px;vertical-align:middle;margin-right:4px;"></i> Public IP: <b id="public-ip-text">${sd.tunnel.public_ip}</b></div>
                <button class="btn outline small" onclick="copyIp('public-ip-text')" title="Copy IP"><i data-lucide="clipboard" style="width:14px;height:14px;"></i></button>
            </div>`;
            tb.classList.add('active');
        } else if (sd?.tunnel?.claim_url) {
            tb.innerHTML = `<i data-lucide="alert-triangle" style="width:14px;height:14px;vertical-align:middle;color:var(--warning);"></i> <a href="${sd.tunnel.claim_url}" target="_blank">Claim your tunnel IP →</a>`;
            tb.classList.add('active');
        } else tb.classList.remove('active');

        if (sd?.local_ip && st.phase === 'running') {
            document.getElementById('local-ip-text').innerText = sd.local_ip;
            lb.style.display = 'flex';
        } else {
            lb.style.display = 'none';
        }
    } catch(e) {}
}

function copyIp(elementId) {
    const text = document.getElementById(elementId).innerText;
    navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
}

// ─── Console ──────────────────────────────────────────────────────────────────
function colorLine(raw) {
    const s = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    if (/\[ERROR\]|\bERROR\b/.test(s))   return `<span class="log-error">${s}</span>`;
    if (/\[WARN\]|\bWARN\b/.test(s))     return `<span class="log-warn">${s}</span>`;
    if (/\[Mero\]/.test(s))              return `<span class="log-mero">${s}</span>`;
    if (/^\[Chat\]/.test(s))             return `<span class="log-chat">${s}</span>`;
    if (/^>/.test(s))                    return `<span class="log-cmd">${s}</span>`;
    return `<span class="log-info">${s}</span>`;
}

async function fetchConsole() {
    if (!currentServer) return;
    try {
        const data = await apiGet(`/servers/${encodeURIComponent(currentServer)}/console`);
        if (data.logs.length === lastLogCount) return; // no change
        lastLogCount = data.logs.length;
        const div = document.getElementById('console-logs');
        
        // Check if user is currently scrolled near the bottom
        const isAtBottom = (div.scrollHeight - div.scrollTop - div.clientHeight) < 50;
        
        div.innerHTML = data.logs.map(colorLine).join('\n');
        
        // Only autoscroll if they were already at the bottom
        if (isAtBottom) {
            div.scrollTop = div.scrollHeight;
        }
    } catch(e) {}
}

async function sendConsoleCommand() {
    const inp = document.getElementById('console-input');
    const cmd = inp.value.trim();
    if (!cmd) return;
    inp.value = '';
    
    if (cmd.toLowerCase() === 'cls' || cmd.toLowerCase() === 'clear') {
        clearConsoleLogs();
        return;
    }
    
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/command`, {command: cmd});
}

function clearConsoleLogs() {
    const div = document.getElementById('console-logs');
    div.innerHTML = '';
    lastLogCount = 0; // We keep it in sync, or we could just visually hide it. 
    // Wait, if lastLogCount is 0, the next fetch will see the backend has more logs and rewrite them all!
    // Better to just visually clear it until new logs arrive, but since backend stores logs, 
    // we should fetch the current count and set lastLogCount to it, and just clear the visual.
    // Actually, setting innerHTML to '' works if we update lastLogCount. But next fetch might add EVERYTHING again.
    // Let's just visually clear it and let next log append. Wait, fetchConsole replaces innerHTML entirely.
    // So cls is hard to do if backend returns all logs. Let's make an API call to clear backend logs!
    apiPost(`/servers/${encodeURIComponent(currentServer)}/command`, {command: 'cls_frontend'});
}

// Custom Context Menu for Console
document.addEventListener('DOMContentLoaded', () => {
    const consoleDiv = document.getElementById('console-logs');
    const menu = document.getElementById('console-context-menu');
    const wrapper = document.getElementById('console-wrapper-main');
    
    if (consoleDiv && menu) {
        consoleDiv.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const rect = wrapper.getBoundingClientRect();
            menu.style.display = 'block';
            menu.style.left = (e.clientX - rect.left) + 'px';
            menu.style.top = (e.clientY - rect.top) + 'px';
        });
        
        document.addEventListener('click', (e) => {
            if (e.target.closest('#console-context-menu')) return;
            menu.style.display = 'none';
        });
    }
});

async function copyConsoleLogs() {
    const div = document.getElementById('console-logs');
    try {
        await navigator.clipboard.writeText(div.innerText);
        showToast("Console logs copied!");
    } catch (e) {
        alert("Failed to copy logs");
    }
    document.getElementById('console-context-menu').style.display = 'none';
}

async function sendChat() {
    const msg    = document.getElementById('chat-message').value.trim();
    const player = document.getElementById('chat-player').value.trim();
    if (!msg) return;
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/chat`, {message: msg, player});
    document.getElementById('chat-message').value = '';
    showToast(player ? `Sent as <${player}>` : 'Announcement sent!');
}

// ─── Config ───────────────────────────────────────────────────────────────────
async function fetchConfig() {
    if (!currentServer) return;
    try {
        const data = await apiGet(`/servers/${encodeURIComponent(currentServer)}/config`);
        const c = data.config;
        const meta = data.meta || {};
            
        // Server Identity / Meta
        document.getElementById('cfg-display-name').value = meta.display_name || currentServer;
        document.getElementById('cfg-ram').value = meta.ram || 4;
        document.getElementById('cfg-ram-val').textContent = (meta.ram || 4) + ' GB';
        
        // Sync previews
        const formattedName = renderMcText(meta.display_name || currentServer);
        if (document.getElementById('settings-servername-preview')) {
            document.getElementById('settings-servername-preview').innerHTML = formattedName;
        }
        if (document.getElementById('settings-motd-title')) {
            document.getElementById('settings-motd-title').innerHTML = formattedName;
        }
        // Properties
        const setVal = (id, key, fallback = '') => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = c[key] !== undefined ? c[key] : fallback;
            // Sync range display labels
            if (id === 'cfg-view-distance') document.getElementById('cfg-view-distance-val').textContent = el.value;
            if (id === 'cfg-simulation-distance') document.getElementById('cfg-sim-distance-val').textContent = el.value;
        };
        // World & Generation
        setVal('cfg-level-name',          'level-name',          'world');
        setVal('cfg-level-type',          'level-type',          'minecraft:normal');
        setVal('cfg-allow-nether',        'allow-nether',        'true');
        setVal('cfg-generate-structures', 'generate-structures', 'true');
        setVal('cfg-max-build-height',    'max-build-height',    '256');
        // Gameplay & Rules
        setVal('cfg-difficulty',          'difficulty',          'easy');
        setVal('cfg-pvp',                 'pvp',                 'true');
        setVal('cfg-hardcore',            'hardcore',            'false');
        setVal('cfg-allow-flight',        'allow-flight',        'false');
        setVal('cfg-spawn-protection',    'spawn-protection',    '16');
        // Performance & Limits
        setVal('cfg-max-players',         'max-players',         '20');
        setVal('cfg-view-distance',       'view-distance',       '10');
        setVal('cfg-simulation-distance', 'simulation-distance', '10');
        setVal('cfg-max-tick-time',       'max-tick-time',       '60000');
        // Security & Network
        setVal('cfg-online-mode',         'online-mode',         'true');
        setVal('cfg-enforce-whitelist',   'enforce-whitelist',   'false');
        setVal('cfg-hide-online-players', 'hide-online-players', 'false');
        setVal('cfg-server-port',         'server-port',         '25565');
        // MOTD
        if (c.motd) { document.getElementById('motd-input').value = c.motd; updateMotdPreview(); }
    } catch(e) { console.error('Failed to parse config:', e); }
}

function updateMotdPreview() {
    document.getElementById('motd-preview-text').innerHTML =
        renderMcText(document.getElementById('motd-input').value);
}

async function withButtonState(btn, actionFunc) {
    if (!btn) return await actionFunc();
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;animation:spin 2s linear infinite;"></i>';
    try {
        await actionFunc();
        btn.innerHTML = '<i data-lucide="check" style="width:14px;height:14px;vertical-align:middle;"></i>';
    } catch(e) {
        btn.innerHTML = '<i data-lucide="x" style="width:14px;height:14px;vertical-align:middle;"></i>';
        setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 2000);
        throw e;
    }
    setTimeout(() => { btn.disabled = false; btn.innerHTML = originalText; }, 2000);
}

async function saveSettings(btn) {
    await withButtonState(btn, async () => {
        const get = id => { const el = document.getElementById(id); return el ? el.value : undefined; };
        const updates = {
            'level-name':           get('cfg-level-name'),
            'level-type':           get('cfg-level-type'),
            'allow-nether':         get('cfg-allow-nether'),
            'generate-structures':  get('cfg-generate-structures'),
            'max-build-height':     get('cfg-max-build-height'),
            'difficulty':           get('cfg-difficulty'),
            'pvp':                  get('cfg-pvp'),
            'hardcore':             get('cfg-hardcore'),
            'allow-flight':         get('cfg-allow-flight'),
            'spawn-protection':     get('cfg-spawn-protection'),
            'max-players':          get('cfg-max-players'),
            'view-distance':        get('cfg-view-distance'),
            'simulation-distance':  get('cfg-simulation-distance'),
            'max-tick-time':        get('cfg-max-tick-time'),
            // Security & Network
            'online-mode':          get('cfg-online-mode'),
            'enforce-whitelist':    get('cfg-enforce-whitelist'),
            'hide-online-players':  get('cfg-hide-online-players'),
            'server-port':          get('cfg-server-port'),
            // MOTD (from settings tab motd input if exists, else from dashboard)
            'motd': get('motd-input'),
        };
        // Remove undefined values
        Object.keys(updates).forEach(k => updates[k] === undefined && delete updates[k]);
        
        const meta_updates = {
            'display_name': get('cfg-display-name'),
            'ram': parseInt(get('cfg-ram'))
        };
        
        await apiPost(`/servers/${encodeURIComponent(currentServer)}/config`, { properties: updates, meta: meta_updates });
        showToast('Configuration saved! Restart server to apply changes.');
        fetchServersList();
        fetchStats();
    });
}


// ─── File Manager ─────────────────────────────────────────────────────────────
async function fetchFiles() {
    if (!currentServer) return;
    selectedFiles.clear(); updateSelectAll();
    // Pre-load installed mods cache so fileIcon() can show thumbnails
    if (installedModsCache.length === 0) {
        try {
            const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/installed_mods`);
            installedModsCache = res.files || [];
        } catch(e) {}
    }
    const files = await apiGet(`/servers/${encodeURIComponent(currentServer)}/files?path=${encodeURIComponent(currentPath)}`);
    renderBreadcrumb();
    const tbody = document.getElementById('fm-tbody');
    tbody.innerHTML = '';
    if (currentPath) {
        const parent = currentPath.split('/').slice(0,-1).join('/');
        const tr = document.createElement('tr'); tr.className = 'fm-row';
        tr.innerHTML = `<td></td><td colspan="3" class="fm-name" onclick="navTo('${parent}')" style="color:var(--muted);cursor:pointer"><i data-lucide="corner-left-up" style="width:14px;height:14px;vertical-align:middle;"></i> ..</td><td></td>`;
        tbody.appendChild(tr);
    }
    if (files.length === 0) {
        const tr = document.createElement('tr'); tr.className = 'fm-row';
        tr.innerHTML = `<td colspan="5" style="text-align:center; color:var(--muted); padding: 20px;">Folder is empty.</td>`;
        tbody.appendChild(tr);
    }
    files.forEach(f => {
        const tr = document.createElement('tr'); tr.className = 'fm-row';
        const icon = f.is_dir ? '<i data-lucide="folder" style="width:16px;height:16px;vertical-align:middle;color:var(--blue);"></i>' : fileIcon(f);
        const nameCell = f.is_dir
            ? `<td class="fm-name dir-name" onclick="navTo('${f.path}')">${icon} ${f.name}</td>`
            : `<td class="fm-name file-name" onclick="editFile('${f.path}')" style="cursor:pointer">${icon} ${f.name}</td>`;
        tr.innerHTML = `
            <td><input type="checkbox" class="fm-check" data-path="${f.path}" onchange="onCheck('${f.path}',this.checked)"></td>
            ${nameCell}
            <td class="fm-meta">${f.is_dir ? '—' : fmtBytes(f.size)}</td>
            <td class="fm-meta">${fmtAgo(f.modified)}</td>
            <td><button class="btn danger outline small" onclick="delEntry('${f.path}')">Delete</button></td>`;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

function renderBreadcrumb() {
    const parts = currentPath ? currentPath.split('/') : [];
    let built = '', html = `<span class="bc-item" onclick="navTo('')"><i data-lucide="home" style="width:14px;height:14px;vertical-align:middle;"></i> /</span>`;
    parts.forEach(p => {
        built += (built ? '/' : '') + p;
        const path = built;
        html += ` <span class="bc-sep">/</span> <span class="bc-item" onclick="navTo('${path}')">${p}</span>`;
    });
    document.getElementById('fm-breadcrumb').innerHTML = html;
}

function navTo(path) { currentPath = path; fetchFiles(); }

function fileIcon(f) {
    const n = typeof f === 'string' ? f : f.name;
    // If backend provided icon_url (tracked mod), use it
    if (f && typeof f === 'object' && f.icon_url) {
        return `<img src="${f.icon_url}" style="width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;background:rgba(255,255,255,0.1);">`;
    }
    if (n.endsWith('.jar')) {
        // Check installed mods cache for a matching icon
        const cached = installedModsCache.find(m => m.path && m.path.split('/').pop() === n);
        if (cached && cached.icon_url) {
            return `<img src="${cached.icon_url}" style="width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;background:rgba(255,255,255,0.1);">`;
        }
        const isMod = installedModsCache.some(m => m.path && m.path.endsWith('/' + n));
        if (isMod) return '<i data-lucide="package" style="width:16px;height:16px;vertical-align:middle;color:var(--success);"></i>';
        return '<i data-lucide="cog" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
    }
    if (n.endsWith('.json')) return '<i data-lucide="braces" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
    if (n.endsWith('.txt'))  return '<i data-lucide="file-text" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
    if (n.endsWith('.log'))  return '<i data-lucide="scroll-text" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
    if (n.endsWith('.zip') || n.endsWith('.gz')) return '<i data-lucide="file-archive" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
    if (/\.(png|jpg|gif)$/.test(n)) return '<i data-lucide="image" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
    return '<i data-lucide="file" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
}

function filterFiles() {
    const q = document.getElementById('fm-search').value.toLowerCase();
    const rows = document.querySelectorAll('#fm-tbody .fm-row');
    rows.forEach(row => {
        const nameCell = row.querySelector('.fm-name');
        if (nameCell && nameCell.innerText.toLowerCase().includes(q)) {
            row.style.display = '';
        } else {
            row.style.display = 'none';
        }
    });
}

function onCheck(path, checked) { checked ? selectedFiles.add(path) : selectedFiles.delete(path); updateSelectAll(); }
function toggleSelectAll(checked) {
    document.querySelectorAll('.fm-check').forEach(cb => { cb.checked = checked; checked ? selectedFiles.add(cb.dataset.path) : selectedFiles.delete(cb.dataset.path); });
}
function updateSelectAll() {
    const all = document.querySelectorAll('.fm-check'), chk = document.getElementById('fm-select-all');
    if (chk) chk.checked = all.length > 0 && selectedFiles.size === all.length;
}

async function delEntry(path) {
    if (!confirm(`Delete "${path}"?`)) return;
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/files/delete?path=${encodeURIComponent(path)}`);
    fetchFiles();
}

async function deleteSelected() {
    if (!selectedFiles.size) return;
    if (!confirm(`Delete ${selectedFiles.size} item(s)?`)) return;
    for (const p of selectedFiles)
        await apiPost(`/servers/${encodeURIComponent(currentServer)}/files/delete?path=${encodeURIComponent(p)}`);
    fetchFiles();
}

async function createFolder() {
    const name = prompt('New folder name:');
    if (!name) return;
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/files/mkdir?path=${encodeURIComponent(currentPath ? currentPath+'/'+name : name)}`);
    fetchFiles();
}

// Drag & drop
const dropzone = document.getElementById('dropzone');
dropzone.addEventListener('dragover',  e => { e.preventDefault(); dropzone.classList.add('drag-over'); });
dropzone.addEventListener('dragleave', e => { dropzone.classList.remove('drag-over'); });
dropzone.addEventListener('drop', async e => {
    e.preventDefault(); dropzone.classList.remove('drag-over');
    if (!currentServer) return;
    
    showToast('Uploading files...');
    for (const file of e.dataTransfer.files) {
        const fd = new FormData();
        fd.append('file', file); fd.append('path', currentPath);
        const r = await fetch(`${API}/servers/${encodeURIComponent(currentServer)}/upload`, {method:'POST', body: fd});
        if (!r.ok) showToast('Failed to upload ' + file.name);
    }
    showToast('Upload complete!');
    fetchFiles();
});

document.getElementById('fm-upload-btn').addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = true;
    inp.onchange = async () => {
        await withButtonState(btn, async () => {
            for (const file of inp.files) {
                const fd = new FormData();
                fd.append('file', file); fd.append('path', currentPath);
                const r = await fetch(`${API}/servers/${encodeURIComponent(currentServer)}/upload`, {method:'POST', body: fd});
                if (!r.ok) throw new Error('Upload failed');
            }
            fetchFiles();
        });
    };
    inp.click();
});

// ─── Modrinth ─────────────────────────────────────────────────────────────────
// ─── Modrinth ─────────────────────────────────────────────────────────────────
let modrinthTimeout = null;
let installedModsCache = [];

function debounceSearchModrinth() {
    clearTimeout(modrinthTimeout);
    modrinthTimeout = setTimeout(searchModrinth, 400);
}

function switchModTab(tab) {
    document.querySelectorAll('.mod-tab').forEach(el => el.classList.remove('active'));
    document.getElementById('mt-' + tab).classList.add('active');
    document.getElementById('mod-view-available').style.display = tab === 'available' ? 'block' : 'none';
    document.getElementById('mod-view-installed').style.display = tab === 'installed' ? 'block' : 'none';
    if (tab === 'installed') fetchInstalledMods();
}

async function fetchInstalledMods() {
    if (!currentServer) return;
    const grid = document.getElementById('installed-mod-results');
    grid.innerHTML = '<p class="text-muted">Loading...</p>';
    const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/installed_mods`);
    installedModsCache = res.files || [];
    filterInstalledMods();
}


function filterInstalledMods() {
    const q = document.getElementById('mod-installed-search-input').value.toLowerCase();
    const typeFilter = document.getElementById('mod-installed-type-filter').value;
    const grid = document.getElementById('installed-mod-results');
    grid.innerHTML = '';
    
    // installedModsCache is now an array of objects: {path, title, icon_url, project_id}
    let filtered = installedModsCache.filter(f => {
        if (!f.title.toLowerCase().includes(q) && !f.path.toLowerCase().includes(q)) return false;
        if (typeFilter !== 'all') {
            if (typeFilter === 'mod' && !f.path.startsWith('mods/')) return false;
            if (typeFilter === 'plugin' && !f.path.startsWith('plugins/')) return false;
            if (typeFilter === 'resourcepack' && !f.path.startsWith('resourcepacks/')) return false;
            if (typeFilter === 'shader' && !f.path.startsWith('shaderpacks/')) return false;
        }
        return true;
    });
    
    if (filtered.length === 0) {
        grid.innerHTML = '<p class="text-muted">No installed mods found.</p>';
        return;
    }
    filtered.forEach(f => {
        const c = document.createElement('div'); c.className = 'mod-card';
        const filename = f.path.split('/')[1];
        c.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
            <img src="${f.icon_url || 'https://docs.modrinth.com/img/logo.svg'}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;">
            <div style="flex:1;overflow:hidden;">
                <h4 style="margin:0;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.title}</h4>
                <div style="font-size:0.75rem;color:var(--muted);">${filename}</div>
            </div>
            </div>
            <button class="btn danger outline small" onclick="deleteInstalledMod('${f.path}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i> Delete</button>`;
        grid.appendChild(c);
    });
    lucide.createIcons();
}

async function deleteInstalledMod(path) {
    if (!confirm(`Delete ${path.split('/')[1]}?`)) return;
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/files/delete?path=${encodeURIComponent(path)}`);
    showToast('Deleted');
    fetchInstalledMods();
}

async function searchModrinth() {
    const q = document.getElementById('mod-search-input').value;
    const t = document.getElementById('mod-type-filter').value;
    if (!currentServer) return;
    
    // ensure we know what's installed
    if (installedModsCache.length === 0) {
        const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/installed_mods`);
        installedModsCache = res.files || [];
    }

    const grid = document.getElementById('mod-results');
    grid.innerHTML = '<p class="text-muted">Searching…</p>';
    // Build loader param: only filter by loader for mods (not resource packs/shaders)
    const loaderMap = {fabric:'fabric',forge:'forge',quilt:'quilt',neoforge:'neoforge',paper:'paper',purpur:'paper',spigot:'spigot',bukkit:'bukkit'};
    const loader = (t === 'mod' || t === 'modpack') ? (loaderMap[currentPlatform] || '') : '';
    let url = `/modrinth/search?query=${encodeURIComponent(q)}&project_type=${t}`;
    if (currentVersion) url += `&game_version=${encodeURIComponent(currentVersion)}`;
    if (loader)         url += `&loader=${encodeURIComponent(loader)}`;
    const hits = await apiGet(url);
    grid.innerHTML = '';
    if (hits.length === 0) {
        grid.innerHTML = '<p class="text-muted">No results found.</p>';
        return;
    }
    
    hits.forEach(h => {
        const isInstalled = installedModsCache.some(f => f.project_id === h.project_id || f.title.toLowerCase().includes(h.slug.toLowerCase()));
        
        const c = document.createElement('div'); c.className = 'mod-card';
        let actionBtn = `<button id="btn-mod-${h.project_id}" class="btn primary small" onclick="installMod('${h.project_id}','${t}')"><i data-lucide="download" style="width:14px;height:14px;"></i> Install</button>`;
        
        if (isInstalled) {
            actionBtn = `<button class="btn success small" disabled><i data-lucide="check" style="width:14px;height:14px;"></i> Installed</button>`;
        }
        
        c.innerHTML = `<img src="${h.icon_url||'https://docs.modrinth.com/img/logo.svg'}">
            <h4>${h.title}</h4><p>${(h.description||'').substring(0,90)}…</p>
            <div id="mod-action-${h.project_id}">${actionBtn}</div>`;
        grid.appendChild(c);
    });
    lucide.createIcons();
}

async function installMod(id, type) {
    const actionDiv = document.getElementById(`mod-action-${id}`);
    actionDiv.innerHTML = `
        <div class="mod-progress-container">
            <div class="mod-progress-fill" id="prog-fill-${id}"></div>
            <div class="mod-progress-text" id="prog-text-${id}">Starting...</div>
        </div>
    `;
    
    try {
        const r = await apiPost(`/servers/${encodeURIComponent(currentServer)}/install`, {project_id: id, project_type: type});
        if (!r.ok) throw new Error("Failed to start install");
        
        const interval = setInterval(async () => {
            const stat = await apiGet(`/servers/${encodeURIComponent(currentServer)}/install_progress?project_id=${id}`);
            if (stat.status === 'error') {
                clearInterval(interval);
                actionDiv.innerHTML = `<button class="btn danger small" disabled>Error</button>`;
                showToast("Installation failed.");
            } else if (stat.status === 'installed') {
                clearInterval(interval);
                actionDiv.innerHTML = `<button class="btn success small" disabled><i data-lucide="check" style="width:14px;height:14px;"></i> Installed</button>`;
                lucide.createIcons();
                // refresh installed mods cache in background
                const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/installed_mods`);
                installedModsCache = res.files || [];
            } else if (stat.status === 'downloading') {
                const fill = document.getElementById(`prog-fill-${id}`);
                const text = document.getElementById(`prog-text-${id}`);
                if (fill && text && stat.total > 0) {
                    const pct = (stat.downloaded / stat.total) * 100;
                    fill.style.width = pct + '%';
                    const mbDl = (stat.downloaded / 1048576).toFixed(1);
                    const mbTot = (stat.total / 1048576).toFixed(1);
                    text.innerText = `${mbDl} MB / ${mbTot} MB`;
                }
            }
        }, 500);
        
    } catch (e) {
        actionDiv.innerHTML = `<button class="btn danger small" disabled>Failed</button>`;
        showToast("Error starting installation.");
    }
}

let aceEditor = null;
let editingPath = '';

async function editFile(path) {
    if (!currentServer) return;
    try {
        const data = await apiGet(`/servers/${encodeURIComponent(currentServer)}/files/content?path=${encodeURIComponent(path)}`);
        document.getElementById('editor-filename').innerHTML = `<i data-lucide="file-edit" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"></i> ${path}`;
        document.getElementById('editor-modal').classList.add('active');
        
        if (!aceEditor) {
            aceEditor = ace.edit("editor-container");
            aceEditor.setTheme("ace/theme/one_dark");
            aceEditor.setOptions({
                fontSize: "14px",
                showPrintMargin: false,
            });
        }
        
        const ext = path.split('.').pop().toLowerCase();
        const modeMap = {
            'json': 'json', 'yml': 'yaml', 'yaml': 'yaml',
            'properties': 'properties', 'txt': 'text',
            'html': 'html', 'js': 'javascript', 'css': 'css',
            'bat': 'batch', 'sh': 'sh'
        };
        aceEditor.session.setMode(`ace/mode/${modeMap[ext] || 'text'}`);
        aceEditor.setValue(data.content, -1);
        editingPath = path;
    } catch(e) {
        alert('Cannot edit this file (might be binary or too large)');
    }
}

async function saveFileContent(btn) {
    if (!currentServer || !editingPath || !aceEditor) return;
    const content = aceEditor.getValue();
    await withButtonState(btn, async () => {
        await apiPost(`/servers/${encodeURIComponent(currentServer)}/files/content`, { path: editingPath, content });
        showToast('File saved successfully!');
    });
}

function closeEditor() {
    document.getElementById('editor-modal').classList.remove('active');
    editingPath = '';
}

// ─── Modal ────────────────────────────────────────────────────────────────────
let systemSpecsFetched = false;
async function showCreateModal() { 
    document.getElementById('create-modal').classList.add('active'); 
    if (!systemSpecsFetched) {
        try {
            const spec = await apiGet('/system_specs');
            const maxRam = spec.total_ram_gb || 8;
            const slider = document.getElementById('server-ram');
            slider.max = maxRam;
            if(slider.value > maxRam) slider.value = maxRam;
            document.getElementById('ram-slider-max-label').innerText = `${maxRam} GB (System Max)`;
            document.getElementById('ram-slider-val').innerText = `${slider.value} GB`;
            systemSpecsFetched = true;
        } catch(e) {}
    }
    fetchVersionsForSoftware();
}
function closeCreateModal(){ document.getElementById('create-modal').classList.remove('active'); }

function closeTutorialModal() {
    document.getElementById('tutorial-modal').classList.remove('active');
}

async function fetchVersionsForSoftware() {
    const type = document.getElementById('server-type').value;
    const select = document.getElementById('server-version');
    select.innerHTML = '<option value="">Loading versions...</option>';
    try {
        const data = await apiGet(`/versions?software=${type}`);
        select.innerHTML = '';
        if (data.versions && data.versions.length > 0) {
            data.versions.forEach((v, idx) => {
                select.appendChild(new Option(v, v, false, idx === 0)); // Select first by default
            });
        } else {
            select.innerHTML = '<option value="">No versions found</option>';
        }
    } catch(e) {
        select.innerHTML = '<option value="">Error loading versions</option>';
    }
}

async function createServer() {
    const name = document.getElementById('server-name').value.trim();
    const type = document.getElementById('server-type').value;
    const ver  = document.getElementById('server-version').value;
    const subdomain = document.getElementById('server-subdomain').value.trim();
    const description = document.getElementById('server-description').value.trim();
    const ram = parseInt(document.getElementById('server-ram').value) || 4;

    if (!name) return alert('Enter a server name');
    if (!ver) return alert('Please wait for versions to load or select a version');
    
    const btn = document.getElementById('btn-create-server');
    btn.innerText = 'Creating…'; btn.disabled = true;
    try {
        const r = await fetch(`${API}/servers`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({name, type, version: ver, subdomain, description, ram})
        });
        let data = {};
        try { data = await r.json(); } catch(e) {}
        if (!r.ok) {
            alert(data.detail || 'Failed to create server (check name characters)');
            return;
        }
        closeCreateModal();
        document.getElementById('server-name').value = '';
        document.getElementById('server-subdomain').value = '';
        document.getElementById('server-description').value = '';
        await fetchServersList();
        currentServer = name;
        document.getElementById('global-server-select').value = name;
        onServerChange();
        
        // Show tutorial
        document.getElementById('tutorial-modal').classList.add('active');
    } catch(e) {
        alert('Error: ' + e.message);
    } finally {
        btn.innerText = 'Create Server'; btn.disabled = false;
    }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

init();


// --- Global Downloads Panel Polling ---
let downloadsPanelVisible = false;
let globalDownloadsInterval = null;

function toggleDownloadsPanel() {
    const panel = document.getElementById('downloads-panel');
    downloadsPanelVisible = !downloadsPanelVisible;
    panel.style.display = downloadsPanelVisible ? 'flex' : 'none';
    if (downloadsPanelVisible) panel.style.flexDirection = 'column';
}

function startGlobalDownloadsPolling() {
    if (globalDownloadsInterval) return;
    globalDownloadsInterval = setInterval(async () => {
        if (!currentServer) return;
        try {
            const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/install_progress_all`);
            const panel = document.getElementById('downloads-list');
            const icon = document.getElementById('btn-global-downloads');
            
            const keys = Object.keys(res);
            if (keys.length === 0) {
                panel.innerHTML = '<p class="text-muted" style="text-align:center; font-size:0.85rem;">No active downloads.</p>';
                icon.className = 'btn outline small';
                return;
            }
            
            let allDone = true;
            let html = '';
            for (let id of keys) {
                const prog = res[id];
                if (prog.status === 'downloading') allDone = false;
                
                const pct = prog.total > 0 ? ((prog.downloaded / prog.total) * 100).toFixed(1) : 0;
                const mbStr = prog.total > 0 ? `${(prog.downloaded/1048576).toFixed(1)} / ${(prog.total/1048576).toFixed(1)} MB` : 'Starting...';
                const statusStr = prog.status === 'installed' ? 'Installed' : (prog.status === 'error' ? 'Error' : mbStr);
                const color = prog.status === 'installed' ? 'var(--success)' : (prog.status === 'error' ? 'var(--danger)' : 'rgba(16, 185, 129, 0.4)');
                
                html += `
                <div style="display:flex; align-items:center; gap:8px; background:var(--panel); padding:8px; border-radius:6px; margin-bottom: 4px;">
                    <img src="${prog.icon_url || 'https://docs.modrinth.com/img/logo.svg'}" style="width:24px;height:24px;border-radius:4px;">
                    <div style="flex:1; overflow:hidden;">
                        <div style="font-size:0.85rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${prog.title || id}</div>
                        <div style="width:100%; height:12px; background:rgba(0,0,0,0.3); border-radius:3px; position:relative; overflow:hidden; margin-top:4px;">
                            <div style="height:100%; width:${pct}%; background:${color}; transition: width 0.3s ease;"></div>
                            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.65rem; font-weight:bold; color:#fff;">${statusStr}</div>
                        </div>
                    </div>
                </div>`;
            }
            panel.innerHTML = html;
            
            if (allDone) {
                icon.style.background = '';
                icon.style.borderColor = '';
            } else {
                icon.style.background = 'rgba(16,185,129,0.15)';
                icon.style.borderColor = 'var(--success)';
            }
        } catch(e) {}
    }, 1000);
}

startGlobalDownloadsPolling();


// --- Box Selection Logic ---
let isSelecting = false;
let selectionStart = {x:0, y:0};
let selectionBox = null;

document.getElementById('fm-tbody').addEventListener('mousedown', (e) => {
    if (!e.ctrlKey) return;
    if (e.target.closest('.btn') || e.target.closest('input[type="checkbox"]')) return;
    
    isSelecting = true;
    selectionStart = {x: e.pageX, y: e.pageY};
    
    selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.left = e.pageX + 'px';
    selectionBox.style.top = e.pageY + 'px';
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    document.body.appendChild(selectionBox);
    e.preventDefault(); // prevent text selection
});

document.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    const currentX = e.pageX;
    const currentY = e.pageY;
    
    const x = Math.min(selectionStart.x, currentX);
    const y = Math.min(selectionStart.y, currentY);
    const width = Math.abs(currentX - selectionStart.x);
    const height = Math.abs(currentY - selectionStart.y);
    
    selectionBox.style.left = x + 'px';
    selectionBox.style.top = y + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    
    // Check intersection with rows
    const boxRect = selectionBox.getBoundingClientRect();
    document.querySelectorAll('#fm-tbody tr').forEach(row => {
        const rowRect = row.getBoundingClientRect();
        const intersect = !(boxRect.right < rowRect.left || boxRect.left > rowRect.right || boxRect.bottom < rowRect.top || boxRect.top > rowRect.bottom);
        const cb = row.querySelector('input[type="checkbox"]');
        if (cb) {
            cb.checked = intersect;
        }
    });
});

document.addEventListener('mouseup', () => {
    if (isSelecting) {
        isSelecting = false;
        if (selectionBox) selectionBox.remove();
        updateSelectedFiles();
    }
});


let currentPlatform = 'vanilla';

function syncPlatformUI() {
    const filter = document.getElementById('mod-type-filter');
    if (!filter) return;
    const currentVal = filter.value;
    filter.innerHTML = '';

    if (['paper', 'purpur', 'spigot', 'bukkit'].includes(currentPlatform)) {
        // Plugin servers: show plugins, not mods
        filter.innerHTML += '<option value="plugin">Plugins</option>';
    } else {
        // Fabric, Forge, Vanilla, unknown — show mods and modpacks
        filter.innerHTML += '<option value="mod">Mods</option>';
        filter.innerHTML += '<option value="modpack">Modpacks</option>';
    }
    filter.innerHTML += '<option value="resourcepack">Resource Packs</option>';
    filter.innerHTML += '<option value="shader">Shaders</option>';

    if (Array.from(filter.options).some(o => o.value === currentVal)) {
        filter.value = currentVal;
    } else {
        filter.value = filter.options[0].value;
        if (document.getElementById('tab-modrinth').style.display === 'block') searchModrinth();
    }
}


async function uploadServerIcon(e) {
    if (!currentServer || !e.target.files[0]) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);
    try {
        const res = await fetch(API + `/servers/${encodeURIComponent(currentServer)}/icon`, {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            // Refresh icon with cache-buster via the GET icon endpoint
            const iconEl = document.getElementById('dash-server-icon');
            iconEl.onerror = () => { iconEl.src = '/static/logo.png'; iconEl.onerror = null; };
            iconEl.src = `/api/servers/${encodeURIComponent(currentServer)}/icon?t=${Date.now()}`;
            showToast('Server icon updated! Restart server for in-game effect.');
        }
    } catch(err) { console.error(err); }
}

async function savePlayitKey() {
    if (!currentServer) return;
    const key = document.getElementById('playit-key-input').value.trim();
    if (!key) return;
    const btn = event.target;
    withButtonState(btn, async () => {
        const res = await apiPost(`/servers/${encodeURIComponent(currentServer)}/playit/key`, {key});
        if (res.ok) {
            alert('Playit key saved! Please start or restart the server to apply the permanent public IP.');
            document.getElementById('playit-key-input').value = '';
        } else {
            alert('Error saving key.');
        }
    });
}

// ─── MC Color Picker ──────────────────────────────────────────────────────────
const MC_COLORS = [
    {code:'\u00a70',bg:'#000000',fg:'#fff',label:'Black'},
    {code:'\u00a71',bg:'#0000AA',fg:'#fff',label:'Dark Blue'},
    {code:'\u00a72',bg:'#00AA00',fg:'#fff',label:'Dark Green'},
    {code:'\u00a73',bg:'#00AAAA',fg:'#fff',label:'Dark Aqua'},
    {code:'\u00a74',bg:'#AA0000',fg:'#fff',label:'Dark Red'},
    {code:'\u00a75',bg:'#AA00AA',fg:'#fff',label:'Purple'},
    {code:'\u00a76',bg:'#FFAA00',fg:'#000',label:'Gold'},
    {code:'\u00a77',bg:'#AAAAAA',fg:'#000',label:'Gray'},
    {code:'\u00a78',bg:'#555555',fg:'#fff',label:'Dark Gray'},
    {code:'\u00a79',bg:'#5555FF',fg:'#fff',label:'Blue'},
    {code:'\u00a7a',bg:'#55FF55',fg:'#000',label:'Green'},
    {code:'\u00a7b',bg:'#55FFFF',fg:'#000',label:'Aqua'},
    {code:'\u00a7c',bg:'#FF5555',fg:'#fff',label:'Red'},
    {code:'\u00a7d',bg:'#FF55FF',fg:'#fff',label:'L.Purple'},
    {code:'\u00a7e',bg:'#FFFF55',fg:'#000',label:'Yellow'},
    {code:'\u00a7f',bg:'#FFFFFF',fg:'#000',label:'White'},
    {code:'\u00a7l',bg:null,label:'Bold',style:'font-weight:800'},
    {code:'\u00a7o',bg:null,label:'Italic',style:'font-style:italic'},
    {code:'\u00a7n',bg:null,label:'Underline',style:'text-decoration:underline'},
    {code:'\u00a7k',bg:null,label:'Obfusc.',style:'letter-spacing:2px'},
    {code:'\u00a7r',bg:null,label:'Reset',style:'opacity:0.6'},
];

function buildMcColorBar(targetId) {
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;margin:6px 0 4px;';
    MC_COLORS.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = c.label + ' (' + c.code + ')';
        btn.textContent = c.bg ? '\u25a0' : c.label.substring(0, c.label === 'Underline' ? 1 : c.label.length > 5 ? 1 : c.label.length);
        btn.style.cssText = `padding:3px 6px;font-size:0.78rem;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:${c.bg || 'var(--bg2, #1a1d24)'};color:${c.fg || 'var(--text)'};${c.style || ''}`;
        btn.onclick = (e) => { e.preventDefault(); insertMcCode(targetId, c.code); };
        bar.appendChild(btn);
    });
    return bar;
}

function insertMcCode(targetId, code) {
    const el = document.getElementById(targetId);
    if (!el) return;
    const s = el.selectionStart || 0, e2 = el.selectionEnd || 0;
    el.value = el.value.substring(0, s) + code + el.value.substring(e2);
    el.selectionStart = el.selectionEnd = s + code.length;
    el.focus();
    if (targetId === 'motd-input') updateMotdPreview();
}

function renderMcText(text) {
    // Track compound state so multiple codes apply simultaneously
    const CM = {'0':'#000000','1':'#0000AA','2':'#00AA00','3':'#00AAAA','4':'#AA0000','5':'#AA00AA','6':'#FFAA00','7':'#AAAAAA','8':'#555555','9':'#5555FF','a':'#55FF55','b':'#55FFFF','c':'#FF5555','d':'#FF55FF','e':'#FFFF55','f':'#FFFFFF'};
    let out = '';
    let state = { color: null, bold: false, italic: false, underline: false, strike: false, obfuscated: false };

    function openSpan(s) {
        let style = '';
        if (s.color)     style += `color:${s.color};`;
        if (s.bold)      style += 'font-weight:800;';
        if (s.italic)    style += 'font-style:italic;';
        if (s.underline) style += 'text-decoration:underline;';
        if (s.strike)    style += 'text-decoration:line-through;';
        if (s.obfuscated) style += 'animation:mc-obfuscate 0.05s steps(1) infinite;';
        return style ? `<span style="${style}">` : '<span>';
    }

    let i = 0;
    let openCount = 0;
    while (i < text.length) {
        const ch = text[i];
        if ((ch === '\u00a7' || ch === '&') && i + 1 < text.length) {
            const code = text[i+1].toLowerCase();
            if (openCount > 0) { out += '</span>'; openCount--; }
            if (code === 'r') {
                state = { color: null, bold: false, italic: false, underline: false, strike: false, obfuscated: false };
            } else if (CM[code]) {
                state.color = CM[code];
            } else if (code === 'l') { state.bold = true; }
            else if (code === 'o')   { state.italic = true; }
            else if (code === 'n')   { state.underline = true; }
            else if (code === 'm')   { state.strike = true; }
            else if (code === 'k')   { state.obfuscated = true; }
            // Only open new span if there's something to style
            if (Object.values(state).some(Boolean)) {
                out += openSpan(state);
                openCount++;
            }
            i += 2;
        } else {
            out += ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : ch === '>' ? '&gt;' : ch;
            i++;
        }
    }
    while (openCount-- > 0) out += '</span>';
    return out || text;
}

// Inject color bars into MOTD and chat
(function injectColorBars() {
    const motdBar = document.getElementById('motd-color-bar');
    if (motdBar) motdBar.appendChild(buildMcColorBar('motd-input'));
    const chatBar = document.getElementById('chat-color-bar');
    if (chatBar) chatBar.appendChild(buildMcColorBar('chat-message'));
    const nameBar = document.getElementById('servername-color-bar');
    if (nameBar) nameBar.appendChild(buildMcColorBar('server-name'));
    const settingsNameBar = document.getElementById('settings-servername-color-bar');
    if (settingsNameBar) settingsNameBar.appendChild(buildMcColorBar('cfg-display-name'));
})();

// \u2500\u2500\u2500 Player Manager \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function avatarUrl(uuid) {
    return `https://crafatar.com/avatars/${uuid || 'steve'}?size=64&overlay`;
}

function playerCard(player, listType) {
    const uuid = player.uuid || '';
    const name = player.name || player;
    const avatar = avatarUrl(uuid);
    const isWhitelisted = listType === 'whitelist';
    const isBanned = listType === 'banned';

    const wlBtn = isWhitelisted
        ? `<button class="btn danger outline small" style="min-width:0;padding:4px 8px" onclick="whitelistRemove('${name}','${uuid}')"><i data-lucide="user-minus" style="width:13px;height:13px"></i></button>`
        : `<button class="btn success outline small" style="min-width:0;padding:4px 8px" onclick="whitelistAdd('${name}','${uuid}')"><i data-lucide="user-plus" style="width:13px;height:13px"></i></button>`;
    const banBtn = isBanned
        ? `<button class="btn outline small" style="min-width:0;padding:4px 8px" onclick="pmUnban('${name}','${uuid}')"><i data-lucide="shield-check" style="width:13px;height:13px"></i></button>`
        : `<button class="btn danger outline small" style="min-width:0;padding:4px 8px" onclick="pmBan('${name}','${uuid}')"><i data-lucide="ban" style="width:13px;height:13px"></i></button>`;

    return `<div class="player-card">
        <img src="${avatar}" alt="${name}" onerror="this.src='/static/logo.png'">
        <span class="player-card-name">${name}</span>
        <div class="player-card-actions">${wlBtn}${banBtn}</div>
    </div>`;
}

async function loadPlayers() {
    if (!currentServer) return;
    try {
        const data = await apiGet(`/servers/${encodeURIComponent(currentServer)}/players`);
        const renderList = (listEl, items, type) => {
            if (!items || items.length === 0) {
                listEl.innerHTML = '<p class="text-muted" style="font-size:.85rem">Empty</p>';
            } else {
                listEl.innerHTML = items.map(p => playerCard(p, type)).join('');
            }
            lucide.createIcons({ nodes: [listEl] });
        };
        renderList(document.getElementById('pm-whitelist-list'), data.whitelist, 'whitelist');
        renderList(document.getElementById('pm-ops-list'),       data.ops,       'ops');
        renderList(document.getElementById('pm-banned-list'),    data.banned,    'banned');
    } catch(e) { console.error(e); }
}

async function searchPlayer() {
    const username = document.getElementById('pm-search-input').value.trim();
    if (!username) return;
    const resultDiv = document.getElementById('pm-search-result');
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = '<p class="text-muted" style="font-size:.85rem">Searching\u2026</p>';
    try {
        const profile = await apiGet(`/mojang/profile/${encodeURIComponent(username)}`);
        resultDiv.innerHTML = `
            <div class="pm-search-card">
                <img src="${avatarUrl(profile.uuid)}" alt="${profile.name}" onerror="this.src='/static/logo.png'">
                <div style="flex:1">
                    <div style="font-weight:700;font-size:1rem;margin-bottom:6px">${profile.name}</div>
                    <div style="font-size:.75rem;color:var(--muted);margin-bottom:10px;font-family:monospace">${profile.uuid}</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn success outline small" onclick="whitelistAdd('${profile.name}','${profile.uuid}')"><i data-lucide="user-plus" style="width:14px;height:14px"></i> Add to Whitelist</button>
                        <button class="btn danger outline small" onclick="whitelistRemove('${profile.name}','${profile.uuid}')"><i data-lucide="user-minus" style="width:14px;height:14px"></i> Remove from Whitelist</button>
                        <button class="btn danger small" onclick="pmBan('${profile.name}','${profile.uuid}')"><i data-lucide="ban" style="width:14px;height:14px"></i> Ban</button>
                    </div>
                </div>
            </div>`;
        lucide.createIcons({ nodes: [resultDiv] });
    } catch(e) {
        resultDiv.innerHTML = '<p style="color:var(--danger);font-size:.85rem">\u26a0 Player not found. Check the username.</p>';
    }
}

async function whitelistAdd(name, uuid) {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/whitelist/add`, {name, uuid});
    showToast(`\u2713 ${name} added to whitelist`);
    loadPlayers();
}
async function whitelistRemove(name, uuid) {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/whitelist/remove`, {name, uuid});
    showToast(`${name} removed from whitelist`);
    loadPlayers();
}
async function pmBan(name, uuid) {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/ban`, {name, uuid});
    showToast(`\u{1f6ab} ${name} banned`);
    loadPlayers();
}
async function pmUnban(name, uuid) {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/unban`, {name, uuid});
    showToast(`${name} unbanned`);
    loadPlayers();
}

// ─── Backups ──────────────────────────────────────────────────────────────────
async function fetchBackupSettings() {
    if (!currentServer) return;
    try {
        const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/meta`);
        if (res.meta) {
            document.getElementById('cfg-auto-backup').value = res.meta.auto_backup ? "true" : "false";
            if (res.meta.backup_interval) document.getElementById('cfg-backup-interval').value = res.meta.backup_interval;
            if (res.meta.max_backups) document.getElementById('cfg-max-backups').value = res.meta.max_backups;
        }
    } catch (e) {
        console.error("Failed to fetch backup settings", e);
    }
}

async function saveBackupSettings() {
    if (!currentServer) return;
    const enabled = document.getElementById('cfg-auto-backup').value === "true";
    const interval = parseInt(document.getElementById('cfg-backup-interval').value) || 12;
    const max = parseInt(document.getElementById('cfg-max-backups').value) || 5;
    try {
        await apiPost(`/servers/${encodeURIComponent(currentServer)}/backup-settings`, {
            auto_backup: enabled,
            backup_interval: interval,
            max_backups: max
        });
        showToast("Backup settings saved");
    } catch (e) {
        showToast("Failed to save backup settings");
    }
}

async function fetchBackups() {
    if (!currentServer) return;
    const tbody = document.getElementById('backups-list');
    tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:10px;text-align:center;">Loading...</td></tr>';
    try {
        const res = await apiGet(`/servers/${encodeURIComponent(currentServer)}/backups`);
        tbody.innerHTML = '';
        if (res.backups.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:10px;text-align:center;">No backups found.</td></tr>';
            return;
        }
        res.backups.forEach(b => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid var(--border)";
            tr.innerHTML = `
                <td style="padding: 10px; font-weight: 500;">${b.filename}</td>
                <td style="padding: 10px; color: var(--muted);">${new Date(b.date * 1000).toLocaleString()}</td>
                <td style="padding: 10px; color: var(--muted);">${(b.size / (1024*1024)).toFixed(2)} MB</td>
                <td style="padding: 10px; text-align: right; display:flex; gap:6px; justify-content:flex-end;">
                    <button class="btn success small" onclick="restoreBackup('${b.filename}')"><i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i> Restore</button>
                    <a class="btn primary small outline" href="${API}/servers/${encodeURIComponent(currentServer)}/backups/${encodeURIComponent(b.filename)}/download" download><i data-lucide="download" style="width:14px;height:14px;"></i></a>
                    <button class="btn danger small outline" onclick="deleteBackup('${b.filename}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
                </td>
            `;
            tbody.appendChild(tr);
        });
        lucide.createIcons();
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-danger" style="padding:10px;text-align:center;">Failed to load backups.</td></tr>';
    }
}

async function createBackup(btn) {
    if (!currentServer) return;
    const ogHtml = btn.innerHTML;
    btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px;margin-right:6px"></span> Creating...`;
    btn.disabled = true;
    try {
        const res = await apiPost(`/servers/${encodeURIComponent(currentServer)}/backups/create`);
        if (!res.ok) throw new Error(await res.text());
        showToast("Backup created successfully!");
        fetchBackups();
    } catch (e) {
        alert("Failed to create backup.");
    } finally {
        btn.innerHTML = ogHtml;
        btn.disabled = false;
        lucide.createIcons();
    }
}

async function restoreBackup(filename) {
    if (!currentServer) return;
    if (document.getElementById('server-status').textContent !== 'Stopped') {
        alert("Please stop the server before restoring a backup to prevent corruption.");
        return;
    }
    if (!confirm(`Are you sure you want to restore ${filename}? This will overwrite your current world.`)) return;
    
    try {
        const res = await apiPost(`/servers/${encodeURIComponent(currentServer)}/backups/restore`, { filename });
        if (!res.ok) throw new Error(await res.text());
        showToast("Backup restored successfully!");
    } catch (e) {
        alert("Failed to restore backup.");
    }
}

async function deleteBackup(filename) {
    if (!currentServer) return;
    if (!confirm(`Delete backup ${filename}?`)) return;
    try {
        const res = await fetch(`${API}/servers/${encodeURIComponent(currentServer)}/backups/${encodeURIComponent(filename)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error("Failed");
        showToast("Backup deleted");
        fetchBackups();
    } catch (e) {
        alert("Failed to delete backup.");
    }
}
