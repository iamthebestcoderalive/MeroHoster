import os
import re
import json
import time
import shutil
import zipfile
import threading
import subprocess
import urllib.request
from collections import deque

import httpx
import psutil
import uvicorn

try:
    import webview
    HAS_WEBVIEW = True
except ImportError:
    HAS_WEBVIEW = False
    import webbrowser

# pyrefly: ignore [missing-import]
from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request, BackgroundTasks, Body
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from mcstatus import JavaServer

class BackupSettingsReq(BaseModel):
    auto_backup: bool
    backup_interval: int
    max_backups: int

class RestoreBackupReq(BaseModel):
    filename: str

# ─────────────────────────── App setup ───────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
SERVERS_DIR = os.path.join(BASE_DIR, "servers")
JAVA_DIR    = os.path.join(BASE_DIR, "java")
JAVA_EXE    = os.path.join(JAVA_DIR, "bin", "java.exe")
PLAYIT_EXE  = os.path.join(BASE_DIR, "playit.exe")
os.makedirs(SERVERS_DIR, exist_ok=True)

# In-memory state
# server_state[name] = { "process": Popen|None, "phase": "stopped"|"starting"|"running" }
server_state     = {}
playit_procs     = {}
playit_info      = {}
server_logs      = {}   # name -> deque
server_start_ts  = {}
install_progress = {} # format: { name: { project_id: { "downloaded": 0, "total": 0, "status": "downloading" } } }
disk_cache       = {}   # name -> (timestamp, bytes)  — cached every 30s

# ─────────────────────────── Helpers ─────────────────────────────────────────
def sdir(name): return os.path.join(SERVERS_DIR, name)

def log(name, msg):
    server_logs.setdefault(name, deque(maxlen=500))
    server_logs[name].append(msg)

def get_port(server_path):
    p = os.path.join(server_path, "server.properties")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.startswith("server-port="):
                    return int(line.split("=")[1].strip())
    return 25565

def capture(proc, name):
    try:
        for line in iter(proc.stdout.readline, ""):
            if line:
                log(name, line.rstrip())
    except Exception:
        pass
    # Mark server as stopped when process ends (handles both "running" and "starting" phases)
    phase = server_state.get(name, {}).get("phase")
    if phase in ("running", "starting"):
        server_state[name]["phase"] = "stopped"
        log(name, "[Mero] ⚠️ Server process exited.")

def read_playit(proc, name):
    playit_info.setdefault(name, {"claim_url": "", "public_ip": ""})
    try:
        for line in iter(proc.stdout.readline, ""):
            line = line.strip()
            m = re.search(r'(https://playit\.gg/claim/[a-zA-Z0-9]+)', line)
            if m: playit_info[name]["claim_url"] = m.group(1)
            m2 = re.search(r'([a-zA-Z0-9-]+\.auto\.playit\.gg)', line)
            if m2: playit_info[name]["public_ip"] = m2.group(1)
    except Exception:
        pass

