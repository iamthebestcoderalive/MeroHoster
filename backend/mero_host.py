import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import asyncio
import datetime
import io
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import threading
import time
import traceback
import urllib.request
import webbrowser
import zipfile
from collections import deque
from typing import Dict, List, Optional, Any

import httpx
import nbtlib
import psutil
import uvicorn

CURRENT_VERSION = "v1.0.0"

try:
    import webview

    HAS_WEBVIEW = True
except ImportError:
    HAS_WEBVIEW = False


class JSApi:
    def copy_to_clipboard(self, text):
        logger.info(f"[JSApi] Native copy to clipboard requested for text: {text}")
        
        # Method 1: Ctypes (Native Windows Clipboard API, 64-bit safe)
        try:
            import ctypes
            from ctypes import wintypes
            kernel32 = ctypes.windll.kernel32
            user32 = ctypes.windll.user32

            kernel32.GlobalAlloc.argtypes = [wintypes.UINT, ctypes.c_size_t]
            kernel32.GlobalAlloc.restype = wintypes.HGLOBAL
            kernel32.GlobalLock.argtypes = [wintypes.HGLOBAL]
            kernel32.GlobalLock.restype = ctypes.c_void_p
            kernel32.GlobalUnlock.argtypes = [wintypes.HGLOBAL]
            kernel32.GlobalUnlock.restype = wintypes.BOOL

            user32.OpenClipboard.argtypes = [wintypes.HWND]
            user32.OpenClipboard.restype = wintypes.BOOL
            user32.EmptyClipboard.argtypes = []
            user32.EmptyClipboard.restype = wintypes.BOOL
            user32.SetClipboardData.argtypes = [wintypes.UINT, wintypes.HGLOBAL]
            user32.SetClipboardData.restype = wintypes.HANDLE
            user32.CloseClipboard.argtypes = []
            user32.CloseClipboard.restype = wintypes.BOOL

            msvcrt = ctypes.cdll.msvcrt
            msvcrt.wcscpy.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p]
            msvcrt.wcscpy.restype = ctypes.c_void_p

            if user32.OpenClipboard(None):
                user32.EmptyClipboard()
                alloc_size = (len(text) + 1) * 2
                hCd = kernel32.GlobalAlloc(2, alloc_size) # 2 = GMEM_MOVEABLE
                if hCd:
                    ptr = kernel32.GlobalLock(hCd)
                    if ptr:
                        msvcrt.wcscpy(ptr, text)
                        kernel32.GlobalUnlock(hCd)
                        user32.SetClipboardData(13, hCd) # 13 = CF_UNICODETEXT
                user32.CloseClipboard()
                logger.info("[JSApi] Copied successfully using ctypes.")
                return True
        except Exception as e:
            logger.warning(f"[JSApi] Ctypes copy failed: {e}")

        # Method 2: clip.exe utility
        try:
            subprocess.run("clip", input=text, text=True, shell=True, check=True)
            logger.info("[JSApi] Copied successfully using clip command.")
            return True
        except Exception as e:
            logger.warning(f"[JSApi] clip command copy failed: {e}")

        # Method 3: Tkinter (Last resort fallback)
        try:
            r = tk.Tk()
            r.withdraw()
            r.clipboard_clear()
            r.clipboard_append(text)
            r.update()
            r.destroy()
            logger.info("[JSApi] Copied successfully using Tkinter.")
            return True
        except Exception as e:
            logger.warning(f"[JSApi] Tkinter copy failed: {e}")

        return False



try:
    from PIL import Image
except ImportError:
    Image = None

# pyrefly: ignore [missing-import]
import argparse
import logging
import sys

from fastapi import (
    BackgroundTasks,
    Body,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from mcstatus import JavaServer
from mero_host_net import MeroHost
from pydantic import BaseModel

# --- Logging Setup ---
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug.log")
log_handlers = [
    logging.FileHandler(LOG_FILE, encoding="utf-8"),
    logging.StreamHandler(sys.stdout),
]

# Fix for Windows console emoji encoding
if sys.platform == "win32":
    import io

    sys.stdout.reconfigure(encoding="utf-8")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=log_handlers,
)
logger = logging.getLogger("MeroHost")


class BackupSettingsReq(BaseModel):
    auto_backup: bool
    backup_interval: int
    max_backups: int


class RestoreBackupReq(BaseModel):
    filename: str


# --- Global Manifest Cache for Modrinth API ---
MANIFEST_CACHE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "manifest_cache.json")
manifest_cache = {}
manifest_cache_lock = asyncio.Lock()

def load_manifest_cache():
    global manifest_cache
    if os.path.exists(MANIFEST_CACHE_PATH):
        try:
            with open(MANIFEST_CACHE_PATH, encoding="utf-8") as f:
                manifest_cache = json.load(f)
            logger.info(f"Loaded {len(manifest_cache)} cached hashes from manifest_cache.json")
        except Exception as e:
            logger.error(f"Error loading manifest cache: {e}")
            manifest_cache = {}
    else:
        manifest_cache = {}

def save_manifest_cache():
    try:
        with open(MANIFEST_CACHE_PATH, "w", encoding="utf-8") as f:
            json.dump(manifest_cache, f, indent=2)
    except Exception as e:
        logger.error(f"Error saving manifest cache: {e}")

load_manifest_cache()


# --- Global Window for JS Bridge ---
main_window = None


# --- Zombie Hunting Logic ---
def get_process_by_pid(pid):
    try:
        proc = psutil.Process(pid)
        if proc.is_running() and "java" in proc.name().lower():
            return proc
    except:
        pass
    return None


def check_zombies():
    """Scan all server folders for server.pid and relink processes."""
    if not os.path.exists(SERVERS_DIR):
        return
    for name in os.listdir(SERVERS_DIR):
        pid_file = os.path.join(sdir(name), "server.pid")
        if os.path.exists(pid_file):
            try:
                with open(pid_file, "r") as f:
                    pid = int(f.read().strip())
                proc = get_process_by_pid(pid)
                if proc:
                    logger.info(f"Relinked zombie process {pid} to server {name}")
                    # We can't easily capture stdout of an existing process,
                    # but we can track its lifecycle.
                    server_state[name] = {
                        "phase": "running",
                        "process": proc,
                        "zombie": True,
                    }
                    server_start_ts[name] = proc.create_time()
            except:
                pass


def kill_process_on_port(port):
    for proc in psutil.process_iter(["pid", "name"]):
        try:
            for conns in proc.connections(kind="inet"):
                if conns.laddr.port == port:
                    proc.kill()
                    return True
        except:
            pass
    return False
# ─────────────────────────── App setup ───────────────────────────────────────
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

if getattr(sys, 'frozen', False):
    DATA_DIR = os.path.dirname(sys.executable)
    BUNDLE_DIR = sys._MEIPASS
else:
    DATA_DIR = os.path.dirname(os.path.abspath(__file__))
    BUNDLE_DIR = DATA_DIR

BASE_DIR = BUNDLE_DIR
SERVERS_DIR = os.path.join(DATA_DIR, "servers")
JAVA_DIR = os.path.join(DATA_DIR, "java")
JAVA_EXE = os.path.join(JAVA_DIR, "bin", "java.exe")
VERSIONS_CACHE_DIR = os.path.join(DATA_DIR, "versions")
PLAYIT_EXE = os.path.join(BUNDLE_DIR, "playit.exe")
# pinggy removed
os.makedirs(SERVERS_DIR, exist_ok=True)

# --- Reset Logic ---
parser = argparse.ArgumentParser(description="MeroHost Server Engine")
parser.add_argument("--reset", action="store_true", help="Clear all server meta data")
args = parser.parse_known_args()[0]

if args.reset:
    logger.warning("RESET FLAG DETECTED: Purging all server meta.json files")
    if os.path.exists(SERVERS_DIR):
        for name in os.listdir(SERVERS_DIR):
            meta_path = os.path.join(SERVERS_DIR, name, "meta.json")
            if os.path.exists(meta_path):
                os.remove(meta_path)
                logger.info(f"Purged meta.json for server: {name}")


