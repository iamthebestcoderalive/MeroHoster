import os, re

with open('backend/main.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Add resourcepack download endpoint
rp_endpoint = '''
from fastapi.responses import FileResponse
import hashlib

@app.get("/api/servers/{name}/resourcepack")
def get_resource_pack(name: str):
    rp_dir = os.path.join(sdir(name), "resourcepacks")
    if os.path.exists(rp_dir):
        for f in os.listdir(rp_dir):
            if f.endswith(".zip"):
                return FileResponse(os.path.join(rp_dir, f))
    raise HTTPException(404, "No resource pack found")

def get_sha1(filepath):
    h = hashlib.sha1()
    with open(filepath, 'rb') as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()
'''

if 'get_resource_pack' not in text:
    text = text.replace('# ─────────────────────────── API: modrinth ───────────────────────────────────', rp_endpoint + '\n# ─────────────────────────── API: modrinth ───────────────────────────────────')

# 2. Update start_server to set server.properties
start_hook = '''
    # --- Auto Server Resource Pack Engine ---
    rp_dir = os.path.join(sdir(name), "resourcepacks")
    props_path = os.path.join(sdir(name), "server.properties")
    if os.path.exists(rp_dir) and os.path.exists(props_path):
        zips = [f for f in os.listdir(rp_dir) if f.endswith(".zip")]
        if zips:
            rp_file = os.path.join(rp_dir, zips[0])
            sha1 = get_sha1(rp_file)
            
            # Read properties
            with open(props_path, "r") as f: lines = f.readlines()
            new_lines = []
            has_rp = False
            has_hash = False
            
            for line in lines:
                if line.startswith("resource-pack="):
                    new_lines.append(f"resource-pack=http://127.0.0.1:8000/api/servers/{name}/resourcepack\\n")
                    has_rp = True
                elif line.startswith("resource-pack-sha1="):
                    new_lines.append(f"resource-pack-sha1={sha1}\\n")
                    has_hash = True
                else:
                    new_lines.append(line)
                    
            if not has_rp: new_lines.append(f"resource-pack=http://127.0.0.1:8000/api/servers/{name}/resourcepack\\n")
            if not has_hash: new_lines.append(f"resource-pack-sha1={sha1}\\n")
            
            with open(props_path, "w") as f: f.writelines(new_lines)
'''
text = re.sub(r'(def start_server\(name: str\):\n)', r'\1' + start_hook, text)

with open('backend/main.py', 'w', encoding='utf-8') as f:
    f.write(text)
