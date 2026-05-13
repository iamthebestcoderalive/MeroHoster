import os
import re

main_path = "backend/main.py"

with open(main_path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add Pydantic models
models_code = """
class BackupSettingsReq(BaseModel):
    auto_backup: bool
    backup_interval: int
    max_backups: int

class RestoreBackupReq(BaseModel):
    filename: str
"""
if "BackupSettingsReq" not in content:
    content = content.replace("from mcstatus import JavaServer\n", "from mcstatus import JavaServer\n" + models_code)

# 2. Add Backup Endpoints
endpoints_code = """
# ─────────────────────────── Backups ───────────────────────────────────────────
@app.get("/api/servers/{name}/backups")
def list_backups(name: str):
    sp = sdir(name)
    bp = os.path.join(sp, "backups")
    if not os.path.exists(bp): return {"backups": []}
    files = []
    for f in os.listdir(bp):
        if f.endswith(".zip"):
            fp = os.path.join(bp, f)
            files.append({
                "filename": f,
                "date": os.path.getmtime(fp),
                "size": os.path.getsize(fp)
            })
    files.sort(key=lambda x: x["date"], reverse=True)
    return {"backups": files}

@app.post("/api/servers/{name}/backup-settings")
def save_backup_settings(name: str, req: BackupSettingsReq):
    meta_path = os.path.join(sdir(name), "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f: meta = json.load(f)
    meta["auto_backup"] = req.auto_backup
    meta["backup_interval"] = req.backup_interval
    meta["max_backups"] = req.max_backups
    with open(meta_path, "w", encoding="utf-8") as f: json.dump(meta, f, indent=2)
    return {"message": "Saved"}

def get_world_folders(sp):
    worlds = ["world", "world_nether", "world_the_end"]
    # Check server.properties for level-name
    prop = os.path.join(sp, "server.properties")
    if os.path.exists(prop):
        with open(prop, "r", encoding="utf-8") as f:
            for line in f:
                if line.startswith("level-name="):
                    worlds[0] = line.strip().split("=")[1].strip()
                    worlds[1] = worlds[0] + "_nether"
                    worlds[2] = worlds[0] + "_the_end"
                    break
    return worlds

@app.post("/api/servers/{name}/backups/create")
def create_backup(name: str, background_tasks: BackgroundTasks = None):
    sp = sdir(name)
    bp = os.path.join(sp, "backups")
    os.makedirs(bp, exist_ok=True)
    
    # Check if running to do safe backup
    proc = server_state.get(name, {}).get("process")
    is_running = proc and proc.poll() is None
    
    if is_running:
        try:
            proc.stdin.write("save-off\\n")
            proc.stdin.flush()
            proc.stdin.write("save-all\\n")
            proc.stdin.flush()
            time.sleep(2) # Give it a moment to write to disk
        except Exception:
            pass
            
    # Zip the worlds
    import datetime
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    zip_name = f"backup_{timestamp}.zip"
    zip_path = os.path.join(bp, zip_name)
    
    worlds = get_world_folders(sp)
    try:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for w in worlds:
                wp = os.path.join(sp, w)
                if os.path.exists(wp):
                    for root, dirs, files in os.walk(wp):
                        for f in files:
                            fp = os.path.join(root, f)
                            arcname = os.path.relpath(fp, sp)
                            zf.write(fp, arcname)
    except Exception as e:
        if is_running:
            try: proc.stdin.write("save-on\\n"); proc.stdin.flush()
            except Exception: pass
        raise HTTPException(500, f"Backup failed: {e}")
        
    if is_running:
        try:
            proc.stdin.write("save-on\\n")
            proc.stdin.flush()
        except Exception:
            pass
            
    # Update meta.json with last backup time
    meta_path = os.path.join(sp, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f: meta = json.load(f)
    meta["last_backup"] = time.time()
    with open(meta_path, "w", encoding="utf-8") as f: json.dump(meta, f, indent=2)
    
    return {"message": "Backup created", "filename": zip_name}

@app.post("/api/servers/{name}/backups/restore")
def restore_backup(name: str, req: RestoreBackupReq):
    sp = sdir(name)
    bp = os.path.join(sp, "backups", req.filename)
    if not os.path.exists(bp): raise HTTPException(404, "Backup not found")
    
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        raise HTTPException(400, "Cannot restore while server is running. Stop it first.")
        
    try:
        worlds = get_world_folders(sp)
        # Delete existing worlds
        for w in worlds:
            wp = os.path.join(sp, w)
            if os.path.exists(wp):
                shutil.rmtree(wp, ignore_errors=True)
                
        # Extract zip
        with zipfile.ZipFile(bp, "r") as zf:
            zf.extractall(sp)
        return {"message": "Restored"}
    except Exception as e:
        raise HTTPException(500, f"Restore failed: {e}")

@app.delete("/api/servers/{name}/backups/{filename}")
def delete_backup_file(name: str, filename: str):
    bp = os.path.join(sdir(name), "backups", filename)
    if os.path.exists(bp):
        os.remove(bp)
    return {"message": "Deleted"}

@app.get("/api/servers/{name}/backups/{filename}/download")
def download_backup_file(name: str, filename: str):
    bp = os.path.join(sdir(name), "backups", filename)
    if not os.path.exists(bp): raise HTTPException(404, "Backup not found")
    return FileResponse(bp, filename=filename)

"""

if "list_backups(" not in content:
    # Insert before app.mount
    content = content.replace('app.mount("/static",', endpoints_code + '\napp.mount("/static",')

# 3. Add Auto Backup Daemon
daemon_code = """
def auto_backup_daemon():
    while True:
        time.sleep(60) # Check every minute
        if not os.path.exists(SERVERS_DIR): continue
        for server_name in os.listdir(SERVERS_DIR):
            sp = os.path.join(SERVERS_DIR, server_name)
            meta_path = os.path.join(sp, "meta.json")
            if not os.path.exists(meta_path): continue
            
            try:
                with open(meta_path, "r", encoding="utf-8") as f: meta = json.load(f)
            except: continue
            
            if meta.get("auto_backup"):
                interval_hours = meta.get("backup_interval", 12)
                last_backup = meta.get("last_backup", 0)
                now = time.time()
                
                if (now - last_backup) >= (interval_hours * 3600):
                    # Trigger backup
                    try:
                        create_backup(server_name)
                    except Exception as e:
                        print(f"Auto-backup failed for {server_name}: {e}")
                    
                    # Enforce max backups
                    max_b = meta.get("max_backups", 5)
                    bp = os.path.join(sp, "backups")
                    if os.path.exists(bp):
                        files = [os.path.join(bp, f) for f in os.listdir(bp) if f.endswith(".zip")]
                        files.sort(key=os.path.getmtime)
                        while len(files) > max_b:
                            oldest = files.pop(0)
                            try: os.remove(oldest)
                            except: pass
"""

if "auto_backup_daemon" not in content:
    # Insert before entry point
    content = content.replace('# ─────────────────────────── Entry point ─────────────────────────────────────', daemon_code + '\n# ─────────────────────────── Entry point ─────────────────────────────────────')
    content = content.replace('if __name__ == "__main__":', 'if __name__ == "__main__":\n    threading.Thread(target=auto_backup_daemon, daemon=True).start()')

with open(main_path, "w", encoding="utf-8") as f:
    f.write(content)

print("Patch applied.")