# ── Startup: clean up orphaned folders from old server versions ───────────────
def _cleanup_server_folders():
    """Remove incorrect mods/plugins folders based on the server type stored in meta.json."""
    if not os.path.exists(SERVERS_DIR):
        return
    for name in os.listdir(SERVERS_DIR):
        sp = os.path.join(SERVERS_DIR, name)
        if not os.path.isdir(sp):
            continue
        meta_path = os.path.join(sp, "meta.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            stype = meta.get("type", "vanilla").lower()
            plugin_types = {"paper", "purpur", "spigot", "bukkit"}
            mod_types = {"fabric", "forge"}
            # Remove plugins/ from mod-only servers
            if stype in mod_types:
                bad = os.path.join(sp, "plugins")
                if os.path.isdir(bad) and not os.listdir(bad):
                    os.rmdir(bad)
            # Remove mods/ from plugin-only servers
            if stype in plugin_types:
                bad = os.path.join(sp, "mods")
                if os.path.isdir(bad) and not os.listdir(bad):
                    os.rmdir(bad)
        except Exception:
            pass


_cleanup_server_folders()

# In-memory state
# server_state[name] = { "process": Popen|None, "phase": "stopped"|"starting"|"running" }
server_state = {}
playit_procs = {}
playit_info = {}
mero_p2p_hosts: Dict[str, MeroHost] = {}
mero_p2p_info = {}
server_logs = {}  # name -> deque
server_start_ts = {}
install_progress = {}  # format: { name: { project_id: { "downloaded": 0, "total": 0, "status": "downloading" } } }
disk_cache = {}  # name -> (timestamp, bytes, is_calculating)  — cached every 60s bg


# ─────────────────────────── Helpers ─────────────────────────────────────────
def sdir(name):
    return os.path.join(SERVERS_DIR, name)


CONSOLE_FILTERS = [
    re.compile(r"Mismatch in destroy block pos", re.IGNORECASE),
    re.compile(r"class_2338", re.IGNORECASE),
]


def log(name, msg):
    # Silently drop noisy/spammy Minecraft log lines
    for pat in CONSOLE_FILTERS:
        if pat.search(msg):
            return
    server_logs.setdefault(name, deque(maxlen=500))
    server_logs[name].append(msg)
    logger.info(f"[{name}] {msg}")


def get_port(server_path):
    p = os.path.join(server_path, "server.properties")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.startswith("server-port="):
                    return int(line.split("=")[1].strip())
    return 25565


def capture(proc, name, conn_method="playit"):
    _done_logged = False

    def tail_log_file():
        log_path = os.path.join(sdir(name), "logs", "latest.log")
        for _ in range(60):
            if os.path.exists(log_path):
                break
            import time
            time.sleep(0.5)
        if not os.path.exists(log_path):
            return
            
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            while proc.poll() is None:
                line = f.readline()
                if not line:
                    import time
                    time.sleep(0.1)
                    continue
                stripped = line.rstrip()
                if stripped:
                    log(name, stripped)
                    
                    nonlocal _done_logged
                    if (
                        'For help, type "help"' in stripped or "Done (" in stripped
                    ) and not _done_logged:
                        _done_logged = True
                        
                        def update_manifest_status_sync(server_name: str, status: str):
                            import requests
                            try:
                                meta_path = os.path.join(sdir(server_name), "meta.json")
                                if not os.path.exists(meta_path):
                                    return
                                with open(meta_path, "r", encoding="utf-8") as f:
                                    meta = json.load(f)
                                m_url = meta.get("manifest_url", "")
                                if "kvdb.io" in m_url:
                                    r = requests.get(m_url, timeout=5)
                                    if r.status_code == 200:
                                        data = r.json()
                                        data["server_status"] = status
                                        requests.post(m_url, json=data, timeout=5)
                            except Exception as e:
                                logger.error(f"Failed to update manifest status: {e}")

                        import threading
                        threading.Thread(
                            target=update_manifest_status_sync,
                            args=(name, "online"),
                            daemon=True,
                        ).start()

                        if conn_method == "playit":
                            pdir = os.path.join(sdir(name), ".playit")
                            os.makedirs(pdir, exist_ok=True)
                            pp = subprocess.Popen(
                                [PLAYIT_EXE, "start"],
                                cwd=pdir,
                                stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT,
                                text=True,
                                bufsize=1,
                                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0,
                            )
                            playit_procs[name] = pp
                            threading.Thread(target=read_playit, args=(pp, name), daemon=True).start()
                        elif conn_method == "mero-p2p":
                            port = get_port(sdir(name))
                            host = MeroHost(local_port=port)
                            try:
                                with open(os.path.join(sdir(name), "meta.json"), "r", encoding="utf-8") as f:
                                    meta = json.load(f)
                                    host.server_name = meta.get("display_name", meta.get("server_name", name))
                            except:
                                host.server_name = name
                            host.get_status = lambda: server_state.get(name, {}).get("phase", "running")
                            mero_p2p_hosts[name] = host
                            threading.Thread(target=run_mero_p2p, args=(host, name), daemon=True).start()

                        def log_ips():
                            port = get_port(sdir(name))
                            log(name, f"[Mero] 🏠 Local IP: {get_local_ip()}:{port}")
                            log(name, f"[Mero] 🌍 Public IP: {get_public_ip()}:{port}")

                            for _ in range(20):
                                if playit_info.get(name, {}).get("public_ip", ""):
                                    break
                                import time
                                time.sleep(1)

                            playit_ip = playit_info.get(name, {}).get("public_ip", "")
                            if playit_ip:
                                log(name, f"[Mero] 🌍 Playit Public IP: {playit_ip}")

                        threading.Thread(target=log_ips, daemon=True).start()

    import threading
    threading.Thread(target=tail_log_file, daemon=True).start()

    try:
        import re
        log4j_pattern = re.compile(r'^\[\d{2}:\d{2}:\d{2}\] \[[^\]]+\]:')
        for line in iter(proc.stdout.readline, ""):
            if line:
                stripped = line.rstrip()
                # If it's a standard log line, let the tail_log_file thread handle it
                if not log4j_pattern.match(stripped):
                    log(name, stripped)
                    
                # We also need to check here in case it's not logged to latest.log or the tailer misses it
                if (
                    'For help, type "help"' in stripped or "Done (" in stripped
                ) and not _done_logged:
                    _done_logged = True

                    def update_manifest_status_sync(server_name: str, status: str):
                        import requests

                        try:
                            meta_path = os.path.join(sdir(server_name), "meta.json")
                            if not os.path.exists(meta_path):
                                return
                            with open(meta_path, "r", encoding="utf-8") as f:
                                meta = json.load(f)
                            m_url = meta.get("manifest_url", "")
                            if "kvdb.io" in m_url:
                                r = requests.get(m_url, timeout=5)
                                if r.status_code == 200:
                                    data = r.json()
                                    data["server_status"] = status
                                    requests.post(m_url, json=data, timeout=5)
                        except Exception as e:
                            logger.error(f"Failed to update manifest status: {e}")

                    import threading

                    threading.Thread(
                        target=update_manifest_status_sync,
                        args=(name, "online"),
                        daemon=True,
                    ).start()

                    if conn_method == "playit":
                        pdir = os.path.join(sdir(name), ".playit")
                        os.makedirs(pdir, exist_ok=True)
                        pp = subprocess.Popen(
                            [PLAYIT_EXE, "start"],
                            cwd=pdir,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT,
                            text=True,
                            bufsize=1,
                            creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0,
                        )
                        playit_procs[name] = pp
                        threading.Thread(target=read_playit, args=(pp, name), daemon=True).start()
                    elif conn_method == "mero-p2p":
                        port = get_port(sdir(name))
                        host = MeroHost(local_port=port)
                        try:
                            with open(os.path.join(sdir(name), "meta.json"), "r", encoding="utf-8") as f:
                                meta = json.load(f)
                                host.server_name = meta.get("display_name", meta.get("server_name", name))
                        except:
                            host.server_name = name
                        host.get_status = lambda: server_state.get(name, {}).get("phase", "running")
                        mero_p2p_hosts[name] = host
                        threading.Thread(target=run_mero_p2p, args=(host, name), daemon=True).start()

                    def log_ips():
                        port = get_port(sdir(name))
                        log(name, f"[Mero] 🏠 Local IP: {get_local_ip()}:{port}")
                        log(name, f"[Mero] 🌍 Public IP: {get_public_ip()}:{port}")

                        for _ in range(20):
                            if playit_info.get(name, {}).get("public_ip", ""):
                                break
                            time.sleep(1)

                        playit_ip = playit_info.get(name, {}).get("public_ip", "")
                        if playit_ip:
                            log(name, f"[Mero] 🌍 Playit Public IP: {playit_ip}")

                    threading.Thread(target=log_ips, daemon=True).start()
    except Exception:
        pass
    # Mark server as stopped when process ends (handles both "running" and "starting" phases)
    phase = server_state.get(name, {}).get("phase")
    if phase in ("running", "starting"):
        server_state[name]["phase"] = "stopped"
        log(name, "[Mero] ⚠️ Server process exited.")
        
        # --- Push offline status to signaling bucket ---
        try:
            meta_path = os.path.join(sdir(name), "meta.json")
            if os.path.exists(meta_path):
                import json, requests
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                signal_bucket = meta.get("signal_bucket")
                if signal_bucket:
                    requests.put(signal_bucket, json={"status": "offline"}, headers={"Accept": "application/json", "Content-Type": "application/json"}, timeout=5)
        except Exception as e:
            logger.error(f"Failed to push offline status: {e}")

    # Restore AutoModpack mod (rename .jar.disabled to .jar) on server exit
    try:
        server_path = sdir(name)
        mods_dir = os.path.join(server_path, "mods")
        if os.path.isdir(mods_dir):
            for fn in os.listdir(mods_dir):
                if fn.lower().startswith("automodpack") and fn.lower().endswith(".jar.disabled"):
                    old_path = os.path.join(mods_dir, fn)
                    new_path = os.path.join(mods_dir, fn[:-9])
                    log(name, f"[Mero] 📦 Restoring AutoModpack: {fn} -> {fn[:-9]}")
                    try:
                        if os.path.exists(new_path):
                            os.remove(new_path)
                        os.rename(old_path, new_path)
                    except Exception as e:
                        log(name, f"[Mero] ⚠️ Failed to restore AutoModpack {fn}: {e}")
    except Exception as e:
        logger.error(f"Error restoring AutoModpack in capture exit: {e}")




def run_mero_p2p(host, name):
    try:

        def mero_logger(msg):
            log(name, msg)

        host.logger = mero_logger
        if host.start():
            import base64
            import requests

            m_url = ""
            meta = {}
            meta_path = os.path.join(sdir(name), "meta.json")
            if os.path.exists(meta_path):
                try:
                    with open(meta_path, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    m_url = meta.get("manifest_url", "")
                except Exception:
                    pass

            # --- SIGNALING BUCKET LOGIC ---
            signal_bucket = meta.get("signal_bucket")
            if not signal_bucket:
                try:
                    r = requests.post("https://jsonblob.com/api/jsonBlob", json={"status": "init"}, headers={"Accept": "application/json"}, timeout=10)
                    if r.status_code in (200, 201):
                        signal_bucket = "https://jsonblob.com" + r.headers.get("Location", "")
                        meta["signal_bucket"] = signal_bucket
                        with open(meta_path, "w", encoding="utf-8") as f:
                            json.dump(meta, f, indent=4)
                except Exception as e:
                    log(name, f"[Mero] ⚠️ Failed to create Signal Bucket: {e}")

            payload = {
                "ip": host.public_ip,
                "udp_port": host.public_port,
                "mc_port": host.local_port,
                "manifest_url": m_url,
                "status": "online"
            }
            host.manifest_url = m_url
            
            import secrets, hashlib
            enc_key = secrets.token_hex(8)
            payload_bytes = json.dumps(payload).encode('utf-8')
            stream = b""
            i = 0
            while len(stream) < len(payload_bytes):
                stream += hashlib.sha256((enc_key + str(i)).encode()).digest()
                i += 1
            enc_payload = bytes(a ^ b for a, b in zip(payload_bytes, stream)).hex()

            if signal_bucket:
                try:
                    requests.put(signal_bucket, json={"e": enc_payload}, headers={"Accept": "application/json", "Content-Type": "application/json"}, timeout=10)
                    invite_b64 = base64.b64encode(f"{signal_bucket}|{enc_key}".encode()).decode()
                except Exception as e:
                    log(name, f"[Mero] ⚠️ Signal Post Failed: {e}")
                    invite_b64 = base64.b64encode(f"|{enc_key}|{enc_payload}".encode()).decode()
            else:
                invite_b64 = base64.b64encode(f"|{enc_key}|{enc_payload}".encode()).decode()

            host.invite_code = "MERO-" + invite_b64
            mero_p2p_info[name] = {"invite_code": host.invite_code}
            log(name, f"[Mero] 🌍 P2P Invite Code: {host.invite_code}")
        else:
            log(name, "[Mero] ❌ Failed to start P2P Host Engine.")
    except Exception as e:
        log(name, f"[Mero] ❌ P2P Error: {e}")


def read_playit(proc, name):
    playit_info.setdefault(name, {"claim_url": "", "public_ip": ""})
    # Heavy-duty regex to strip all Playit UI codes (like [2J and 8)
    ansi_escape = re.compile(r"\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])|\r")
    _last_logged_line = None
    try:
        for line in iter(proc.stdout.readline, ""):
            line = ansi_escape.sub("", line).strip()
            if not line:
                continue

            lower = line.lower()
            if "failed to load latest tunnels" in lower or "got error" in lower:
                continue

            # 1. Catch the Claim URL
            m = re.search(r"(https://playit\.gg/claim/[a-zA-Z0-9]+)", line)
            if m:
                playit_info[name]["claim_url"] = m.group(1)
                continue

            # 2. Catch the Public IP (Supports .playit.gg and .joinmc.link)
            m2 = re.search(r"([a-zA-Z0-9.-]+\.(?:playit\.gg|joinmc\.link))", line)
            if m2 and "playit.gg/claim" not in m2.group(1):
                playit_info[name]["public_ip"] = m2.group(1)
                continue

            # 3. BLOCK THE SPAM
            if "tunnel running" in lower and "tunnels registered" in lower:
                continue  # Silently skip the repeating status logs

            # 4. Log everything else cleanly
            if line == _last_logged_line:
                continue

            if any(
                kw in lower
                for kw in (
                    "error",
                    "warn",
                    "connected",
                    "tunnel",
                    "agent",
                    "started",
                    "failed",
                    "running",
                    "listening",
                )
            ):
                log(name, "[Playit] " + line)
                _last_logged_line = line
    except Exception:
        pass


# ─────────────────────────── Installation (sync, runs in thread) ─────────────
def _download_jar(name, req_type, req_version, jar_path, server_path):
    """Synchronous jar download using httpx - safe to call from a thread."""
    os.makedirs(VERSIONS_CACHE_DIR, exist_ok=True)
    is_single_jar = req_type in ["paper", "purpur", "fabric"]
    cached_jar_path = os.path.join(VERSIONS_CACHE_DIR, f"{req_type}-{req_version}.jar")

    if is_single_jar and os.path.exists(cached_jar_path):
        log(name, f"[Mero] 📦 Found cached {req_type} {req_version}, skipping download...")
        os.makedirs(os.path.dirname(jar_path), exist_ok=True)
        shutil.copy(cached_jar_path, jar_path)
        return

    with httpx.Client(timeout=600, follow_redirects=True) as client:
        if req_type == "paper":
            log(name, f"[Mero] 🔍 Fetching latest Paper build for {req_version}…")
            r = client.get(
                f"https://api.papermc.io/v2/projects/paper/versions/{req_version}/builds"
            )
            r.raise_for_status()
            build = r.json()["builds"][-1]["build"]
            url = (
                f"https://api.papermc.io/v2/projects/paper/versions/{req_version}"
                f"/builds/{build}/downloads/paper-{req_version}-{build}.jar"
            )
            log(name, f"[Mero] ⬇  Downloading Paper {req_version} build #{build}…")
            data = client.get(url).raise_for_status().content
            with open(cached_jar_path, "wb") as f:
                f.write(data)
            os.makedirs(os.path.dirname(jar_path), exist_ok=True)
            shutil.copy(cached_jar_path, jar_path)

        elif req_type == "purpur":
            log(name, f"[Mero] 🔍 Fetching latest Purpur build for {req_version}…")
            r = client.get(f"https://api.purpurmc.org/v2/purpur/{req_version}")
            r.raise_for_status()
            build = r.json()["builds"]["latest"]
            url = f"https://api.purpurmc.org/v2/purpur/{req_version}/{build}/download"
            log(name, f"[Mero] ⬇  Downloading Purpur {req_version} build #{build}…")
            data = client.get(url).raise_for_status().content
            with open(cached_jar_path, "wb") as f:
                f.write(data)
            os.makedirs(os.path.dirname(jar_path), exist_ok=True)
            shutil.copy(cached_jar_path, jar_path)

        elif req_type == "fabric":
            # Fetch latest stable loader + installer versions dynamically
            loaders = (
                client.get("https://meta.fabricmc.net/v2/versions/loader")
                .raise_for_status()
                .json()
            )
            installers = (
                client.get("https://meta.fabricmc.net/v2/versions/installer")
                .raise_for_status()
                .json()
            )
            loader_ver = next(x for x in loaders if x["stable"])["version"]
            installer_ver = next(x for x in installers if x["stable"])["version"]
            url = (
                f"https://meta.fabricmc.net/v2/versions/loader"
                f"/{req_version}/{loader_ver}/{installer_ver}/server/jar"
            )
            log(
                name,
                f"[Mero] ⬇  Downloading Fabric {req_version} (loader {loader_ver})…",
            )
            data = client.get(url).raise_for_status().content
            with open(cached_jar_path, "wb") as f:
                f.write(data)
            os.makedirs(os.path.dirname(jar_path), exist_ok=True)
            shutil.copy(cached_jar_path, jar_path)

        elif req_type == "forge":
            log(name, "[Mero] 🔍 Fetching Forge version list…")
            r = client.get(
                "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
            )
            r.raise_for_status()
            promos = r.json()["promos"]
            build = promos.get(f"{req_version}-recommended") or promos.get(
                f"{req_version}-latest"
            )
            if not build:
                raise RuntimeError(f"No Forge build found for Minecraft {req_version}")
            forge_ver = f"{req_version}-{build}"
            inst_url = (
                f"https://maven.minecraftforge.net/net/minecraftforge/forge"
                f"/{forge_ver}/forge-{forge_ver}-installer.jar"
            )
            inst_path = os.path.join(server_path, "forge-installer.jar")
            log(name, f"[Mero] ⬇  Downloading Forge {forge_ver} installer…")
            data = client.get(inst_url).raise_for_status().content
            with open(inst_path, "wb") as f:
                f.write(data)

            log(
                name, "[Mero] ⚙  Running Forge installer (this may take a few minutes)…"
            )
            proc = subprocess.Popen(
                [JAVA_EXE, "-jar", "forge-installer.jar", "--installServer"],
                cwd=server_path,  # Forge installs relative to cwd
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
            )
            for line in iter(proc.stdout.readline, ""):
                if line:
                    log(name, line.rstrip())
            proc.wait()
            if os.path.exists(inst_path):
                os.remove(inst_path)
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
    zip_path = os.path.join(DATA_DIR, "jre.zip")
    try:
        with httpx.Client(timeout=60, follow_redirects=True) as client:
            # Step 1: Ask Adoptium API for the actual download link
            api = (
                "https://api.adoptium.net/v3/assets/latest/21/hotspot"
                "?architecture=x64&image_type=jre&os=windows&vendor=eclipse"
            )
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
        dirs = [
            d for d in os.listdir(JAVA_DIR) if os.path.isdir(os.path.join(JAVA_DIR, d))
        ]
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

    state = server_state[name]  # already set by the endpoint
    server_logs.setdefault(name, deque(maxlen=500))

    try:
        _boot_server_inner(name, state)
    except Exception as e:
        tb = traceback.format_exc()
        log(name, f"[Mero] ❌ FATAL CRASH in boot thread:\n{tb}")
        state["phase"] = "stopped"


def _boot_server_inner(name: str, state: dict):
    server_path = sdir(name)
    bin_path = os.path.join(server_path, "bin")
    meta_path = os.path.join(server_path, "meta.json")
    jar_path = os.path.join(bin_path, "server.jar")

    log(name, "[Mero] 🚀 Deployment sequence started...")

    # 1. Environment
    msg1 = "Preparing Environment & EULA..."
    log(name, f"[Mero] Step 1/3: {msg1}")
    if main_window:
        main_window.evaluate_js(f'updateDeploymentStep(1, "{msg1}")')

    if not _ensure_java_thread(name):
        state["phase"] = "stopped"
        if main_window:
            main_window.evaluate_js(
                'updateDeploymentStep(1, "❌ Java Install Failed", true)'
            )
        return

    # 2. Engine & Bin Routing
    msg2 = "Deploying Engine & Directories..."
    log(name, f"[Mero] Step 2/3: {msg2}")
    if main_window:
        main_window.evaluate_js(f'updateDeploymentStep(2, "{msg2}")')

    with open(meta_path, encoding="utf-8") as f:
        meta = json.load(f)
    req_type, req_version = meta["type"], meta["version"]

    # Migration for modern Forge files from bin/ to root server_path
    if os.path.exists(bin_path):
        has_bin_run = os.path.exists(os.path.join(bin_path, "run.bat")) or os.path.exists(os.path.join(bin_path, "run.sh"))
        if has_bin_run:
            log(name, "[Mero] 📦 Migrating modern Forge files from bin/ to server root…")
            for item in os.listdir(bin_path):
                src = os.path.join(bin_path, item)
                dst = os.path.join(server_path, item)
                try:
                    if os.path.exists(dst):
                        if os.path.isdir(dst):
                            shutil.rmtree(dst)
                        else:
                            os.remove(dst)
                    shutil.move(src, dst)
                except Exception as ex:
                    log(name, f"[Mero] ⚠️ Migration warning for {item}: {ex}")

    has_jar = os.path.exists(jar_path)
    has_forge = False
    if req_type == "forge":
        has_modern_forge = os.path.exists(os.path.join(server_path, "run.bat")) or os.path.exists(os.path.join(server_path, "run.sh"))
        has_legacy_forge_bin = any(
            fn.endswith(".jar") and "installer" not in fn for fn in (os.listdir(bin_path) if os.path.exists(bin_path) else [])
        )
        has_legacy_forge_root = any(
            fn.startswith("forge-") and fn.endswith(".jar") and "installer" not in fn for fn in os.listdir(server_path)
        )
        has_forge = has_modern_forge or has_legacy_forge_bin or has_legacy_forge_root
    else:
        has_forge = any(
            fn.endswith(".jar") and "installer" not in fn for fn in (os.listdir(bin_path) if os.path.exists(bin_path) else [])
        )

    if not (has_jar or has_forge):
        try:
            install_dir = server_path if req_type == "forge" else bin_path
            _download_jar(name, req_type, req_version, jar_path, install_dir)
        except Exception as e:
            log(name, f"[Mero] ❌ Deployment failed: {e}")
            state["phase"] = "stopped"
            if main_window:
                main_window.evaluate_js(
                    f'updateDeploymentStep(2, "❌ Engine Download Failed: {str(e)}", true)'
                )
            return

    # 3. Tunneling & Execution
    conn_method = meta.get("connection-method", "playit")
    tunnel_text = (
        "Binding Playit.gg Tunnel Agent..."
        if conn_method == "playit"
        else "Configuring Mero P2P Encrypted Uplink..."
    )
    log(name, f"[Mero] Step 3/3: {tunnel_text}")
    if main_window:
        main_window.evaluate_js(f'updateDeploymentStep(3, "{tunnel_text}")')

    # Dynamically configure AutoModpack based on connection method (disabled on Mero P2P and local)
    disable_automodpack = (conn_method in ["mero-p2p", "local"])
    for config_dir in ["automodpack", os.path.join("config", "automodpack")]:
        full_dir = os.path.join(server_path, config_dir)
        try:
            os.makedirs(full_dir, exist_ok=True)
            config_file = os.path.join(full_dir, "automodpack-server.json")
            config_data = {}
            if os.path.exists(config_file):
                try:
                    with open(config_file, "r", encoding="utf-8") as f:
                        config_data = json.load(f)
                except Exception:
                    pass
            
            config_data["modpackHost"] = not disable_automodpack
            config_data["generateModpackOnStart"] = not disable_automodpack
            config_data["requireAutoModpackOnClient"] = False
            
            with open(config_file, "w", encoding="utf-8") as f:
                json.dump(config_data, f, indent=2)
        except Exception as e:
            log(name, f"[Mero] ⚠️ Warning: Failed to configure AutoModpack: {e}")

    # Rename server-side automodpack mod files based on connection method
    try:
        mods_dir = os.path.join(server_path, "mods")
        if os.path.isdir(mods_dir):
            for fn in os.listdir(mods_dir):
                if fn.lower().startswith("automodpack"):
                    if disable_automodpack and fn.lower().endswith(".jar"):
                        old_path = os.path.join(mods_dir, fn)
                        new_path = os.path.join(mods_dir, fn + ".disabled")
                        log(name, f"[Mero] 📦 Disabling AutoModpack mod: {fn} -> {fn}.disabled")
                        try:
                            if os.path.exists(new_path):
                                os.remove(new_path)
                            os.rename(old_path, new_path)
                        except Exception as e:
                            log(name, f"[Mero] ⚠️ Failed to disable AutoModpack: {e}")
                    elif not disable_automodpack and fn.lower().endswith(".jar.disabled"):
                        old_path = os.path.join(mods_dir, fn)
                        new_path = os.path.join(mods_dir, fn[:-9])
                        log(name, f"[Mero] 📦 Re-enabling AutoModpack mod: {fn} -> {fn[:-9]}")
                        try:
                            if os.path.exists(new_path):
                                os.remove(new_path)
                            os.rename(old_path, new_path)
                        except Exception as e:
                            log(name, f"[Mero] ⚠️ Failed to re-enable AutoModpack: {e}")
    except Exception as e:
        log(name, f"[Mero] ⚠️ Warning: Error scanning mods directory: {e}")

    port = get_port(server_path)
    kill_process_on_port(port)  # Proactive clear

    target = "server.jar"
    if os.path.exists(bin_path):
        for fn in os.listdir(bin_path):
            if fn.endswith(".jar") and "installer" not in fn:
                target = os.path.join("bin", fn)
                break

    ram_gb = meta.get("ram", 4)

    # ── Forge modern launch detection ──────────────────────────────────────────
    # Modern Forge (1.17+) generates run.bat / run.sh + user_jvm_args.txt
    # instead of a standalone jar. We detect this and build the proper command.
    run_bat = os.path.join(server_path, "run.bat")
    run_sh  = os.path.join(server_path, "run.sh")
    user_jvm_path = os.path.join(server_path, "user_jvm_args.txt")

    def _forge_modern_cmd():
        """Return (cmd, cwd) for a modern Forge install, or None if not detected."""
        script = run_bat if os.name == "nt" else run_sh
        if not os.path.exists(script):
            return None
        # Inject RAM into user_jvm_args.txt
        if os.path.exists(user_jvm_path):
            with open(user_jvm_path, "r", encoding="utf-8") as _f:
                jvm_content = _f.read()
            # Remove any existing Xmx/Xms lines
            jvm_lines = [
                l for l in jvm_content.splitlines()
                if not l.strip().startswith("-Xm")
            ]
            jvm_lines.append(f"-Xms{ram_gb}G")
            jvm_lines.append(f"-Xmx{ram_gb}G")
            with open(user_jvm_path, "w", encoding="utf-8") as _f:
                _f.write("\n".join(jvm_lines) + "\n")
        # Parse args file from run.bat: look for @libraries/...win_args.txt or unix_args.txt
        with open(run_bat if os.path.exists(run_bat) else run_sh, "r", encoding="utf-8") as _f:
            bat_content = _f.read()
        import re as _re
        # Match @libraries/.../win_args.txt or unix_args.txt
        m = _re.search(r'@(libraries/[^\s]+(?:win|unix)_args\.txt)', bat_content)
        if not m:
            return None
        args_file = m.group(1)
        cmd = [
            JAVA_EXE,
            "@user_jvm_args.txt",
            f"@{args_file}",
            "nogui",
        ]
        return (cmd, server_path)

    forge_launch = _forge_modern_cmd() if req_type == "forge" else None

    if forge_launch:
        cmd, launch_cwd = forge_launch
        log(name, f"[Mero] 🚀 Launching Forge (modern @args mode) from {launch_cwd}")
    else:
        # Vanilla / Paper / Fabric / legacy Forge: find the jar
        target = "server.jar"
        if os.path.exists(bin_path):
            for fn in os.listdir(bin_path):
                if fn.endswith(".jar") and "installer" not in fn:
                    target = os.path.join("bin", fn)
                    break
        # Fallback to search server root for legacy forge jar if not found in bin
        if target == "server.jar":
            for fn in os.listdir(server_path):
                if fn.startswith("forge-") and fn.endswith(".jar") and "installer" not in fn:
                    target = fn
                    break
        cmd = [JAVA_EXE, f"-Xms{ram_gb}G", f"-Xmx{ram_gb}G", "-jar", target, "nogui"]
        launch_cwd = server_path

    log_path = os.path.join(server_path, "logs", "latest.log")
    if os.path.exists(log_path):
        try:
            with open(log_path, "w") as f:
                f.truncate(0)
        except Exception:
            pass

    mc = subprocess.Popen(
        cmd,
        cwd=launch_cwd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=subprocess.CREATE_NO_WINDOW if hasattr(subprocess, 'CREATE_NO_WINDOW') else 0
    )
    state["process"] = mc
    state["phase"] = "running"
    server_start_ts[name] = time.time()

    with open(os.path.join(server_path, "server.pid"), "w") as f:
        f.write(str(mc.pid))

    threading.Thread(target=capture, args=(mc, name, conn_method), daemon=True).start()


    # Final check for "Online" status is handled by capture() which can also signal JS
    if main_window:
        main_window.evaluate_js(
            'updateDeploymentStep(4, "Deployment Complete! Server is LIVE.")'
        )


# ─────────────────────────── API: servers ────────────────────────────────────
class ServerCreate(BaseModel):
    name: str
    type: str
    version: str
    description: str = ""
    network_service: str = "playit"  # playit or mero-p2p
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
    player: str = ""  # if set, prefix as <player>


class FileContentReq(BaseModel):
    path: str
    content: str


class PlayitKeyReq(BaseModel):
    key: str


@app.post("/api/servers")
def create_server(req: ServerCreate, background_tasks: BackgroundTasks):
    safe_name = re.sub(r"§[0-9a-fk-or]", "", req.name, flags=re.IGNORECASE)
    safe_name = re.sub(r'[<>:"/\\|?*!]', "", safe_name).strip()
    if not safe_name:
        raise HTTPException(400, "Invalid server name (too few safe characters)")

    sp = sdir(safe_name)
    if os.path.exists(sp):
        raise HTTPException(400, "Server already exists")

    # 1. Smart Folder Architecture & Clean Engine
    os.makedirs(sp)
    os.makedirs(os.path.join(sp, "bin"), exist_ok=True)

    stype = req.type.lower()
    if stype in ["fabric", "forge", "neoforge"]:
        os.makedirs(os.path.join(sp, "mods"), exist_ok=True)
        os.makedirs(os.path.join(sp, "resourcepacks"), exist_ok=True)
        os.makedirs(os.path.join(sp, "shaderpacks"), exist_ok=True)
    elif stype in ["paper", "purpur", "spigot", "bukkit"]:
        os.makedirs(os.path.join(sp, "plugins"), exist_ok=True)

    # 2. Automated First-Boot (EULA Cheat)
    with open(os.path.join(sp, "eula.txt"), "w", encoding="utf-8") as f:
        f.write("eula=true\n")

    # 3. Pre-filled Properties
    motd = req.description if req.description.strip() else "A Mero Sanctuary"
    with open(os.path.join(sp, "server.properties"), "w", encoding="utf-8") as f:
        f.write(f"online-mode=false\nmotd={motd}\nserver-port=25565\n")

    meta_data = {
        "display_name": req.name,
        "version": req.version,
        "type": req.type,
        "ram": req.ram,
        "software": stype,
        "installed_files": [],
        "connection-method": req.network_service,
    }
    with open(os.path.join(sp, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta_data, f)

    # Auto-install AutoModpack on Fabric
    if stype == "fabric":
        # k68glP2e is the Modrinth ID for AutoModpack
        install_req = InstallReq(
            project_id="k68glP2e",
            project_type="mod",
            title="AutoModpack",
            icon_url="https://cdn.modrinth.com/data/k68glP2e/a62ab7ad159491ebfbcdb8e8f23f37ab28ff11e8.png",
        )

        async def do_install():
            async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
                await resolve_and_download(
                    safe_name, install_req, background_tasks, c, meta_data
                )

        background_tasks.add_task(lambda: asyncio.run(do_install()))

    return {"message": "Created"}


_cached_local_ip = None
_cached_public_ip = None
_system_specs_cache = None


def get_local_ip():
    global _cached_local_ip
    if _cached_local_ip:
        return _cached_local_ip
    # Try connecting to external IP first
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip != "127.0.0.1":
            _cached_local_ip = ip
            return ip
    except Exception:
        pass

    # Try local subnet routing dummy call
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.2)
        s.connect(("10.255.255.255", 1))
        ip = s.getsockname()[0]
        s.close()
        if ip and ip != "127.0.0.1":
            _cached_local_ip = ip
            return ip
    except Exception:
        pass

    # Query socket.gethostbyname_ex to enumerate interface IPs
    try:
        hostname = socket.gethostname()
        ips = socket.gethostbyname_ex(hostname)[2]
        for ip in ips:
            if ip != "127.0.0.1" and not ip.startswith("169.254."):
                _cached_local_ip = ip
                return ip
    except Exception:
        pass

    # Fallback to standard socket.gethostbyname
    try:
        ip = socket.gethostbyname(socket.gethostname())
        if ip and ip != "127.0.0.1":
            _cached_local_ip = ip
            return ip
    except Exception:
        pass

    return "127.0.0.1"


def get_public_ip():
    global _cached_public_ip
    if _cached_public_ip:
        return _cached_public_ip
    try:
        req = urllib.request.Request(
            "https://api.ipify.org", headers={"User-Agent": "Mozilla/5.0"}
        )
        ip = urllib.request.urlopen(req, timeout=3).read().decode("utf8").strip()
        _cached_public_ip = ip
        return ip
    except Exception:
        return "Unknown"


def _fetch_system_specs_bg():
    global _system_specs_cache
    ram_gb = round(psutil.virtual_memory().total / (1024**3))

    manufacturer = "Local"
    model = "Device"
    cpu = "Unknown CPU"
    disk_type = "Local Storage"

    # 1. Try Windows Registry (instant lookup <1ms)
    if os.name == "nt":
        try:
            import winreg
            def get_reg_val(path, name):
                try:
                    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, path) as k:
                        return winreg.QueryValueEx(k, name)[0]
                except Exception:
                    return None

            mfg = get_reg_val(r"HARDWARE\DESCRIPTION\System\BIOS", "SystemManufacturer")
            mdl = get_reg_val(r"HARDWARE\DESCRIPTION\System\BIOS", "SystemProductName")
            cpu_name = get_reg_val(r"HARDWARE\DESCRIPTION\System\CentralProcessor\0", "ProcessorNameString")

            if mfg:
                manufacturer = mfg.strip()
            if mdl:
                model = mdl.strip()
            if cpu_name:
                cpu = cpu_name.strip()
        except Exception as e:
            logger.error(f"Registry spec retrieval failed: {e}")

    # 2. Try PowerShell fallback inside background thread only if registry failed or is empty
    try:
        if os.name == "nt":
            import subprocess
            if manufacturer == "Local" or model == "Device":
                try:
                    out = subprocess.check_output(
                        [
                            "powershell",
                            "-NoProfile",
                            "-Command",
                            "(Get-CimInstance Win32_ComputerSystem).Manufacturer + '||' + (Get-CimInstance Win32_ComputerSystem).Model",
                        ],
                        text=True,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        timeout=5,
                    ).strip()
                    if "||" in out:
                        m, md = out.split("||", 1)
                        if manufacturer == "Local" and m:
                            manufacturer = m
                        if model == "Device" and md:
                            model = md
                except Exception:
                    pass

            if cpu == "Unknown CPU":
                try:
                    c = subprocess.check_output(
                        [
                            "powershell",
                            "-NoProfile",
                            "-Command",
                            "(Get-CimInstance Win32_Processor).Name",
                        ],
                        text=True,
                        creationflags=subprocess.CREATE_NO_WINDOW,
                        timeout=5,
                    ).strip()
                    if c:
                        cpu = c
                except Exception:
                    pass

            # Disk type query is always run via powershell once in background
            try:
                disk_out = subprocess.check_output(
                    [
                        "powershell",
                        "-NoProfile",
                        "-Command",
                        "(Get-PhysicalDisk | Select-Object -First 1).MediaType",
                    ],
                    text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW,
                    timeout=5,
                ).strip()
                if disk_out:
                    disk_type = (
                        "SSD"
                        if "SSD" in disk_out.upper() or disk_out == "4"
                        else "HDD"
                        if disk_out == "3"
                        else disk_out
                    )
            except Exception:
                pass
    except Exception as e:
        logger.error(f"PowerShell fallback failed: {e}")

    _system_specs_cache = {
        "total_ram_gb": ram_gb,
        "manufacturer": manufacturer[:2].upper() if manufacturer else "PC",
        "model": model,
        "cpu": cpu,
        "disk": disk_type,
    }
    logger.info(f"System specs cached: {_system_specs_cache}")


@app.get("/api/system_specs")
def get_system_specs():
    global _system_specs_cache
    if _system_specs_cache:
        return _system_specs_cache

    ram_gb = round(psutil.virtual_memory().total / (1024**3))
    return {
        "total_ram_gb": ram_gb,
        "manufacturer": "PC",
        "model": "Device",
        "cpu": "Loading...",
        "disk": "Loading...",
    }


@app.get("/api/update/check")
async def check_update():
    try:
        async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
            r = await c.get("https://api.github.com/repos/iamthebestcoderalive/MeroHoster/releases/latest")
            if r.status_code == 200:
                data = r.json()
                latest_version = data.get("tag_name", CURRENT_VERSION)
                # Normalize versions for comparison (e.g., 'v.1.0.0' vs 'v1.0.0')
                def clean_ver(v):
                    return "".join(c for c in v if c.isdigit() or c == ".").strip(".")
                
                if clean_ver(latest_version) != clean_ver(CURRENT_VERSION) and latest_version.startswith("v"):
                    return {"update_available": True, "latest_version": latest_version, "release_notes": data.get("body", "")}
    except Exception as e:
        logger.error(f"Update check failed: {e}")
    return {"update_available": False}


@app.post("/api/update/install")
async def install_update(background_tasks: BackgroundTasks):
    def run_update():
        import tempfile
        import requests
        try:
            r = requests.get("https://api.github.com/repos/iamthebestcoderalive/MeroHoster/releases/latest", headers={"User-Agent": "MeroHost/1.0"})
            if r.status_code == 200:
                assets = r.json().get("assets", [])
                zip_url = None
                for a in assets:
                    if a.get("name") == "MeroHoster.zip":
                        zip_url = a.get("browser_download_url")
                        break
                if zip_url:
                    log("System", f"[Mero] ⬇ Downloading update from {zip_url}...")
                    zip_r = requests.get(zip_url)
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".zip") as tf:
                        tf.write(zip_r.content)
                        tf_path = tf.name
                    
                    bat_path = os.path.join(os.getcwd(), "update_merohoster.bat")
                    with open(bat_path, "w") as bf:
                        bf.write(f"""@echo off
timeout /t 3 /nobreak
echo Extracting update...
powershell -command "Expand-Archive -Force '{tf_path}' '{os.getcwd()}'"
del "{tf_path}"
echo Restarting...
start "" "python" "mero_host.py"
del "%~f0"
""")
                    log("System", "[Mero] 🚀 Launching updater and shutting down...")
                    subprocess.Popen(bat_path, shell=True, creationflags=subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0)
                    os._exit(0)
        except Exception as e:
            logger.error(f"Failed to install update: {e}")

    background_tasks.add_task(run_update)
    return {"message": "Update initiated, restarting soon."}


