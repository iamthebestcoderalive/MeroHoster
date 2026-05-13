import os, re

with open('backend/main.py', 'r', encoding='utf-8') as f:
    text = f.read()

endpoint = '''
@app.get("/api/servers/{name}/install_progress_all")
def get_install_progress_all(name: str):
    return install_progress.get(name, {})
'''
if 'install_progress_all' not in text:
    text += '\n' + endpoint

with open('backend/main.py', 'w', encoding='utf-8') as f:
    f.write(text)

with open('backend/static/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

if 'let lastServerPhase = null;' not in text:
    text = re.sub(r'let currentServer = null;', 'let currentServer = null;\nlet lastServerPhase = null;', text)

if 'Notification.requestPermission()' not in text:
    text = "if ('Notification' in window) { Notification.requestPermission(); }\n" + text

fetchStatsCode = '''
async function fetchStats() {
    if (!currentServer) return;
    try {
        const d = await apiGet(`/servers/${currentServer}/stats`);
        setButtons(d.phase);
        
        if (lastServerPhase === 'starting' && d.phase === 'running') {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Mero', {body: `Server ${currentServer} has started successfully!`, icon: '/static/logo.png'});
            }
        }
        lastServerPhase = d.phase;
'''
text = re.sub(r'async function fetchStats\(\) \{\s*if \(\!currentServer\) return;\s*try \{\s*const d = await apiGet\(`/servers/\$\{currentServer\}/stats`\);\s*setButtons\(d\.phase\);', fetchStatsCode.strip(), text)

downloads_code = '''
// --- Global Downloads Panel Polling ---
let downloadsPanelVisible = false;
let globalDownloadsInterval = null;

function toggleDownloadsPanel() {
    const panel = document.getElementById('downloads-panel');
    downloadsPanelVisible = !downloadsPanelVisible;
    panel.style.display = downloadsPanelVisible ? 'flex' : 'none';
}

function startGlobalDownloadsPolling() {
    if (globalDownloadsInterval) return;
    globalDownloadsInterval = setInterval(async () => {
        if (!currentServer) return;
        try {
            const res = await apiGet(`/servers/${currentServer}/install_progress_all`);
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
                icon.className = 'btn outline small';
            } else {
                icon.className = 'btn success small';
                if (!downloadsPanelVisible) toggleDownloadsPanel();
            }
        } catch(e) {}
    }, 1000);
}

startGlobalDownloadsPolling();
'''

if 'startGlobalDownloadsPolling' not in text:
    text += '\n' + downloads_code

# Also fix `fileIcon` to use original mod icons
fileIconPatch = '''
function fileIcon(name) {
    if (name.endsWith('/')) return '<i data-lucide="folder" class="text-primary"></i>';
    if (name.endsWith('.jar')) {
        // Find if it's in installedModsCache
        let iconHtml = '<i data-lucide="package" class="text-success"></i>';
        // Note: installedModsCache contains full relative paths like "mods/fabric-api.jar" and objects in meta.json
        return iconHtml;
    }
    return '<i data-lucide="file" class="text-muted"></i>';
}
'''
# actually `app.js` has `fileIcon(n)` - replacing it is complex via regex. Just skip the file manager icon integration for now or do it via exact replacement.
with open('backend/static/app.js', 'w', encoding='utf-8') as f:
    f.write(text)
