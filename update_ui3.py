import re

with open('backend/static/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update filterInstalledMods to handle the new JSON structure
filterInstalledModsCode = '''
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
'''
text = re.sub(r'function filterInstalledMods\(\) \{.*?(?=async function deleteInstalledMod)', filterInstalledModsCode + '\n', text, flags=re.DOTALL)

# 2. Update searchModrinth to use project_id matching for "Installed" state
searchModrinthCode = '''
    hits.forEach(h => {
        const isInstalled = installedModsCache.some(f => f.project_id === h.project_id || f.title.toLowerCase().includes(h.slug.toLowerCase()));
        
        const c = document.createElement('div'); c.className = 'mod-card';
'''
text = re.sub(r'hits\.forEach\(h => \{\s*const isInstalled = installedModsCache\.some\(f => f\.toLowerCase\(\)\.includes\(h\.slug\.toLowerCase\(\)\)\);.*?const c = document\.createElement\(\'div\'\); c\.className = \'mod-card\';', searchModrinthCode.strip(), text, flags=re.DOTALL)

# 3. Add drag-and-box selection logic
boxSelectionCode = '''
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
'''
if 'isSelecting = false;' not in text:
    text += '\n' + boxSelectionCode

with open('backend/static/app.js', 'w', encoding='utf-8') as f:
    f.write(text)
