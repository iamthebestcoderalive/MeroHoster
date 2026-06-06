import _winapi
import base64
import ctypes
import json
import os
import re
import shutil
import socket
import struct
import subprocess
import threading
import time
import traceback
from tkinter import filedialog, messagebox

import customtkinter as ctk
import minecraft_launcher_lib
import requests
import urllib3
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import sys

# --- 8-Bit Font System ---
FONT_HEADING = "Press Start 2P"
FONT_BODY = "VT323"
CLIENT_VERSION = "v1.0.0"

def load_custom_fonts():
    if sys.platform != "win32":
        return
    import ctypes
    font_dir = os.path.join(os.path.expanduser("~"), ".mero_fonts")
    os.makedirs(font_dir, exist_ok=True)
    
    font_urls = {
        "PressStart2P-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/pressstart2p/PressStart2P-Regular.ttf",
        "VT323-Regular.ttf": "https://github.com/google/fonts/raw/main/ofl/vt323/VT323-Regular.ttf"
    }
    
    for filename, url in font_urls.items():
        font_path = os.path.join(font_dir, filename)
        if not os.path.exists(font_path):
            try:
                print(f"[Mero] Downloading {filename}...")
                r = requests.get(url, timeout=10)
                if r.status_code == 200:
                    with open(font_path, "wb") as f:
                        f.write(r.content)
            except Exception as e:
                print(f"[Mero] Failed to download {filename}: {e}")
                
        if os.path.exists(font_path):
            try:
                # FR_PRIVATE = 0x10, FR_NOT_ENUM = 0x20
                res = ctypes.windll.gdi32.AddFontResourceExW(font_path, 0x10, 0)
                if res:
                    print(f"[Mero] Loaded custom font: {filename}")
            except Exception as e:
                print(f"[Mero] Failed to register {filename}: {e}")

# Try to load custom fonts immediately
try:
    load_custom_fonts()
except Exception as e:
    print(f"[Mero] Font loader initialization failed: {e}")

def get_font(font_type, size, weight="normal"):
    """
    Helper function to scale and resolve 8-bit fonts properly.
    """
    if font_type == "heading":
        adj_size = max(8, int(size * 0.55))
        return (FONT_HEADING, adj_size, weight)
    else:
        adj_size = int(size * 1.35)
        return (FONT_BODY, adj_size, weight)


# --- The Deadlock Fix (Preserved) ---
_original_init = requests.Session.__init__


def _patched_init(self, *args, **kwargs):
    _original_init(self, *args, **kwargs)
    retry = Retry(connect=3, backoff_factor=0.5)
    adapter = HTTPAdapter(pool_connections=50, pool_maxsize=50, max_retries=retry)
    self.mount("http://", adapter)
    self.mount("https://", adapter)


requests.Session.__init__ = _patched_init

# --- Color Palette ---
DARKER_CHARCOAL = "#1A1A1A"
CHARCOAL = "#2B2B2B"
NEON_GREEN = "#39FF14"
ACCENT_BLUE = "#1E90FF"
TEXT_COLOR = "#E0E0E0"
ERROR_RED = "#FF3131"


# --- Tunnel Logic (Preserved) ---
class MeroTunnel:
    def __init__(self, host_ip, udp_port):
        self.host_addr = (host_ip, int(udp_port))
        self.udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.lsock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.lsock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.lsock.bind(("127.0.0.1", 0))
        self.local_tcp_port = self.lsock.getsockname()[1]
        self.running = True
        self.streams = {}
        self.next_conn_id = 1
        self.streams_lock = threading.Lock()

    def start(self):
        threading.Thread(target=self.punch_hole, daemon=True).start()
        threading.Thread(target=self.udp_listener, daemon=True).start()
        threading.Thread(target=self.start_local_listener, daemon=True).start()

    def stop(self):
        self.running = False
        try:
            self.udp_sock.close()
        except:
            pass
        try:
            self.lsock.close()
        except:
            pass
        with self.streams_lock:
            for s in self.streams.values():
                try:
                    s.close()
                except:
                    pass

    def punch_hole(self):
        while self.running:
            try:
                self.udp_sock.sendto(b"HOLE_PUNCH", self.host_addr)
            except:
                pass
            time.sleep(5)

    def udp_listener(self):
        while self.running:
            try:
                data, addr = self.udp_sock.recvfrom(16384)
                if len(data) >= 4:
                    conn_id = struct.unpack(">I", data[:4])[0]
                    payload = data[4:]
                    with self.streams_lock:
                        if len(payload) == 0 and conn_id in self.streams:
                            try:
                                self.streams[conn_id].close()
                            except:
                                pass
                            del self.streams[conn_id]
                        elif conn_id in self.streams:
                            try:
                                self.streams[conn_id].sendall(payload)
                            except:
                                pass
            except:
                break

    def start_local_listener(self):
        try:
            self.lsock.listen(10)
            while self.running:
                conn, addr = self.lsock.accept()
                with self.streams_lock:
                    conn_id = self.next_conn_id
                    self.next_conn_id += 1
                    self.streams[conn_id] = conn
                threading.Thread(
                    target=self.bridge_tcp_to_udp, args=(conn, conn_id), daemon=True
                ).start()
        except:
            pass
        finally:
            self.lsock.close()

    def bridge_tcp_to_udp(self, conn, conn_id):
        try:
            while self.running:
                data = conn.recv(16384)
                packet = struct.pack(">I", conn_id) + data
                self.udp_sock.sendto(packet, self.host_addr)
                if not data:
                    break
        except:
            pass
        finally:
            with self.streams_lock:
                if conn_id in self.streams:
                    del self.streams[conn_id]
            try:
                conn.close()
            except:
                pass
            try:
                self.udp_sock.sendto(struct.pack(">I", conn_id), self.host_addr)
            except:
                pass


