# Complete Codebase Documentation: MeroConnect / Minecraft Server Hoster

This document provides an exhaustive overview of the entire project, including the MeroLauncher (Client), MeroHost (Python & Java Backends), networking infrastructure, and utility scripts.

## 1. Project Overview

The project is a high-performance, user-friendly Minecraft server hosting and management suite. It allows users to host Minecraft servers on their own machines with advanced networking (P2P tunneling, Playit.gg), automated mod management, and a modern web-based control panel.

### Core Goals
- **Ease of Use**: Automated Java installation, one-click server creation, and intuitive UI.
- **Advanced Networking**: UDP hole-punching for direct P2P connections and Playit.gg integration for easy public access without port forwarding.
- **Mod Synchronization**: Manifest-driven mod/plugin synchronization between host and client with delta-downloading.
- **Modern UI**: Dark-themed, responsive interfaces for both the desktop client and the web-based host control panel.

---

## 2. Architecture

The system follows a client-server architecture with a local backend managing the actual Minecraft server instances.

- **MeroLauncher (Client)**: Desktop application used by players to connect to servers, manage their local instances, and sync mods.
- **MeroHost (Backend)**: Runs on the host machine. Manages Minecraft server processes, handles configuration, backups, and networking.
    - **Python Version**: The primary, feature-rich version (FastAPI).
    - **Java Version**: A prototype/alternative implementation (Javalin).
- **Networking Layer**: A custom UDP-based tunneling protocol that facilitates connections between the client and host, even through CGNAT or restricted firewalls.

---

## 3. MeroLauncher (Client) - `mero_client.py`

Built with `customtkinter` and `minecraft-launcher-lib`, the client provides a premium experience for Minecraft players.

### Key Features
- **Instance Vault**: Isolated server directories in `%APPDATA%/.meroconnect/instances/` to prevent mod conflicts between different servers.
- **Delta Sync Engine**:
    - Fetches a remote `manifest.json`.
    - Compares local files (mods, resource packs, shaders) with the manifest using hashes/ETags.
    - Downloads only missing or outdated files to minimize bandwidth.
- **Launch Engine**:
    - Automates installation of Minecraft versions, Forge, Fabric, Quilt, and NeoForge.
    - Handles authentication and game launching with custom arguments.
- **Client-Side P2P Tunneling**:
    - Implements the `MeroTunnel` class.
    - Performs UDP hole-punching to the host.
    - Provides a local TCP bridge (`127.0.0.1:<random_port>`) for the Minecraft client to connect to.
- **UI Components**:
    - Custom server cards with live status pings.
    - Integrated log terminal for real-time feedback.
    - Onboarding/Add Server dialogs.

---

## 4. MeroHost (Python Backend) - `backend/mero_host.py`

The primary backend service, built with FastAPI, managing the server lifecycle and providing the Web UI.

### Key Components
- **Web API**: Comprehensive REST API for server control, file management, console access, and player management.
- **Server Lifecycle**:
    - `boot_server()`: Orchestrates the entire startup process (Java check -> Playit setup -> JAR download -> Process launch).
    - Supports multiple server types: Paper, Purpur, Fabric, Forge, Vanilla.
- **Java Management**: Automatically detects and downloads the required JRE (e.g., JRE 21) if not found.
- **Networking Infrastructure**:
    - **Playit.gg Integration**: Downloads and runs the `playit.exe` agent to provide a public URL.
    - **Mero P2P Engine**: (`mero_host_net.py`) Implements the server-side custom P2P tunnel using STUN for discovery and UDP for data transfer.
- **Web Control Panel**: (`backend/static/`)
    - **Dashboard**: Real-time CPU/RAM/Disk stats using Chart.js.
    - **Console**: Interactive console with ANSI color support and command autocomplete.
    - **File Manager**: Web-based file explorer with upload/download, folder creation, and jar scanning for mod icons.
    - **Modrinth Integration**: Browse and install mods/plugins directly from the web UI.
    - **Player Manager**: Visual management of online players (Health, Hunger, Inventory, Actions).
    - **Backups**: Automated and manual backup system (zipped worlds).

---

## 5. MeroHost (Java Backend) - `backend-java/`

A prototype implementation designed for performance and platform portability.

### Current State
- **Framework**: Built with Javalin (Web Server) and OkHttp (HTTP Client).
- **Discovery**: Uses OSHI (`oshi-core`) for detailed system specifications (CPU, RAM, OS).
- **Logic**: Currently implements basic system discovery and IP resolution in `SystemUtils.java`.

---

## 6. P2P Tunneling Protocol

A custom-built networking layer for direct peer-to-peer connections.

### Mechanism
1.  **Discovery**: Host uses STUN (`stun.l.google.com`) to find its public UDP IP and port.
2.  **Invite Code**: A Base64 string containing the Host's Public IP, UDP Port, and local Minecraft Port.
3.  **Hole Punching**:
    - Client periodically sends `HOLE_PUNCH` packets to the Host.
    - Host listens for these and maps the client's public address.
4.  **Multiplexing**:
    - Data is wrapped in a simple protocol: `[4 bytes Connection ID] [Payload]`.
    - Multiple virtual connections (streams) can run over a single UDP socket.
5.  **Bridging**:
    - **Host-side**: Bridges UDP packets to the local Minecraft TCP port (e.g., 25565).
    - **Client-side**: Bridges local Minecraft TCP connection to the UDP tunnel.

---

## 7. Utility and Patch Scripts

Several scripts are used to maintain and update the codebase.

- **`patch_backups.py`**: Injects backup management logic (endpoints and background daemon) into the main host file.
- **`patch_playit.py`**: Updates the Playit log parser to better handle claim URLs and public IP discovery.
- **`fix_enc.py`**: Ensures all file I/O in the backend uses UTF-8 encoding to prevent errors with special characters/emojis.
- **`fix_ua.py`**: (Likely) updates User-Agent strings for external API calls (Modrinth, etc.).

---

## 8. Vercel Landing Page - `vercel-landing/`

A static landing page for project promotion and downloads.

- **`index.html` / `style.css`**: Provides a modern, "glassmorphism" themed UI.
- **`script.js`**: Implements subtle animations and Lucide icon initialization.
- **Assets**: Includes logos and pre-compiled binaries for the client.

---

## 9. Environment and Deployment

- **Language**: Python 3.8+ (Primary), Java 21 (Backend-Java).
- **Operating System**: Primarily Windows (due to `.exe` packaging and `.bat` scripts), but core logic is cross-platform.
- **Executable Packaging**: Uses PyInstaller (`mero_connect_client.spec`, `MeroClient.spec`) to create standalone client binaries.
- **Startup**: `start_mero.bat` launches the Python backend.

---

*This document is automatically updated based on the latest codebase analysis.*
