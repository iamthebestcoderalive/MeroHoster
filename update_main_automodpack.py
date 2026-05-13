import os, re

with open('backend/main.py', 'r', encoding='utf-8') as f:
    text = f.read()

# 1. Update create_server to accept BackgroundTasks and install AutoModpack
create_hook = '''
@app.post("/api/servers")
def create_server(req: ServerCreate, background_tasks: BackgroundTasks):
    safe_name = re.sub(r'[<>:"/\\\\|?*]', '', req.name).strip()
    if not safe_name: raise HTTPException(400, "Invalid server name")
    
    sp = sdir(safe_name)
    if os.path.exists(sp): raise HTTPException(400, "Server already exists")
    os.makedirs(sp)
    for d in ("mods", "plugins", "resourcepacks", "shaderpacks"):
        os.makedirs(os.path.join(sp, d), exist_ok=True)
    with open(os.path.join(sp, "eula.txt"), "w") as f: f.write("eula=true\\n")
    
    motd = req.description if req.description.strip() else "A Mero Server"
    with open(os.path.join(sp, "server.properties"), "w") as f:
        f.write(f"online-mode=false\\nmotd={motd}\\nserver-port=25565\\n")
        
    meta_data = {
        "version": req.version,
        "type": req.type,
        "ram": req.ram,
        "subdomain": req.subdomain,
        "software": req.type.lower(), # Track platform
        "installed_files": []
    }
    with open(os.path.join(sp, "meta.json"), "w") as f: json.dump(meta_data, f)
    
    # Auto-install AutoModpack on Fabric
    if req.type.lower() == "fabric":
        # k68glP2e is the Modrinth ID for AutoModpack
        install_req = InstallReq(project_id="k68glP2e", project_type="mod", title="AutoModpack", icon_url="https://cdn.modrinth.com/data/k68glP2e/a62ab7ad159491ebfbcdb8e8f23f37ab28ff11e8.png")
        
        # We need a client. We can just schedule a quick coroutine wrapper.
        import asyncio
        async def do_install():
            async with httpx.AsyncClient() as c:
                await resolve_and_download(safe_name, install_req, background_tasks, c, meta_data)
        background_tasks.add_task(lambda: asyncio.run(do_install()))
        
    return {"message": "Created"}
'''
text = re.sub(r'@app\.post\("/api/servers"\)\ndef create_server\(req: ServerCreate\):.*?return \{"message": "Created"\}', create_hook.strip(), text, flags=re.DOTALL)


# 2. Add server icon and playit endpoints
extra_endpoints = '''
@app.post("/api/servers/{name}/icon")
async def upload_icon(name: str, file: UploadFile = File(...)):
    sp = sdir(name)
    if not os.path.exists(sp): raise HTTPException(404, "Server not found")
    dest = os.path.join(sp, "server-icon.png")
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    return {"message": "Icon updated"}

class PlayitKeyReq(BaseModel):
    key: str

@app.post("/api/servers/{name}/playit/key")
def set_playit_key(name: str, req: PlayitKeyReq):
    sp = sdir(name)
    pdir = os.path.join(sp, ".playit")
    os.makedirs(pdir, exist_ok=True)
    with open(os.path.join(pdir, "playit.toml"), "w") as f:
        f.write(f'secret_key = "{req.key}"\\n')
    return {"message": "Playit key saved. Restart server to apply."}
'''
if '/api/servers/{name}/icon' not in text:
    text += '\n' + extra_endpoints

with open('backend/main.py', 'w', encoding='utf-8') as f:
    f.write(text)
