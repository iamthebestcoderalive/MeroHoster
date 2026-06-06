# Complete Codebase Documentation: MeroConnect / Minecraft Server Hoster

This document provides an exhaustive overview of the entire project, including the MeroLauncher (Client), MeroHost (Python Backends), networking infrastructure, and utility scripts.

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

## 4. MeroHost (Python Backend)

The primary backend service, built with FastAPI, managing the server lifecycle and providing the Web UI.

### Web Control Panel (`backend/templates/` & `backend/static/js/`)
The frontend is modularized for easier maintenance and contribution.
- **HTML Templates (Jinja2)**:
    - `templates/base.html`: Main shell, head, and `<script>` inclusions.
    - `templates/sidebar.html`: App navigation.
    - `templates/tabs/*.html`: Individual modules like `dashboard.html`, `console.html`, `players.html`, `mods.html`, `files.html`.
    - `templates/components/modals.html`: Pop-up dialogs.
- **JavaScript Modules (`static/js/`)**:
    - `main.js`: Initialization and global state.
    - `api.js`: Network request wrappers.
    - `ui.js`: Toast notifications, button loaders, tab management.
    - `dashboard.js`: Stats polling, graph rendering, performance metrics.
    - `console.js`: Terminal integration and command autocompletion.
    - `players.js`: Ops, Whitelist, Ban list, and live player manager.
    - `mods.js`: Modrinth API integration and mod manager.
    - `files.js`: File explorer, Code Editor (Ace).
    - `settings.js`: Config options (RAM, java versions).
    - `backups.js`: Zip creation, restoration, deletion logic.

### Backend Application (`backend/`)
- **`mero_host.py`**: The main FastAPI entry point and orchestration layer.
    - Serves API routes, WebSockets for console logs, and background daemons.
    - Uses `Jinja2Templates` to render `base.html` and stitch the UI together.
    - Orchestrates server boot loops, JRE detection, and system spec aggregation.
- **`mero_host_net.py`**: Implementation of the server-side P2P tunnel over UDP hole-punching.

---

## 5. P2P Tunneling Protocol

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

## 6. Vercel Landing Page - `vercel-landing/`

A static landing page for project promotion and downloads.

- **`index.html` / `style.css`**: Provides a modern, "glassmorphism" themed UI.
- **`script.js`**: Implements subtle animations and Lucide icon initialization.
- **Assets**: Includes logos and pre-compiled binaries for the client.

---

## 7. Environment and Deployment

- **Language**: Python 3.13+
- **Framework**: FastAPI (Backend), Jinja2 (Templating)
- **Operating System**: Primarily Windows (due to WebView2 requirements and registry checks).
- **Executable Packaging**: Uses PyInstaller (`MeroHoster.spec`) to create a standalone binary containing the embedded Python runtime.

---

*This document is automatically updated based on the latest codebase analysis.*