# --- Wizard Application ---
class MeroWizard(ctk.CTk):
    def __init__(self):
        super().__init__()
        self.title("Mero Uplink Wizard")
        self.geometry("650x550")
        self.configure(fg_color=DARKER_CHARCOAL)
        self.resizable(False, False)

        self.payload = None
        self.manifest = None
        self.selected_instance_path = None
        self.current_tunnel = None
        self.mode = None  # "use" or "create"
        self.disabled_mods = []
        
        self.config_path = os.path.join(os.path.expanduser("~"), ".mero_client_cfg.json")
        self.servers = []
        self.current_server_id = None
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r") as f:
                    data = json.load(f)
                    if "servers" in data:
                        self.servers = data["servers"]
                    elif "invite_code" in data:
                        # Migrate old config
                        pass
            except Exception:
                pass

        self.protocol("WM_DELETE_WINDOW", self.destroy)

        # Launcher detection paths (Mainly for State 2A now)
        self.launcher_configs = {
            "Official / SK / TLauncher": os.path.join(
                os.getenv("APPDATA"), ".minecraft"
            ),
            "Prism Launcher": os.path.join(os.getenv("APPDATA"), "PrismLauncher"),
            "Modrinth App": os.path.join(os.getenv("APPDATA"), "com.modrinth.app"),
            "MultiMC": os.path.join(os.getenv("APPDATA"), "MultiMC"),
        }
        self.detected_launchers = self.detect_launchers()

        self.main_container = ctk.CTkFrame(self, fg_color="transparent")
        self.main_container.pack(fill="both", expand=True, padx=40, pady=40)

        self.show_state_menu()
        self.after(500, self.refresh_servers)

    def save_config(self):
        try:
            with open(self.config_path, "w") as f:
                json.dump({"servers": self.servers}, f, indent=2)
        except Exception as e:
            print(f"[Mero] Failed to save config: {e}")

    def clear_container(self):
        for widget in self.main_container.winfo_children():
            widget.destroy()

    def detect_launchers(self):
        found = {}
        for name, path in self.launcher_configs.items():
            if os.path.exists(path):
                found[name] = path
        if not found:
            found = self.launcher_configs.copy()
        return found

    def create_mero_link(self, src, dst):
        try:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.exists(dst) or os.path.islink(dst):
                if os.path.islink(dst) or os.path.isfile(dst):
                    os.remove(dst)
                elif os.path.isdir(dst):
                    shutil.rmtree(dst)
            is_dir = 1 if os.path.isdir(src) else 0
            flags = is_dir | 0x2
            
            # Specify argtypes and restype for Windows API to correctly pass Unicode strings
            ctypes.windll.kernel32.CreateSymbolicLinkW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong]
            ctypes.windll.kernel32.CreateSymbolicLinkW.restype = ctypes.c_ubyte
            
            res = ctypes.windll.kernel32.CreateSymbolicLinkW(dst, src, flags)
            if not res:
                if is_dir:
                    try:
                        import _winapi
                        _winapi.CreateJunction(os.path.abspath(src), os.path.abspath(dst))
                    except Exception as je:
                        print(f"Junction failed, falling back to copytree: {je}")
                        shutil.copytree(src, dst)
                else:
                    ctypes.windll.kernel32.CreateHardLinkW.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_void_p]
                    ctypes.windll.kernel32.CreateHardLinkW.restype = ctypes.c_ubyte
                    res_hl = ctypes.windll.kernel32.CreateHardLinkW(dst, src, None)
                    if not res_hl:
                        print("Hard link failed, falling back to copy file.")
                        shutil.copy2(src, dst)
        except Exception as e:
            print(f"Link failed {dst}: {e}")

    def cleanup_mero_links(self, target_dir):
        if not os.path.exists(target_dir):
            return
        for fn in os.listdir(target_dir):
            if fn.startswith("[Mero]"):
                full_path = os.path.join(target_dir, fn)
                try:
                    if os.path.islink(full_path) or os.path.isfile(full_path):
                        os.remove(full_path)
                    elif os.path.isdir(full_path):
                        shutil.rmtree(full_path)
                except Exception as e:
                    print(f"Cleanup failed {fn}: {e}")

    def toggle_step(self, btn):
        current_text = btn.cget("text")
        if "~~" in current_text:
            new_text = current_text.replace("~~", "")
            btn.configure(text=new_text, text_color=TEXT_COLOR)
        else:
            btn.configure(text=f"~~{current_text}~~", text_color="gray")

    # --- State -1: Home Menu ---
    def show_state_menu(self):
        self.clear_container()
        self.current_server_id = None

        # Top Bar
        top_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        top_frame.pack(fill="x", pady=(0, 20))

        # Title
        ctk.CTkLabel(
            top_frame,
            text="MERO SERVERS",
            font=get_font("heading", 24, "bold"),
            text_color=NEON_GREEN,
        ).pack(side="left")

        # Top Bar Buttons
        btn_frame = ctk.CTkFrame(top_frame, fg_color="transparent")
        btn_frame.pack(side="right")

        ctk.CTkButton(
            btn_frame,
            text="Refresh",
            width=80,
            fg_color=CHARCOAL,
            hover_color="#555555",
            command=self.refresh_servers,
        ).pack(side="left", padx=5)

        ctk.CTkButton(
            btn_frame,
            text="+ Add Server",
            width=100,
            fg_color=NEON_GREEN,
            text_color="black",
            hover_color="#2ECC71",
            command=lambda: self.show_state_0_auth(),
        ).pack(side="left", padx=5)

        # Server List Frame (Scrollable)
        self.list_frame = ctk.CTkScrollableFrame(
            self.main_container,
            fg_color="transparent",
            width=500,
            height=400,
        )
        self.list_frame.pack(fill="both", expand=True)

        if not self.servers:
            ctk.CTkLabel(
                self.list_frame,
                text="You don't have any servers created yet.",
                font=get_font("body", 16),
                text_color="gray",
            ).pack(pady=100)
        else:
            for s in self.servers:
                self.draw_server_card(s)

    def draw_server_card(self, server_info):
        card = ctk.CTkFrame(
            self.list_frame,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            border_width=2,
            corner_radius=10,
            cursor="hand2",
        )
        card.pack(fill="x", pady=10, padx=5, ipady=10)

        top_row = ctk.CTkFrame(card, fg_color="transparent")
        top_row.pack(fill="x", padx=15, pady=(10, 5))

        ctk.CTkLabel(
            top_row,
            text=server_info.get("name", "Unknown Server"),
            font=get_font("heading", 18, "bold"),
            text_color="white",
        ).pack(side="left")

        # Edit Button
        edit_btn = ctk.CTkButton(
            top_row,
            text="Edit",
            width=50,
            height=24,
            fg_color="transparent",
            border_color=NEON_GREEN,
            border_width=1,
            text_color=NEON_GREEN,
            hover_color=CHARCOAL,
            command=lambda s=server_info: self.show_state_edit(s)
        )
        edit_btn.pack(side="right", padx=(10, 0))

        status_text = server_info.get("status", "Checking...").capitalize()
        status_color = ERROR_RED if status_text == "Offline" else (NEON_GREEN if status_text in ("Running", "Online") else "orange")
        if status_text == "Running": status_text = "Online"

        update_needed = server_info.get("update_needed", False)
        if update_needed:
            notif = ctk.CTkLabel(
                top_row,
                text=" ! ",
                font=get_font("heading", 14, "bold"),
                fg_color=ERROR_RED,
                text_color="white",
                corner_radius=15,
            )
            notif.pack(side="right")
        else:
            ctk.CTkLabel(
                top_row,
                text=status_text,
                font=get_font("body", 12),
                text_color=status_color,
            ).pack(side="right")

        bottom_row = ctk.CTkFrame(card, fg_color="transparent")
        bottom_row.pack(fill="x", padx=15, pady=(0, 10))

        plat_ver = f"{str(server_info.get('platform', 'Vanilla')).capitalize()} {server_info.get('version', '1.20')}"
        ctk.CTkLabel(
            bottom_row,
            text=plat_ver,
            font=get_font("body", 12),
            text_color="gray",
        ).pack(side="left")

        path_str = server_info.get("instance_path", "")
        if path_str:
            path_lbl = ctk.CTkLabel(
                bottom_row,
                text=path_str,
                font=get_font("body", 11, "underline"),
                text_color=NEON_GREEN,
                cursor="hand2",
            )
            path_lbl.pack(side="left", padx=(10, 0))
            
            def open_path(e, p=path_str):
                if os.path.exists(p):
                    os.startfile(p)
            
            path_lbl.bind("<Button-1>", open_path)
            # Prevent path label click from bubbling
            path_lbl.bind("<ButtonRelease-1>", lambda e: "break")

        def on_click(event, s=server_info):
            self.on_server_click(s)

        card.bind("<Button-1>", on_click)
        top_row.bind("<Button-1>", on_click)
        bottom_row.bind("<Button-1>", on_click)
        # Bind children except the ones that have their own commands
        for child in card.winfo_children():
            if child not in (edit_btn,):
                child.bind("<Button-1>", on_click)
                for sub in child.winfo_children():
                    if sub.winfo_name() not in getattr(path_lbl, "winfo_name", lambda: "")():
                        sub.bind("<Button-1>", on_click)

    def on_server_click(self, server_info):
        self.current_server_id = server_info.get("id")
        if server_info.get("update_needed"):
            self.show_state_0_auth(is_update=True)
        else:
            # Quick Launch
            self.payload = server_info.get("payload")
            self.manifest = server_info.get("manifest")
            
            # Auto-update the server name if it was missing before but manifest has it now
            if server_info.get("name") == "Mero Server" and self.manifest and self.manifest.get("name"):
                server_info["name"] = self.manifest.get("name")
                self.save_config()

            self.selected_instance_path = server_info.get("instance_path")
            if not self.selected_instance_path or not os.path.exists(self.selected_instance_path):
                self.show_state_2_selection()
            else:
                self.mode = "use"
                self.show_state_3_execution()

    def show_state_edit(self, server_info):
        self.clear_container()

        ctk.CTkLabel(
            self.main_container,
            text="EDIT SERVER",
            font=get_font("heading", 24, "bold"),
            text_color=NEON_GREEN,
        ).pack(pady=(40, 20))

        code_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        code_frame.pack(fill="x", pady=(0, 20), padx=20)

        code_entry = ctk.CTkEntry(
            code_frame,
            height=40,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            text_color=TEXT_COLOR,
            placeholder_text="Enter new Invite Code (optional)",
        )
        code_entry.pack(side="left", expand=True, fill="x")
        code_entry.insert(0, server_info.get("invite_code", ""))

        path_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        path_frame.pack(fill="x", pady=20, padx=20)

        path_entry = ctk.CTkEntry(
            path_frame,
            height=40,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            text_color=TEXT_COLOR,
        )
        path_entry.pack(side="left", expand=True, fill="x", padx=(0, 10))
        path_entry.insert(0, server_info.get("instance_path", ""))

        def do_browse():
            p = filedialog.askdirectory(title="Select New Instance Folder")
            if p:
                path_entry.delete(0, "end")
                path_entry.insert(0, p)

        browse_btn = ctk.CTkButton(
            path_frame,
            text="[ Browse... ]",
            width=100,
            height=40,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            border_width=1,
            command=do_browse,
        )
        browse_btn.pack(side="left")

        btn_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        btn_frame.pack(side="bottom", pady=40)

        def do_save():
            new_path = path_entry.get().strip()
            if new_path and new_path != server_info.get("instance_path"):
                old_vault = os.path.join(server_info.get("instance_path", ""), ".mero_vault")
                new_vault = os.path.join(new_path, ".mero_vault")
                if os.path.exists(old_vault):
                    try:
                        import shutil
                        shutil.move(old_vault, new_vault)
                        print(f"[Mero] Moved vault to {new_vault}")
                    except Exception as e:
                        print(f"[Mero] Move failed: {e}")
                server_info["instance_path"] = new_path
                
            new_code = code_entry.get().strip()
            if new_code and new_code != server_info.get("invite_code"):
                server_info["invite_code"] = new_code
                try:
                    b64_str = new_code.split("MERO-")[1]
                    decoded_str = base64.b64decode(b64_str).decode()
                    if decoded_str.startswith("http"):
                        import requests
                        r = requests.get(decoded_str, timeout=5)
                        if r.status_code == 200:
                            payload = r.json()
                            payload["signal_bucket"] = decoded_str
                            server_info["payload"] = payload
                    else:
                        server_info["payload"] = json.loads(decoded_str)
                    server_info["update_needed"] = True
                except:
                    pass

            self.save_config()
            self.show_state_menu()

        ctk.CTkButton(
            btn_frame,
            text="< CANCEL",
            width=100,
            height=40,
            fg_color="transparent",
            text_color=TEXT_COLOR,
            hover_color=CHARCOAL,
            command=self.show_state_menu,
        ).pack(side="left", padx=10)

        def do_delete():
            if server_info in self.servers:
                self.servers.remove(server_info)
                self.save_config()
            self.show_state_menu()

        ctk.CTkButton(
            btn_frame,
            text="DELETE",
            width=100,
            height=40,
            fg_color=ERROR_RED,
            text_color="white",
            font=get_font("heading", 13, "bold"),
            hover_color="#c0392b",
            command=do_delete,
        ).pack(side="left", padx=10)

        ctk.CTkButton(
            btn_frame,
            text="SAVE",
            width=150,
            height=40,
            fg_color=NEON_GREEN,
            text_color="black",
            font=get_font("heading", 13, "bold"),
            hover_color="#2ECC71",
            command=do_save,
        ).pack(side="left", padx=10)

    def refresh_servers(self):
        def ping_worker():
            for s in self.servers:
                i_path = s.get("instance_path")
                if i_path:
                    s["name"] = __import__('os').path.basename(i_path.rstrip('/\\'))

                payload = s.get("payload")
                if not payload: continue
                
                # Try to fetch latest dynamic IP/Port from signal server
                signal_bucket = payload.get("signal_bucket")
                if signal_bucket:
                    try:
                        import requests
                        r = requests.get(signal_bucket, timeout=5)
                        if r.status_code == 200:
                            sig_data = r.json()
                            payload["ip"] = sig_data.get("ip")
                            payload["udp_port"] = sig_data.get("udp_port")
                            if sig_data.get("status") == "offline":
                                s["status"] = "Offline"
                                s["update_needed"] = False
                                continue
                    except Exception as e:
                        print(f"Failed to fetch signal for {s.get('name')}: {e}")

                ip = payload.get("ip")
                udp_port = payload.get("udp_port")
                if not ip or not udp_port: continue
                
                try:
                    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    sock.settimeout(2.0)
                    packet = struct.pack(">I", 0) + b"STATUS"
                    
                    # Try local loopback first
                    mc_port = payload.get("mc_port")
                    success = False
                    if mc_port:
                        try:
                            sock.settimeout(0.5)
                            sock.sendto(packet, ("127.0.0.1", mc_port))
                            data, _ = sock.recvfrom(2048)
                            success = True
                        except Exception:
                            pass
                            
                    if not success:
                        sock.settimeout(2.0)
                        sock.sendto(packet, (ip, udp_port))
                        data, _ = sock.recvfrom(2048)
                        
                    if len(data) > 4:
                        raw_str = data[4:].decode()
                        if raw_str.startswith("{"):
                            status_json = json.loads(raw_str)
                            m_url = status_json.get("url", "")
                            s["status"] = status_json.get("status", "Unknown").capitalize()
                        else:
                            m_url = raw_str
                            s["status"] = "Online"
                            
                        if m_url and m_url != s.get("manifest_url"):
                            s["update_needed"] = True
                            s["manifest_url"] = m_url
                        else:
                            s["update_needed"] = False
                except Exception as e:
                    s["status"] = "Offline"
            self.save_config()
            self.after(0, self.show_state_menu)
            
        threading.Thread(target=ping_worker, daemon=True).start()

    # --- State 0: Auth Frame ---
    def show_state_0_auth(self, is_update=False):
        self.clear_container()

        nav_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        nav_frame.pack(fill="x", pady=(0, 10))
        ctk.CTkButton(
            nav_frame,
            text="< Menu",
            width=60,
            height=30,
            fg_color="transparent",
            text_color=TEXT_COLOR,
            hover_color=CHARCOAL,
            command=self.show_state_menu,
        ).pack(side="left")

        title = "UPDATE SERVER" if is_update else "MERO UPLINK"
        ctk.CTkLabel(
            self.main_container,
            text=title,
            font=get_font("heading", 28, "bold"),
            text_color=NEON_GREEN,
        ).pack(pady=(10, 30))

        self.invite_entry = ctk.CTkEntry(
            self.main_container,
            placeholder_text="Enter MERO Invite Code",
            width=400,
            height=45,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            text_color=TEXT_COLOR,
        )
        # Don't auto-fill if updating, because they need to enter the NEW code
        if not is_update:
            # We don't pre-fill self.last_code anymore since it's an old system, but we could pre-fill from a server
            pass
            
        self.invite_entry.pack(pady=10)

        self.auth_error_lbl = ctk.CTkLabel(
            self.main_container, text="", font=get_font("body", 12), text_color=ERROR_RED
        )
        self.auth_error_lbl.pack()

        ctk.CTkButton(
            self.main_container,
            text="CHECK CONNECTION",
            width=400,
            height=50,
            font=get_font("heading", 14, "bold"),
            fg_color=NEON_GREEN,
            text_color="black",
            hover_color="#2ECC71",
            command=self.validate_uplink,
        ).pack(pady=20)

    def validate_uplink(self):
        code = self.invite_entry.get().strip()
        if not code.startswith("MERO-"):
            self.auth_error_lbl.configure(text="Invalid Uplink Code")
            return
        
        self.validated_invite_code = code

        try:
            import requests, hashlib
            b64_str = code.split("MERO-")[1]
            decoded_str = base64.b64decode(b64_str).decode()
            
            parts = decoded_str.split("|")
            sig_url = parts[0]
            enc_key = parts[1] if len(parts) > 1 else None
            enc_hex = parts[2] if len(parts) > 2 else None

            if sig_url.startswith("http"):
                r = requests.get(sig_url, timeout=10)
                if r.status_code == 200:
                    data = r.json()
                    if "e" in data and enc_key:
                        enc_hex = data["e"]
                    else:
                        self.payload = data
                    if self.payload is None: 
                        self.payload = {}
                    self.payload["signal_bucket"] = sig_url
                else:
                    self.auth_error_lbl.configure(text="Failed to resolve Invite Code")
                    return
            elif not enc_hex and not enc_key:
                self.payload = json.loads(decoded_str)

            if enc_hex and enc_key:
                enc_data = bytes.fromhex(enc_hex)
                stream = b""
                i = 0
                while len(stream) < len(enc_data):
                    stream += hashlib.sha256((enc_key + str(i)).encode()).digest()
                    i += 1
                dec_data = bytes(a ^ b for a, b in zip(enc_data, stream))
                parsed = json.loads(dec_data.decode('utf-8'))
                if hasattr(self, "payload") and "signal_bucket" in self.payload:
                    parsed["signal_bucket"] = self.payload["signal_bucket"]
                self.payload = parsed
            m_url = self.payload.get("manifest_url")

            if m_url:
                r = requests.get(m_url, timeout=10)
                if r.status_code == 200:
                    self.manifest = r.json()

            # We will save the server to config AFTER instance selection (in start_sync)
            self.mode = "use"
            if self.current_server_id:
                # Update flow: we already know the instance path, jump to execution
                server = next((s for s in self.servers if s["id"] == self.current_server_id), None)
                if server:
                    server["invite_code"] = code
                    server["payload"] = self.payload
                    server["manifest"] = self.manifest
                    server["manifest_url"] = m_url
                    server["update_needed"] = False
                    self.selected_instance_path = server.get("instance_path")
                    self.save_config()
                    self.show_state_3_execution()
                    return
                    
            self.show_state_2_selection()
        except Exception as e:
            self.auth_error_lbl.configure(text=f"Validation Failed: {str(e)[:30]}")

    def show_state_2_selection(self):
        self.clear_container()

        # 1. Server Brief Header
        brief_frame = ctk.CTkFrame(
            self.main_container,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            border_width=1,
        )
        brief_frame.pack(fill="x", pady=(0, 20))

        mc_ver = self.manifest.get("minecraft_version", "Unknown")
        loader = self.manifest.get("loader_type", "Vanilla").capitalize()
        mods_count = len(self.manifest.get("mods", []))
        rp_count = len(self.manifest.get("resourcepacks", []))
        sp_count = len(self.manifest.get("shaderpacks", []))

        header_text = f"PLATFORM: {loader} | VERSION: {mc_ver}\nSTATS: {mods_count} Mods, {rp_count} Resources, {sp_count} Shaders"
        ctk.CTkLabel(
            brief_frame,
            text=header_text,
            font=get_font("body", 12, "bold"),
            text_color=NEON_GREEN,
        ).pack(pady=10)

        # 2. Potato Mode Toggles
        toggle_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        toggle_frame.pack(fill="x", pady=10)

        self.sync_rp_var = ctk.BooleanVar(value=True)
        self.sync_sp_var = ctk.BooleanVar(value=True)

        ctk.CTkCheckBox(
            toggle_frame,
            text="Sync Resourcepacks",
            variable=self.sync_rp_var,
            border_color=NEON_GREEN,
            checkmark_color=NEON_GREEN,
        ).pack(side="left", padx=20)
        ctk.CTkCheckBox(
            toggle_frame,
            text="Sync Shaders",
            variable=self.sync_sp_var,
            border_color=NEON_GREEN,
            checkmark_color=NEON_GREEN,
        ).pack(side="left", padx=20)

        # 3. Interactive To-Do List
        todo_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        todo_frame.pack(fill="both", expand=True, pady=10)

        step_1_text = (
            f"Step 1: Open Launcher and create a NEW [{mc_ver}] {loader} instance."
        )
        steps = [
            step_1_text,
            "Step 2: Browse to that instance's folder using the button below.",
            "Step 3: Click Sync & Connect to finalize the uplink.",
        ]

        for i, step in enumerate(steps):
            is_step_1 = i == 0
            btn = ctk.CTkButton(
                todo_frame,
                text=step,
                anchor="w",
                fg_color="transparent",
                hover_color=CHARCOAL,
                text_color=NEON_GREEN if is_step_1 else TEXT_COLOR,
                font=get_font("body", 12, "bold" if is_step_1 else "normal"),
            )
            btn.configure(command=lambda b=btn: self.toggle_step(b))
            btn.pack(fill="x", pady=2)

        # 4. Path & Action
        path_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        path_frame.pack(side="bottom", fill="x", pady=(20, 0))

        ctk.CTkButton(
            path_frame,
            text="< Back",
            width=80,
            height=40,
            fg_color="transparent",
            text_color=TEXT_COLOR,
            hover_color=CHARCOAL,
            command=self.show_state_0_auth,
        ).pack(side="left", padx=(0, 10))

        self.path_entry = ctk.CTkEntry(
            path_frame,
            height=40,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            text_color=TEXT_COLOR,
            placeholder_text="Instance Path...",
        )
        self.path_entry.pack(side="left", expand=True, fill="x", padx=(0, 10))
        self.path_entry.bind("<KeyRelease>", lambda e: self.validate_path())

        browse_btn = ctk.CTkButton(
            path_frame,
            text="[ Browse... ]",
            width=100,
            height=40,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            border_width=1,
            command=self.browse_instance_path,
        )
        browse_btn.pack(side="left", padx=(0, 10))

        self.sync_btn = ctk.CTkButton(
            path_frame,
            text="SYNC & CONNECT",
            width=180,
            height=40,
            fg_color="gray",
            state="disabled",
            text_color="black",
            font=get_font("heading", 13, "bold"),
            command=self.start_sync,
        )
        self.sync_btn.pack(side="right")

    def validate_path(self):
        path = self.path_entry.get().strip()
        if path and os.path.exists(path):
            self.sync_btn.configure(state="normal", fg_color=NEON_GREEN)
        else:
            self.sync_btn.configure(state="disabled", fg_color="gray")

    def browse_instance_path(self):
        path = filedialog.askdirectory(title="Select Minecraft Instance Folder")
        if path:
            self.path_entry.delete(0, "end")
            self.path_entry.insert(0, path)
            self.validate_path()

    def start_sync(self):
        self.selected_instance_path = self.path_entry.get().strip()
        self.show_state_3_execution()

    def cancel_execution(self):
        self.cancel_sync_flag = True
        self.cancel_btn.configure(state="disabled", text="CANCELLING...")
        def do_rollback():
            self.rollback_execution()
            self.after(0, self.show_state_2_selection)
        threading.Thread(target=do_rollback, daemon=True).start()

    def rollback_execution(self):
        try:
            path = getattr(self, 'selected_instance_path', None)
            if not path or not os.path.exists(path):
                return
                
            self.update_exec("Rolling back changes...", 0)
            print("[Mero Wizard] Rolling back execution...")
            
            # 1. Clean up symlinks
            for d in ["mods", "resourcepacks", "shaderpacks"]:
                self.cleanup_mero_links(os.path.join(path, d))
                
            # 2. Restore disabled AutoModpack
            self.restore_disabled_mods()
            
            # 3. Clean up JVM args if any were injected
            current_dir = path
            profiles_path = None
            for _ in range(5):
                candidate = os.path.join(current_dir, "launcher_profiles.json")
                if os.path.isfile(candidate):
                    profiles_path = candidate
                    break
                parent = os.path.dirname(current_dir)
                if parent == current_dir:
                    break
                current_dir = parent

            if profiles_path:
                try:
                    with open(profiles_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    for prof_id, prof in data.get("profiles", {}).items():
                        java_args = prof.get("javaArgs", "")
                        java_args = re.sub(
                            r'-Dfabric\.addMods="[^"]*"|-Dfabric\.addMods=\S+',
                            '', java_args
                        ).strip()
                        prof["javaArgs"] = java_args
                    with open(profiles_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                except Exception as e:
                    print(f"Rollback JVM arg failed: {e}")

            # Also check instance.cfg
            for search_dir in [path, os.path.dirname(path)]:
                cfg_path = os.path.join(search_dir, "instance.cfg")
                if os.path.isfile(cfg_path):
                    try:
                        with open(cfg_path, "r", encoding="utf-8") as f:
                            lines = f.readlines()
                        for i, line in enumerate(lines):
                            if line.startswith("OverrideCommands=true"):
                                lines[i] = "OverrideCommands=false\n"
                            if line.startswith("JvmArgs="):
                                new_args = re.sub(r'-Dfabric\.addMods="[^"]*"|-Dfabric\.addMods=\S+', '', line)
                                lines[i] = new_args
                        with open(cfg_path, "w", encoding="utf-8") as f:
                            f.writelines(lines)
                    except Exception as e:
                        pass
        except Exception as e:
            print(f"[Mero Wizard] Rollback failed: {e}")

    # --- State 3: Execution Engine ---
    def show_state_3_execution(self):
        self.clear_container()
        ctk.CTkLabel(
            self.main_container,
            text="UPLINK IN PROGRESS",
            font=get_font("heading", 22, "bold"),
            text_color=NEON_GREEN,
        ).pack(pady=(10, 40))
        self.exec_progress = ctk.CTkProgressBar(
            self.main_container,
            width=450,
            height=15,
            progress_color=NEON_GREEN,
            fg_color=CHARCOAL,
        )
        self.exec_progress.pack(pady=10)
        self.exec_progress.set(0)
        self.exec_status = ctk.CTkLabel(
            self.main_container,
            text="Initializing Throttled Engine...",
            font=get_font("body", 12),
            text_color=TEXT_COLOR,
        )
        self.exec_status.pack(pady=10)

        self.cancel_sync_flag = False
        self.cancel_btn = ctk.CTkButton(
            self.main_container,
            text="CANCEL UPLINK",
            width=200,
            fg_color="transparent",
            border_color=ERROR_RED,
            border_width=1,
            text_color=ERROR_RED,
            command=self.cancel_execution,
        )
        self.cancel_btn.pack(pady=20)

        threading.Thread(target=self.execution_worker, daemon=True).start()

    def update_exec(self, status=None, progress=None):
        if status:
            self.after(0, lambda: self.exec_status.configure(text=status))
        if progress is not None:
            self.after(0, lambda: self.exec_progress.set(progress))

    def execution_worker(self):
        try:
            path = self.selected_instance_path

            loader_type = (
                self.manifest.get("loader_type", "vanilla").lower()
                if self.manifest
                else "vanilla"
            )
            self.loader_type = loader_type
            is_modded = loader_type in ["fabric", "forge", "quilt"]

            if not is_modded:
                self.update_exec("Vanilla/Plugin Server - Skipping Mods", 0.05)
                time.sleep(1)

            # 1. Prepare Vault
            vault_dir = os.path.join(path, ".mero_vault")
            v_mods = os.path.join(vault_dir, "mods")
            v_rps = os.path.join(vault_dir, "resourcepacks")
            v_sps = os.path.join(vault_dir, "shaderpacks")
            
            folders_to_make = [v_rps, v_sps]
            if is_modded:
                folders_to_make.append(v_mods)
                
            for d in folders_to_make:
                os.makedirs(d, exist_ok=True)

            # Cleanup old links
            for d in ["mods", "resourcepacks", "shaderpacks"]:
                self.cleanup_mero_links(os.path.join(path, d))

            # Scan client mods directory and rename automodpack*.jar to automodpack*.jar.disabled
            if is_modded:
                client_mods_dir = os.path.join(path, "mods")
                if os.path.isdir(client_mods_dir):
                    for fn in os.listdir(client_mods_dir):
                        if fn.lower().startswith("automodpack") and fn.lower().endswith(".jar"):
                            old_path = os.path.join(client_mods_dir, fn)
                            new_path = os.path.join(client_mods_dir, fn + ".disabled")
                            print(f"[Mero Wizard] Disabling AutoModpack: {old_path} -> {new_path}")
                            try:
                                if os.path.exists(new_path):
                                    os.remove(new_path)
                                os.rename(old_path, new_path)
                                self.disabled_mods.append(new_path)
                            except Exception as e:
                                print(f"[Mero Wizard] Failed to disable client AutoModpack: {e}")

            mc_ver = (
                self.manifest.get("minecraft_version", "1.21")
                if self.manifest
                else "1.21"
            )
            if self.mode == "create":
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        self.update_exec(f"Downloading Engine: {mc_ver}...", 0.1)
                        callbacks = {
                            "setStatus": lambda msg: self.update_exec(f"Engine: {msg}"),
                            "setProgress": lambda p: self.update_exec(
                                progress=0.1 + (p / 100) * 0.4
                            ),
                            "setMax": lambda m: None,
                        }
                        minecraft_launcher_lib.install.install_minecraft_version(
                            mc_ver, path, callbacks
                        )
                        break
                    except Exception as e:
                        if attempt < max_retries - 1:
                            self.update_exec(
                                f"⚠️ Network hiccup. Resuming (Attempt {attempt + 2}/3)..."
                            )
                            time.sleep(2)
                        else:
                            raise e

                loader_ver = self.manifest.get("loader_version")
                if loader_type == "fabric" and loader_ver:
                    self.update_exec("Injecting Fabric Loader...")
                    minecraft_launcher_lib.fabric.install_fabric(
                        mc_ver, path, loader_version=loader_ver
                    )
                elif loader_type == "forge" and loader_ver:
                    self.update_exec("Injecting Forge Loader...")
                    minecraft_launcher_lib.forge.install_forge_version(loader_ver, path)

            # Sync Categories
            from concurrent.futures import ThreadPoolExecutor

            swarm_session = requests.Session()

            def download_swarm(
                item_list,
                vault_dest,
                target_subdir,
                progress_base,
                progress_scale,
                label,
                create_link=True,
            ):
                if not item_list:
                    return
                total = len(item_list)
                completed = 0
                lock = threading.Lock()

                def download_task(data):
                    nonlocal completed
                    if self.cancel_sync_flag:
                        return
                    m_name = data.get(
                        "name", data.get("filename", f"file_{time.time()}")
                    )
                    m_url = data.get("url")
                    if not m_url:
                        return

                    try:
                        dest = os.path.join(vault_dest, m_name)
                        if not os.path.exists(dest):
                            r = swarm_session.get(m_url, stream=True, timeout=20)
                            r.raise_for_status()
                            with open(dest, "wb") as f:
                                for chunk in r.iter_content(16384):
                                    if chunk:
                                        f.write(chunk)

                        if create_link:
                            self.create_mero_link(
                                dest, os.path.join(path, target_subdir, f"[Mero] {m_name}")
                            )

                        with lock:
                            completed += 1
                            pct = progress_base + (completed / total) * progress_scale
                            self.update_exec(
                                f"Swarm Sync: {label} ({completed}/{total})", pct
                            )
                    except Exception as e:
                        print(f"Swarm Error on {m_name}: {e}")

                with ThreadPoolExecutor(max_workers=10) as executor:
                    executor.map(download_task, item_list)

            if self.cancel_sync_flag: return
            # 1. Mods
            mods = self.manifest.get("mods", []) if self.manifest else []
            filtered_mods = []
            for m in mods:
                name = m.get("name", "").lower()
                filename = m.get("filename", "").lower()
                if "automodpack" in name or "automodpack" in filename:
                    print(f"[Mero Wizard] AutoModpack filtered from manifest download: {m}")
                    continue
                filtered_mods.append(m)
            # For Fabric/Quilt: keep mods in vault only, load via JVM args
            skip_mod_links = False
            download_swarm(filtered_mods, v_mods, "mods", 0.5, 0.2, "Mod", create_link=not skip_mod_links)

            if self.cancel_sync_flag: return
            # 2. Resources (Potato Mode Check)
            if self.sync_rp_var.get():
                rps = self.manifest.get("resourcepacks", []) if self.manifest else []
                download_swarm(rps, v_rps, "resourcepacks", 0.7, 0.1, "Resource")

            if self.cancel_sync_flag: return
            # 3. Shaders (Potato Mode Check)
            if self.sync_sp_var.get():
                sps = self.manifest.get("shaderpacks", []) if self.manifest else []
                download_swarm(sps, v_sps, "shaderpacks", 0.8, 0.1, "Shader")

            if self.cancel_sync_flag: return
            # === Mero Vault Integration ===
            # For Fabric/Quilt: clean up any old JVM args from previous versions
            if loader_type in ["fabric", "quilt"] and is_modded:
                self.update_exec("Cleaning up Mod Loader...", 0.91)
                self._cleanup_fabric_jvm_args(path)

            # Auto-activate synced resource packs in options.txt
            if self.sync_rp_var.get():
                rp_list = self.manifest.get("resourcepacks", []) if self.manifest else []
                rp_names = [r.get("name", r.get("filename", "")) for r in rp_list if r.get("name") or r.get("filename")]
                if rp_names:
                    self.update_exec("Activating Resource Packs...", 0.93)
                    self._activate_resource_packs(path, rp_names)

            self.update_exec("Establishing P2P Tunnel...", 0.95)
            ip = self.payload.get("ip")
            udp_port = self.payload.get("udp_port")
            
            # Check if server is local to bypass NAT loopback issues
            mc_port = self.payload.get("mc_port")
            if mc_port:
                try:
                    tsock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                    tsock.settimeout(0.5)
                    tsock.sendto(struct.pack(">I", 0) + b"STATUS", ("127.0.0.1", mc_port))
                    tsock.recvfrom(2048)
                    ip = "127.0.0.1"
                    udp_port = mc_port
                except Exception:
                    pass

            if self.current_tunnel:
                self.current_tunnel.stop()
            self.current_tunnel = MeroTunnel(ip, udp_port)
            self.current_tunnel.start()

            # Save server config if it's new
            if not self.current_server_id:
                server_id = base64.b64encode(os.urandom(8)).decode()
                server_name = self.manifest.get("name", "Mero Server") if self.manifest else "Mero Server"
                self.servers.append({
                    "id": server_id,
                    "name": server_name,
                    "version": self.manifest.get("minecraft_version", "1.20"),
                    "platform": self.manifest.get("loader_type", "Vanilla"),
                    "invite_code": getattr(self, "validated_invite_code", ""),
                    "instance_path": self.selected_instance_path,
                    "manifest_url": self.payload.get("manifest_url", ""),
                    "payload": self.payload,
                    "manifest": self.manifest,
                    "update_needed": False
                })
                self.save_config()

            self.after(0, self.show_state_4_complete)
        except Exception as e:
            self.update_exec(f"CRITICAL ERROR: {str(e)[:50]}", 0)
            print(traceback.format_exc())

    # --- State 4: Uplink Complete ---
    def show_state_4_complete(self):
        self.clear_container()
        ctk.CTkLabel(
            self.main_container,
            text="✅ UPLINK COMPLETE",
            font=get_font("heading", 32, "bold"),
            text_color=NEON_GREEN,
        ).pack(pady=(20, 20))
        port = self.current_tunnel.local_tcp_port
        info_frame = ctk.CTkFrame(
            self.main_container,
            fg_color=CHARCOAL,
            border_color=NEON_GREEN,
            border_width=1,
        )
        info_frame.pack(fill="x", pady=20, padx=20)
        ctk.CTkLabel(
            info_frame, text="CONNECTION TARGET (Click to Copy)", font=get_font("body", 10), text_color="gray"
        ).pack(pady=(10, 0))

        target_ip = f"127.0.0.1:{port}"
        ip_label = ctk.CTkLabel(
            info_frame,
            text=target_ip,
            font=get_font("body", 24, "bold"),
            text_color=NEON_GREEN,
            cursor="hand2"
        )
        ip_label.pack(pady=(0, 10))

        def copy_ip_to_clipboard(event):
            try:
                self.clipboard_clear()
                self.clipboard_append(target_ip)
                self.update()
                
                # Show quick visual feedback
                ip_label.configure(text="COPIED!", text_color=NEON_GREEN)
                def reset_lbl():
                    try:
                        ip_label.configure(text=target_ip, text_color=NEON_GREEN)
                    except:
                        pass
                self.after(1000, reset_lbl)
            except Exception as e:
                print(f"Failed to copy: {e}")

        ip_label.bind("<Button-1>", copy_ip_to_clipboard)

        ctk.CTkLabel(
            self.main_container,
            text="1. Open your Minecraft Launcher.\n2. Select the Mero instance.\n3. Click PLAY and join the IP above.",
            font=get_font("body", 14),
            text_color=TEXT_COLOR,
            justify="left",
        ).pack(pady=20)
        
        btn_frame = ctk.CTkFrame(self.main_container, fg_color="transparent")
        btn_frame.pack(side="bottom", pady=20)

        ctk.CTkButton(
            btn_frame,
            text="GO TO MENU (DISCONNECT)",
            width=200,
            fg_color=CHARCOAL,
            text_color="white",
            hover_color="#555555",
            command=self.go_to_menu,
        ).pack(side="left", padx=10)

        ctk.CTkButton(
            btn_frame,
            text="EXIT WIZARD",
            width=150,
            fg_color="transparent",
            border_color=ERROR_RED,
            border_width=1,
            text_color=ERROR_RED,
            command=self.destroy,
        ).pack(side="left", padx=10)

    def go_to_menu(self):
        self.rollback_execution()
        if self.current_tunnel:
            self.current_tunnel.stop()
            self.current_tunnel = None
        self.show_state_menu()

    def _cleanup_fabric_jvm_args(self, instance_path):
        """Clean up old -Dfabric.addMods JVM args from launcher profiles."""
        current_dir = instance_path
        profiles_path = None
        
        # Traverse up to 4 levels to find launcher_profiles.json
        for _ in range(5):
            candidate = os.path.join(current_dir, "launcher_profiles.json")
            if os.path.isfile(candidate):
                profiles_path = candidate
                break
            parent = os.path.dirname(current_dir)
            if parent == current_dir:
                break
            current_dir = parent

        if profiles_path:
                try:
                    with open(profiles_path, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    for prof_id, prof in data.get("profiles", {}).items():
                        java_args = prof.get("javaArgs", "")
                        # Remove any old fabric.addMods arg
                        java_args = re.sub(
                            r'-Dfabric\.addMods="[^"]*"|-Dfabric\.addMods=\S+',
                            '', java_args
                        ).strip()
                        prof["javaArgs"] = java_args
                    with open(profiles_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)
                    print(f"[Mero] Cleaned up JVM args in {profiles_path}")
                    return
                except Exception as e:
                    print(f"[Mero] Failed to patch {profiles_path}: {e}")

        # --- Try instance.cfg (Prism Launcher / MultiMC) ---
        for search_dir in [instance_path, os.path.dirname(instance_path)]:
            cfg_path = os.path.join(search_dir, "instance.cfg")
            if os.path.isfile(cfg_path):
                try:
                    with open(cfg_path, "r", encoding="utf-8") as f:
                        lines = f.readlines()
                    new_lines = []
                    for line in lines:
                        if line.startswith("JvmArgs="):
                            existing = line.strip().split("=", 1)[1]
                            existing = re.sub(
                                r'-Dfabric\.addMods="[^"]*"|-Dfabric\.addMods=\S+',
                                '', existing
                            ).strip()
                            if existing:
                                new_lines.append(f"JvmArgs={existing}\n")
                            else:
                                new_lines.append("JvmArgs=\n")
                        else:
                            new_lines.append(line)
                    with open(cfg_path, "w", encoding="utf-8") as f:
                        f.writelines(new_lines)
                    print(f"[Mero] Cleaned up JVM args in {cfg_path}")
                    return
                except Exception as e:
                    print(f"[Mero] Failed to patch {cfg_path}: {e}")

        print("[Mero] No launcher profile found — JVM args not cleaned up")

    def _activate_resource_packs(self, instance_path, rp_names):
        """Auto-activate Mero resource packs in Minecraft's options.txt."""
        options_path = os.path.join(instance_path, "options.txt")
        mero_entries = [f"file/[Mero] {name}" for name in rp_names]

        lines = []
        if os.path.isfile(options_path):
            with open(options_path, "r", encoding="utf-8") as f:
                lines = f.readlines()

        rp_idx = None
        for i, line in enumerate(lines):
            if line.startswith("resourcePacks:"):
                rp_idx = i
                break

        if rp_idx is not None:
            raw = lines[rp_idx].split(":", 1)[1].strip()
            try:
                existing = json.loads(raw)
            except Exception:
                existing = ["vanilla"]
            for entry in mero_entries:
                if entry not in existing:
                    existing.append(entry)
            lines[rp_idx] = f"resourcePacks:{json.dumps(existing)}\n"
        else:
            existing = ["vanilla"] + mero_entries
            lines.append(f"resourcePacks:{json.dumps(existing)}\n")

        with open(options_path, "w", encoding="utf-8") as f:
            f.writelines(lines)
        print(f"[Mero] Activated {len(mero_entries)} resource packs in options.txt")

    def restore_disabled_mods(self):
        if hasattr(self, 'disabled_mods') and self.disabled_mods:
            for filepath in self.disabled_mods:
                if filepath.endswith(".disabled") and os.path.exists(filepath):
                    original_path = filepath[:-9]
                    print(f"[Mero Wizard] Restoring AutoModpack: {filepath} -> {original_path}")
                    try:
                        if os.path.exists(original_path):
                            os.remove(original_path)
                        os.rename(filepath, original_path)
                    except Exception as e:
                        print(f"[Mero Wizard] Failed to restore AutoModpack {filepath}: {e}")
            self.disabled_mods = []

    def destroy(self):
        try:
            self.restore_disabled_mods()
            
            # Clean up symlinks when the application is closed
            path = getattr(self, 'selected_instance_path', None)
            if path and os.path.exists(path):
                for d in ["mods", "resourcepacks", "shaderpacks"]:
                    self.cleanup_mero_links(os.path.join(path, d))
                    
        except Exception as e:
            print(f"[Mero Wizard] Error during destroy cleanup: {e}")
            
        if hasattr(self, 'current_tunnel') and self.current_tunnel:
            try:
                self.current_tunnel.stop()
            except:
                pass
                
        super().destroy()


def check_for_client_updates():
    try:
        import urllib.request, json
        exe_path = sys.executable
        old_exe_path = exe_path + ".old"
        if os.path.exists(old_exe_path):
            try:
                os.remove(old_exe_path)
            except:
                pass

        if not getattr(sys, 'frozen', False):
            return

        req = urllib.request.Request("https://api.github.com/repos/iamthebestcoderalive/MeroHoster/releases/latest")
        req.add_header("User-Agent", "MeroClient")
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode())
        latest_version = data["tag_name"]

        if latest_version != CLIENT_VERSION:
            print(f"[Mero] Update found: {latest_version} (Current: {CLIENT_VERSION})")
            download_url = None
            for asset in data.get("assets", []):
                if asset["name"] == "MeroClient.exe":
                    download_url = asset["browser_download_url"]
                    break
            
            if download_url:
                print(f"[Mero] Downloading update...")
                new_exe_path = exe_path + ".new"
                urllib.request.urlretrieve(download_url, new_exe_path)
                
                os.rename(exe_path, old_exe_path)
                os.rename(new_exe_path, exe_path)
                print(f"[Mero] Update complete! Restarting...")
                subprocess.Popen([exe_path] + sys.argv[1:])
                sys.exit(0)
    except Exception as e:
        print(f"[Mero] Update check failed: {e}")

if __name__ == "__main__":
    check_for_client_updates()
    app = MeroWizard()
    app.mainloop()