@app.get("/api/versions")
async def get_versions(software: str = "paper"):
    software = software.lower()
    async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
        try:
            if software == "paper":
                r = await c.get("https://api.papermc.io/v2/projects/paper")
                return {"versions": r.json()["versions"][::-1]}  # Newest first
            elif software == "purpur":
                r = await c.get("https://api.purpurmc.org/v2/purpur")
                return {"versions": r.json()["versions"][::-1]}
            elif software == "fabric":
                r = await c.get("https://meta.fabricmc.net/v2/versions/game")
                return {"versions": [v["version"] for v in r.json() if v["stable"]]}
            elif software == "forge":
                r = await c.get(
                    "https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json"
                )
                promos = r.json()["promos"]
                # forge promos has keys like '1.20.4-recommended'. We extract the MC version.
                versions = list(set([k.split("-")[0] for k in promos.keys()]))
                # Sort roughly by version numbers
                versions.sort(
                    key=lambda s: [int(x) for x in s.split(".") if x.isdigit()],
                    reverse=True,
                )
                return {"versions": versions}
            elif software == "vanilla":
                r = await c.get(
                    "https://launchermeta.mojang.com/mc/game/version_manifest.json"
                )
                return {
                    "versions": [
                        v["id"] for v in r.json()["versions"] if v["type"] == "release"
                    ]
                }
            else:
                return {"versions": ["1.20.4", "1.19.4", "1.18.2"]}
        except Exception:
            return {"versions": ["1.20.4", "1.19.4", "1.18.2"]}