# ─────────────────────────── Installation (sync, runs in thread) ─────────────
def _download_jar(name, req_type, req_version, jar_path, server_path):
    """Synchronous jar download using httpx - safe to call from a thread."""
    with httpx.Client(timeout=600, follow_redirects=True) as client:
        if req_type == "paper":
            log(name, f"[Mero] 🔍 Fetching latest Paper build for {req_version}…")
            r = client.get(f"https://api.papermc.io/v2/projects/paper/versions/{req_version}/builds")
            r.raise_for_status()
            build = r.json()["builds"][-1]["build"]
            url   = (f"https://api.papermc.io/v2/projects/paper/versions/{req_version}"
                     f"/builds/{build}/downloads/paper-{req_version}-{build}.jar")
            log(name, f"[Mero] ⬇  Downloading Paper {req_version} build #{build}…")
            data = client.get(url).raise_for_status().content
            with open(jar_path, "wb") as f: f.write(data)

        elif req_type == "purpur":
            log(name, f"[Mero] 🔍 Fetching latest Purpur build for {req_version}…")
            r = client.get(f"https://api.purpurmc.org/v2/purpur/{req_version}")
            r.raise_for_status()
            build = r.json()["builds"]["latest"]
            url   = f"https://api.purpurmc.org/v2/purpur/{req_version}/{build}/download"
            log(name, f"[Mero] ⬇  Downloading Purpur {req_version} build #{build}…")
            data = client.get(url).raise_for_status().content
            with open(jar_path, "wb") as f: f.write(data)

        elif req_type == "fabric":
            # Fetch latest stable loader + installer versions dynamically
            loaders    = client.get("https://meta.fabricmc.net/v2/versions/loader").raise_for_status().json()
            installers = client.get("https://meta.fabricmc.net/v2/versions/installer").raise_for_status().json()
            loader_ver    = next(x for x in loaders    if x["stable"])["version"]
            installer_ver = next(x for x in installers if x["stable"])["version"]
            url = (f"https://meta.fabricmc.net/v2/versions/loader"
                   f"/{req_version}/{loader_ver}/{installer_ver}/server/jar")
            log(name, f"[Mero] ⬇  Downloading Fabric {req_version} (loader {loader_ver})…")
            data = client.get(url).raise_for_status().content
            with open(jar_path, "wb") as f: f.write(data)

        elif req_type == "forge":
            log(name, "[Mero] 🔍 Fetching Forge version list…")
            r = client.get("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
            r.raise_for_status()
            promos = r.json()["promos"]
            build  = promos.get(f"{req_version}-recommended") or promos.get(f"{req_version}-latest")
            if not build:
                raise RuntimeError(f"No Forge build found for Minecraft {req_version}")
            forge_ver  = f"{req_version}-{build}"
            inst_url   = (f"https://maven.minecraftforge.net/net/minecraftforge/forge"
                          f"/{forge_ver}/forge-{forge_ver}-installer.jar")
            inst_path  = os.path.join(server_path, "forge-installer.jar")
            log(name, f"[Mero] ⬇  Downloading Forge {forge_ver} installer…")
            data = client.get(inst_url).raise_for_status().content
            with open(inst_path, "wb") as f: f.write(data)

            log(name, "[Mero] ⚙  Running Forge installer (this may take a few minutes)…")
            proc = subprocess.Popen(
                [JAVA_EXE, "-jar", "forge-installer.jar", "--installServer"],
                cwd=server_path,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            )
            for line in iter(proc.stdout.readline, ""):
                if line: log(name, line.rstrip())
            proc.wait()
            if os.path.exists(inst_path): os.remove(inst_path)
            log(name, "[Mero] ✅ Forge installer finished.")

    log(name, "[Mero] ✅ Server jar ready.")


def _ensure_java_thread(name):
    """Ensure Java is available — uses system Java if present, otherwise downloads JRE 21."""
    global JAVA_EXE
    if os.path.exists(JAVA_EXE):
        return True
    # Use system Java if already installed (e.g. player has Minecraft installed)
    system_java = shutil.which("java")
    if system_java:
        log(name, f"[Mero] ☕ Using system Java: {system_java}")
        JAVA_EXE = system_java
        return True
    log(name, "[Mero] ☕ Java 21 not found — downloading via Adoptium API…")
    os.makedirs(JAVA_DIR, exist_ok=True)
    zip_path = os.path.join(BASE_DIR, "jre.zip")
    try:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            # Step 1: Ask Adoptium API for the actual download link
            api = ("https://api.adoptium.net/v3/assets/latest/21/hotspot"
                   "?architecture=x64&image_type=jre&os=windows&vendor=eclipse")
            log(name, "[Mero] ☕ Querying Adoptium for JRE download link…")
            r = client.get(api)
            r.raise_for_status()
            assets = r.json()
            download_url = assets[0]["binary"]["package"]["link"]
            log(name, f"[Mero] ☕ Downloading JRE: {download_url}")

        # Step 2: Download the zip (large file, separate client with long timeout)
        with httpx.Client(timeout=600, follow_redirects=True) as client:
            r = client.get(download_url)
            r.raise_for_status()
            with open(zip_path, "wb") as f:
                f.write(r.content)

        # Step 3: Extract and flatten
        log(name, "[Mero] ☕ Extracting JRE…")
        with zipfile.ZipFile(zip_path) as z:
            z.extractall(JAVA_DIR)
        os.remove(zip_path)
        # Adoptium zips have a single top-level folder — flatten it
        dirs = [d for d in os.listdir(JAVA_DIR) if os.path.isdir(os.path.join(JAVA_DIR, d))]
        if dirs:
            inner = os.path.join(JAVA_DIR, dirs[0])
            for item in os.listdir(inner):
                shutil.move(os.path.join(inner, item), JAVA_DIR)
            os.rmdir(inner)
        log(name, "[Mero] ✅ Java 21 installed.")
        return True
    except Exception as e:
        log(name, f"[Mero] ❌ Java install failed: {e}")
        return False


def boot_server(name: str):
    """Full boot sequence — runs in a background daemon thread.
       NOTE: caller must set phase='starting' before spawning this thread."""
    import traceback
    state = server_state[name]   # already set by the endpoint
    server_logs.setdefault(name, deque(maxlen=500))

    try:
        _boot_server_inner(name, state)
    except Exception as e:
        tb = traceback.format_exc()
        log(name, f"[Mero] ❌ FATAL CRASH in boot thread:\n{tb}")
        state["phase"] = "stopped"


def _boot_server_inner(name: str, state: dict):
    server_path = sdir(name)
    meta_path   = os.path.join(server_path, "meta.json")
    jar_path    = os.path.join(server_path, "server.jar")

    log(name, "[Mero] 🚀 Boot sequence started…")

    # 1. Java
    log(name, "[Mero] Step 1/4: Checking Java…")
    if not _ensure_java_thread(name):
        state["phase"] = "stopped"
        return

    log(name, f"[Mero] ✅ Java ready: {JAVA_EXE}")

    # 2. Playit (best-effort, non-fatal)
    if not os.path.exists(PLAYIT_EXE):
        log(name, "[Mero] ⬇  Downloading playit.gg agent…")
        try:
            urllib.request.urlretrieve(
                "https://github.com/playit-cloud/playit-agent/releases/download/v0.15.26/playit-windows-x86_64.exe",
                PLAYIT_EXE,
            )
            log(name, "[Mero] ✅ playit.gg ready.")
        except Exception as e:
            log(name, f"[Mero] ⚠  playit.gg unavailable: {e}")

    # 3. Server jar (lazy install)
    log(name, "[Mero] Step 2/4: Checking server jar…")
    with open(meta_path, encoding="utf-8") as f: meta = json.load(f)
    req_type, req_version = meta["type"], meta["version"]
    log(name, f"[Mero] Server type={req_type}  version={req_version}")

    has_jar     = os.path.exists(jar_path)
    has_run_bat = os.path.exists(os.path.join(server_path, "run.bat"))
    has_forge   = any(
        fn.startswith("forge-") and fn.endswith(".jar") and "installer" not in fn
        for fn in os.listdir(server_path)
    )

    if not (has_jar or has_run_bat or has_forge):
        log(name, "[Mero] 📦 Step 3/4: Downloading server jar (first launch)…")
        try:
            _download_jar(name, req_type, req_version, jar_path, server_path)
        except Exception as e:
            import traceback
            log(name, f"[Mero] ❌ Download failed: {e}\n{traceback.format_exc()}")
            state["phase"] = "stopped"
            return
    else:
        log(name, "[Mero] ✅ Server jar already present.")

    # 4. Launch!
    log(name, "[Mero] Step 4/4: Launching Minecraft server…")

    # Wait for port to be free (prevents crash when restarting quickly)
    import socket
    port = get_port(server_path)
    for attempt in range(15):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(('127.0.0.1', port)) != 0:
                break
        log(name, f"[Mero] ⏳ Waiting for port {port} to be free…")
        time.sleep(2)

    if os.path.exists(os.path.join(server_path, "run.bat")):
        cmd = [os.path.join(server_path, "run.bat"), "nogui"]
    else:
        target = "server.jar"
        for fn in os.listdir(server_path):
            if fn.startswith("forge-") and fn.endswith(".jar") and "installer" not in fn:
                target = fn; break
        ram_gb = meta.get("ram", 4)
        cmd = [JAVA_EXE, f"-Xms{ram_gb}G", f"-Xmx{ram_gb}G", "-jar", target, "nogui"]

    log(name, f"[Mero] CMD: {' '.join(cmd)}")
    mc = subprocess.Popen(
        cmd, cwd=server_path,
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )
    state["process"] = mc
    state["phase"]   = "running"
    server_start_ts[name] = time.time()

    threading.Thread(target=capture, args=(mc, name), daemon=True).start()

    # 5. Playit tunnel
    if os.path.exists(PLAYIT_EXE):
        pdir = os.path.join(server_path, ".playit")
        os.makedirs(pdir, exist_ok=True)
        pp = subprocess.Popen(
            [PLAYIT_EXE, "start"], cwd=pdir,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1,
        )
        playit_procs[name] = pp
        threading.Thread(target=read_playit, args=(pp, name), daemon=True).start()


# ─────────────────────────── API: servers ────────────────────────────────────
class ServerCreate(BaseModel):
    name: str
    type: str
    version: str
    description: str = ""
    subdomain: str = ""
    ram: int = 4  # Default 4GB

class InstallReq(BaseModel):
    project_id: str
    project_type: str
    title: str = ""
    icon_url: str = ""

class CmdReq(BaseModel):
    command: str

class ChatReq(BaseModel):
    message: str
    player: str = ""   # if set, prefix as <player>

class FileContentReq(BaseModel):
    path: str
    content: str

class PlayitKeyReq(BaseModel):
    key: str

@app.post("/api/servers")
def create_server(req: ServerCreate, background_tasks: BackgroundTasks):
    safe_name = re.sub(r'§[0-9a-fk-or]', '', req.name, flags=re.IGNORECASE)
    safe_name = re.sub(r'[<>:"/\\|?*!]', '', safe_name).strip()
    if not safe_name: raise HTTPException(400, "Invalid server name (too few safe characters)")
    
    sp = sdir(safe_name)
    if os.path.exists(sp): raise HTTPException(400, "Server already exists")
    os.makedirs(sp)
    folders = ["resourcepacks", "shaderpacks"]
    if req.type.lower() in ["fabric", "forge"]:
        folders.append("mods")
    elif req.type.lower() in ["paper", "purpur", "spigot"]:
        folders.append("plugins")
    
    for d in folders:
        os.makedirs(os.path.join(sp, d), exist_ok=True)
    with open(os.path.join(sp, "eula.txt"), "w", encoding="utf-8") as f: f.write("eula=true\n")
    
    motd = req.description if req.description.strip() else "A Mero Server"
    with open(os.path.join(sp, "server.properties"), "w", encoding="utf-8") as f:
        f.write(f"""online-mode=false
motd={motd}
server-port=25565
""")
        
    meta_data = {
        "display_name": req.name,
        "version": req.version,
        "type": req.type,
        "ram": req.ram,
        "subdomain": req.subdomain,
        "software": req.type.lower(), # Track platform
        "installed_files": []
    }
    with open(os.path.join(sp, "meta.json"), "w", encoding="utf-8") as f: json.dump(meta_data, f)
    
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

_cached_local_ip = None
def get_local_ip():
    global _cached_local_ip
    if _cached_local_ip: return _cached_local_ip
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        _cached_local_ip = ip
        return ip
    except Exception:
        return "127.0.0.1"

@app.get("/api/system_specs")
def get_system_specs():
    import psutil
    ram_gb = round(psutil.virtual_memory().total / (1024**3))
    return {"total_ram_gb": ram_gb}

@app.get("/api/versions")
async def get_versions(software: str = "paper"):
    software = software.lower()
    async with httpx.AsyncClient() as c:
        try:
            if software == "paper":
                r = await c.get("https://api.papermc.io/v2/projects/paper")
                return {"versions": r.json()["versions"][::-1]} # Newest first
            elif software == "purpur":
                r = await c.get("https://api.purpurmc.org/v2/purpur")
                return {"versions": r.json()["versions"][::-1]}
            elif software == "fabric":
                r = await c.get("https://meta.fabricmc.net/v2/versions/game")
                return {"versions": [v["version"] for v in r.json() if v["stable"]]}
            elif software == "forge":
                r = await c.get("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json")
                promos = r.json()["promos"]
                # forge promos has keys like '1.20.4-recommended'. We extract the MC version.
                versions = list(set([k.split('-')[0] for k in promos.keys()]))
                # Sort roughly by version numbers
                versions.sort(key=lambda s: [int(x) for x in s.split('.') if x.isdigit()], reverse=True)
                return {"versions": versions}
            elif software == "vanilla":
                r = await c.get("https://launchermeta.mojang.com/mc/game/version_manifest.json")
                return {"versions": [v["id"] for v in r.json()["versions"] if v["type"] == "release"]}
            else:
                return {"versions": ["1.20.4", "1.19.4", "1.18.2"]}
        except Exception:
            return {"versions": ["1.20.4", "1.19.4", "1.18.2"]}

@app.get("/api/servers")
def list_servers():
    if not os.path.exists(SERVERS_DIR): return []
    out = []
    for name in os.listdir(SERVERS_DIR):
        if not os.path.isdir(sdir(name)): continue
        st    = server_state.get(name, {})
        phase = st.get("phase", "stopped")
        tunnel = playit_info.get(name, {}) if phase == "running" else {}
        local_ip = ""
        if phase == "running":
            local_ip = f"{get_local_ip()}:{get_port(sdir(name))}"
        display_name = name
        meta_path = os.path.join(sdir(name), "meta.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    display_name = meta.get("display_name", name)
            except Exception: pass

        out.append({"name": name, "display_name": display_name, "phase": phase, "tunnel": tunnel, "local_ip": local_ip})
    return out

@app.post("/api/servers/{name}/start")
def start_server(name: str):

    # --- Auto Server Resource Pack Engine ---
    rp_dir = os.path.join(sdir(name), "resourcepacks")
    props_path = os.path.join(sdir(name), "server.properties")
    if os.path.exists(rp_dir) and os.path.exists(props_path):
        zips = [f for f in os.listdir(rp_dir) if f.endswith(".zip")]
        if zips:
            rp_file = os.path.join(rp_dir, zips[0])
            sha1 = get_sha1(rp_file)
            
            local_ip = get_local_ip()
            # Read properties
            with open(props_path, "r", encoding="utf-8") as f: lines = f.readlines()
            new_lines = []
            has_rp = False
            has_hash = False
            
            for line in lines:
                if line.startswith("resource-pack="):
                    new_lines.append(f"resource-pack=http://{local_ip}:8000/api/servers/{name}/resourcepack\n")
                    has_rp = True
                elif line.startswith("resource-pack-sha1="):
                    new_lines.append(f"resource-pack-sha1={sha1}\n")
                    has_hash = True
                else:
                    new_lines.append(line)
                    
            if not has_rp: new_lines.append(f"resource-pack=http://{local_ip}:8000/api/servers/{name}/resourcepack\n")
            if not has_hash: new_lines.append(f"resource-pack-sha1={sha1}\n")
            
            with open(props_path, "w", encoding="utf-8") as f: f.writelines(new_lines)
    if not os.path.exists(sdir(name)):
        raise HTTPException(404, "Server not found")
    # Enforce: only 1 server running at a time
    for sname, st in server_state.items():
        if sname != name and st.get("phase") in ("starting", "running"):
            raise HTTPException(400, f"Server '{sname}' is already running. Stop it first.")
    st = server_state.get(name, {})
    if st.get("phase") in ("starting", "running"):
        raise HTTPException(400, "Already running or starting")
    # Set phase BEFORE spawning thread to avoid race condition with fetchStats()
    server_state[name] = {"phase": "starting", "process": None}
    server_logs[name]  = deque(maxlen=500)
    log(name, "[Mero] 🚀 Boot sequence initiated…")
    threading.Thread(target=boot_server, args=(name,), daemon=True).start()
    return {"message": "Boot sequence initiated"}

@app.post("/api/servers/{name}/stop")
def stop_server(name: str, force: bool = False):
    st   = server_state.get(name, {})
    proc = st.get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(400, "Not running")
    if not force:
        try:
            port = get_port(sdir(name))
            sv   = JavaServer.lookup(f"127.0.0.1:{port}")
            if sv.status().players.online > 0:
                raise HTTPException(400, "Players are online. Force stop?")
        except HTTPException: raise
        except Exception: pass
    try: proc.stdin.write("stop\n"); proc.stdin.flush()
    except Exception: proc.terminate()
    pp = playit_procs.get(name)
    if pp and pp.poll() is None: pp.terminate()
    # Let the capture thread set the phase to "stopped" when the process exits
    # so we don't accidentally allow restarting while it's still shutting down
    return {"message": "Stopping..."}

@app.post("/api/servers/{name}/restart")
def restart_server(name: str):
    st   = server_state.get(name, {})
    proc = st.get("process")
    if proc and proc.poll() is None:
        try: proc.stdin.write("stop\n"); proc.stdin.flush()
        except Exception: proc.terminate()
        proc.wait(timeout=30)
    pp = playit_procs.get(name)
    if pp and pp.poll() is None: pp.terminate()
    server_state[name] = {"phase": "starting", "process": None}
    server_logs[name]  = deque(maxlen=500)
    log(name, "[Mero] 🔄 Restarting…")
    threading.Thread(target=boot_server, args=(name,), daemon=True).start()
    return {"message": "Restarting"}

@app.delete("/api/servers/{name}")
def delete_server(name: str):
    sp = sdir(name)
    if not os.path.exists(sp):
        raise HTTPException(404, "Server not found")

    # Force-kill any lingering server / playit processes first
    st = server_state.get(name, {})
    proc = st.get("process")
    if proc:
        try: proc.kill(); proc.wait(timeout=10)
        except Exception: pass
    pp = playit_procs.get(name)
    if pp:
        try: pp.kill(); pp.wait(timeout=5)
        except Exception: pass

    import stat, time as _time

    def _robust_remove(func, path, exc_info):
        """Handle Windows file-lock / read-only errors during rmtree."""
        try:
            os.chmod(path, stat.S_IWRITE)
            func(path)
        except Exception:
            pass  # will be retried below

    # Try up to 3 times with a short delay for Windows to release file locks
    last_err = None
    for attempt in range(3):
        try:
            shutil.rmtree(sp, onexc=_robust_remove)
            break
        except Exception as e:
            last_err = e
            _time.sleep(1)
    else:
        if os.path.exists(sp):
            raise HTTPException(500, f"Could not fully delete server files: {last_err}")

    server_state.pop(name, None)
    server_logs.pop(name, None)
    playit_info.pop(name, None)
    playit_procs.pop(name, None)
    server_start_ts.pop(name, None)
    return {"message": "Deleted"}

@app.post("/api/servers/{name}/kill")
def kill_server(name: str):
    st   = server_state.get(name, {})
    proc = st.get("process")
    if proc:
        try: proc.kill()
        except Exception: pass
    pp = playit_procs.get(name)
    if pp:
        try: pp.kill()
        except Exception: pass
    st["phase"] = "stopped"
    log(name, "[Mero] ⚡ Server killed.")
    return {"message": "Killed"}

# ─────────────────────────── API: console ────────────────────────────────────
@app.get("/api/servers/{name}/stats")
def get_stats(name: str):
    sp = sdir(name)

    # Cache disk calculation for 30s — os.walk on large servers is very expensive
    cached = disk_cache.get(name)
    if cached and (time.time() - cached[0]) < 30:
        disk = cached[1]
    else:
        def _safe_getsize(path):
            try: return os.path.getsize(path)
            except OSError: return 0
        disk = sum(
            _safe_getsize(os.path.join(dp, fn))
            for dp, _, fns in os.walk(sp) for fn in fns
            if not os.path.islink(os.path.join(dp, fn))
        )
        disk_cache[name] = (time.time(), disk)
    st    = server_state.get(name, {})
    phase = st.get("phase", "stopped")
    proc  = st.get("process")

    players_online = 0
    players_max = 0
    players_sample = []

    meta_path = os.path.join(sp, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            try: meta = json.load(f)
            except Exception: pass

    mods_path = os.path.join(sp, "mods")
    rp_path = os.path.join(sp, "resourcepacks")
    sp_path = os.path.join(sp, "shaderpacks")

    mods_count = len([f for f in os.listdir(mods_path) if os.path.isfile(os.path.join(mods_path, f))]) if os.path.exists(mods_path) else 0
    rp_count = len([f for f in os.listdir(rp_path) if os.path.isfile(os.path.join(rp_path, f))]) if os.path.exists(rp_path) else 0
    sp_count = len([f for f in os.listdir(sp_path) if os.path.isfile(os.path.join(sp_path, f))]) if os.path.exists(sp_path) else 0

    base_stats = {
        "display_name": meta.get("display_name", name),
        "version": meta.get("version", "Unknown"),
        "type": meta.get("type", "Unknown").capitalize(),
        "platform": meta.get("type", "vanilla"),
        "mods_count": mods_count,
        "rp_count": rp_count,
        "sp_count": sp_count,
        "disk": disk,
    }

    if phase == "starting":
        return {"phase": "starting", "cpu": 0, "memory": 0, "uptime": 0, "players_online": 0, "players_max": 0, "players_sample": [], **base_stats}

    if phase == "running" and proc and proc.poll() is None:
        try:
            port = get_port(sdir(name))
            sv = JavaServer.lookup(f"127.0.0.1:{port}")
            sv.timeout = 0.5
            st_data = sv.status()
            players_online = st_data.players.online
            players_max = st_data.players.max
            players_sample = [{"name": p.name} for p in st_data.players.sample] if st_data.players.sample else []
        except Exception:
            pass

        try:
            root  = psutil.Process(proc.pid)
            procs = [root] + root.children(recursive=True)
            cpu, mem = 0.0, 0
            for p in procs:
                try: cpu += p.cpu_percent(interval=0.0); mem += p.memory_info().rss
                except Exception: pass
            return {
                "phase": "running", "cpu": cpu, "memory": mem,
                "uptime": int(time.time() - server_start_ts.get(name, time.time())),
                "players_online": players_online, "players_max": players_max, "players_sample": players_sample,
                **base_stats
            }
        except Exception:
            pass
    return {"phase": "stopped", "cpu": 0, "memory": 0, "uptime": 0, "players_online": 0, "players_max": 0, "players_sample": [], **base_stats}

@app.get("/api/servers/{name}/console")
def get_console(name: str):
    return {"logs": list(server_logs.get(name, []))}

@app.post("/api/servers/{name}/command")
def send_command(name: str, req: CmdReq):
    proc = server_state.get(name, {}).get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(400, "Not running")
    try:
        proc.stdin.write(req.command + "\n")
        proc.stdin.flush()
        log(name, f"> {req.command}")
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"message": "Sent"}

@app.post("/api/servers/{name}/chat")
def send_chat(name: str, req: ChatReq):
    proc = server_state.get(name, {}).get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(400, "Not running")
    if req.player:
        cmd = f'tellraw @a [{{"text":"<{req.player}> "}},{{"text":"{req.message}"}}]'
    else:
        # Use tellraw without a sender to avoid the [Server] prefix
        safe_msg = req.message.replace('\\', '\\\\').replace('"', '\\"')
        cmd = f'tellraw @a {{"text":"{safe_msg}"}}'
    try:
        proc.stdin.write(cmd + "\n")
        proc.stdin.flush()
        log(name, f"[Chat] {'<' + req.player + '> ' if req.player else ''}{req.message}")
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"message": "Sent"}

# ─────────────────────────── API: config ─────────────────────────────────────
@app.get("/api/servers/{name}/config")
def get_config(name: str):
    pp = os.path.join(sdir(name), "server.properties")
    props = {}
    if os.path.exists(pp):
        with open(pp, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    props[k] = v
    return props

@app.post("/api/servers/{name}/config")
async def update_config(name: str, request: Request):
    updates = await request.json()
    pp      = os.path.join(sdir(name), "server.properties")
    props, order = {}, []
    if os.path.exists(pp):
        with open(pp, encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    props[k.strip()] = v.strip(); order.append(k.strip())
                else:
                    order.append(line)
    for k, v in updates.items():
        if k not in props: order.append(k)
        props[k] = str(v)
    with open(pp, "w", encoding="utf-8") as f:
        for item in order:
            f.write(f"{item}={props[item]}\n" if item in props else item)
    return {"message": "Saved"}


# ──────────────────────────── API: Player Manager ────────────────────────────
@app.get("/api/servers/{name}/players")
def list_players(name: str):
    sp = sdir(name)
    result = {"whitelist": [], "ops": [], "banned": []}

    def read_json_list(filename):
        path = os.path.join(sp, filename)
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return []

    result["whitelist"] = read_json_list("whitelist.json")
    result["ops"]       = read_json_list("ops.json")
    result["banned"]    = read_json_list("banned-players.json")
    return result

@app.get("/api/mojang/profile/{username}")
async def mojang_profile(username: str):
    """Fetch Mojang UUID + skin for a username."""
    async with httpx.AsyncClient() as c:
        r = await c.get(f"https://api.mojang.com/users/profiles/minecraft/{username}", timeout=8)
        if r.status_code != 200:
            raise HTTPException(404, "Player not found")
        data = r.json()
        uuid = data.get("id", "")
        name = data.get("name", username)
        avatar = f"https://crafatar.com/avatars/{uuid}?size=64&overlay"
        return {"uuid": uuid, "name": name, "avatar": avatar}

@app.post("/api/servers/{name}/whitelist/add")
def whitelist_add(name: str, req: dict = Body(...)):
    sp = sdir(name)
    player_name = req.get("name", "")
    player_uuid = req.get("uuid", "")
    path = os.path.join(sp, "whitelist.json")
    players = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f: players = json.load(f)
        except Exception: pass
    if not any(p.get("name", "").lower() == player_name.lower() for p in players):
        players.append({"uuid": player_uuid, "name": player_name})
        with open(path, "w", encoding="utf-8") as f: json.dump(players, f, indent=2)
    # Send live command if running
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try: proc.stdin.write(f"whitelist add {player_name}\n"); proc.stdin.flush()
        except Exception: pass
    return {"message": f"{player_name} added to whitelist"}

@app.post("/api/servers/{name}/whitelist/remove")
def whitelist_remove(name: str, req: dict = Body(...)):
    sp = sdir(name)
    player_name = req.get("name", "")
    path = os.path.join(sp, "whitelist.json")
    players = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f: players = json.load(f)
        except Exception: pass
    players = [p for p in players if p.get("name", "").lower() != player_name.lower()]
    with open(path, "w", encoding="utf-8") as f: json.dump(players, f, indent=2)
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try: proc.stdin.write(f"whitelist remove {player_name}\n"); proc.stdin.flush()
        except Exception: pass
    return {"message": f"{player_name} removed from whitelist"}

@app.post("/api/servers/{name}/ban")
def ban_player(name: str, req: dict = Body(...)):
    sp = sdir(name)
    player_name = req.get("name", "")
    player_uuid = req.get("uuid", "")
    reason = req.get("reason", "Banned by an operator.")
    path = os.path.join(sp, "banned-players.json")
    banned = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f: banned = json.load(f)
        except Exception: pass
    if not any(p.get("name", "").lower() == player_name.lower() for p in banned):
        import datetime
        banned.append({"uuid": player_uuid, "name": player_name, "created": datetime.datetime.utcnow().isoformat() + " +0000", "source": "Server", "expires": "forever", "reason": reason})
        with open(path, "w", encoding="utf-8") as f: json.dump(banned, f, indent=2)
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try: proc.stdin.write(f"ban {player_name} {reason}\n"); proc.stdin.flush()
        except Exception: pass
    return {"message": f"{player_name} banned"}

@app.post("/api/servers/{name}/unban")
def unban_player(name: str, req: dict = Body(...)):
    sp = sdir(name)
    player_name = req.get("name", "")
    path = os.path.join(sp, "banned-players.json")
    banned = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f: banned = json.load(f)
        except Exception: pass
    banned = [p for p in banned if p.get("name", "").lower() != player_name.lower()]
    with open(path, "w", encoding="utf-8") as f: json.dump(banned, f, indent=2)
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try: proc.stdin.write(f"pardon {player_name}\n"); proc.stdin.flush()
        except Exception: pass
    return {"message": f"{player_name} unbanned"}


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

# ─────────────────────────── API: modrinth ───────────────────────────────────
@app.get("/api/modrinth/search")
async def modrinth_search(query: str = "", project_type: str = "mod", game_version: str = "", loader: str = ""):
    facets_list = [f'["project_type:{project_type}"]']
    if game_version:
        facets_list.append(f'["versions:{game_version}"]')
    # Only filter by loader for mods/modpacks — resource packs and shaders are loader-agnostic
    if loader and project_type in ("mod", "modpack"):
        facets_list.append(f'["categories:{loader}"]')
    facets = '[' + ','.join(facets_list) + ']'
    async with httpx.AsyncClient() as c:
        r = await c.get(f"https://api.modrinth.com/v2/search?query={query}&facets={facets}&limit=12&index=downloads")
        return r.json().get("hits", [])

import tempfile, zipfile

# Tracks multi-stage modpack installation progress per server+project_id
# {server_name: {project_id: {stage, stage_label, pack_pct, mods_done, mods_total, status, title, icon_url, error}}}
modpack_progress: dict = {}

async def install_modpack_bg(name: str, project_id: str, meta: dict, title: str, icon_url: str):
    """Background coroutine: streams mrpack download, parses manifest, downloads all mods."""
    key = project_id
    prog = modpack_progress.setdefault(name, {})
    prog[key] = {
        "status": "downloading_pack", "stage": 1,
        "stage_label": "Downloading modpack file\u2026",
        "pack_pct": 0, "mods_done": 0, "mods_total": 0,
        "title": title, "icon_url": icon_url, "error": ""
    }
    try:
        async with httpx.AsyncClient(timeout=120) as c:
            # ── Stage 1: Fetch version manifest ──────────────────────────────
            r = await c.get(
                f"https://api.modrinth.com/v2/project/{project_id}/version"
                f"?game_versions=[\"{ meta['version'] }\"]"
            )
            data = r.json()
            if not data:
                prog[key].update({"status": "error", "error": "No compatible version found"}); return
            fi = next((f for f in data[0]["files"] if f["filename"].endswith(".mrpack")), None)
            if not fi:
                prog[key].update({"status": "error", "error": "No .mrpack file found"}); return

            # ── Stage 1b: Stream the mrpack file with byte-level progress ────
            tmp = tempfile.mktemp(suffix=".mrpack")
            async with c.stream("GET", fi["url"], follow_redirects=True, timeout=180) as resp:
                total_bytes = int(resp.headers.get("Content-Length", 0))
                downloaded_bytes = 0
                prog[key]["stage_label"] = "Downloading modpack file\u2026"
                with open(tmp, "wb") as f_out:
                    async for chunk in resp.aiter_bytes(chunk_size=32768):
                        f_out.write(chunk)
                        downloaded_bytes += len(chunk)
                        if total_bytes > 0:
                            prog[key]["pack_pct"] = round(downloaded_bytes / total_bytes * 100, 1)
            prog[key]["pack_pct"] = 100

            # ── Stage 2: Extract manifest & overrides ────────────────────────
            prog[key].update({"status": "extracting", "stage": 2, "stage_label": "Reading manifest\u2026"})
            with zipfile.ZipFile(tmp, 'r') as z:
                idx = json.loads(z.read("modrinth.index.json"))
                for zi in z.infolist():
                    if zi.filename.startswith("overrides/"):
                        target = os.path.join(sdir(name), zi.filename.replace("overrides/", "", 1))
                        if zi.is_dir(): os.makedirs(target, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target), exist_ok=True)
                            with open(target, "wb") as out: out.write(z.read(zi.filename))
            os.remove(tmp)

            mod_files = idx.get("files", [])
            total_mods = len(mod_files)
            prog[key].update({
                "status": "downloading_mods", "stage": 3,
                "stage_label": f"Downloading mods: 0 / {total_mods}",
                "mods_total": total_mods, "mods_done": 0
            })

            # ── Stage 3: Batch-fetch icons then download each mod file ───────
            project_ids_list = []
            for mf in mod_files:
                url_parts = mf["downloads"][0].split("/data/")
                pid = url_parts[1].split("/")[0] if len(url_parts) > 1 else None
                project_ids_list.append(pid)

            icon_map = {}
            unique_pids = [p for p in set(project_ids_list) if p]
            if unique_pids:
                try:
                    pr = await c.get(
                        "https://api.modrinth.com/v2/projects",
                        params={"ids": json.dumps(unique_pids)},
                        timeout=10
                    )
                    if pr.status_code == 200:
                        for proj in pr.json():
                            icon_map[proj["id"]] = {
                                "title": proj.get("title", proj["id"]),
                                "icon_url": proj.get("icon_url") or ""
                            }
                except Exception:
                    pass

            done = 0
            for mf, pid in zip(mod_files, project_ids_list):
                mod_url  = mf["downloads"][0]
                dest     = os.path.join(sdir(name), mf["path"])
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                fn       = os.path.basename(dest)
                info     = icon_map.get(pid, {})
                mod_title    = info.get("title", fn)
                mod_icon_url = info.get("icon_url", "")
                # Download each mod file individually (reuse existing task logic)
                try:
                    async with c.stream("GET", mod_url, follow_redirects=True, timeout=60) as mr:
                        with open(dest, "wb") as f_mod:
                            async for chunk in mr.aiter_bytes(chunk_size=32768):
                                f_mod.write(chunk)
                    # Register in meta.json
                    with open(os.path.join(sdir(name), "meta.json"), encoding="utf-8") as fm: m = json.load(fm)
                    if "installed_files" not in m: m["installed_files"] = []
                    m["installed_files"] = [x for x in m["installed_files"] if x["filename"] != fn]
                    m["installed_files"].append({"project_id": pid or fn, "filename": fn, "type": "mod", "title": mod_title, "icon_url": mod_icon_url})
                    with open(os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8") as fm: json.dump(m, fm)
                    # Also record in install_progress so downloads panel works
                    install_progress.setdefault(name, {})[fn] = {"downloaded": 1, "total": 1, "status": "installed", "title": mod_title, "icon_url": mod_icon_url}
                except Exception:
                    pass  # Skip failed mod files rather than aborting everything
                done += 1
                prog[key]["mods_done"] = done
                prog[key]["stage_label"] = f"Downloading mods: {done} / {total_mods}"

        prog[key].update({"status": "done", "stage": 3, "stage_label": "Installation complete!", "mods_done": total_mods})
    except Exception as ex:
        prog.setdefault(key, {})
        prog[key].update({"status": "error", "stage_label": "Installation failed", "error": str(ex)})

async def download_mod_task(name: str, project_id: str, project_type: str, url: str, dest: str, filename: str, title: str, icon_url: str):
    try:
        async with httpx.AsyncClient() as c:
            async with c.stream("GET", url, follow_redirects=True) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                install_progress.setdefault(name, {})[project_id] = {"downloaded": 0, "total": total, "status": "downloading", "title": title, "icon_url": icon_url}
                
                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        install_progress[name][project_id]["downloaded"] += len(chunk)
        
        # update meta.json tracking
        with open(os.path.join(sdir(name), "meta.json"), encoding="utf-8") as f: meta = json.load(f)
        if "installed_files" not in meta: meta["installed_files"] = []
        meta["installed_files"] = [m for m in meta["installed_files"] if m["project_id"] != project_id]
        meta["installed_files"].append({"project_id": project_id, "filename": filename, "type": project_type, "title": title, "icon_url": icon_url})
        with open(os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8") as f: json.dump(meta, f)
        
        install_progress[name][project_id]["status"] = "installed"
    except Exception as e:
        if name in install_progress and project_id in install_progress[name]:
            install_progress[name][project_id]["status"] = "error"

async def resolve_and_download(name: str, req: InstallReq, background_tasks: BackgroundTasks, c: httpx.AsyncClient, meta: dict, visited: set = None):
    if visited is None: visited = set()
    if req.project_id in visited: return
    visited.add(req.project_id)
    
    # fetch project details for title and icon
    r_proj = await c.get(f"https://api.modrinth.com/v2/project/{req.project_id}")
    proj_data = r_proj.json() if r_proj.status_code == 200 else {}
    title = req.title or proj_data.get("title", req.project_id)
    icon_url = req.icon_url or proj_data.get("icon_url", "")
    
    # get compatible version
    r = await c.get(f"https://api.modrinth.com/v2/project/{req.project_id}/version?game_versions=[\"{meta['version']}\"]")
    data = r.json()
    if not data: return # no compatible version
    
    v = data[0]
    fi = v["files"][0]
    folder = {"mod":"mods","resourcepack":"resourcepacks","shader":"shaderpacks"}.get(req.project_type,"mods")
    os.makedirs(os.path.join(sdir(name), folder), exist_ok=True)
    dest = os.path.join(sdir(name), folder, fi["filename"])
    
    # === PEACEKEEPER ENGINE: Conflict Resolution ===
    installed = meta.get("installed_files", [])
    for dep in v.get("dependencies", []):
        if dep.get("dependency_type") == "incompatible" and dep.get("project_id"):
            inc_id = dep["project_id"]
            for inst in installed:
                if inst["project_id"] == inc_id:
                    # Conflict detected, resolve by deleting the incompatible mod
                    inc_path = os.path.join(sdir(name), {"mod":"mods","resourcepack":"resourcepacks","shader":"shaderpacks"}.get(inst.get("type", "mod"), "mods"), inst["filename"])
                    if os.path.exists(inc_path):
                        os.remove(inc_path)
                    meta["installed_files"] = [m for m in meta["installed_files"] if m["project_id"] != inc_id]
                    with open(os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8") as f:
                        json.dump(meta, f)
                    print(f"[Peacekeeper] Removed incompatible mod {inst['filename']} to install {title}")
    
    background_tasks.add_task(download_mod_task, name, req.project_id, req.project_type, fi["url"], dest, fi["filename"], title, icon_url)
    
    # process dependencies
    for dep in v.get("dependencies", []):
        if dep.get("dependency_type") == "required" and dep.get("project_id"):
            await resolve_and_download(name, InstallReq(project_id=dep["project_id"], project_type=req.project_type), background_tasks, c, meta, visited)

@app.post("/api/servers/{name}/install")
async def install_mod(name: str, req: InstallReq, background_tasks: BackgroundTasks):
    with open(os.path.join(sdir(name), "meta.json"), encoding="utf-8") as f: meta = json.load(f)
    if req.project_type == "modpack":
        # Fetch basic project info for title/icon (fast), then hand off to background
        title, icon_url = req.title or req.project_id, req.icon_url or ""
        try:
            async with httpx.AsyncClient(timeout=8) as c:
                rp = await c.get(f"https://api.modrinth.com/v2/project/{req.project_id}")
                if rp.status_code == 200:
                    pd = rp.json()
                    title    = pd.get("title", title)
                    icon_url = pd.get("icon_url") or ""
        except Exception:
            pass
        # Kick off the full staged installation in the background
        background_tasks.add_task(install_modpack_bg, name, req.project_id, meta, title, icon_url)
        return {"message": "Started", "project_id": req.project_id}
    else:
        async with httpx.AsyncClient() as c:
            await resolve_and_download(name, req, background_tasks, c, meta)
        return {"message": "Started"}

@app.get("/api/servers/{name}/install_progress_all")
def get_install_progress_all(name: str):
    return install_progress.get(name, {})

@app.get("/api/servers/{name}/install_progress")
def get_install_progress(name: str, project_id: str):
    prog = install_progress.get(name, {}).get(project_id)
    if not prog: return {"status": "none"}
    return prog

@app.get("/api/servers/{name}/modpack_progress/{project_id}")
def get_modpack_progress(name: str, project_id: str):
    prog = modpack_progress.get(name, {}).get(project_id)
    if not prog: return {"status": "unknown"}
    return prog

@app.get("/api/servers/{name}/installed_mods")
def get_installed_mods(name: str):
    installed = []
    meta_path = os.path.join(sdir(name), "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
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

# ─────────────────────────── API: file manager ───────────────────────────────
@app.get("/api/servers/{name}/files")
def list_files(name: str, path: str = ""):
    sp     = sdir(name)
    target = os.path.normpath(os.path.join(sp, path)) if path else sp
    if not target.startswith(sp): raise HTTPException(400, "Invalid path")
    
    meta_path = os.path.join(sp, "meta.json")
    icon_map = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                m = json.load(f)
                for item in m.get("installed_files", []):
                    icon_map[item.get("filename")] = item.get("icon_url")
        except: pass

    entries = []
    try:
        for e in sorted(os.scandir(target), key=lambda x: (not x.is_dir(), x.name.lower())):
            st = e.stat()
            entries.append({"name": e.name,
                             "path": os.path.relpath(e.path, sp).replace("\\", "/"),
                             "is_dir": e.is_dir(),
                             "size": 0 if e.is_dir() else st.st_size,
                             "modified": int(st.st_mtime),
                             "icon_url": icon_map.get(e.name, "")})
    except FileNotFoundError: raise HTTPException(404, "Not found")
    return entries

@app.post("/api/servers/{name}/upload")
async def upload_file(name: str, path: str = Form(""), file: UploadFile = File(...)):
    sp   = sdir(name)
    dest = os.path.normpath(os.path.join(sp, path)) if path else sp
    if not dest.startswith(sp): raise HTTPException(400, "Invalid path")
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, file.filename), "wb") as f: f.write(await file.read())
    return {"message": "Uploaded"}

@app.post("/api/servers/{name}/files/delete")
def delete_entry(name: str, path: str):
    sp = sdir(name)
    t  = os.path.normpath(os.path.join(sp, path))
    if not t.startswith(sp): raise HTTPException(400, "Invalid path")
    if os.path.isfile(t): os.remove(t)
    elif os.path.isdir(t): shutil.rmtree(t)
    return {"message": "Deleted"}

@app.post("/api/servers/{name}/files/mkdir")
def make_dir(name: str, path: str):
    sp = sdir(name)
    t  = os.path.normpath(os.path.join(sp, path))
    if not t.startswith(sp): raise HTTPException(400, "Invalid path")
    os.makedirs(t, exist_ok=True)
    return {"message": "Created"}

@app.get("/api/servers/{name}/files/content")
def get_file_content(name: str, path: str):
    sp = sdir(name)
    t  = os.path.normpath(os.path.join(sp, path))
    if not t.startswith(sp) or not os.path.isfile(t):
        raise HTTPException(400, "Invalid path or not a file")
    try:
        with open(t, "r", encoding="utf-8") as f:
            return {"content": f.read()}
    except Exception as e:
        raise HTTPException(500, f"Could not read file: {e}")

@app.post("/api/servers/{name}/files/content")
def set_file_content(name: str, req: FileContentReq):
    sp = sdir(name)
    t  = os.path.normpath(os.path.join(sp, req.path))
    if not t.startswith(sp):
        raise HTTPException(400, "Invalid path")
    try:
        with open(t, "w", encoding="utf-8") as f:
            f.write(req.content)
        return {"message": "Saved"}
    except Exception as e:
        raise HTTPException(500, f"Could not save file: {e}")


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
            cmd = "save-off\n"
            if "b" in getattr(proc.stdin, "mode", "b"): cmd = cmd.encode()
            proc.stdin.write(cmd)
            proc.stdin.flush()
            
            cmd2 = "save-all\n"
            if "b" in getattr(proc.stdin, "mode", "b"): cmd2 = cmd2.encode()
            proc.stdin.write(cmd2)
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
                            if f == "session.lock": continue
                            fp = os.path.join(root, f)
                            arcname = os.path.relpath(fp, sp)
                            try:
                                zf.write(fp, arcname)
                            except PermissionError:
                                pass # Skip locked files

    except Exception as e:
        if is_running:
            try:
                cmd = "save-on\n"
                if "b" in getattr(proc.stdin, "mode", "b"): cmd = cmd.encode()
                proc.stdin.write(cmd)
                proc.stdin.flush()
            except Exception: pass
        raise HTTPException(500, f"Backup failed: {e}")
        
    if is_running:
        try:
            cmd = "save-on\n"
            if "b" in getattr(proc.stdin, "mode", "b"): cmd = cmd.encode()
            proc.stdin.write(cmd)
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


app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

@app.get("/")
def root(): return FileResponse(os.path.join(BASE_DIR, "static", "index.html"))


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

# ─────────────────────────── Entry point ─────────────────────────────────────
def run_uvicorn():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="debug")

if __name__ == "__main__":
    threading.Thread(target=auto_backup_daemon, daemon=True).start()
    t = threading.Thread(target=run_uvicorn, daemon=True)
    t.start()
    time.sleep(0.8)
    
    if HAS_WEBVIEW:
        webview.create_window(
            title="Mero – Minecraft Hero",
            url="http://127.0.0.1:8000",
            width=1280, height=820,
            min_size=(960, 640),
            background_color="#0d0f13",
        )
        webview.start()
    else:
        print("Starting in headless browser mode. Access at http://127.0.0.1:8000")
        webbrowser.open("http://127.0.0.1:8000")
        while True:
            time.sleep(1)


@app.get("/api/servers/{name}/icon")
def get_server_icon(name: str):
    icon_path = os.path.join(sdir(name), "server-icon.png")
    if os.path.exists(icon_path):
        return FileResponse(icon_path, media_type="image/png")
    # Fall back to the bundled Mero logo
    logo_path = os.path.join(BASE_DIR, "static", "logo.png")
    if os.path.exists(logo_path):
        return FileResponse(logo_path, media_type="image/png")
    raise HTTPException(404, "No icon found")

@app.post("/api/servers/{name}/icon")
async def upload_icon(name: str, file: UploadFile = File(...)):
    sp = sdir(name)
    if not os.path.exists(sp): raise HTTPException(404, "Server not found")
    dest = os.path.join(sp, "server-icon.png")
    data = await file.read()
    # Attempt to resize to 64x64 (required by Minecraft for in-game server list icon)
    try:
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(data)).convert("RGBA")
        img = img.resize((64, 64), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        data = buf.getvalue()
    except Exception:
        pass  # PIL not available or resize failed — save as-is
    with open(dest, "wb") as f:
        f.write(data)
    return {"message": "Icon updated"}

@app.post("/api/servers/{name}/playit/key")
def set_playit_key(name: str, req: PlayitKeyReq):
    sp = sdir(name)
    pdir = os.path.join(sp, ".playit")
    os.makedirs(pdir, exist_ok=True)
    with open(os.path.join(pdir, "playit.toml", encoding="utf-8"), "w") as f:
        f.write(f'secret_key = "{req.key}"\n')
    return {"message": "Playit key saved. Restart server to apply."}
