import re

with open('backend/static/index.html', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Server Icon UI and Playit UI
dashboard_header = '''
            <div id="tab-dashboard" class="tab-content active">
                <div style="display:flex; justify-content:space-between; align-items:flex-end; margin-bottom: 24px;">
                    <div style="display:flex; align-items:center; gap: 16px;">
                        <div class="server-icon-container" style="position:relative; cursor:pointer;" onclick="document.getElementById('server-icon-upload').click()">
                            <img id="dash-server-icon" src="pack.png" style="width:64px;height:64px;border-radius:8px;object-fit:cover;border:1px solid var(--border);">
                            <div style="position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity 0.2s;border-radius:8px;color:#fff;font-size:0.75rem;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0">Edit</div>
                        </div>
                        <input type="file" id="server-icon-upload" style="display:none" accept="image/png" onchange="uploadServerIcon(event)">
                        <div>
                            <h2 class="page-title" id="dash-title">Dashboard</h2>
                            <div class="page-subtitle" id="stat-status"><span class="badge stopped">● Offline</span></div>
                        </div>
                    </div>
'''
text = re.sub(r'<div id="tab-dashboard" class="tab-content active">.*?<h2 class="page-title" id="dash-title">Dashboard</h2>.*?</div>\s*</div>', dashboard_header.strip() + '\n                    <ul style="list-style: none; display: flex; gap: 16px; font-weight: 600; padding: 0; color: var(--muted); font-size: 0.85rem; margin-bottom: 8px;">\n                        <li><span style="color:var(--danger)">●</span> Mods: <span id="dash-mods">0</span></li>\n                        <li><span style="color:var(--blue)">●</span> Resource packs: <span id="dash-rp">0</span></li>\n                        <li><span style="color:var(--success)">●</span> Shaders: <span id="dash-sp">0</span></li>\n                    </ul>\n                </div>', text, flags=re.DOTALL)


playit_ui = '''
                        <div class="tunnel-box" id="tunnel-info-box" style="margin-bottom: 8px;"></div>
                        <div class="tunnel-box" id="playit-setup-box">
                            <h4 style="margin:0 0 8px 0; font-size:0.9rem;">Playit.gg Public IP</h4>
                            <p class="text-muted" style="margin-bottom:8px; font-size:0.8rem;">To get a permanent public IP, enter your playit.gg Secret Key here.</p>
                            <div style="display:flex; gap:8px;">
                                <input type="password" id="playit-key-input" class="glass-input" placeholder="Secret Key (sk-...)">
                                <button class="btn success small" onclick="savePlayitKey()">Connect</button>
                            </div>
                        </div>
'''
text = re.sub(r'<div class="tunnel-box" id="tunnel-info-box" style="margin-bottom: 8px;"></div>', playit_ui.strip(), text)

with open('backend/static/index.html', 'w', encoding='utf-8') as f:
    f.write(text)


with open('backend/static/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

app_js_adds = '''
async function uploadServerIcon(e) {
    if (!currentServer || !e.target.files[0]) return;
    const file = e.target.files[0];
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const res = await fetch(API + `/servers/${currentServer}/icon`, {
            method: 'POST',
            body: formData
        });
        if (res.ok) {
            // refresh icon with cache breaker
            document.getElementById('dash-server-icon').src = `/api/servers/${currentServer}/files/server-icon.png?t=${Date.now()}`;
        }
    } catch(err) {
        console.error(err);
    }
}

async function savePlayitKey() {
    if (!currentServer) return;
    const key = document.getElementById('playit-key-input').value.trim();
    if (!key) return;
    
    const btn = event.target;
    withButtonState(btn, async () => {
        const res = await apiPost(`/servers/${currentServer}/playit/key`, {key});
        if (res.ok) {
            alert('Playit key saved! Please start or restart the server to apply the permanent public IP.');
            document.getElementById('playit-key-input').value = '';
        } else {
            alert('Error saving key.');
        }
    });
}
'''
if 'uploadServerIcon' not in text:
    text += '\n' + app_js_adds

# Update fetchStats to load server icon initially
text = re.sub(r'const tb = document\.getElementById\(\'tunnel-info-box\'\);', r'const tb = document.getElementById(\'tunnel-info-box\'); document.getElementById(\'dash-server-icon\').src = `/api/servers/${currentServer}/files/server-icon.png?fallback=pack.png`;', text)

with open('backend/static/app.js', 'w', encoding='utf-8') as f:
    f.write(text)