@app.post("/api/servers/{name}/open_folder")
def open_server_folder(name: str):
    sp = sdir(name)
    if not os.path.exists(sp):
        raise HTTPException(404, "Server not found")
    try:
        if os.name == "nt":
            os.startfile(sp)
        elif sys.platform == "darwin":
            subprocess.Popen(["open", sp])
        else:
            subprocess.Popen(["xdg-open", sp])
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"message": "Folder opened"}


@app.get("/api/servers")
def list_servers():
    if not os.path.exists(SERVERS_DIR):
        return []
    out = []
    for name in os.listdir(SERVERS_DIR):
        if not os.path.isdir(sdir(name)):
            continue
        st = server_state.get(name, {})
        phase = st.get("phase", "stopped")
        tunnel = {}
        if phase == "running":
            if name in playit_info:
                tunnel = playit_info[name]
            elif name in mero_p2p_info:
                tunnel = {
                    "public_ip": mero_p2p_info[name]["invite_code"],
                    "is_p2p": True,
                }
        local_ip = f"{get_local_ip()}:{get_port(sdir(name))}"
        display_name = name
        meta_path = os.path.join(sdir(name), "meta.json")
        conn_method = "playit"
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                    display_name = meta.get("display_name", name)
                    conn_method = meta.get("connection-method", "playit")
            except Exception:
                pass

        out.append(
            {
                "name": name,
                "display_name": display_name,
                "phase": phase,
                "tunnel": tunnel,
                "local_ip": local_ip,
                "connection_method": conn_method,
            }
        )
    return out


