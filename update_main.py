import os, re

code = '''
@app.post("/api/servers/{name}/install")
async def install_mod(name: str, req: InstallReq, background_tasks: BackgroundTasks):
    with open(os.path.join(sdir(name), "meta.json")) as f: meta = json.load(f)
    async with httpx.AsyncClient() as c:
        if req.project_type == "modpack":
            # download mrpack
            r = await c.get(f"https://api.modrinth.com/v2/project/{req.project_id}/version?game_versions=[\\"{meta['version']}\\"]")
            data = r.json()
            if not data: raise HTTPException(404, "No compatible modpack version")
            fi = next((f for f in data[0]["files"] if f["filename"].endswith(".mrpack")), None)
            if not fi: raise HTTPException(404, "No .mrpack found")
            
            # download zip to temp
            import tempfile, zipfile
            tmp = tempfile.mktemp(suffix=".mrpack")
            with open(tmp, "wb") as f: f.write((await c.get(fi["url"], follow_redirects=True)).content)
            
            # parse and queue mods
            with zipfile.ZipFile(tmp, 'r') as z:
                idx = json.loads(z.read("modrinth.index.json"))
                
                # copy overrides
                for zi in z.infolist():
                    if zi.filename.startswith("overrides/"):
                        target = os.path.join(sdir(name), zi.filename.replace("overrides/", "", 1))
                        if zi.is_dir(): os.makedirs(target, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target), exist_ok=True)
                            with open(target, "wb") as out: out.write(z.read(zi.filename))
                            
            os.remove(tmp)
            
            # queue downloads
            for mf in idx.get("files", []):
                # simplified: download url directly
                url = mf["downloads"][0]
                dest = os.path.join(sdir(name), mf["path"])
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                fn = os.path.basename(dest)
                background_tasks.add_task(download_mod_task, name, fn, "mod", url, dest, fn, fn, "")
                
        else:
            await resolve_and_download(name, req, background_tasks, c, meta)
        
    return {"message": "Started"}
'''

with open('backend/main.py', 'r', encoding='utf-8') as f:
    text = f.read()

text = re.sub(r'@app\.post\("/api/servers/\{name\}/install"\).*?return \{"message": "Started"\}', code.strip(), text, flags=re.DOTALL)

with open('backend/main.py', 'w', encoding='utf-8') as f:
    f.write(text)
