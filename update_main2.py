import os, re

# Update main.py
with open('backend/main.py', 'r', encoding='utf-8') as f:
    text = f.read()

get_installed_mods_code = '''
@app.get("/api/servers/{name}/installed_mods")
def get_installed_mods(name: str):
    installed = []
    meta_path = os.path.join(sdir(name), "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r") as f:
            meta = json.load(f)
            
    tracked = meta.get("installed_files", [])
    
    for d in ["mods", "plugins", "resourcepacks", "shaderpacks"]:
        folder = os.path.join(sdir(name), d)
        if os.path.isdir(folder):
            for f in os.listdir(folder):
                path = f"{d}/{f}"
                # find tracking info
                info = next((m for m in tracked if m.get("filename") == f), {})
                installed.append({
                    "path": path,
                    "title": info.get("title") or f,
                    "icon_url": info.get("icon_url") or "",
                    "project_id": info.get("project_id") or ""
                })
    return {"files": installed}
'''
text = re.sub(r'@app\.get\("/api/servers/\{name\}/installed_mods"\).*?return \{"files": installed\}', get_installed_mods_code.strip(), text, flags=re.DOTALL)

with open('backend/main.py', 'w', encoding='utf-8') as f:
    f.write(text)