@app.post("/api/servers/{name}/start")
def start_server(name: str):
    def update_manifest_status_sync(server_name: str, status: str):
        import requests

        try:
            meta_path = os.path.join(sdir(server_name), "meta.json")
            if not os.path.exists(meta_path):
                return
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            m_url = meta.get("manifest_url", "")
            if "kvdb.io" in m_url:
                r = requests.get(m_url, timeout=5)
                if r.status_code == 200:
                    data = r.json()
                    data["server_status"] = status
                    requests.post(m_url, json=data, timeout=5)
        except Exception as e:
            logger.error(f"Failed to update manifest status: {e}")

    import threading

    threading.Thread(
        target=update_manifest_status_sync, args=(name, "starting"), daemon=True
    ).start()

    # --- Auto Server Resource Pack Engine ---
    meta_path = os.path.join(sdir(name), "meta.json")
    conn_method = "playit"
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            conn_method = meta.get("connection-method", "playit")
        except Exception:
            pass

    rp_dir = os.path.join(sdir(name), "resourcepacks")
    props_path = os.path.join(sdir(name), "server.properties")
    if os.path.exists(props_path):
        if conn_method == "playit" and os.path.exists(rp_dir):
            zips = [f for f in os.listdir(rp_dir) if f.endswith(".zip")]
            if zips:
                rp_file = os.path.join(rp_dir, zips[0])
                sha1 = get_sha1(rp_file)

                local_ip = get_local_ip()
                # Read properties
                with open(props_path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                new_lines = []
                has_rp = False
                has_hash = False

                for line in lines:
                    if line.startswith("resource-pack="):
                        new_lines.append(
                            f"resource-pack=http://{local_ip}:8000/api/servers/{name}/resourcepack\n"
                        )
                        has_rp = True
                    elif line.startswith("resource-pack-sha1="):
                        new_lines.append(f"resource-pack-sha1={sha1}\n")
                        has_hash = True
                    else:
                        new_lines.append(line)

                if not has_rp:
                    new_lines.append(
                        f"resource-pack=http://{local_ip}:8000/api/servers/{name}/resourcepack\n"
                    )
                if not has_hash:
                    new_lines.append(f"resource-pack-sha1={sha1}\n")

                with open(props_path, "w", encoding="utf-8") as f:
                    f.writelines(new_lines)
        else:
            # Clear resource-pack fields for mero-p2p and local joins
            with open(props_path, "r", encoding="utf-8") as f:
                lines = f.readlines()
            new_lines = []
            for line in lines:
                if line.startswith("resource-pack="):
                    new_lines.append("resource-pack=\n")
                elif line.startswith("resource-pack-sha1="):
                    new_lines.append("resource-pack-sha1=\n")
                else:
                    new_lines.append(line)
            with open(props_path, "w", encoding="utf-8") as f:
                f.writelines(new_lines)
    if not os.path.exists(sdir(name)):
        raise HTTPException(404, "Server not found")
    # Enforce: only 1 server running at a time
    for sname, st in server_state.items():
        if sname != name and st.get("phase") in ("starting", "running"):
            raise HTTPException(
                400, f"Server '{sname}' is already running. Stop it first."
            )
    st = server_state.get(name, {})
    if st.get("phase") in ("starting", "running"):
        raise HTTPException(400, "Already running or starting")
    # Set phase BEFORE spawning thread to avoid race condition with fetchStats()
    server_state[name] = {"phase": "starting", "process": None}
    server_logs[name] = deque(maxlen=500)
    log(name, "[Mero] 🚀 Boot sequence initiated…")

    meta_path = os.path.join(sdir(name), "meta.json")
    with open(meta_path, "r") as f:
        meta = json.load(f)

    # Backend now routes modal UI via JS eval
    if main_window:
        main_window.evaluate_js(
            f'openDeploymentModal("{name}", "{meta.get("connection-method", "playit")}")'
        )
    threading.Thread(target=boot_server, args=(name,), daemon=True).start()
    return {"message": "Boot sequence initiated"}


@app.post("/api/servers/{name}/stop")
def stop_server(name: str, force: bool = False):
    st = server_state.get(name, {})
    proc = st.get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(400, "Not running")
    if not force:
        try:
            port = get_port(sdir(name))
            sv = JavaServer.lookup(f"127.0.0.1:{port}")
            if sv.status().players.online > 0:
                raise HTTPException(400, "Players are online. Force stop?")
        except HTTPException:
            raise
        except Exception:
            pass
    try:
        proc.stdin.write("stop\n")
        proc.stdin.flush()
    except Exception:
        proc.terminate()
    pp = playit_procs.get(name)
    if pp and pp.poll() is None:
        pp.terminate()
    mh = mero_p2p_hosts.get(name)
    if mh:
        mh.stop()
        mero_p2p_hosts.pop(name, None)
        mero_p2p_info.pop(name, None)
    # pinggy removed
    # Let the capture thread set the phase to "stopped" when the process exits
    # so we don't accidentally allow restarting while it's still shutting down
    return {"message": "Stopping..."}


@app.post("/api/servers/{name}/restart")
def restart_server(name: str):
    st = server_state.get(name, {})
    proc = st.get("process")
    if proc and proc.poll() is None:
        try:
            proc.stdin.write("stop\n")
            proc.stdin.flush()
        except Exception:
            proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            log(name, "[Mero] ⚠️ Server taking too long. Killing processes...")
            try:
                # Kill entire process tree
                parent = psutil.Process(proc.pid)
                for child in parent.children(recursive=True):
                    child.kill()
                parent.kill()
            except:
                pass
    pp = playit_procs.get(name)
    if pp and pp.poll() is None:
        pp.terminate()
    mh = mero_p2p_hosts.get(name)
    if mh:
        mh.stop()
        mero_p2p_hosts.pop(name, None)
        mero_p2p_info.pop(name, None)
    # pinggy removed
    server_state[name] = {"phase": "starting", "process": None}
    server_logs[name] = deque(maxlen=500)
    log(name, "[Mero] 🔄 Restarting…")
    threading.Thread(target=boot_server, args=(name,), daemon=True).start()
    return {"message": "Restarting"}





@app.delete("/api/servers/{name}")
def delete_server(name: str):
    sp = sdir(name)
    if not os.path.exists(sp):
        raise HTTPException(404, "Server not found")

    # Force-kill any lingering server / playit / pinggy processes first
    st = server_state.get(name, {})
    proc = st.get("process")
    if proc:
        try:
            proc.kill()
            proc.wait(timeout=10)
        except Exception:
            pass
    pp = playit_procs.get(name)
    if pp:
        try:
            pp.kill()
            pp.wait(timeout=5)
        except Exception:
            pass
    mh = mero_p2p_hosts.get(name)
    if mh:
        mh.stop()
    # pinggy removed

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
            time.sleep(1)
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
    st = server_state.get(name, {})
    proc = st.get("process")
    if proc:
        try:
            proc.kill()
        except Exception:
            pass
    pp = playit_procs.get(name)
    if pp:
        try:
            pp.kill()
        except Exception:
            pass
    mh = mero_p2p_hosts.get(name)
    if mh:
        mh.stop()
    st["phase"] = "stopped"
    log(name, "[Mero] ⚡ Server killed.")
    return {"message": "Killed"}


# --- Player Query Ping Cache ---
status_ping_cache = {}


def _update_disk_cache_bg(name: str, sp: str):
    try:
        def _safe_getsize(path):
            try:
                return os.path.getsize(path)
            except OSError:
                return 0

        disk = sum(
            _safe_getsize(os.path.join(dp, fn))
            for dp, _, fns in os.walk(sp)
            for fn in fns
            if not os.path.islink(os.path.join(dp, fn))
        )
        disk_cache[name] = (time.time(), disk, False)
    except Exception as e:
        logger.error(f"Error calculating disk size for {name}: {e}")
        cached = disk_cache.get(name)
        if cached:
            disk_cache[name] = (cached[0], cached[1], False)
        else:
            disk_cache[name] = (0, 0, False)


# ─────────────────────────── API: console ────────────────────────────────────
@app.get("/api/servers/{name}/stats")
def get_stats(name: str):
    sp = sdir(name)

    # Cache disk calculation in background — os.walk on large servers is very expensive
    cached = disk_cache.get(name)
    if cached:
        timestamp, disk, is_calculating = cached
        if (time.time() - timestamp) > 60 and not is_calculating:
            disk_cache[name] = (timestamp, disk, True)
            threading.Thread(target=_update_disk_cache_bg, args=(name, sp), daemon=True).start()
    else:
        disk = 0
        disk_cache[name] = (0, 0, True)
        threading.Thread(target=_update_disk_cache_bg, args=(name, sp), daemon=True).start()
    st = server_state.get(name, {})
    phase = st.get("phase", "stopped")
    proc = st.get("process")

    players_online = 0
    players_max = 0
    players_sample = []

    meta_path = os.path.join(sp, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            try:
                meta = json.load(f)
            except Exception:
                pass

    server_type = meta.get("type", "vanilla").lower()
    is_plugin_server = server_type in ("paper", "spigot", "purpur", "bukkit")
    mods_folder_name = "plugins" if is_plugin_server else "mods"

    mods_path = os.path.join(sp, mods_folder_name)
    rp_path = os.path.join(sp, "resourcepacks")
    sp_path = os.path.join(sp, "shaderpacks")

    mods_count = (
        len(
            [
                f
                for f in os.listdir(mods_path)
                if os.path.isfile(os.path.join(mods_path, f))
            ]
        )
        if os.path.exists(mods_path)
        else 0
    )
    rp_count = (
        len(
            [f for f in os.listdir(rp_path) if os.path.isfile(os.path.join(rp_path, f))]
        )
        if os.path.exists(rp_path)
        else 0
    )
    sp_count = (
        len(
            [f for f in os.listdir(sp_path) if os.path.isfile(os.path.join(sp_path, f))]
        )
        if os.path.exists(sp_path)
        else 0
    )

    bin_dir = os.path.join(sp, "bin")
    jar_exists = (
        os.path.exists(os.path.join(sp, "server.jar"))
        or os.path.exists(os.path.join(sp, "run.bat"))
        or os.path.exists(os.path.join(bin_dir, "server.jar"))
        or any(
            fn.startswith("forge-") and fn.endswith(".jar") and "installer" not in fn
            for fn in (os.listdir(sp) if os.path.exists(sp) else [])
        )
        or any(
            fn.startswith("forge-") and fn.endswith(".jar") and "installer" not in fn
            for fn in (os.listdir(bin_dir) if os.path.exists(bin_dir) else [])
        )
    )
    content_folders_exist = any(
        os.path.isdir(os.path.join(sp, d)) for d in ("mods", "plugins", "resourcepacks")
    )
    is_initialized = jar_exists and content_folders_exist

    base_stats = {
        "display_name": meta.get("display_name", name),
        "version": meta.get("version", "Unknown"),
        "type": meta.get("type", "Unknown").capitalize(),
        "platform": meta.get("type", "vanilla"),
        "mods_count": mods_count,
        "rp_count": rp_count,
        "sp_count": sp_count,
        "disk": disk,
        "sp": sp,
        "ram": meta.get("ram", 4),
        "premade_ip": meta.get("premade_ip", ""),
        "connection_method": meta.get("connection-method", "playit"),
        "tunnel": (
            playit_info.get(name, {})
            if name in playit_info
            else (
                {"public_ip": mero_p2p_info[name]["invite_code"], "is_p2p": True}
                if name in mero_p2p_info
                else {}
            )
        )
        if phase == "running"
        else {},
        "local_ip": f"{get_local_ip()}:{get_port(sdir(name))}",
        "is_initialized": is_initialized,
    }

    if phase == "starting":
        return {
            "phase": "starting",
            "cpu": 0,
            "memory": 0,
            "uptime": 0,
            "players_online": 0,
            "players_max": 0,
            "players_sample": [],
            **base_stats,
        }

    if phase == "running" and proc and proc.poll() is None:
        now = time.time()
        cached_ping = status_ping_cache.get(name)
        if cached_ping and (now - cached_ping[0]) < 3.0:
            players_online = cached_ping[1]
            players_max = cached_ping[2]
            players_sample = cached_ping[3]
        else:
            try:
                port = get_port(sdir(name))
                sv = JavaServer.lookup(f"127.0.0.1:{port}")
                sv.timeout = 0.5
                st_data = sv.status()
                players_online = st_data.players.online
                players_max = st_data.players.max
                players_sample = (
                    [{"name": p.name} for p in st_data.players.sample]
                    if st_data.players.sample
                    else []
                )
                status_ping_cache[name] = (now, players_online, players_max, players_sample)
            except Exception:
                # If lookup fails, cache empty result to prevent hammering the server socket
                status_ping_cache[name] = (now, 0, 0, [])
                players_online = 0
                players_max = 0
                players_sample = []

        try:
            root = psutil.Process(proc.pid)
            procs = [root] + root.children(recursive=True)
            cpu, mem = 0.0, 0
            for p in procs:
                try:
                    cpu += p.cpu_percent(interval=0.0)
                    mem += p.memory_info().rss
                except Exception:
                    pass
            return {
                "phase": "running",
                "cpu": cpu,
                "memory": mem,
                "uptime": int(time.time() - server_start_ts.get(name, time.time())),
                "players_online": players_online,
                "players_max": players_max,
                "players_sample": players_sample,

                **base_stats,
            }
        except Exception:
            pass
    return {
        "phase": "stopped",
        "cpu": 0,
        "memory": 0,
        "uptime": 0,
        "players_online": 0,
        "players_max": 0,
        "players_sample": [],

        **base_stats,
    }


@app.get("/api/servers/{name}/console")
def get_console(name: str):
    return {"logs": list(server_logs.get(name, []))}


@app.post("/api/servers/{name}/command")
def send_command(name: str, req: CmdReq):
    proc = server_state.get(name, {}).get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(400, "Not running")
    try:
        command_text = req.command
        if command_text.startswith("/"):
            command_text = command_text[1:]
        proc.stdin.write(command_text + "\n")
        proc.stdin.flush()
        log(name, f"> {req.command}")
    except Exception as e:
        raise HTTPException(500, str(e))
    return {"message": "Sent"}


import json
import re

def parse_legacy_chat_to_json(msg: str):
    color_map = {
        '0': 'black', '1': 'dark_blue', '2': 'dark_green', '3': 'dark_aqua',
        '4': 'dark_red', '5': 'dark_purple', '6': 'gold', '7': 'gray',
        '8': 'dark_gray', '9': 'blue', 'a': 'green', 'b': 'aqua',
        'c': 'red', 'd': 'light_purple', 'e': 'yellow', 'f': 'white'
    }
    format_map = {
        'l': 'bold', 'm': 'strikethrough', 'n': 'underlined', 'o': 'italic', 'k': 'obfuscated'
    }
    parts = []
    current_color = None
    current_formats = []
    
    tokens = re.split(r'([§&][0-9a-fk-orA-FK-OR])', msg)
    for token in tokens:
        if not token: continue
        if re.match(r'^[§&][0-9a-fk-orA-FK-OR]$', token):
            code = token[1].lower()
            if code == 'r':
                current_color = None
                current_formats = []
            elif code in color_map:
                current_color = color_map[code]
                current_formats = []
            elif code in format_map:
                if format_map[code] not in current_formats:
                    current_formats.append(format_map[code])
        else:
            part = {"text": token}
            if current_color: part["color"] = current_color
            for fmt in current_formats: part[fmt] = True
            parts.append(part)
    return parts if parts else [{"text": ""}]

@app.post("/api/servers/{name}/chat")
def send_chat(name: str, req: ChatReq):
    proc = server_state.get(name, {}).get("process")
    if not proc or proc.poll() is not None:
        raise HTTPException(400, "Not running")
        
    parts = parse_legacy_chat_to_json(req.message)
    if req.player:
        final_json = [{"text": f"<{req.player}> "}] + parts
    else:
        final_json = parts
        
    cmd = f"tellraw @a {json.dumps(final_json)}"
    try:
        proc.stdin.write(cmd + "\n")
        proc.stdin.flush()
        log(
            name, f"[Chat] {'<' + req.player + '> ' if req.player else ''}{req.message}"
        )
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

    meta_path = os.path.join(sdir(name), "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, encoding="utf-8") as f:
            try:
                meta = json.load(f)
            except Exception:
                pass

    return {"config": props, "meta": meta}


@app.post("/api/servers/{name}/config")
async def update_config(name: str, request: Request):
    payload = await request.json()
    props_updates = payload.get("properties", payload)  # fallback for old requests
    meta_updates = payload.get("meta", {})

    # Save properties
    pp = os.path.join(sdir(name), "server.properties")
    props, order = {}, []
    if os.path.exists(pp):
        with open(pp, encoding="utf-8") as f:
            for line in f:
                if "=" in line and not line.strip().startswith("#"):
                    k, v = line.split("=", 1)
                    props[k.strip()] = v.strip()
                    order.append(k.strip())
                else:
                    order.append(line)
    for k, v in props_updates.items():
        if k not in props:
            order.append(k)
        props[k] = str(v)
    with open(pp, "w", encoding="utf-8") as f:
        for item in order:
            f.write(f"{item}={props[item]}\n" if item in props else item)

    # Save meta
    if meta_updates:
        meta_path = os.path.join(sdir(name), "meta.json")
        meta = {}
        if os.path.exists(meta_path):
            with open(meta_path, encoding="utf-8") as f:
                try:
                    meta = json.load(f)
                except Exception:
                    pass
        for k, v in meta_updates.items():
            meta[k] = v
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)

    return {"message": "Saved"}


# ──────────────────────────── API: Manifest Builder ──────────────────────────
@app.post("/api/servers/{name}/manifest/publish")
async def publish_manifest(name: str):
    """
    Scans the server's mods folder and config, builds a launcher-compatible
    manifest, and uploads it using Swarm Synchronization for maximum performance.
    """
    sp = sdir(name)
    if not os.path.exists(sp):
        raise HTTPException(404, "Server not found")

    # ── 1. Read meta.json ───────────────────────────────────────────────────
    meta = {}
    meta_path = os.path.join(sp, "meta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            pass

    mc_version = meta.get("version", "1.21.1")
    loader_type = meta.get("type", "fabric").lower()
    loader_ver = meta.get("loader_version", "")

    # ── 2. Scanning Swarm: Concurrent Hashing ────────────────────────────────
    import hashlib
    from concurrent.futures import ThreadPoolExecutor

    def get_file_sha1(folder, fn):
        filepath = os.path.join(sp, folder, fn)
        sha1 = hashlib.sha1()
        with open(filepath, "rb") as f:
            while chunk := f.read(8192):
                sha1.update(chunk)
        digest = sha1.hexdigest()
        print(f"Hashed [{folder}] {fn}")
        return folder, fn, digest

    def scan_and_hash_all_files():
        hashed = []
        folders_to_scan = ["mods", "resourcepacks", "shaderpacks"]
        if loader_type not in ["fabric", "forge", "quilt"]:
            folders_to_scan = ["resourcepacks", "shaderpacks"]
        for folder in folders_to_scan:
            folder_path = os.path.join(sp, folder)
            if os.path.exists(folder_path):
                files = [
                    fn for fn in os.listdir(folder_path)
                    if (fn.endswith(".jar") or fn.endswith(".zip")) and os.path.isfile(os.path.join(folder_path, fn))
                ]
                with ThreadPoolExecutor() as executor:
                    results = list(executor.map(lambda fn: get_file_sha1(folder, fn), files))
                    hashed.extend(results)
        return hashed

    hashed_files = await asyncio.to_thread(scan_and_hash_all_files)

    # ── 3. Manifest Swarm: Parallel Modrinth API Sync ────────────────────────
    async def process_file(client, folder, fn, file_sha1):
        # 1. Check cache first
        async with manifest_cache_lock:
            cached = manifest_cache.get(file_sha1)
        
        if cached:
            if cached.get("is_local"):
                host_ip = get_local_ip()
                download_url = f"http://{host_ip}:8000/api/servers/{name}/download/{folder}/{fn}"
            else:
                download_url = cached["url"]

            return {
                "filename": fn,
                "url": download_url,
                "required": True,
                "folder": folder
            }

        # 2. Cache miss -> query Modrinth
        try:
            r = await client.get(
                f"https://api.modrinth.com/v2/version_file/{file_sha1}?algorithm=sha1",
                headers={"User-Agent": "MeroHost/1.0 (contact@example.com)"},
            )
            is_local = True
            if r.status_code == 200:
                data = r.json()
                download_url = data["files"][0]["url"]
                is_local = False
            else:
                host_ip = get_local_ip()
                download_url = f"http://{host_ip}:8000/api/servers/{name}/download/{folder}/{fn}"
                
            # Cache the result
            async with manifest_cache_lock:
                manifest_cache[file_sha1] = {
                    "url": download_url,
                    "is_local": is_local
                }
                save_manifest_cache()

            return {
                "filename": fn,
                "url": download_url,
                "required": True,
                "folder": folder
            }
        except Exception:
            host_ip = get_local_ip()
            return {
                "filename": fn,
                "url": f"http://{host_ip}:8000/api/servers/{name}/download/{folder}/{fn}",
                "required": True,
                "folder": folder
            }

    async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "MeroHost/1.0"}) as client:
        tasks = [process_file(client, folder, fn, sha1) for folder, fn, sha1 in hashed_files]
        results = await asyncio.gather(*tasks)
    
    mods_list = [r for r in results if r is not None and r["folder"] == "mods"]
    rp_list = [r for r in results if r is not None and r["folder"] == "resourcepacks"]
    sp_list = [r for r in results if r is not None and r["folder"] == "shaderpacks"]

    # ── 4. Build manifest dict ──────────────────────────────────────────────
    manifest = {
        "manifest_version": 1,
        "server_name": meta.get("display_name", name),
        "minecraft_version": mc_version,
        "loader_type": loader_type,
        "loader_version": loader_ver or "latest",
        "mods": mods_list,
        "resourcepacks": rp_list,
        "shaderpacks": sp_list,
        "generated_by": "Mero Swarm Manifest Builder",
        "generated_at": datetime.datetime.now(datetime.timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
    }

    manifest_json = json.dumps(manifest, indent=2)

    # ── 5. Upload Swarm: Parallel Cloud Persistence ─────────────────────────
    upload_url = None
    import uuid

    manifest_id = str(uuid.uuid4())

    print(f"Manifest Published: {len(mods_list)} mods, {len(rp_list)} resourcepacks, {len(sp_list)} shaders successfully synced")

    # Save a local backup copy of the manifest
    try:
        local_manifest_path = os.path.join(sp, "manifest.json")
        with open(local_manifest_path, "w", encoding="utf-8") as f:
            f.write(manifest_json)
        logger.info(f"Saved local backup of manifest to {local_manifest_path}")
    except Exception as e:
        logger.error(f"Failed to save local manifest backup: {e}")

    async def upload_bytebin():
        try:
            async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "MeroHost/1.0"}) as client:
                r = await client.post(
                    "https://bytebin.lucko.me/post",
                    content=manifest_json,
                    headers={"Content-Type": "application/json; charset=utf-8"},
                )
                if r.status_code in (200, 201):
                    key = r.json().get("key")
                    return f"https://bytebin.lucko.me/{key}"
        except Exception as e:
            logger.error(f"Bytebin Swarm Upload Failed: {e}")
        return None

    async def upload_kvdb():
        try:
            async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "MeroHost/1.0"}) as client:
                bucket_r = await client.post("https://kvdb.io/")
                if bucket_r.status_code in (200, 201):
                    bucket_url = bucket_r.text.strip()
                    post_url = f"{bucket_url}/manifest_{manifest_id}"
                    r = await client.post(post_url, content=manifest_json)
                    if r.status_code in (200, 201):
                        return post_url
        except Exception as e:
            logger.error(f"KVDB Swarm Upload Failed: {e}")
        return None

    async def upload_paste_rs():
        try:
            async with httpx.AsyncClient(timeout=20, headers={"User-Agent": "MeroHost/1.0"}) as client:
                r = await client.post(
                    "https://paste.rs",
                    content=manifest_json,
                )
                if r.status_code in (200, 201):
                    paste_url = r.text.strip()
                    if paste_url.startswith("http"):
                        return paste_url
        except Exception as e:
            logger.error(f"Paste.rs Swarm Upload Failed: {e}")
        return None

    # Try Bytebin first, then KVDB, then Paste.rs, and finally local fallback
    upload_url = await upload_bytebin()
    if not upload_url:
        logger.info("Bytebin failed, trying KVDB...")
        upload_url = await upload_kvdb()
    if not upload_url:
        logger.info("KVDB failed, trying Paste.rs...")
        upload_url = await upload_paste_rs()
    if not upload_url:
        logger.info("All cloud uploads failed. Falling back to local manifest URL...")
        host_ip = get_local_ip()
        upload_url = f"http://{host_ip}:8000/api/servers/{name}/manifest/raw"

    # ── 6. Cache the URL ───────────────────────────────────────────────────
    try:
        meta["manifest_url"] = upload_url
        meta["manifest_mods"] = len(mods_list)
        meta["manifest_resourcepacks"] = len(rp_list)
        meta["manifest_shaders"] = len(sp_list)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, indent=2)
    except Exception:
        pass

    print(f"✅ Published Swarm Manifest: {upload_url}")
    return {
        "url": upload_url,
        "mods": len(mods_list),
        "resourcepacks": len(rp_list),
        "shaders": len(sp_list),
        "platform": loader_type,
        "manifest": manifest,
    }


