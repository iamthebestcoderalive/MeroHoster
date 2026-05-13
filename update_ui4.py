import re

with open('backend/static/app.js', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Sync platform UI
platform_sync = '''
let currentPlatform = 'vanilla';

function syncPlatformUI() {
    const filter = document.getElementById('mod-type-filter');
    if (!filter) return;
    
    // Store current value to re-apply if possible
    const currentVal = filter.value;
    filter.innerHTML = '';
    
    if (['fabric', 'forge', 'quilt', 'neoforge'].includes(currentPlatform)) {
        filter.innerHTML += '<option value="mod">Mods</option>';
        filter.innerHTML += '<option value="modpack">Modpacks</option>';
    } else if (['paper', 'purpur', 'spigot', 'bukkit'].includes(currentPlatform)) {
        filter.innerHTML += '<option value="plugin">Plugins</option>';
    }
    
    filter.innerHTML += '<option value="resourcepack">Resource Packs</option>';
    filter.innerHTML += '<option value="shader">Shaders</option>';
    
    // Attempt to restore value if it still exists
    if (Array.from(filter.options).some(o => o.value === currentVal)) {
        filter.value = currentVal;
    } else {
        filter.value = filter.options[0].value;
        if (document.getElementById('tab-modrinth').style.display === 'block') searchModrinth();
    }
}
'''
if 'let currentPlatform' not in text:
    text += '\n' + platform_sync

text = re.sub(r'lastServerPhase = d\.phase;', r'lastServerPhase = d.phase;\n        if (d.platform && d.platform !== currentPlatform) { currentPlatform = d.platform; syncPlatformUI(); }', text)

# 2. Fix the button loading state (don't shrink)
text = re.sub(r'btn\.innerHTML = \'<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;animation:spin 2s linear infinite;"></i> Saving…\';', 
              r'btn.innerHTML = \'<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;animation:spin 2s linear infinite;"></i> Saving…\'; btn.style.minWidth = btn.offsetWidth + "px";', text)

with open('backend/static/app.js', 'w', encoding='utf-8') as f:
    f.write(text)