@app.get("/api/servers/{name}/manifest/url")
def get_manifest_url(name: str):
    """Returns the previously published manifest URL, if any."""
    meta_path = os.path.join(sdir(name), "meta.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                meta = json.load(f)
            url = meta.get("manifest_url", "")
            if url:
                return {
                    "url": url,
                    "mods": meta.get("manifest_mods", 0),
                    "resourcepacks": meta.get("manifest_resourcepacks", 0),
                    "shaders": meta.get("manifest_shaders", 0),
                    "platform": meta.get("type", "vanilla").lower(),
                }
        except Exception:
            pass
    return {"url": "", "mods": 0, "resourcepacks": 0, "shaders": 0}


@app.get("/api/servers/{name}/manifest/raw")
def get_raw_manifest(name: str):
    """Serves the raw manifest.json directly from the server directory."""
    sp = sdir(name)
    manifest_path = os.path.join(sp, "manifest.json")
    if os.path.exists(manifest_path):
        return FileResponse(manifest_path, media_type="application/json")
    raise HTTPException(404, "Manifest not found")


# ──────────────────────────── API: Player Manager ────────────────────────────
def parse_nbt_to_dict(nbt_tag):
    if isinstance(nbt_tag, dict):
        return {k: parse_nbt_to_dict(v) for k, v in nbt_tag.items()}
    elif isinstance(nbt_tag, list):
        return [parse_nbt_to_dict(i) for i in nbt_tag]
    else:
        if hasattr(nbt_tag, 'real'):
            return nbt_tag.real
        elif type(nbt_tag).__name__ == 'String':
            return str(nbt_tag)
        else:
            return str(nbt_tag)

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
    result["ops"] = read_json_list("ops.json")
    result["banned"] = read_json_list("banned-players.json")
    return result

@app.get("/api/servers/{name}/players/{player_name}")
def get_player_data(name: str, player_name: str):
    # 1. Issue save-all to ensure data is written to disk
    sp = sdir(name)
    send_command(name, "save-all")
    time.sleep(0.5) # Give the server a tiny moment to flush to disk
    
    # 2. Find UUID from usercache.json
    uuid_str = None
    cache_path = os.path.join(sp, "usercache.json")
    if os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                cache = json.load(f)
                for entry in cache:
                    if entry.get("name", "").lower() == player_name.lower():
                        uuid_str = entry.get("uuid")
                        break
        except: pass
    
    if not uuid_str:
        # Fallback offline UUID calculation or just try to find them
        raise HTTPException(404, f"Could not find UUID for player {player_name}")
    
    # 3. Read NBT
    playerdata_dir = os.path.join(sp, "world", "playerdata")
    if not os.path.exists(playerdata_dir):
        # Maybe it's a paper server with default world? Let's check common locations
        for w in ["world", "world_nether", "world_the_end"]:
            alt = os.path.join(sp, w, "playerdata")
            if os.path.exists(alt):
                playerdata_dir = alt
                break
                
    dat_path = os.path.join(playerdata_dir, f"{uuid_str}.dat")
    if not os.path.exists(dat_path):
        raise HTTPException(404, f"Player data file not found for {player_name}")
        
    try:
        nbt_file = nbtlib.load(dat_path, gzipped=True)
        player_dict = parse_nbt_to_dict(nbt_file)
        
        # We only return the specific fields to avoid huge payloads
        res = {
            "uuid": uuid_str,
            "name": player_name,
            "Health": player_dict.get("Health", 20.0),
            "foodLevel": player_dict.get("foodLevel", 20),
            "Inventory": player_dict.get("Inventory", [])
        }
        return res
    except Exception as e:
        logger.error(f"Failed to read NBT for {player_name}: {e}")
        raise HTTPException(500, f"Error parsing player data: {e}")

class PlayerActionReq(BaseModel):
    action: str
    amount: Optional[int] = None

@app.post("/api/servers/{name}/players/{player_name}/action")
def execute_player_action(name: str, player_name: str, req: PlayerActionReq):
    if req.action == "heal":
        send_command(name, f"effect give {player_name} instant_health 1 100")
    elif req.action == "feed":
        send_command(name, f"effect give {player_name} saturation 1 100")
    elif req.action == "set_health":
        if req.amount is None: raise HTTPException(400, "Amount required")
        # To set health to exactly X: fully heal, then damage difference. (20 max)
        send_command(name, f"effect give {player_name} instant_health 1 100")
        diff = max(0, 20 - req.amount)
        if diff > 0:
            send_command(name, f"damage {player_name} {diff}")
    elif req.action == "set_food":
        if req.amount is None: raise HTTPException(400, "Amount required")
        # Approximate: saturate fully, then use hunger effect to drain it
        send_command(name, f"effect give {player_name} saturation 1 100")
        diff = max(0, 20 - req.amount)
        if diff > 0:
            # hunger effect level 5 (amplifier 4) reduces exhaustion very fast.
            # 1 tick = 0.025 exhaustion. 1 sec = 0.5 exhaustion.
            # it's just a rough approximation for standard users
            send_command(name, f"effect give {player_name} hunger {diff} 4")
    else:
        raise HTTPException(400, "Unknown action")
    
    return {"status": "ok"}


@app.get("/api/mojang/profile/{username}")
async def mojang_profile(username: str):
    """Fetch Mojang UUID + skin for a username."""
    async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
        r = await c.get(
            f"https://api.mojang.com/users/profiles/minecraft/{username}", timeout=8
        )
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
            with open(path, encoding="utf-8") as f:
                players = json.load(f)
        except Exception:
            pass
    if not any(p.get("name", "").lower() == player_name.lower() for p in players):
        players.append({"uuid": player_uuid, "name": player_name})
        with open(path, "w", encoding="utf-8") as f:
            json.dump(players, f, indent=2)
    # Send live command if running
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try:
            proc.stdin.write(f"whitelist add {player_name}\n")
            proc.stdin.flush()
        except Exception:
            pass
    return {"message": f"{player_name} added to whitelist"}


@app.post("/api/servers/{name}/whitelist/remove")
def whitelist_remove(name: str, req: dict = Body(...)):
    sp = sdir(name)
    player_name = req.get("name", "")
    path = os.path.join(sp, "whitelist.json")
    players = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                players = json.load(f)
        except Exception:
            pass
    players = [p for p in players if p.get("name", "").lower() != player_name.lower()]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(players, f, indent=2)
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try:
            proc.stdin.write(f"whitelist remove {player_name}\n")
            proc.stdin.flush()
        except Exception:
            pass
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
            with open(path, encoding="utf-8") as f:
                banned = json.load(f)
        except Exception:
            pass
    if not any(p.get("name", "").lower() == player_name.lower() for p in banned):
        banned.append(
            {
                "uuid": player_uuid,
                "name": player_name,
                "created": datetime.datetime.utcnow().isoformat() + " +0000",
                "source": "Server",
                "expires": "forever",
                "reason": reason,
            }
        )
        with open(path, "w", encoding="utf-8") as f:
            json.dump(banned, f, indent=2)
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try:
            proc.stdin.write(f"ban {player_name} {reason}\n")
            proc.stdin.flush()
        except Exception:
            pass
    return {"message": f"{player_name} banned"}


@app.post("/api/servers/{name}/unban")
def unban_player(name: str, req: dict = Body(...)):
    sp = sdir(name)
    player_name = req.get("name", "")
    path = os.path.join(sp, "banned-players.json")
    banned = []
    if os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as f:
                banned = json.load(f)
        except Exception:
            pass
    banned = [p for p in banned if p.get("name", "").lower() != player_name.lower()]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(banned, f, indent=2)
    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        try:
            proc.stdin.write(f"pardon {player_name}\n")
            proc.stdin.flush()
        except Exception:
            pass
    return {"message": f"{player_name} unbanned"}


import hashlib

from fastapi.responses import FileResponse


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
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()


# ─────────────────────────── API: modrinth ───────────────────────────────────
@app.get("/api/modrinth/search")
async def modrinth_search(
    query: str = "", project_type: str = "mod", game_version: str = "", loader: str = "", offset: int = 0
):
    facets_list = [f'["project_type:{project_type}"]']
    if game_version:
        facets_list.append(f'["versions:{game_version}"]')
    # Only filter by loader for mods/modpacks — resource packs and shaders are loader-agnostic
    if loader and project_type in ("mod", "modpack"):
        facets_list.append(f'["categories:{loader}"]')
    facets = "[" + ",".join(facets_list) + "]"
    async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
        r = await c.get(
            f"https://api.modrinth.com/v2/search?query={query}&facets={facets}&limit=36&offset={offset}&index=downloads"
        )
        return r.json().get("hits", [])


import tempfile
import zipfile

# Tracks multi-stage modpack installation progress per server+project_id
# {server_name: {project_id: {stage, stage_label, pack_pct, mods_done, mods_total, status, title, icon_url, error}}}
modpack_progress: dict = {}


async def install_modpack_bg(
    name: str, project_id: str, meta: dict, title: str, icon_url: str
):
    """Background coroutine: streams mrpack download, parses manifest, downloads all mods."""
    key = project_id
    prog = modpack_progress.setdefault(name, {})
    prog[key] = {
        "status": "downloading_pack",
        "stage": 1,
        "stage_label": "Downloading modpack file\u2026",
        "pack_pct": 0,
        "mods_done": 0,
        "mods_total": 0,
        "title": title,
        "icon_url": icon_url,
        "error": "",
    }
    try:
        async with httpx.AsyncClient(timeout=120, headers={"User-Agent": "MeroHost/1.0"}) as c:
            # ── Stage 1: Fetch version manifest ──────────────────────────────
            r = await c.get(
                f"https://api.modrinth.com/v2/project/{project_id}/version"
                f'?game_versions=["{meta["version"]}"]'
            )
            data = r.json()
            if not data:
                prog[key].update(
                    {"status": "error", "error": "No compatible version found"}
                )
                return
            fi = next(
                (f for f in data[0]["files"] if f["filename"].endswith(".mrpack")), None
            )
            if not fi:
                prog[key].update({"status": "error", "error": "No .mrpack file found"})
                return

            # ── Stage 1b: Stream the mrpack file with byte-level progress ────
            tmp = tempfile.mktemp(suffix=".mrpack")
            async with c.stream(
                "GET", fi["url"], follow_redirects=True, timeout=180
            ) as resp:
                total_bytes = int(resp.headers.get("Content-Length", 0))
                downloaded_bytes = 0
                prog[key]["stage_label"] = "Downloading modpack file\u2026"
                with open(tmp, "wb") as f_out:
                    async for chunk in resp.aiter_bytes(chunk_size=32768):
                        f_out.write(chunk)
                        downloaded_bytes += len(chunk)
                        if total_bytes > 0:
                            prog[key]["pack_pct"] = round(
                                downloaded_bytes / total_bytes * 100, 1
                            )
            prog[key]["pack_pct"] = 100

            # ── Stage 2: Extract manifest & overrides ────────────────────────
            prog[key].update(
                {
                    "status": "extracting",
                    "stage": 2,
                    "stage_label": "Reading manifest\u2026",
                }
            )
            with zipfile.ZipFile(tmp, "r") as z:
                idx = json.loads(z.read("modrinth.index.json"))
                for zi in z.infolist():
                    if zi.filename.startswith("overrides/"):
                        target = os.path.join(
                            sdir(name), zi.filename.replace("overrides/", "", 1)
                        )
                        if zi.is_dir():
                            os.makedirs(target, exist_ok=True)
                        else:
                            os.makedirs(os.path.dirname(target), exist_ok=True)
                            with open(target, "wb") as out:
                                out.write(z.read(zi.filename))
            os.remove(tmp)

            mod_files = idx.get("files", [])
            total_mods = len(mod_files)
            prog[key].update(
                {
                    "status": "downloading_mods",
                    "stage": 3,
                    "stage_label": f"Downloading mods: 0 / {total_mods}",
                    "mods_total": total_mods,
                    "mods_done": 0,
                }
            )

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
                        timeout=10,
                    )
                    if pr.status_code == 200:
                        for proj in pr.json():
                            icon_map[proj["id"]] = {
                                "title": proj.get("title", proj["id"]),
                                "icon_url": proj.get("icon_url") or "",
                            }
                except Exception:
                    pass

            # Concurrency limit (e.g. max 5 concurrent download tasks)
            sem = asyncio.Semaphore(5)
            done_lock = asyncio.Lock()
            done = 0
            
            async def download_mod(mf, pid):
                nonlocal done
                mod_url = mf["downloads"][0]
                dest = os.path.join(sdir(name), mf["path"])
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                fn = os.path.basename(dest)
                info = icon_map.get(pid, {})
                mod_title = info.get("title", fn)
                mod_icon_url = info.get("icon_url", "")
                
                async with sem:
                    # Retry up to 3 times for robustness
                    for attempt in range(3):
                        try:
                            async with httpx.AsyncClient(timeout=120, headers={"User-Agent": "MeroHost/1.0"}) as client:
                                async with client.stream(
                                    "GET", mod_url, follow_redirects=True, timeout=60
                                ) as mr:
                                    mr.raise_for_status()
                                    with open(dest, "wb") as f_mod:
                                        async for chunk in mr.aiter_bytes(chunk_size=32768):
                                            f_mod.write(chunk)
                            break
                        except Exception:
                            if attempt == 2:
                                return None
                
                async with done_lock:
                    done += 1
                    prog[key]["mods_done"] = done
                    prog[key]["stage_label"] = f"Downloading mods: {done} / {total_mods}"
                    if main_window:
                        try:
                            main_window.evaluate_js(f"updateInstallProgress({done}, {total_mods})")
                        except:
                            pass
                
                return {
                    "project_id": pid or fn,
                    "filename": fn,
                    "type": "mod",
                    "title": mod_title,
                    "icon_url": mod_icon_url,
                }

            tasks = [download_mod(mf, pid) for mf, pid in zip(mod_files, project_ids_list)]
            results = await asyncio.gather(*tasks)
            successful_mods = [r for r in results if r is not None]
            
            if successful_mods:
                with open(os.path.join(sdir(name), "meta.json"), encoding="utf-8") as fm:
                    m = json.load(fm)
                if "installed_files" not in m:
                    m["installed_files"] = []
                
                installed_filenames = {sm["filename"] for sm in successful_mods}
                m["installed_files"] = [
                    x for x in m["installed_files"] if x["filename"] not in installed_filenames
                ]
                m["installed_files"].extend(successful_mods)
                
                with open(os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8") as fm:
                    json.dump(m, fm)
                
                for sm in successful_mods:
                    install_progress.setdefault(name, {})[sm["filename"]] = {
                        "downloaded": 1,
                        "total": 1,
                        "status": "installed",
                        "title": sm["title"],
                        "icon_url": sm["icon_url"],
                    }

        prog[key].update(
            {
                "status": "done",
                "stage": 3,
                "stage_label": "Installation complete!",
                "mods_done": total_mods,
            }
        )
    except Exception as ex:
        prog.setdefault(key, {})
        prog[key].update(
            {"status": "error", "stage_label": "Installation failed", "error": str(ex)}
        )


async def download_mod_task(
    name: str,
    project_id: str,
    project_type: str,
    url: str,
    dest: str,
    filename: str,
    title: str,
    icon_url: str,
):
    try:
        async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
            async with c.stream("GET", url, follow_redirects=True) as resp:
                total = int(resp.headers.get("Content-Length", 0))
                install_progress.setdefault(name, {})[project_id] = {
                    "downloaded": 0,
                    "total": total,
                    "status": "downloading",
                    "title": title,
                    "icon_url": icon_url,
                }

                with open(dest, "wb") as f:
                    async for chunk in resp.aiter_bytes(chunk_size=8192):
                        f.write(chunk)
                        install_progress[name][project_id]["downloaded"] += len(chunk)

        # update meta.json tracking
        with open(os.path.join(sdir(name), "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
        if "installed_files" not in meta:
            meta["installed_files"] = []
        meta["installed_files"] = [
            m for m in meta["installed_files"] if m["project_id"] != project_id
        ]
        meta["installed_files"].append(
            {
                "project_id": project_id,
                "filename": filename,
                "type": project_type,
                "title": title,
                "icon_url": icon_url,
            }
        )
        with open(os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8") as f:
            json.dump(meta, f)

        install_progress[name][project_id]["status"] = "installed"
    except Exception as e:
        if name in install_progress and project_id in install_progress[name]:
            install_progress[name][project_id]["status"] = "error"


async def resolve_and_download(
    name: str,
    req: InstallReq,
    background_tasks: BackgroundTasks,
    c: httpx.AsyncClient,
    meta: dict,
    visited: set = None,
):
    if visited is None:
        visited = set()
    if req.project_id in visited:
        return
    visited.add(req.project_id)

    # fetch project details for title and icon
    r_proj = await c.get(f"https://api.modrinth.com/v2/project/{req.project_id}")
    proj_data = r_proj.json() if r_proj.status_code == 200 else {}
    title = req.title or proj_data.get("title", req.project_id)
    icon_url = req.icon_url or proj_data.get("icon_url", "")

    server_type = meta.get("type", "vanilla").lower()
    loaders = ""
    if server_type in ("paper", "spigot", "bukkit"):
        loaders = '["paper","spigot","bukkit"]'
    elif server_type == "purpur":
        loaders = '["purpur","paper","spigot","bukkit"]'
    elif server_type == "forge":
        loaders = '["forge"]'
    elif server_type == "neoforge":
        loaders = '["neoforge","forge"]'
    elif server_type == "fabric":
        loaders = '["fabric"]'

    url = f'https://api.modrinth.com/v2/project/{req.project_id}/version?game_versions=["{meta["version"]}"]'
    if loaders:
        import urllib.parse
        url += f'&loaders={urllib.parse.quote(loaders)}'

    # get compatible version
    r = await c.get(url)
    data = r.json()
    if not data:
        return  # no compatible version

    v = data[0]
    fi = v["files"][0]

    is_plugin_server = server_type in ("paper", "spigot", "purpur", "bukkit")
    mod_folder = "plugins" if is_plugin_server else "mods"

    folder = {
        "mod": mod_folder,
        "resourcepack": "resourcepacks",
        "shader": "shaderpacks",
    }.get(req.project_type, mod_folder)
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
                    inc_path = os.path.join(
                        sdir(name),
                        {
                            "mod": mod_folder,
                            "resourcepack": "resourcepacks",
                            "shader": "shaderpacks",
                        }.get(inst.get("type", "mod"), mod_folder),
                        inst["filename"],
                    )
                    if os.path.exists(inc_path):
                        os.remove(inc_path)
                    meta["installed_files"] = [
                        m for m in meta["installed_files"] if m["project_id"] != inc_id
                    ]
                    with open(
                        os.path.join(sdir(name), "meta.json"), "w", encoding="utf-8"
                    ) as f:
                        json.dump(meta, f)
                    logger.info(
                        f"[Peacekeeper] Removed incompatible mod {inst['filename']} to install {title}"
                    )

    background_tasks.add_task(
        download_mod_task,
        name,
        req.project_id,
        req.project_type,
        fi["url"],
        dest,
        fi["filename"],
        title,
        icon_url,
    )

    # process dependencies
    for dep in v.get("dependencies", []):
        if dep.get("dependency_type") == "required" and dep.get("project_id"):
            await resolve_and_download(
                name,
                InstallReq(project_id=dep["project_id"], project_type=req.project_type),
                background_tasks,
                c,
                meta,
                visited,
            )


@app.post("/api/servers/{name}/install")
async def install_mod(name: str, req: InstallReq, background_tasks: BackgroundTasks):
    with open(os.path.join(sdir(name), "meta.json"), encoding="utf-8") as f:
        meta = json.load(f)
    if req.project_type == "modpack":
        # Fetch basic project info for title/icon (fast), then hand off to background
        title, icon_url = req.title or req.project_id, req.icon_url or ""
        try:
            async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "MeroHost/1.0"}) as c:
                rp = await c.get(
                    f"https://api.modrinth.com/v2/project/{req.project_id}"
                )
                if rp.status_code == 200:
                    pd = rp.json()
                    title = pd.get("title", title)
                    icon_url = pd.get("icon_url") or ""
        except Exception:
            pass
        # Kick off the full staged installation in the background
        background_tasks.add_task(
            install_modpack_bg, name, req.project_id, meta, title, icon_url
        )
        return {"message": "Started", "project_id": req.project_id}
    else:
        async with httpx.AsyncClient(headers={"User-Agent": "MeroHost/1.0"}) as c:
            await resolve_and_download(name, req, background_tasks, c, meta)
        return {"message": "Started"}


@app.get("/api/servers/{name}/install_progress_all")
def get_install_progress_all(name: str):
    return install_progress.get(name, {})


@app.get("/api/servers/{name}/install_progress")
def get_install_progress(name: str, project_id: str):
    prog = install_progress.get(name, {}).get(project_id)
    if not prog:
        return {"status": "none"}
    return prog


@app.get("/api/servers/{name}/modpack_progress/{project_id}")
def get_modpack_progress(name: str, project_id: str):
    prog = modpack_progress.get(name, {}).get(project_id)
    if not prog:
        return {"status": "unknown"}
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
                installed.append(
                    {
                        "path": path,
                        "title": info.get("title") or f,
                        "icon_url": info.get("icon_url") or "",
                        "project_id": info.get("project_id") or "",
                    }
                )
    return {"files": installed}


scanned_jars_cache = set()

def calculate_sha1(filepath):
    import hashlib
    h = hashlib.sha1()
    with open(filepath, 'rb') as file:
        chunk = 0
        while chunk != b'':
            chunk = file.read(65536)
            h.update(chunk)
    return h.hexdigest()

async def scan_jars_bg(name: str):
    """Scan all .jar files in mods/ and plugins/, hash them, and fetch Modrinth details."""
    sp = sdir(name)
    if not os.path.exists(sp):
        return
        
    meta_path = os.path.join(sp, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            pass
            
    tracked = meta.setdefault("installed_files", [])
    changed = False
    
    for d in ["mods", "plugins"]:
        folder = os.path.join(sp, d)
        if not os.path.isdir(folder):
            continue
            
        for f in os.listdir(folder):
            if not f.endswith(".jar"):
                continue
                
            cache_key = f"{name}:{f}"
            if cache_key in scanned_jars_cache:
                continue
                
            info = next((m for m in tracked if m.get("filename") == f), None)
            if info and info.get("icon_url") and info.get("project_id"):
                continue
                
            filepath = os.path.join(folder, f)
            try:
                sha1 = await asyncio.to_thread(calculate_sha1, filepath)
                
                async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "MeroHost/1.0"}) as client:
                    r = await client.get(f"https://api.modrinth.com/v2/version_file/{sha1}", headers={"User-Agent": "MeroServerHoster/1.0"})
                    if r.status_code == 200:
                        vdata = r.json()
                        project_id = vdata.get("project_id")
                        
                        pr = await client.get(f"https://api.modrinth.com/v2/project/{project_id}", headers={"User-Agent": "MeroServerHoster/1.0"})
                        if pr.status_code == 200:
                            pdata = pr.json()
                            title = pdata.get("title", f)
                            icon_url = pdata.get("icon_url") or ""
                            
                            if info:
                                info["project_id"] = project_id
                                info["title"] = title
                                info["icon_url"] = icon_url
                            else:
                                tracked.append({
                                    "project_id": project_id,
                                    "filename": f,
                                    "type": "mod" if d == "mods" else "plugin",
                                    "title": title,
                                    "icon_url": icon_url
                                })
                            changed = True
                            
                            if main_window:
                                try:
                                    main_window.evaluate_js(f"onJarScanned('{f}', '{icon_url}', '{title}')")
                                except Exception as e:
                                    logger.error(f"Failed JS eval: {e}")
            except Exception as e:
                logger.error(f"Error scanning jar {f}: {e}")
            finally:
                scanned_jars_cache.add(cache_key)
                
    if changed:
        try:
            with open(meta_path, "w", encoding="utf-8") as f:
                json.dump(meta, f)
        except Exception:
            pass

@app.post("/api/servers/{name}/scan-jars")
async def trigger_scan_jars(name: str, background_tasks: BackgroundTasks):
    background_tasks.add_task(scan_jars_bg, name)
    return {"status": "started"}


# ─────────────────────────── API: file manager ───────────────────────────────
@app.get("/api/servers/{name}/files")
def list_files(name: str, path: str = ""):
    sp = sdir(name)
    target = os.path.normpath(os.path.join(sp, path)) if path else sp
    if not target.startswith(sp):
        raise HTTPException(400, "Invalid path")

    meta_path = os.path.join(sp, "meta.json")
    icon_map = {}
    if os.path.exists(meta_path):
        try:
            with open(meta_path, encoding="utf-8") as f:
                m = json.load(f)
                for item in m.get("installed_files", []):
                    icon_map[item.get("filename")] = item.get("icon_url")
        except:
            pass

    entries = []
    try:
        for e in sorted(
            os.scandir(target), key=lambda x: (not x.is_dir(), x.name.lower())
        ):
            st = e.stat()
            entries.append(
                {
                    "name": e.name,
                    "path": os.path.relpath(e.path, sp).replace("\\", "/"),
                    "is_dir": e.is_dir(),
                    "size": 0 if e.is_dir() else st.st_size,
                    "modified": int(st.st_mtime),
                    "icon_url": icon_map.get(e.name, ""),
                }
            )
    except FileNotFoundError:
        raise HTTPException(404, "Not found")
    return entries


@app.post("/api/servers/{name}/upload")
async def upload_file(name: str, path: str = Form(""), file: UploadFile = File(...)):
    sp = sdir(name)
    dest = os.path.normpath(os.path.join(sp, path)) if path else sp
    if not dest.startswith(sp):
        raise HTTPException(400, "Invalid path")
    os.makedirs(dest, exist_ok=True)
    with open(os.path.join(dest, file.filename), "wb") as f:
        f.write(await file.read())
    return {"message": "Uploaded"}


@app.post("/api/servers/{name}/files/delete")
def delete_entry(name: str, path: str):
    sp = sdir(name)
    t = os.path.normpath(os.path.join(sp, path))
    if not t.startswith(sp):
        raise HTTPException(400, "Invalid path")
    if os.path.isfile(t):
        os.remove(t)
    elif os.path.isdir(t):
        shutil.rmtree(t)
    return {"message": "Deleted"}


@app.post("/api/servers/{name}/files/mkdir")
def make_dir(name: str, path: str):
    sp = sdir(name)
    t = os.path.normpath(os.path.join(sp, path))
    if not t.startswith(sp):
        raise HTTPException(400, "Invalid path")
    os.makedirs(t, exist_ok=True)
    return {"message": "Created"}
@app.get("/api/servers/{name}/download/{folder}/{filename}")
def download_server_asset(name: str, folder: str, filename: str):
    if folder not in ["mods", "resourcepacks", "shaderpacks"]:
        raise HTTPException(400, "Invalid folder")
    file_path = os.path.join(sdir(name), folder, filename)
    if not os.path.exists(file_path):
        raise HTTPException(404, "File not found")
    return FileResponse(file_path, filename=filename)



@app.get("/api/servers/{name}/files/content")
def get_file_content(name: str, path: str):
    sp = sdir(name)
    t = os.path.normpath(os.path.join(sp, path))
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
    t = os.path.normpath(os.path.join(sp, req.path))
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
    if not os.path.exists(bp):
        return {"backups": []}
    files = []
    for f in os.listdir(bp):
        if f.endswith(".zip"):
            fp = os.path.join(bp, f)
            files.append(
                {
                    "filename": f,
                    "date": os.path.getmtime(fp),
                    "size": os.path.getsize(fp),
                }
            )
    files.sort(key=lambda x: x["date"], reverse=True)
    return {"backups": files}


@app.post("/api/servers/{name}/backup-settings")
def save_backup_settings(name: str, req: BackupSettingsReq):
    meta_path = os.path.join(sdir(name), "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    meta["auto_backup"] = req.auto_backup
    meta["backup_interval"] = req.backup_interval
    meta["max_backups"] = req.max_backups
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
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
            if "b" in getattr(proc.stdin, "mode", "b"):
                cmd = cmd.encode()
            proc.stdin.write(cmd)
            proc.stdin.flush()

            cmd2 = "save-all\n"
            if "b" in getattr(proc.stdin, "mode", "b"):
                cmd2 = cmd2.encode()
            proc.stdin.write(cmd2)
            proc.stdin.flush()
            time.sleep(2)  # Give it a moment to write to disk
        except Exception:
            pass

    # Zip the worlds

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
                            if f == "session.lock":
                                continue
                            fp = os.path.join(root, f)
                            arcname = os.path.relpath(fp, sp)
                            try:
                                zf.write(fp, arcname)
                            except PermissionError:
                                pass  # Skip locked files

    except Exception as e:
        if is_running:
            try:
                cmd = "save-on\n"
                if "b" in getattr(proc.stdin, "mode", "b"):
                    cmd = cmd.encode()
                proc.stdin.write(cmd)
                proc.stdin.flush()
            except Exception:
                pass
        raise HTTPException(500, f"Backup failed: {e}")

    if is_running:
        try:
            cmd = "save-on\n"
            if "b" in getattr(proc.stdin, "mode", "b"):
                cmd = cmd.encode()
            proc.stdin.write(cmd)
            proc.stdin.flush()
        except Exception:
            pass

    # Update meta.json with last backup time
    meta_path = os.path.join(sp, "meta.json")
    meta = {}
    if os.path.exists(meta_path):
        with open(meta_path, "r", encoding="utf-8") as f:
            meta = json.load(f)
    meta["last_backup"] = time.time()
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    # Enforce max backups limit
    max_b = meta.get("max_backups", 5)
    if os.path.exists(bp):
        files = [
            os.path.join(bp, f)
            for f in os.listdir(bp)
            if f.endswith(".zip")
        ]
        files.sort(key=os.path.getmtime)
        while len(files) > max_b:
            oldest = files.pop(0)
            try:
                os.remove(oldest)
            except Exception:
                pass

    return {"message": "Backup created", "filename": zip_name}


@app.post("/api/servers/{name}/backups/restore")
def restore_backup(name: str, req: RestoreBackupReq):
    sp = sdir(name)
    bp = os.path.join(sp, "backups", req.filename)
    if not os.path.exists(bp):
        raise HTTPException(404, "Backup not found")

    proc = server_state.get(name, {}).get("process")
    if proc and proc.poll() is None:
        raise HTTPException(
            400, "Cannot restore while server is running. Stop it first."
        )

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
    if not os.path.exists(bp):
        raise HTTPException(404, "Backup not found")
    return FileResponse(bp, filename=filename)


app.mount(
    "/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static"
)


@app.get("/")
def root():
    return FileResponse(os.path.join(BASE_DIR, "static", "index.html"))


def auto_backup_daemon():
    while True:
        time.sleep(60)  # Check every minute
        if not os.path.exists(SERVERS_DIR):
            continue
        for server_name in os.listdir(SERVERS_DIR):
            sp = os.path.join(SERVERS_DIR, server_name)
            meta_path = os.path.join(sp, "meta.json")
            if not os.path.exists(meta_path):
                continue

            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    meta = json.load(f)
            except:
                continue

            if meta.get("auto_backup"):
                interval_hours = meta.get("backup_interval", 12)
                last_backup = meta.get("last_backup", 0)
                now = time.time()

                if (now - last_backup) >= (interval_hours * 3600):
                    # Trigger backup
                    try:
                        create_backup(server_name)
                    except Exception as e:
                        logger.error(f"Auto-backup failed for {server_name}: {e}")


# ─────────────────────────── Exit Protocol UI ────────────────────────────────
def show_exit_dialog():
    if sys.platform == "win32":
        try:
            import ctypes
            title = "Active Servers Detected"
            message = (
                "There are active Minecraft servers running.\n\n"
                "• Click YES to terminate all running servers and close Mero.\n"
                "• Click NO to keep the servers running in the background and close Mero.\n"
                "• Click CANCEL to return to Mero."
            )
            # MB_YESNOCANCEL = 0x00000003
            # MB_ICONWARNING = 0x00000030
            # MB_SETFOREGROUND = 0x00010000
            # MB_TOPMOST = 0x00040000
            res = ctypes.windll.user32.MessageBoxW(
                0, 
                message, 
                title, 
                0x00000003 | 0x00000030 | 0x00010000 | 0x00040000
            )
            # IDYES = 6, IDNO = 7, IDCANCEL = 2
            if res == 6:
                return "kill"
            elif res == 7:
                return "keep"
            return "cancel"
        except Exception as e:
            logger.error(f"Failed to show Windows native dialog: {e}")

    # Fallback to tkinter messagebox if not on Windows or if ctypes fails
    try:
        import tkinter as tk
        from tkinter import messagebox
        root = tk.Tk()
        root.withdraw()
        res = messagebox.askyesnocancel(
            "Active Servers Detected",
            "There are active Minecraft servers running.\n\n"
            "Yes: Terminate all running servers and exit.\n"
            "No: Keep servers running in the background and exit.\n"
            "Cancel: Stay in Mero."
        )
        root.destroy()
        if res is True:
            return "kill"
        elif res is False:
            return "keep"
        return "cancel"
    except Exception as e:
        logger.error(f"Fallback dialog failed: {e}")
        return "keep"


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
    logger.info(f"Received icon upload request for server '{name}'")
    try:
        sp = sdir(name)
        if not os.path.exists(sp):
            logger.error(f"Upload failed: Server directory not found for '{name}'")
            raise HTTPException(404, "Server not found")
        dest = os.path.join(sp, "server-icon.png")
        data = await file.read()
        logger.info(f"Read {len(data)} bytes of image data for server '{name}'")
        
        # Attempt to resize to 64x64 (required by Minecraft for in-game server list icon)
        try:
            if Image is None:
                logger.warning("PIL Image is not available. Saving icon as-is.")
            else:
                img = Image.open(io.BytesIO(data)).convert("RGBA")
                img = img.resize((64, 64), Image.LANCZOS)
                buf = io.BytesIO()
                img.save(buf, format="PNG")
                data = buf.getvalue()
                logger.info(f"Successfully resized icon for '{name}' to 64x64 PNG")
        except Exception as resize_err:
            logger.warning(f"Failed to resize server icon for '{name}' (saving as-is): {resize_err}")
            
        try:
            with open(dest, "wb") as f:
                f.write(data)
            logger.info(f"Icon successfully saved to {dest}")
            return {"message": "Icon updated"}
        except PermissionError:
            logger.warning(f"server-icon.png is locked by the server process for '{name}'")
            raise HTTPException(409, "Server icon is currently locked by the server. Please stop the server to change the icon.")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during icon upload for '{name}': {e}", exc_info=True)
        raise HTTPException(500, f"Internal server error: {e}")


@app.post("/api/servers/{name}/playit/key")
def set_playit_key(name: str, req: PlayitKeyReq):
    sp = sdir(name)
    pdir = os.path.join(sp, ".playit")
    os.makedirs(pdir, exist_ok=True)
    with open(os.path.join(pdir, "playit.toml"), "w", encoding="utf-8") as f:
        f.write(f'secret_key = "{req.key}"\n')
    return {"message": "Playit key saved. Restart server to apply."}


# ─────────────────────────── Entry point ─────────────────────────────────────
def run_uvicorn():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")


keep_running_flag = False

def on_closing():
    global keep_running_flag
    # Check if any servers are running
    active = False
    for name, st in server_state.items():
        if st.get("phase") in ("starting", "running"):
            active = True
            break

    if not active:
        return True  # Allow close

    choice = show_exit_dialog()
    if choice == "kill":
        for name in list(server_state.keys()):
            stop_server(name, force=True)
        return True
    elif choice == "keep":
        keep_running_flag = True
        return True
    return False  # Cancel


def import_external_server(folder_path):
    if not os.path.isdir(folder_path):
        logger.error(f"[MeroHoster] Error: {folder_path} is not a directory.")
        return None
        
    files = os.listdir(folder_path)
    is_server = any(f in ["server.properties", "eula.txt", "run.bat", "run.sh"] for f in files) or any(f.endswith(".jar") for f in files)
    
    if not is_server:
        logger.error(f"[MeroHoster] Error: {folder_path} does not look like a Minecraft server.")
        return None
        
    folder_name = os.path.basename(os.path.normpath(folder_path))
    target_symlink = os.path.join(SERVERS_DIR, folder_name)
    
    if not os.path.exists(target_symlink):
        logger.info(f"[MeroHoster] Creating NTFS Junction to {folder_path}")
        subprocess.run(["cmd.exe", "/c", "mklink", "/J", target_symlink, folder_path], capture_output=True)
        
    engine = "paper"
    version = "1.20.1"
    
    if any("forge" in f.lower() for f in files):
        engine = "forge"
    elif any("fabric" in f.lower() for f in files):
        engine = "fabric"
    elif any("purpur" in f.lower() for f in files):
        engine = "purpur"
    elif any("spigot" in f.lower() for f in files):
        engine = "spigot"
        
    meta_path = os.path.join(target_symlink, "meta.json")
    if not os.path.exists(meta_path):
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({
                "type": engine,
                "version": version,
                "java": "java17",
                "args": "-Xmx4G -Xms4G"
            }, f, indent=4)
            
    return folder_name

if __name__ == "__main__":
    # Start pre-fetching IPs and specs in the background
    def prefetch_all():
        logger.info("[Mero] Prefetching hardware specs and IPs concurrently...")
        threading.Thread(target=get_local_ip, daemon=True).start()
        threading.Thread(target=get_public_ip, daemon=True).start()
        threading.Thread(target=_fetch_system_specs_bg, daemon=True).start()

    imported_server = None
    if len(sys.argv) > 1:
        folder = sys.argv[1]
        imported_server = import_external_server(folder)

    try:
        if os.path.exists(SERVERS_DIR):
            for sname in os.listdir(SERVERS_DIR):
                s_mods = os.path.join(SERVERS_DIR, sname, "mods")
                if os.path.isdir(s_mods):
                    for fn in os.listdir(s_mods):
                        if fn.lower().startswith("automodpack") and fn.lower().endswith(".jar.disabled"):
                            old_path = os.path.join(s_mods, fn)
                            new_path = os.path.join(s_mods, fn[:-9])
                            logger.info(f"[Mero Startup] Restoring leftover disabled AutoModpack: {old_path} -> {new_path}")
                            try:
                                if os.path.exists(new_path):
                                    os.remove(new_path)
                                os.rename(old_path, new_path)
                            except Exception as e:
                                logger.warning(f"[Mero Startup] Failed to restore leftover AutoModpack {fn}: {e}")
    except Exception as e:
        logger.error(f"[Mero Startup] Error restoring leftover AutoModpack mods: {e}")

    threading.Thread(target=prefetch_all, daemon=True).start()

    # Initialize Zombie Check
    check_zombies()

    threading.Thread(target=auto_backup_daemon, daemon=True).start()
    t = threading.Thread(target=run_uvicorn, daemon=True)
    t.start()
    
    # Wait for Uvicorn to be ready to avoid the long black screen
    for _ in range(50):
        try:
            with socket.create_connection(("127.0.0.1", 8000), timeout=0.1):
                break
        except Exception:
            pass
        time.sleep(0.1)

    if HAS_WEBVIEW:
        url = "http://127.0.0.1:8000"
        if imported_server:
            import urllib.parse
            url += f"/?server={urllib.parse.quote(imported_server)}"
        
        window = webview.create_window(
            title="MeroHoster",
            url=url,
            width=1280,
            height=820,
            min_size=(960, 640),
            background_color="#0d0f13",
            text_select=True,
            js_api=JSApi(),
        )
        window.events.closing += on_closing
        storage_path = os.path.join(DATA_DIR, ".webview_storage")
        
        # Aggressively clear WebView cache to prevent corrupted static files
        import shutil
        cache_dirs = [
            os.path.join(storage_path, "EBWebView", "Default", "Cache"),
            os.path.join(storage_path, "EBWebView", "Default", "Code Cache"),
            os.path.join(storage_path, "EBWebView", "Default", "GPUCache")
        ]
        for d in cache_dirs:
            if os.path.exists(d):
                try:
                    shutil.rmtree(d, ignore_errors=True)
                except:
                    pass

        try:
            webview.start(gui="edgechromium", private_mode=False, storage_path=storage_path)
        except Exception as e:
            logger.error(f"[MeroHoster] Edge Chromium WebView2 failed to start: {e}")
            import tkinter as tk
            from tkinter import messagebox
            root = tk.Tk()
            root.withdraw()
            root.attributes("-topmost", True)
            messagebox.showwarning(
                "Missing Microsoft Edge WebView2", 
                "MeroHoster requires 'Microsoft Edge WebView2' to display the desktop app, but it is not installed on this PC.\n\n"
                "Don't worry! We will now open the dashboard safely in your default web browser instead."
            )
            root.destroy()
            import webbrowser
            webbrowser.open(url)
            
            # Keep the backend alive
            while True:
                time.sleep(1)
        
        if keep_running_flag:
            import customtkinter as ctk
            import sys
            
            app = ctk.CTk()
            app.title("MeroHoster - Background Process")
            app.geometry("350x150")
            app.configure(fg_color="#0d0f13")
            
            ctk.CTkLabel(app, text="MeroHoster Dashboard Closed", font=("Arial", 16, "bold"), text_color="#39FF14").pack(pady=(20, 5))
            ctk.CTkLabel(app, text="Minecraft servers are still running in the background.", text_color="gray").pack(pady=(0, 15))
            
            def full_shutdown():
                for name in list(server_state.keys()):
                    stop_server(name, force=True)
                app.destroy()
                sys.exit(0)
                
            ctk.CTkButton(app, text="Shutdown All Servers & Exit", fg_color="#FF3131", hover_color="#c0392b", command=full_shutdown).pack()
            app.protocol("WM_DELETE_WINDOW", full_shutdown)
            app.mainloop()
            
    else:
        url = "http://127.0.0.1:8000"
        if imported_server:
            import urllib.parse
            url += f"/?server={urllib.parse.quote(imported_server)}"
        logger.info(
            f"Starting in headless browser mode. Access at {url}"
        )
        webbrowser.open(url)
        while True:
            time.sleep(1)

