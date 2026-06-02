if ("Notification" in window) {
  Notification.requestPermission();
}
const API = "/api";

let currentServer = "";
let currentServerType = "";
let statInterval = null;
let consoleInterval = null;
let currentPath = "";
let selectedFiles = new Set();
let lastLogCount = 0;
let currentVersion = "";
let statsChart = null;
let chartLabels = [];
let chartCpuData = [];
let chartRamData = [];
const CHART_MAX_PTS = 60;

// Dev Mode Listener removed
// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {


  await fetchServersList();
  
  // Check for auto-updates in the background
  setTimeout(checkForUpdates, 1500);
}

async function checkForUpdates() {
    try {
        const res = await apiGet("/update/check");
        if (res.update_available) {
            const banner = document.getElementById("update-banner");
            const text = document.getElementById("update-banner-text");
            if (banner && text) {
                text.innerText = `MeroHoster ${res.latest_version} is available!`;
                banner.style.display = "flex";
                // Only animate lucide icons after making them visible
                setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 50);
            }
        }
    } catch (e) {
        console.error("Failed to check for updates", e);
    }
}

async function installUpdate() {
    const banner = document.getElementById("update-banner");
    const overlay = document.getElementById("update-overlay");
    const overlayText = document.getElementById("update-overlay-text");
    const tipText = document.getElementById("update-tip-text");
    
    if(banner) banner.style.display = "none";
    if(overlay) overlay.style.display = "flex";
    if(window.lucide) lucide.createIcons();
    
    // Start Tip Rotation
    const tips = [
        "MeroHoster bypasses the need for port forwarding using advanced P2P tunneling.",
        "Your RAM allocation directly limits how much memory Java can use—leave some for your OS!",
        "MeroClient automatically syncs mods with the server, so your players never have to.",
        "Using Paper or Purpur instead of Vanilla can drastically improve your server's TPS.",
        "MeroHoster runs your server in the background, so you can safely close the dashboard.",
        "Fabric is highly recommended for modern modding, offering faster load times than Forge."
    ];
    let tipIndex = 0;
    if(tipText) tipText.innerText = tips[0];
    
    const tipInterval = setInterval(() => {
        if(!tipText) return;
        tipText.style.opacity = "0";
        setTimeout(() => {
            tipIndex = (tipIndex + 1) % tips.length;
            tipText.innerText = tips[tipIndex];
            tipText.style.opacity = "1";
        }, 500);
    }, 4500);
    
    try {
        await fetch(API + "/update/install", { method: "POST" });
        // Poll until server goes down and comes back up
        let offline = false;
        const checkInterval = setInterval(async () => {
            try {
                await fetch(API + "/servers", { method: "GET" });
                if (offline) {
                    // Server came back online!
                    clearInterval(checkInterval);
                    clearInterval(tipInterval);
                    window.location.reload();
                }
            } catch (e) {
                offline = true;
                if(overlayText) overlayText.innerText = "Restarting backend and applying update... Please wait.";
            }
        }, 2000);
    } catch (e) {
        console.error("Install trigger failed", e);
        clearInterval(tipInterval);
        if(overlayText) {
            overlayText.innerText = "Update failed to start. Please restart MeroHoster manually.";
            overlayText.style.color = "var(--danger)";
        }
    }
}

async function connectCoHost() {
    const input = document.getElementById("cohost-code");
    const error = document.getElementById("cohost-error");
    if (!input || !error) return;
    
    const code = input.value.trim();
    if (!code.startsWith("MERO-") || code.length < 20) {
        error.style.display = "block";
        return;
    }
    
    error.style.display = "none";
    closeCreateModal();
    
    const overlay = document.getElementById("cohost-sync-overlay");
    const text = document.getElementById("cohost-sync-text");
    const pBar = document.getElementById("cohost-progress-bar");
    const pPct = document.getElementById("cohost-progress-percentage");
    const pSpeed = document.getElementById("cohost-progress-speed");
    
    if (overlay) overlay.style.display = "flex";
    if (window.lucide) lucide.createIcons();
    
    // Simulate connection and download process
    setTimeout(() => {
        if(text) text.innerText = "Tunnel established. Downloading world data from cloud...";
        let progress = 0;
        const dlInterval = setInterval(() => {
            progress += Math.random() * 8;
            if (progress >= 100) {
                progress = 100;
                clearInterval(dlInterval);
                if(text) text.innerText = "Extracting files and linking Co-Host P2P address...";
                if(pSpeed) pSpeed.innerText = "Processing...";
                
                setTimeout(() => {
                    if(text) text.innerText = "Success! Initializing server...";
                    setTimeout(() => {
                        window.location.reload(); // Mock finish
                    }, 1500);
                }, 2000);
            }
            if(pBar) pBar.style.width = progress + "%";
            if(pPct) pPct.innerText = Math.floor(progress) + "%";
            if(pSpeed && progress < 100) pSpeed.innerText = (Math.random() * 15 + 5).toFixed(1) + " MB/s";
        }, 300);
    }, 1500);
}

async function fetchServersList() {
  try {
    const servers = await apiGet("/servers");
    const sel = document.getElementById("global-server-select");
    sel.innerHTML = "";
    servers.forEach((s) =>
      sel.appendChild(
        new Option(
          (s.display_name || s.name).replace(/§[0-9a-fk-or]/gi, ""),
          s.name,
        ),
      ),
    );

    // Toggle empty state vs full app
    if (servers.length === 0) {
      document.getElementById("empty-state").style.display = "flex";
      document.getElementById("app-container").style.display = "none";
      currentServer = "";
      clearInterval(statInterval);
      clearInterval(consoleInterval);
      return;
    }
    document.getElementById("empty-state").style.display = "none";
    document.getElementById("app-container").style.display = "flex";

    if (!currentServer || !servers.find((s) => s.name === currentServer)) {
      const wasEmpty = !currentServer;
      currentServer = servers[0].name;
      sel.value = currentServer;
      onServerChange();
      if (wasEmpty) {
          switchTab('dashboard');
      }
    }
    
    // Start the onboarding tour only after a server is selected
    setTimeout(startOnboardingTour, 800);
  } catch (e) {}
}
let systemSpecsFetched = false;
let maxSystemRam = 8;

async function fetchHardwareSpecs() {
  try {
    const specs = await apiGet("/system_specs");
    maxSystemRam = specs.total_ram_gb || 8;
    document.getElementById("plan-brand-icon").textContent = specs.manufacturer;
    document.getElementById("plan-model-name").textContent = specs.model;
    document.getElementById("plan-cpu-spec").innerHTML = `💻 ${specs.cpu}`;
    document.getElementById("plan-ram-spec").innerHTML =
      `🧠 ${specs.total_ram_gb} GB RAM`;
    document.getElementById("plan-disk-spec").innerHTML = `💾 ${specs.disk}`;
  } catch (e) {
    console.error("Failed to load hardware specs", e);
  }
}

function onServerChange(targetTab = "dashboard") {
  currentServer = document.getElementById("global-server-select").value;
  clearInterval(statInterval);
  clearInterval(consoleInterval);
  if (!currentServer) return;
  installedModsCache = []; // Clear cache so it reloads for new server
  currentVersion = ""; // Reset until fetchStats provides it
  currentPlatform = "vanilla";
  syncPlatformUI();
  document.getElementById("no-server-warning").style.display = "none";
  document.getElementById("content-area").style.display = "block";
  document.getElementById("btn-delete-server").style.display = "inline-flex";
  lastLogCount = 0;
  // Reset chart for new server
  chartLabels = [];
  chartCpuData = [];
  chartRamData = [];
  if (statsChart) {
    statsChart.data.labels = [];
    statsChart.data.datasets[0].data = [];
    statsChart.data.datasets[1].data = [];
    statsChart.update("none");
  }
  const lbl = document.getElementById("chart-status-label");
  if (lbl) lbl.textContent = "Waiting for data…";
  if (targetTab) {
    switchTab(targetTab);
  }
  statInterval = setInterval(fetchStats, 4000);
  consoleInterval = setInterval(fetchConsole, 2000);
  fetchHardwareSpecs();
  fetchStats();
  fetchConsole();
  fetchConfig();
  loadManifestUrl();
}

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiGet(path) {
  const r = await fetch(API + path);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
async function apiPost(path, body) {
  const r = await fetch(API + path, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}

// ─── Tab switching ────────────────────────────────────────────────────────────
function switchTab(tabId) {
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => (c.style.display = "none"));
  document
    .querySelectorAll("nav li")
    .forEach((li) => li.classList.remove("active"));
  const targetTab = document.getElementById(`tab-${tabId}`);
  if (tabId === "dashboard") {
    targetTab.style.display = "flex";
  } else {
    targetTab.style.display = "block";
  }
  const navEl = document.getElementById(`nav-${tabId}`);
  if (navEl) navEl.classList.add("active");
  if (tabId === "files" && currentServer) {
    currentPath = "";
    fetchFiles();
  }
  if (tabId === "settings") fetchConfig();
  if (tabId === "players" && currentServer) loadPlayers();
  if (tabId === "modrinth") {
    syncPlatformUI();
    searchModrinth();
  }
  if (tabId === "backups" && currentServer) {
    fetchBackupSettings();
    fetchBackups();
  }

  lucide.createIcons();
}

// ─── Power buttons ────────────────────────────────────────────────────────────
function setButtons(phase) {
  const startRow = document.getElementById("btn-row-start");
  const controlRow = document.getElementById("btn-row-controls");
  const startBtn = document.getElementById("btn-start");

  if (phase === "stopped") {
    startRow.style.display = "flex";
    controlRow.style.display = "none";
    startBtn.disabled = false;
    startBtn.innerHTML = "▶ Start";
  } else if (phase === "starting") {
    startRow.style.display = "flex";
    controlRow.style.display = "none";
    startBtn.disabled = true;
    startBtn.innerHTML = "⚙ Starting…";
  } else {
    // running
    startRow.style.display = "none";
    controlRow.style.display = "flex";
  }

  // Console input enable/disable
  const consoleInput = document.getElementById("console-input");
  const consoleSend = document.getElementById("console-send");
  const chatMsg = document.getElementById("chat-message");
  const chatSend = document.getElementById("chat-send");
  const offline = document.getElementById("console-offline");
  const isRunning = phase === "running";
  const isStopped = phase === "stopped";
  if (consoleInput) consoleInput.disabled = !isRunning;
  if (consoleSend) consoleSend.disabled = !isRunning;
  if (chatMsg) chatMsg.disabled = !isRunning;
  if (chatSend) chatSend.disabled = !isRunning;
  // Show offline overlay ONLY when fully stopped (not during starting — boot logs should be visible)
  if (offline) offline.style.display = isStopped ? "flex" : "none";
}

// ─── Power button loading helper ──────────────────────────────────────────────
async function withLoadingBtn(btn, icon, asyncFn) {
  const orig = btn.innerHTML;
  const origW = btn.getBoundingClientRect().width;
  btn.style.minWidth = origW + "px";
  btn.innerHTML = `<i data-lucide="${icon}" class="spin" style="width:14px;height:14px"></i>`;
  btn.classList.add("btn-loading");
  lucide.createIcons();
  try {
    await asyncFn();
  } finally {
    btn.innerHTML = orig;
    btn.classList.remove("btn-loading");
    btn.style.minWidth = "";
    lucide.createIcons();
  }
}

async function startServer() {
  const btn = document.getElementById("btn-start");
  await withLoadingBtn(btn, "loader", async () => {
    const r = await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/start`,
    );
    if (!r.ok) {
      const detail = (await r.json()).detail || "Failed to start";
      alert("Error: " + detail);
      return;
    }
    switchTab("console");
    fetchStats();
  });
}

async function stopServer(btn) {
  if (!btn) btn = event?.currentTarget;
  await withLoadingBtn(btn, "loader", async () => {
    const r = await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/stop`,
    );
    if (!r.ok) {
      const d = (await r.json()).detail;
      if (confirm(d + "\n\nForce stop?"))
        await apiPost(
          `/servers/${encodeURIComponent(currentServer)}/stop?force=true`,
        );
    }
    fetchStats();
  });
}

async function restartServer(btn) {
  if (!btn) btn = event?.currentTarget;
  await withLoadingBtn(btn, "loader", async () => {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/restart`);
    lastLogCount = 0;
    fetchStats();
  });
}

async function killServer(btn) {
  if (
    !confirm(
      "Kill the server process immediately? This may corrupt world data!",
    )
  )
    return;
  if (!btn) btn = event?.currentTarget;
  await withLoadingBtn(btn, "zap", async () => {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/kill`);
    fetchStats();
  });
}

async function deleteCurrentServer() {
  if (!currentServer) return;
  if (
    !confirm(
      `Permanently delete server "${currentServer}" and ALL its data? This cannot be undone!`,
    )
  )
    return;
  const r = await fetch(`${API}/servers/${encodeURIComponent(currentServer)}`, {
    method: "DELETE",
  });
  if (!r.ok) {
    alert((await r.json()).detail || "Failed to delete");
    return;
  }
  currentServer = "";
  clearInterval(statInterval);
  clearInterval(consoleInterval);
  setButtons("stopped");
  await fetchServersList();
  showToast("Server deleted.");
}

async function saveMotd(btn) {
  if (!currentServer) return;
  await withButtonState(btn, async () => {
    const motd = document.getElementById("dash-motd-input").value;
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/config`, {
      properties: { motd: motd },
      meta: {},
    });
    // Sync settings tab too
    const settingsInput = document.getElementById("settings-motd-input");
    if (settingsInput) {
      settingsInput.value = motd;
      updateSettingsMotdPreview();
    }
    showToast("MOTD saved! Restart server to apply.");
  });
}

async function savePlayitKey() {
  const key = document.getElementById("playit-key-input").value.trim();
  if (!key) return;

  try {
    const r = await fetch(
      `${API}/servers/${encodeURIComponent(currentServer)}/playit/key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      },
    );
    if (r.ok) {
      showToast("Playit key saved! Restart server to apply.");
      document.getElementById("playit-key-input").value = "";
    } else {
      showToast("Failed to save key");
    }
  } catch (e) {
    showToast("Error saving key");
  }
}

// ─── Chart init ──────────────────────────────────────────────────────────────
function initStatsChart() {
  const canvas = document.getElementById("stats-chart");
  if (!canvas || !window.Chart) return;
  if (statsChart) {
    statsChart.destroy();
    statsChart = null;
  }
  statsChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "CPU %",
          data: [],
          borderColor: "#10b981",
          backgroundColor: "rgba(16,185,129,0.08)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
          yAxisID: "yCpu",
        },
        {
          label: "RAM (MB)",
          data: [],
          borderColor: "#3b82f6",
          backgroundColor: "rgba(59,130,246,0.07)",
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.4,
          fill: true,
          yAxisID: "yRam",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: {
            color: "#94a3b8",
            font: { family: "Outfit", size: 11 },
            boxWidth: 12,
          },
        },
        tooltip: {
          backgroundColor: "#13161b",
          borderColor: "#22262e",
          borderWidth: 1,
          titleColor: "#e2e8f0",
          bodyColor: "#94a3b8",
          callbacks: {
            label: (ctx) =>
              ctx.dataset.label === "CPU %"
                ? ` ${ctx.parsed.y.toFixed(1)}%`
                : ` ${ctx.parsed.y.toFixed(0)} MB`,
          },
        },
      },
      scales: {
        x: { display: false },
        yCpu: {
          position: "left",
          min: 0,
          grid: { color: "rgba(34,38,46,0.6)" },
          ticks: {
            color: "#10b981",
            font: { size: 10 },
            callback: (v) => v + "%",
          },
        },
        yRam: {
          position: "right",
          min: 0,
          grid: { drawOnChartArea: false },
          ticks: {
            color: "#3b82f6",
            font: { size: 10 },
            callback: (v) => v + " MB",
          },
        },
      },
    },
  });
}

// ─── Stats ────────────────────────────────────────────────────────────────────
function fmtBytes(b) {
  if (!b) return "0 B";
  const k = 1024,
    s = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / k ** i).toFixed(2) + " " + s[i];
}
function fmtUptime(sec) {
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = Math.floor(sec % 60);
  return `${h}h ${m}m ${s}s`;
}
function fmtAgo(ts) {
  const d = Math.floor(Date.now() / 1000 - ts);
  if (d < 60) return d + "s ago";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  return Math.floor(d / 86400) + "d ago";
}

/* ── Player Manager Logic ──────────────────────────────────────────── */
let pmCurrentPlayer = null;

async function openPlayerManager(playerName) {
    pmCurrentPlayer = playerName;
    const modal = document.getElementById("player-manager-modal");
    modal.style.display = "flex";
    document.getElementById("pm-content").style.display = "none";
    document.getElementById("pm-loading").style.display = "block";
    document.getElementById("pm-name").innerText = playerName;
    document.getElementById("pm-head").src = ""; // Clear old
    
    try {
        const data = await apiGet(`/servers/${encodeURIComponent(currentServer)}/players/${encodeURIComponent(playerName)}`);
        document.getElementById("pm-head").src = `https://crafatar.com/renders/head/${data.uuid}?overlay`;
        renderPlayerManager(data);
    } catch(e) {
        showToast("Error loading player data");
        closePlayerManager();
    }
}

function closePlayerManager() {
    document.getElementById("player-manager-modal").style.display = "none";
}

function renderPlayerManager(data) {
    document.getElementById("pm-loading").style.display = "none";
    document.getElementById("pm-content").style.display = "block";
    
    // Render Health (20 half-hearts)
    const hlth = document.getElementById("pm-health-container");
    hlth.innerHTML = "";
    const healthVal = Math.round(data.Health || 20); // 1 to 20
    for(let i=1; i<=20; i++) {
        const cls = i % 2 !== 0 ? "mc-half-left" : "mc-half-right";
        const active = i <= healthVal ? "active" : "";
        hlth.innerHTML += `<div class="mc-half ${cls} ${active}" data-val="${i}" onmouseover="pmHoverStat(this, 'health')" onmouseout="pmUnhoverStat(this, 'health')" onclick="pmSetStat('health', ${i})"></div>`;
    }
    
    // Render Hunger
    const hngr = document.getElementById("pm-hunger-container");
    hngr.innerHTML = "";
    const foodVal = Math.round(data.foodLevel || 20); // 1 to 20
    for(let i=1; i<=20; i++) {
        const cls = i % 2 !== 0 ? "mc-half-left" : "mc-half-right";
        const active = i <= foodVal ? "active" : "";
        hngr.innerHTML += `<div class="mc-half ${cls} ${active}" data-val="${i}" onmouseover="pmHoverStat(this, 'hunger')" onmouseout="pmUnhoverStat(this, 'hunger')" onclick="pmSetStat('hunger', ${i})"></div>`;
    }
    
    // Render Inventory Map
    const invMap = {};
    if(data.Inventory) {
        data.Inventory.forEach(item => {
            invMap[item.Slot] = item;
        });
    }
    
    const genItemHTML = (slotId) => {
        const item = invMap[slotId];
        if(!item) return "";
        let id = item.id.replace("minecraft:", "");
        const src = `https://assets.mcasset.cloud/1.20.4/assets/minecraft/textures/item/${id}.png`;
        const count = item.Count > 1 ? `<span class="mc-item-count">${item.Count}</span>` : "";
        return `<img src="${src}" class="mc-item-img" title="${id}" onerror="this.onerror=null; this.src='https://assets.mcasset.cloud/1.20.4/assets/minecraft/textures/block/${id}.png';" />${count}`;
    };
    
    // Armor Slots
    [103, 102, 101, 100].forEach(s => {
        document.getElementById(`mc-slot-${s}`).innerHTML = genItemHTML(s);
    });
    // Offhand Slot
    document.getElementById(`mc-slot--106`).innerHTML = genItemHTML(-106);
    
    // Main Inventory (slots 9 to 35)
    let mainHtml = "";
    for(let i=9; i<=35; i++) {
        mainHtml += `<div class="mc-slot">${genItemHTML(i)}</div>`;
    }
    document.getElementById("pm-inventory-main").innerHTML = mainHtml;
    
    // Hotbar (slots 0 to 8)
    let hbHtml = "";
    for(let i=0; i<=8; i++) {
        hbHtml += `<div class="mc-slot">${genItemHTML(i)}</div>`;
    }
    document.getElementById("pm-inventory-hotbar").innerHTML = hbHtml;
}

function pmHoverStat(el, type) {
    const val = parseInt(el.getAttribute("data-val"));
    const container = type === 'health' ? document.getElementById("pm-health-container") : document.getElementById("pm-hunger-container");
    Array.from(container.children).forEach(child => {
        if (parseInt(child.getAttribute("data-val")) <= val) {
            child.classList.add("hover-glow");
        }
    });
}

function pmUnhoverStat(el, type) {
    const container = type === 'health' ? document.getElementById("pm-health-container") : document.getElementById("pm-hunger-container");
    Array.from(container.children).forEach(child => child.classList.remove("hover-glow"));
}

async function pmSetStat(type, val) {
    if(!pmCurrentPlayer) return;
    try {
        const action = type === 'health' ? 'set_health' : 'set_food';
        await apiPost(`/servers/${encodeURIComponent(currentServer)}/players/${encodeURIComponent(pmCurrentPlayer)}/action`, {
            action: action,
            amount: val
        });
        const container = type === 'health' ? document.getElementById("pm-health-container") : document.getElementById("pm-hunger-container");
        Array.from(container.children).forEach(child => {
            if (parseInt(child.getAttribute("data-val")) <= val) {
                child.classList.add("active");
            } else {
                child.classList.remove("active");
            }
        });
        showToast(type === 'health' ? `Health set to ${val/2} hearts` : `Hunger set to ${val/2} drumsticks`);
    } catch(e) {
        showToast(`Failed to set ${type}`);
    }
}async function openServerFolder(e) {
  e.preventDefault();
  if (!currentServer) return;
  try {
    await apiPost(`/servers/${encodeURIComponent(currentServer)}/open_folder`);
  } catch (e) {
    showToast("Failed to open folder");
  }
}

async function fetchStats() {
  if (!currentServer) return;
  try {
    const st = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/stats`,
    );
    window.latestServerState = st;
    setButtons(st.phase);

    const badge = {
      stopped: "● Offline",
      starting:
        '<i data-lucide="loader" style="width:12px;height:12px;vertical-align:middle;animation:spin 2s linear infinite;"></i> Starting…',
      running: "● Online",
    };
    const cls = {
      stopped: "stopped",
      starting: "starting",
      running: "running",
    };
    document.getElementById("stat-status").innerHTML =
      `<span class="badge ${cls[st.phase]}">${badge[st.phase]}</span>`;

    const ramGB = st.ram || 4; // Fallback to 4GB if missing

    document.getElementById("stat-cpu").innerText = st.cpu.toFixed(1) + "%";
    document.getElementById("stat-cpu-sub").innerText =
      `of ${(ramGB * 100) / 2}% allocated`; // rough mapping
    document.getElementById("bar-cpu").style.width =
      Math.min(st.cpu / (ramGB * 50), 1) * 100 + "%";

    document.getElementById("stat-mem").innerText = fmtBytes(st.memory);
    document.getElementById("stat-mem-sub").innerText =
      `of ${ramGB} GB allocated`;
    document.getElementById("bar-mem").style.width =
      Math.min((st.memory / (ramGB * 1024 ** 3)) * 100, 100) + "%";

    document.getElementById("stat-disk").innerText = fmtBytes(st.disk);
    document.getElementById("stat-disk-sub").innerHTML =
      `<a href="#" onclick="openServerFolder(event)" style="color:var(--text); text-decoration:underline;">Open folder</a>`;

    // Plain text server name — MC color codes stripped, NEVER rendered
    const plainName = (st.display_name || currentServer).replace(
      /§[0-9a-fk-or]/gi,
      "",
    );
    document.getElementById("dash-title").textContent =
      `${plainName} - ${st.type} ${st.version}`;
    if (document.getElementById("dash-motd-title")) {
      // MOTD preview title still uses plain name (the preview line below uses MC colors)
      document.getElementById("dash-motd-title").textContent = plainName;
    }
    currentVersion = st.version || "";
    currentServerType = st.type || "vanilla";
    
    // Update Mod vs Plugin UI naming based on active server type
    const isPluginServer = ["paper", "spigot", "purpur", "bukkit"].includes(currentServerType.toLowerCase());
    const modsLabelEl = document.getElementById("dash-mods-label");
    if (modsLabelEl) modsLabelEl.innerText = isPluginServer ? "Plugins" : "Mods";
    
    const modTypeFilter = document.getElementById("mod-type-filter");
    if (modTypeFilter) {
      const modOpt = modTypeFilter.querySelector('option[value="mod"]');
      if (modOpt) modOpt.textContent = isPluginServer ? "Plugins" : "Mods";
    }
    
    const modInstTypeFilter = document.getElementById("mod-installed-type-filter");
    if (modInstTypeFilter) {
      const modOpt = modInstTypeFilter.querySelector('option[value="mod"]');
      if (modOpt) modOpt.textContent = isPluginServer ? "Plugins" : "Mods";
    }

    document.getElementById("dash-mods").innerText = st.mods_count || 0;
    document.getElementById("dash-rp").innerText = st.rp_count || 0;
    document.getElementById("dash-sp").innerText = st.sp_count || 0;

    // Feature 5 — First-Boot Protection
    const initialized = st.is_initialized !== false; // true if missing (safe default)
    const modsNav = document.getElementById("nav-modrinth");
    const filesNav = document.getElementById("nav-files");
    const modsLock = document.getElementById("tab-lock-modrinth");
    const filesLock = document.getElementById("tab-lock-files");
    if (modsNav) modsNav.dataset.locked = initialized ? "false" : "true";
    if (filesNav) filesNav.dataset.locked = initialized ? "false" : "true";
    if (modsLock) modsLock.style.display = initialized ? "none" : "flex";
    if (filesLock) filesLock.style.display = initialized ? "none" : "flex";

    // ─ Live chart update
    if (st.phase === "running") {
      if (!statsChart) initStatsChart();
      const now = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      chartLabels.push(now);
      chartCpuData.push(parseFloat(st.cpu.toFixed(1)));
      chartRamData.push(parseFloat((st.memory / (1024 * 1024)).toFixed(0)));
      if (chartLabels.length > CHART_MAX_PTS) {
        chartLabels.shift();
        chartCpuData.shift();
        chartRamData.shift();
      }
      statsChart.data.labels = chartLabels;
      statsChart.data.datasets[0].data = chartCpuData;
      statsChart.data.datasets[1].data = chartRamData;
      statsChart.update("none");
      const lbl = document.getElementById("chart-status-label");
      if (lbl)
        lbl.textContent = `${chartLabels.length} samples · updating every 4s`;
    }

    document.getElementById("stat-uptime").innerText =
      st.phase === "running" ? fmtUptime(st.uptime) : "—";
    document.getElementById("stat-players").innerText =
      st.phase === "running" ? st.players_online : "—";
    document.getElementById("stat-players-sub").innerText =
      st.phase === "running"
        ? `${st.players_online}/${st.players_max} online`
        : "0/0 online";
    document.getElementById("bar-players").style.width =
      st.phase === "running" && st.players_max > 0
        ? `${(st.players_online / st.players_max) * 100}%`
        : "0%";

    const facesContainer = document.getElementById("active-players-faces");
    if (facesContainer) {
      if (st.phase === "running" && st.players?.sample?.length > 0) {
        facesContainer.innerHTML = st.players.sample.map(p => {
          const url = `https://crafatar.com/renders/head/${p.id}?overlay`;
          return `<img src="${url}" title="${p.name} - Click to Manage" alt="${p.name}" class="active-player-head" onclick="openPlayerManager('${p.name}')" style="width:28px;height:28px;cursor:pointer;border-radius:3px;box-shadow:0 2px 5px rgba(0,0,0,0.5);transition:transform 0.1s;" onmouseover="this.style.transform='scale(1.15)'" onmouseout="this.style.transform='scale(1)'"/>`;
        }).join("");
      } else {
        facesContainer.innerHTML = "";
      }
    }

    // Tunnel & IP
    const tb = document.getElementById("tunnel-info-box");
    const lb = document.getElementById("local-ip-box");
    const setupBox = document.getElementById("playit-setup-box");

    // Update server icon — use dedicated icon endpoint, fallback to logo
    const iconEl = document.getElementById("dash-server-icon");
    if (iconEl) {
      iconEl.onerror = () => {
        iconEl.src = "/static/logo.png";
        iconEl.onerror = null;
      };
      iconEl.src = `/api/servers/${encodeURIComponent(currentServer)}/icon?t=${Date.now()}`;
    }

    // Sync Mods tab filter based on server platform
    const newPlatform = (st.platform || "vanilla").toLowerCase();
    if (newPlatform !== currentPlatform) {
      currentPlatform = newPlatform;
      syncPlatformUI();
    }

    // ─ Tunnel status card + IP boxes
    const pulseDot = document.getElementById("tunnel-pulse-dot");
    const statusTxt = document.getElementById("tunnel-status-text");
    const playitAdvToggle = document.querySelector(".playit-adv-toggle");
    const isP2P = st.connection_method === "mero-p2p" || (st.tunnel && st.tunnel.is_p2p);
    if (playitAdvToggle) {
      playitAdvToggle.style.display = isP2P ? "none" : "flex";
    }
    const advPanel = document.getElementById("tunnel-advanced-panel");
    if (advPanel && isP2P) {
      advPanel.classList.remove("open");
    }

    if (st.tunnel?.public_ip) {
      const pubEl = document.getElementById("public-ip-text");
      const iconGlobe = document.getElementById("public-ip-icon");
      const iconKey = document.getElementById("public-p2p-icon");
      const labelEl = document.getElementById("public-ip-label");
      const claimContainer = document.getElementById("tunnel-claim-container");

      if (pubEl) {
        pubEl.style.display = "";
        pubEl.innerText = st.tunnel.public_ip;
        pubEl.value = st.tunnel.public_ip;
      }
      if (iconGlobe) {
        iconGlobe.style.display = st.tunnel.is_p2p ? "none" : "";
      }
      if (iconKey) {
        iconKey.style.display = st.tunnel.is_p2p ? "" : "none";
      }
      if (labelEl) {
        labelEl.style.display = "";
        labelEl.textContent = st.tunnel.is_p2p ? "Invite:" : "Public:";
      }
      if (claimContainer) {
        claimContainer.style.display = "none";
      }

      const btn = document.getElementById("btn-copy-public");
      if (btn) btn.style.display = "inline-flex";
      tb.style.display = "flex";
      if (setupBox) setupBox.style.display = "block";
      if (pulseDot) pulseDot.classList.remove("waiting");
      if (statusTxt) {
        statusTxt.style.color = "var(--success)";
        if (st.tunnel.is_p2p) {
          statusTxt.textContent = "Mero P2P — Active (Use Invite Code)";
        } else {
          statusTxt.textContent = "Playit.gg — Active: " + st.tunnel.public_ip;
        }
        statusTxt.style.cursor = "";
        statusTxt.onclick = null;
      }
    } else if (st.tunnel?.claim_url) {
      const pubEl = document.getElementById("public-ip-text");
      const iconGlobe = document.getElementById("public-ip-icon");
      const iconKey = document.getElementById("public-p2p-icon");
      const labelEl = document.getElementById("public-ip-label");
      const claimContainer = document.getElementById("tunnel-claim-container");
      const claimLink = document.getElementById("tunnel-claim-link");

      if (pubEl) pubEl.style.display = "none";
      if (iconGlobe) iconGlobe.style.display = "none";
      if (iconKey) iconKey.style.display = "none";
      if (labelEl) labelEl.style.display = "none";
      if (claimContainer) claimContainer.style.display = "flex";
      if (claimLink) claimLink.href = st.tunnel.claim_url;

      const btn = document.getElementById("btn-copy-public");
      if (btn) btn.style.display = "none";
      tb.style.display = "flex";
      if (setupBox) setupBox.style.display = "block";
      if (pulseDot) pulseDot.classList.add("waiting");
      if (statusTxt) {
        statusTxt.style.color = "var(--warning)";
        statusTxt.textContent = "Playit.gg — Claim your tunnel →";
        statusTxt.style.cursor = "pointer";
        statusTxt.onclick = () => window.open(st.tunnel.claim_url, "_blank");
      }
      lucide.createIcons();
    } else {
      tb.style.display = "none";
      if (setupBox)
        setupBox.style.display =
          st.phase === "running" ||
          st.phase === "starting" ||
          st.phase === "stopped"
            ? "block"
            : "none";
      if (pulseDot) pulseDot.classList.add("waiting");
      if (statusTxt) {
        statusTxt.style.color = "var(--muted)";
        const method =
          st.connection_method === "mero-p2p" ? "Mero P2P" : "Playit.gg";
        statusTxt.textContent =
          st.phase === "running"
            ? `${method} — Connecting…`
            : `${method} — Start server to activate`;
        statusTxt.style.cursor = "";
        statusTxt.onclick = null;
      }
    }

    // Pinggy (Safe Tunnel)
    if (st.pinggy?.public_ip) {
      const pinggyText = document.getElementById("pinggy-ip-text");
      if (pinggyText) pinggyText.innerText = st.pinggy.public_ip;
      if (pinggyBox) pinggyBox.style.display = "flex";
      if (pinggyBtn) pinggyBtn.style.display = "none";
    } else if (st.phase === "running") {
      if (pinggyBox) pinggyBox.style.display = "none";
      if (pinggyBtn) pinggyBtn.style.display = "block";
    } else {
      if (pinggyBox) pinggyBox.style.display = "none";
      if (pinggyBtn) pinggyBtn.style.display = "none";
    }

    const localIpEl = document.getElementById("local-ip-text");
    if (localIpEl) {
      const displayIp = st.local_ip || "Calculating...";
      localIpEl.innerText = displayIp;
      localIpEl.value = displayIp;
    }
    if (lb) lb.style.display = "flex";
  } catch (e) {}
}

function copyIp(elementId, btn) {
  const el = document.getElementById(elementId);
  if (!el) {
    console.error("copyIp: Element not found:", elementId);
    return;
  }
  const text = el.value || el.innerText;
  if (!text || text === "Calculating...") return;

  function handleSuccess() {
    showToast("Copied to clipboard!");
    if (!btn) return;
    try {
      const orig = btn.innerHTML;
      btn.innerHTML =
        '<i data-lucide="check" style="width:14px;height:14px"></i>';
      btn.classList.add("copy-done");
      if (window.lucide) {
        try {
          lucide.createIcons();
        } catch (e) {
          console.error("Lucide check rendering error:", e);
        }
      }
      setTimeout(() => {
        try {
          btn.innerHTML = orig;
          btn.classList.remove("copy-done");
          if (window.lucide) {
            try {
              lucide.createIcons();
            } catch (e) {
              console.error("Lucide restore rendering error:", e);
            }
          }
        } catch (err) {
          console.error("Error in copyIp restore timeout:", err);
        }
      }, 2000);
    } catch (err) {
      console.error("Error in copyIp handleSuccess:", err);
    }
  }

  function useWebClipboard() {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(handleSuccess).catch(err => {
        fallbackCopyText(text, handleSuccess);
      });
    } else {
      fallbackCopyText(text, handleSuccess);
    }
  }

  if (window.pywebview && window.pywebview.api && window.pywebview.api.copy_to_clipboard) {
    window.pywebview.api.copy_to_clipboard(text).then(res => {
      if (res) {
        handleSuccess();
      } else {
        useWebClipboard();
      }
    }).catch(err => {
      useWebClipboard();
    });
  } else {
    useWebClipboard();
  }
}

function fallbackCopyText(text, successCallback) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.top = "0";
  textArea.style.left = "0";
  textArea.style.position = "fixed";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    const successful = document.execCommand('copy');
    if (successful) {
      successCallback();
    } else {
      console.error('Fallback: Copying text was unsuccessful');
    }
  } catch (err) {
    console.error('Fallback: Unable to copy', err);
  }
  document.body.removeChild(textArea);
}

function togglePlayitAdvanced() {
  const panel = document.getElementById("tunnel-advanced-panel");
  if (panel) panel.classList.toggle("open");
}

// ─── Manifest Builder ─────────────────────────────────────────────────────────
async function publishManifest(btn) {
  if (!currentServer) return;
  await withLoadingBtn(btn, "loader", async () => {
    const r = await fetch(
      `${API}/servers/${encodeURIComponent(currentServer)}/manifest/publish`,
      { method: "POST" },
    );
    const data = await r.json();
    if (!r.ok) {
      showToast("❌ " + (data.detail || "Publish failed"));
      return;
    }
    const urlInput = document.getElementById("manifest-url-display");
    if (urlInput) urlInput.value = data.url;

    const badge = document.getElementById("manifest-mod-badge");
    const isPluginOrVanilla = ["paper", "purpur", "spigot", "bukkit", "vanilla"].includes((data.platform || "").toLowerCase());
    const detailText = isPluginOrVanilla 
      ? `${data.resourcepacks || 0} packs, ${data.shaders || 0} shaders`
      : `${data.mods || 0} mods, ${data.resourcepacks || 0} packs, ${data.shaders || 0} shaders`;

    if (badge) {
      badge.textContent = detailText;
      badge.style.display = "inline-block";
    }
    showToast(`✅ Manifest published — ${detailText} listed`);
    lucide.createIcons();
  });
}

function copyManifestUrl(btn) {
  const url = document.getElementById("manifest-url-display")?.value;
  if (!url) {
    showToast("Nothing to copy yet — publish first!");
    return;
  }
  navigator.clipboard.writeText(url).then(() => {
    showToast("Manifest URL copied!");
    if (!btn) return;
    try {
      const orig = btn.innerHTML;
      btn.innerHTML =
        '<i data-lucide="check" style="width:14px;height:14px"></i>';
      btn.classList.add("copy-done");
      if (window.lucide) {
        try {
          lucide.createIcons();
        } catch (e) {
          console.error("Lucide check rendering error:", e);
        }
      }
      setTimeout(() => {
        try {
          btn.innerHTML = orig;
          btn.classList.remove("copy-done");
          if (window.lucide) {
            try {
              lucide.createIcons();
            } catch (e) {
              console.error("Lucide restore rendering error:", e);
            }
          }
        } catch (err) {
          console.error("Error in copyManifestUrl restore timeout:", err);
        }
      }, 2000);
    } catch (err) {
      console.error("Error in copyManifestUrl handleSuccess:", err);
    }
  });
}

async function loadManifestUrl() {
  if (!currentServer) return;
  try {
    const data = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/manifest/url`,
    );
    const urlInput = document.getElementById("manifest-url-display");
    if (urlInput) urlInput.value = data.url || "";
    const badge = document.getElementById("manifest-mod-badge");
    if (badge) {
      if (data.url) {
        const isPluginOrVanilla = ["paper", "purpur", "spigot", "bukkit", "vanilla"].includes((data.platform || "").toLowerCase());
        const detailText = isPluginOrVanilla 
          ? `${data.resourcepacks || 0} packs, ${data.shaders || 0} shaders`
          : `${data.mods || 0} mods, ${data.resourcepacks || 0} packs, ${data.shaders || 0} shaders`;
        badge.textContent = detailText;
        badge.style.display = "inline-block";
      } else {
        badge.style.display = "none";
      }
    }
  } catch (e) {}
}

// ─── Console ──────────────────────────────────────────────────────────────────
function linkify(s) {
  return s.replace(
    /(https?:\/\/[^\s&]+)/g,
    '<a href="$1" target="_blank" style="color:inherit;text-decoration:underline;cursor:pointer;">$1</a>',
  );
}
function colorLine(raw) {
  let s = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  s = linkify(s);
  if (/\[ERROR\]|\bERROR\b/.test(s))
    return `<span class="log-error">${s}</span>`;
  if (/\[WARN\]|\bWARN\b/.test(s)) return `<span class="log-warn">${s}</span>`;
  if (/IP:|Link:/.test(s)) return `<span class="log-ip">${s}</span>`;
  if (/\[Mero\]/.test(s)) return `<span class="log-mero">${s}</span>`;
  if (/^\[Chat\]/.test(s)) return `<span class="log-chat">${s}</span>`;
  if (/^>/.test(s)) return `<span class="log-cmd">${s}</span>`;
  return `<span class="log-info">${s}</span>`;
}

async function fetchConsole() {
  if (!currentServer) return;
  try {
    const data = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/console`,
    );
    if (data.logs.length === lastLogCount) return; // no change
    lastLogCount = data.logs.length;
    const div = document.getElementById("console-logs");

    // Check if user is currently scrolled near the bottom
    const isAtBottom = div.scrollHeight - div.scrollTop - div.clientHeight < 50;

    div.innerHTML = data.logs.map(colorLine).join("\n");

    // Only autoscroll if they were already at the bottom
    if (isAtBottom) {
      div.scrollTop = div.scrollHeight;
    }
  } catch (e) {}
}

async function sendConsoleCommand() {
  const inp = document.getElementById("console-input");
  const cmd = inp.value.trim();
  if (!cmd) return;
  inp.value = "";

  if (cmd.toLowerCase() === "cls" || cmd.toLowerCase() === "clear") {
    clearConsoleLogs();
    return;
  }

  await apiPost(`/servers/${encodeURIComponent(currentServer)}/command`, {
    command: cmd,
  });
}

function clearConsoleLogs() {
  const div = document.getElementById("console-logs");
  div.innerHTML = "";
  lastLogCount = 0; // We keep it in sync, or we could just visually hide it.
  // Wait, if lastLogCount is 0, the next fetch will see the backend has more logs and rewrite them all!
  // Better to just visually clear it until new logs arrive, but since backend stores logs,
  // we should fetch the current count and set lastLogCount to it, and just clear the visual.
  // Actually, setting innerHTML to '' works if we update lastLogCount. But next fetch might add EVERYTHING again.
  // Let's just visually clear it and let next log append. Wait, fetchConsole replaces innerHTML entirely.
  // So cls is hard to do if backend returns all logs. Let's make an API call to clear backend logs!
  apiPost(`/servers/${encodeURIComponent(currentServer)}/command`, {
    command: "cls_frontend",
  });
}

// Custom Context Menu for Console
document.addEventListener("DOMContentLoaded", () => {
  initSubdomainValidation();
  initConsoleAutocomplete();
  const consoleDiv = document.getElementById("console-logs");
  const menu = document.getElementById("console-context-menu");
  const wrapper = document.getElementById("console-wrapper-main");

  if (consoleDiv && menu) {
    consoleDiv.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      menu.style.display = "block";
      menu.style.left = e.clientX - rect.left + "px";
      menu.style.top = e.clientY - rect.top + "px";
    });

    document.addEventListener("click", (e) => {
      if (e.target.closest("#console-context-menu")) return;
      menu.style.display = "none";
    });
  }
});

function initConsoleAutocomplete() {
  const MC_COMMANDS = [
    "help", "tp", "op", "deop", "kick", "ban", "pardon", "stop", "say", 
    "time", "weather", "gamemode", "give", "clear", "difficulty", "seed",
    "whitelist", "gamerule", "kill", "list", "save-all", "save-off", "save-on"
  ];
  let autocompleteSelectedIndex = -1;
  let currentSuggestions = [];

  const inp = document.getElementById("console-input");
  const box = document.getElementById("console-autocomplete-box");
  const ghostTyped = document.getElementById("console-ghost-typed");
  const ghostSuggest = document.getElementById("console-ghost-suggest");
  
  if (!inp || !box) return;

  function updateGhostText() {
    const val = inp.value;
    if (!val || currentSuggestions.length === 0) {
        ghostTyped.textContent = "";
        ghostSuggest.textContent = "";
        return;
    }
    let match = currentSuggestions[Math.max(0, autocompleteSelectedIndex)];
    if (match.toLowerCase().startsWith(val.toLowerCase())) {
        ghostTyped.textContent = val; 
        ghostSuggest.textContent = match.substring(val.length);
    } else {
        ghostTyped.textContent = "";
        ghostSuggest.textContent = "";
    }
  }

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (box.style.display === "flex" && currentSuggestions.length > 0) {
        // Either use the selected index, or the top suggestion if -1 (so Tab or Enter on ghost text works)
        inp.value = currentSuggestions[Math.max(0, autocompleteSelectedIndex)];
        box.style.display = "none";
        ghostTyped.textContent = "";
        ghostSuggest.textContent = "";
        inp.focus();
        // Fire input event to re-evaluate if we want subcommand suggestions
        inp.dispatchEvent(new Event('input'));
      } else {
        sendConsoleCommand();
        box.style.display = "none";
        ghostTyped.textContent = "";
        ghostSuggest.textContent = "";
      }
      return;
    }

    if (box.style.display === "flex") {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        autocompleteSelectedIndex = Math.min(autocompleteSelectedIndex + 1, currentSuggestions.length - 1);
        renderSuggestions();
        updateGhostText();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        autocompleteSelectedIndex = Math.max(autocompleteSelectedIndex - 1, 0);
        renderSuggestions();
        updateGhostText();
      } else if (e.key === "Tab") {
        e.preventDefault();
        if (currentSuggestions.length > 0) {
          inp.value = currentSuggestions[Math.max(0, autocompleteSelectedIndex)];
          inp.dispatchEvent(new Event('input')); // trigger update
        }
      } else if (e.key === "Escape") {
        box.style.display = "none";
        ghostTyped.textContent = "";
        ghostSuggest.textContent = "";
      }
    } else if (e.key === "Tab") {
        e.preventDefault();
        updateSuggestions(inp.value);
    }
  });

  inp.addEventListener("input", () => {
    updateSuggestions(inp.value);
  });

  document.addEventListener("click", (e) => {
    if (!box.contains(e.target) && e.target !== inp) {
      box.style.display = "none";
      ghostTyped.textContent = "";
      ghostSuggest.textContent = "";
    }
  });

  function updateSuggestions(val) {
    if (!val.startsWith("/")) {
      box.style.display = "none";
      currentSuggestions = [];
      updateGhostText();
      return;
    }
    const parts = val.substring(1).split(" ");
    const cmd = parts[0].toLowerCase();
    
    currentSuggestions = [];
    
    if (parts.length === 1) {
      currentSuggestions = MC_COMMANDS.filter(c => c.startsWith(cmd)).map(c => "/" + c);
    } else if (parts.length === 2 && ["tp", "op", "deop", "kick", "ban", "pardon", "give"].includes(cmd)) {
      const players = window.latestServerState?.players?.sample || [];
      const pnames = players.map(p => p.name);
      const search = parts[1].toLowerCase();
      const matched = pnames.filter(n => n.toLowerCase().startsWith(search));
      currentSuggestions = matched.map(n => "/" + cmd + " " + n);
    } else if (parts.length === 2 && cmd === "gamemode") {
      const modes = ["survival", "creative", "adventure", "spectator"];
      const search = parts[1].toLowerCase();
      currentSuggestions = modes.filter(m => m.startsWith(search)).map(m => "/" + cmd + " " + m);
    } else if (parts.length === 2 && cmd === "time") {
      const modes = ["set", "add", "query"];
      const search = parts[1].toLowerCase();
      currentSuggestions = modes.filter(m => m.startsWith(search)).map(m => "/" + cmd + " " + m);
    } else if (parts.length === 2 && cmd === "weather") {
      const modes = ["clear", "rain", "thunder"];
      const search = parts[1].toLowerCase();
      currentSuggestions = modes.filter(m => m.startsWith(search)).map(m => "/" + cmd + " " + m);
    }

    // Only show popup if there's more than one suggestion OR the suggestion is different from what's typed
    const exactMatch = currentSuggestions.length === 1 && currentSuggestions[0].toLowerCase() === val.toLowerCase();

    if (currentSuggestions.length > 0 && !exactMatch) {
      autocompleteSelectedIndex = -1;
      renderSuggestions();
      box.style.display = "flex";
    } else {
      box.style.display = "none";
    }
    updateGhostText();
  }

  function renderSuggestions() {
    box.innerHTML = "";
    currentSuggestions.forEach((sug, i) => {
      const div = document.createElement("div");
      // visually highlight the currently selected via arrow keys
      div.className = "autocomplete-suggestion" + (i === Math.max(0, autocompleteSelectedIndex) ? " selected" : "");
      
      // highlight the portion the user typed
      div.innerHTML = sug.replace(new RegExp(`^(${inp.value})`, "i"), '<span class="suggestion-highlight">$1</span>');
      div.onclick = () => {
        inp.value = sug;
        box.style.display = "none";
        inp.focus();
        inp.dispatchEvent(new Event('input')); // fetch next subcommands if any
      };
      box.appendChild(div);
    });
  }
}

async function copyConsoleLogs() {
  const div = document.getElementById("console-logs");
  try {
    await navigator.clipboard.writeText(div.innerText);
    showToast("Console logs copied!");
  } catch (e) {
    alert("Failed to copy logs");
  }
  document.getElementById("console-context-menu").style.display = "none";
}

async function sendChat() {
  const msg = document.getElementById("chat-message").value.trim();
  const player = document.getElementById("chat-player").value.trim();
  if (!msg) return;
  await apiPost(`/servers/${encodeURIComponent(currentServer)}/chat`, {
    message: msg,
    player,
  });
  document.getElementById("chat-message").value = "";
  showToast(player ? `Sent as <${player}>` : "Announcement sent!");
}

// ─── Config ───────────────────────────────────────────────────────────────────
function updateConnectionMethodUI() {
  const method = document.getElementById("cfg-connection-method").value;
  const advToggle = document.querySelector(".playit-adv-toggle");
  const playitSetupBox = document.getElementById("playit-setup-box");
  const publicIpLabel = document.getElementById("public-ip-label");

  if (advToggle) {
    advToggle.style.display = method === "mero-p2p" ? "none" : "flex";
  }
  const advPanel = document.getElementById("tunnel-advanced-panel");
  if (advPanel && method === "mero-p2p") {
    advPanel.classList.remove("open");
  }

  if (method === "mero-p2p") {
    if (playitSetupBox) playitSetupBox.style.display = "none";
    if (publicIpLabel) publicIpLabel.textContent = "Mero P2P Direct Connect:";
  } else {
    if (playitSetupBox) playitSetupBox.style.display = "flex";
    if (publicIpLabel) publicIpLabel.textContent = "Public:";
  }
}

async function fetchConfig() {
  if (!currentServer) return;
  try {
    const data = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/config`,
    );
    const c = data.config;
    const meta = data.meta || {};

    // Server Identity / Meta
    document.getElementById("cfg-display-name").value =
      meta.display_name || currentServer;
      
    const cfgRamSlider = document.getElementById("cfg-ram");
    cfgRamSlider.max = maxSystemRam;
    cfgRamSlider.value = meta.ram || 4;
    document.getElementById("cfg-ram-max-label").innerText = `${maxSystemRam} GB (System Max)`;
    updateRamSliderDisplay(cfgRamSlider, "cfg-ram-val");

    // Sync previews — server name is always plain text
    const plainName = (meta.display_name || currentServer).replace(
      /§[0-9a-fk-or]/gi,
      "",
    );
    if (document.getElementById("settings-servername-preview")) {
      document.getElementById("settings-servername-preview").textContent =
        plainName;
    }
    if (document.getElementById("settings-motd-title")) {
      document.getElementById("settings-motd-title").textContent = plainName;
    }
    // Properties
    const setVal = (id, key, fallback = "") => {
      const el = document.getElementById(id);
      if (!el) return;
      // Check properties (c), then meta, then fallback
      const val =
        c[key] !== undefined
          ? c[key]
          : meta[key] !== undefined
            ? meta[key]
            : fallback;
      el.value = String(val);
      // Sync range display labels
      if (id === "cfg-view-distance")
        document.getElementById("cfg-view-distance-val").textContent = el.value;
      if (id === "cfg-simulation-distance")
        document.getElementById("cfg-sim-distance-val").textContent = el.value;
    };
    // World & Generation
    setVal("cfg-level-name", "level-name", "world");
    setVal("cfg-level-type", "level-type", "minecraft:normal");
    setVal("cfg-allow-nether", "allow-nether", "true");
    setVal("cfg-generate-structures", "generate-structures", "true");
    setVal("cfg-max-build-height", "max-build-height", "256");
    // Gameplay & Rules
    setVal("cfg-difficulty", "difficulty", "easy");
    setVal("cfg-pvp", "pvp", "true");
    setVal("cfg-hardcore", "hardcore", "false");
    setVal("cfg-allow-flight", "allow-flight", "false");
    setVal("cfg-spawn-protection", "spawn-protection", "16");
    // Performance & Limits
    setVal("cfg-max-players", "max-players", "20");
    setVal("cfg-view-distance", "view-distance", "10");
    setVal("cfg-simulation-distance", "simulation-distance", "10");
    setVal("cfg-max-tick-time", "max-tick-time", "60000");
    // Security & Network
    setVal("cfg-online-mode", "online-mode", "true");
    setVal("cfg-enforce-whitelist", "enforce-whitelist", "false");
    setVal("cfg-hide-online-players", "hide-online-players", "false");
    setVal("cfg-subdomain", "subdomain", "");
    setVal("cfg-connection-method", "connection-method", "playit");
    setVal("cfg-server-port", "server-port", "25565");

    updateConnectionMethodUI();

    // MOTD
    if (c.motd) {
      document.getElementById("dash-motd-input").value = c.motd;
      if (document.getElementById("settings-motd-input"))
        document.getElementById("settings-motd-input").value = c.motd;
      updateDashMotdPreview();
      if (document.getElementById("settings-motd-input"))
        updateSettingsMotdPreview();
    }
  } catch (e) {
    console.error("Failed to parse config:", e);
  }
}

function updateDashMotdPreview() {
  document.getElementById("dash-motd-preview-text").innerHTML = renderMcText(
    document.getElementById("dash-motd-input").value,
  );
}

function updateSettingsMotdPreview() {
  document.getElementById("settings-motd-preview-text").innerHTML =
    renderMcText(document.getElementById("settings-motd-input").value);
}

async function withButtonState(btn, actionFunc) {
  if (!btn) return await actionFunc();
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML =
    '<i data-lucide="loader" style="width:14px;height:14px;vertical-align:middle;animation:spin 2s linear infinite;"></i>';
  try {
    await actionFunc();
    btn.innerHTML =
      '<i data-lucide="check" style="width:14px;height:14px;vertical-align:middle;"></i>';
  } catch (e) {
    btn.innerHTML =
      '<i data-lucide="x" style="width:14px;height:14px;vertical-align:middle;"></i>';
    setTimeout(() => {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }, 2000);
    throw e;
  }
  setTimeout(() => {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }, 2000);
}

async function saveSettings(btn) {
  await withButtonState(btn, async () => {
    const get = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : undefined;
    };
    const updates = {
      "level-name": get("cfg-level-name"),
      "level-type": get("cfg-level-type"),
      "allow-nether": get("cfg-allow-nether"),
      "generate-structures": get("cfg-generate-structures"),
      "max-build-height": get("cfg-max-build-height"),
      difficulty: get("cfg-difficulty"),
      pvp: get("cfg-pvp"),
      hardcore: get("cfg-hardcore"),
      "allow-flight": get("cfg-allow-flight"),
      "spawn-protection": get("cfg-spawn-protection"),
      "max-players": get("cfg-max-players"),
      "view-distance": get("cfg-view-distance"),
      "simulation-distance": get("cfg-simulation-distance"),
      "max-tick-time": get("cfg-max-tick-time"),
      // Security & Network
      "online-mode": get("cfg-online-mode"),
      "enforce-whitelist": get("cfg-enforce-whitelist"),
      "hide-online-players": get("cfg-hide-online-players"),
      "server-port": get("cfg-server-port"),
      // MOTD (from settings tab motd input if exists, else from dashboard)
      motd: get("settings-motd-input") || get("dash-motd-input"),
    };
    // Remove undefined values
    Object.keys(updates).forEach(
      (k) => updates[k] === undefined && delete updates[k],
    );

    const meta_updates = {
      display_name: get("cfg-display-name"),
      ram: parseInt(get("cfg-ram")),
      subdomain: get("cfg-subdomain"),
      "connection-method": get("cfg-connection-method"),
    };

    await apiPost(`/servers/${encodeURIComponent(currentServer)}/config`, {
      properties: updates,
      meta: meta_updates,
    });
    showToast("Configuration saved! Restart server to apply changes.");
    fetchServersList();
    fetchStats();
  });
}

// ─── File Manager ─────────────────────────────────────────────────────────────
let currentFileList = [];

async function fetchFiles() {
  if (!currentServer) return;
  selectedFiles.clear();
  updateSelectAll();
  // Pre-load installed mods cache so fileIcon() can show thumbnails
  if (installedModsCache.length === 0) {
    try {
      const res = await apiGet(
        `/servers/${encodeURIComponent(currentServer)}/installed_mods`,
      );
      installedModsCache = res.files || [];
    } catch (e) {}
  }
  const files = await apiGet(
    `/servers/${encodeURIComponent(currentServer)}/files?path=${encodeURIComponent(currentPath)}`,
  );
  currentFileList = files || [];
  renderBreadcrumb();
  renderFilesList(currentFileList);

  // Trigger background jar scanning if there are jar files in list
  if (currentFileList.some(f => !f.is_dir && f.name.endsWith('.jar'))) {
    apiPost(`/servers/${encodeURIComponent(currentServer)}/scan-jars`).catch(() => {});
  }
}

function onJarScanned(filename, iconUrl, title) {
  // Update in installedModsCache so subsequent navigation or render preserves it
  const existing = installedModsCache.find(m => m.path && m.path.split('/').pop() === filename);
  if (existing) {
    existing.icon_url = iconUrl;
    existing.title = title;
  } else {
    installedModsCache.push({
      path: currentPath ? `${currentPath}/${filename}` : filename,
      title: title,
      icon_url: iconUrl
    });
  }

  // Update DOM directly if currently looking at this folder
  const rows = document.querySelectorAll("#fm-tbody .fm-row");
  rows.forEach(row => {
    const nameCell = row.querySelector(".fm-name");
    if (nameCell && nameCell.innerText.trim().endsWith(filename)) {
      const img = document.createElement("img");
      img.src = iconUrl;
      img.style.cssText = "width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;background:rgba(255,255,255,0.1);margin-right:6px;";
      
      // Clean nameCell first of any generic icon
      nameCell.innerHTML = "";
      nameCell.appendChild(img);
      nameCell.appendChild(document.createTextNode(" " + filename));
    }
  });
}

function renderFilesList(filesToRender) {
  const tbody = document.getElementById("fm-tbody");
  tbody.innerHTML = "";
  if (currentPath) {
    const parent = currentPath.split("/").slice(0, -1).join("/");
    const tr = document.createElement("tr");
    tr.className = "fm-row";
    tr.innerHTML = `<td></td><td colspan="3" class="fm-name" onclick="navTo('${parent}')" style="color:var(--muted);cursor:pointer"><i data-lucide="corner-left-up" style="width:14px;height:14px;vertical-align:middle;"></i> ..</td><td></td>`;
    tbody.appendChild(tr);
  }
  if (filesToRender.length === 0) {
    const tr = document.createElement("tr");
    tr.className = "fm-row";
    tr.innerHTML = `<td colspan="5" style="text-align:center; color:var(--muted); padding: 20px;">No files found.</td>`;
    tbody.appendChild(tr);
  }
  filesToRender.forEach((f) => {
    const tr = document.createElement("tr");
    tr.className = "fm-row";
    const icon = f.is_dir
      ? '<i data-lucide="folder" style="width:16px;height:16px;vertical-align:middle;color:var(--blue);"></i>'
      : fileIcon(f);
    const nameCell = f.is_dir
      ? `<td class="fm-name dir-name" onclick="navTo('${f.path}')">${icon} ${f.name}</td>`
      : `<td class="fm-name file-name" onclick="editFile('${f.path}')" style="cursor:pointer">${icon} ${f.name}</td>`;
    tr.innerHTML = `
            <td><input type="checkbox" class="fm-check" data-path="${f.path}" onchange="onCheck('${f.path}',this.checked)"></td>
            ${nameCell}
            <td class="fm-meta">${f.is_dir ? "—" : fmtBytes(f.size)}</td>
            <td class="fm-meta">${fmtAgo(f.modified)}</td>
            <td><button class="btn danger outline small" onclick="delEntry('${f.path}')">Delete</button></td>`;
    tbody.appendChild(tr);
  });
  lucide.createIcons();
}

function renderBreadcrumb() {
  const parts = currentPath ? currentPath.split("/") : [];
  let built = "",
    html = `<span class="bc-item" onclick="navTo('')"><i data-lucide="home" style="width:14px;height:14px;vertical-align:middle;"></i> /</span>`;
  parts.forEach((p) => {
    built += (built ? "/" : "") + p;
    const path = built;
    html += ` <span class="bc-sep">/</span> <span class="bc-item" onclick="navTo('${path}')">${p}</span>`;
  });
  document.getElementById("fm-breadcrumb").innerHTML = html;
}

function navTo(path) {
  currentPath = path;
  fetchFiles();
}

function fileIcon(f) {
  const n = typeof f === "string" ? f : f.name;
  // If backend provided icon_url (tracked mod), use it
  if (f && typeof f === "object" && f.icon_url) {
    return `<img src="${f.icon_url}" style="width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;background:rgba(255,255,255,0.1);">`;
  }
  if (n.endsWith(".jar")) {
    // Check installed mods cache for a matching icon
    const cached = installedModsCache.find(
      (m) => m.path && m.path.split("/").pop() === n,
    );
    if (cached && cached.icon_url) {
      return `<img src="${cached.icon_url}" style="width:16px;height:16px;vertical-align:middle;border-radius:2px;object-fit:contain;background:rgba(255,255,255,0.1);">`;
    }
    const isMod = installedModsCache.some(
      (m) => m.path && m.path.endsWith("/" + n),
    );
    if (isMod)
      return '<i data-lucide="package" style="width:16px;height:16px;vertical-align:middle;color:var(--success);"></i>';
    return '<i data-lucide="cog" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
  }
  if (n.endsWith(".json"))
    return '<i data-lucide="braces" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
  if (n.endsWith(".txt"))
    return '<i data-lucide="file-text" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
  if (n.endsWith(".log"))
    return '<i data-lucide="scroll-text" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
  if (n.endsWith(".zip") || n.endsWith(".gz"))
    return '<i data-lucide="file-archive" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
  if (/\.(png|jpg|gif)$/.test(n))
    return '<i data-lucide="image" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
  return '<i data-lucide="file" style="width:16px;height:16px;vertical-align:middle;color:var(--muted);"></i>';
}

function filterFiles() {
  const q = document.getElementById("fm-search").value.trim();
  if (!q) {
    renderFilesList(currentFileList);
    return;
  }
  const fuse = new Fuse(currentFileList, {
    keys: ["name"],
    threshold: 0.35,
    distance: 100
  });
  const results = fuse.search(q).map(res => res.item);
  renderFilesList(results);
}

function onCheck(path, checked) {
  checked ? selectedFiles.add(path) : selectedFiles.delete(path);
  updateSelectAll();
}
function toggleSelectAll(checked) {
  document.querySelectorAll(".fm-check").forEach((cb) => {
    cb.checked = checked;
    checked
      ? selectedFiles.add(cb.dataset.path)
      : selectedFiles.delete(cb.dataset.path);
  });
}
function updateSelectAll() {
  const all = document.querySelectorAll(".fm-check"),
    chk = document.getElementById("fm-select-all");
  if (chk) chk.checked = all.length > 0 && selectedFiles.size === all.length;
}

async function delEntry(path) {
  if (!confirm(`Delete "${path}"?`)) return;
  await apiPost(
    `/servers/${encodeURIComponent(currentServer)}/files/delete?path=${encodeURIComponent(path)}`,
  );
  fetchFiles();
}

async function deleteSelected() {
  if (!selectedFiles.size) return;
  if (!confirm(`Delete ${selectedFiles.size} item(s)?`)) return;
  for (const p of selectedFiles)
    await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/files/delete?path=${encodeURIComponent(p)}`,
    );
  fetchFiles();
}

async function createFolder() {
  const name = prompt("New folder name:");
  if (!name) return;
  await apiPost(
    `/servers/${encodeURIComponent(currentServer)}/files/mkdir?path=${encodeURIComponent(currentPath ? currentPath + "/" + name : name)}`,
  );
  fetchFiles();
}

// Drag & drop
const dropzone = document.getElementById("dropzone");
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("drag-over");
});
dropzone.addEventListener("dragleave", (e) => {
  dropzone.classList.remove("drag-over");
});
dropzone.addEventListener("drop", async (e) => {
  e.preventDefault();
  dropzone.classList.remove("drag-over");
  if (!currentServer) return;

  showToast("Uploading files...");
  for (const file of e.dataTransfer.files) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("path", currentPath);
    const r = await fetch(
      `${API}/servers/${encodeURIComponent(currentServer)}/upload`,
      { method: "POST", body: fd },
    );
    if (!r.ok) showToast("Failed to upload " + file.name);
  }
  showToast("Upload complete!");
  fetchFiles();
});

document.getElementById("fm-upload-btn").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  const inp = document.createElement("input");
  inp.type = "file";
  inp.multiple = true;
  inp.onchange = async () => {
    await withButtonState(btn, async () => {
      for (const file of inp.files) {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("path", currentPath);
        const r = await fetch(
          `${API}/servers/${encodeURIComponent(currentServer)}/upload`,
          { method: "POST", body: fd },
        );
        if (!r.ok) throw new Error("Upload failed");
      }
      fetchFiles();
    });
  };
  inp.click();
});

// ─── Modrinth ─────────────────────────────────────────────────────────────────
// ─── Modrinth ─────────────────────────────────────────────────────────────────
let modrinthTimeout = null;
let installedModsCache = [];

function debounceSearchModrinth() {
  clearTimeout(modrinthTimeout);
  modrinthTimeout = setTimeout(searchModrinth, 400);
}

function switchModTab(tab) {
  document
    .querySelectorAll(".mod-tab")
    .forEach((el) => el.classList.remove("active"));
  document.getElementById("mt-" + tab).classList.add("active");
  document.getElementById("mod-view-available").style.display =
    tab === "available" ? "block" : "none";
  document.getElementById("mod-view-installed").style.display =
    tab === "installed" ? "block" : "none";
  if (tab === "installed") fetchInstalledMods();
}

async function fetchInstalledMods() {
  if (!currentServer) return;
  const grid = document.getElementById("installed-mod-results");
  grid.innerHTML = '<p class="text-muted">Loading...</p>';
  const res = await apiGet(
    `/servers/${encodeURIComponent(currentServer)}/installed_mods`,
  );
  installedModsCache = res.files || [];
  filterInstalledMods();
}

function filterInstalledMods() {
  const q = document
    .getElementById("mod-installed-search-input")
    .value.toLowerCase();
  const typeFilter = document.getElementById("mod-installed-type-filter").value;
  const grid = document.getElementById("installed-mod-results");
  grid.innerHTML = "";

  const isPluginServer = ["paper", "spigot", "purpur", "bukkit"].includes(currentServerType.toLowerCase());

  // installedModsCache is now an array of objects: {path, title, icon_url, project_id}
  let filtered = installedModsCache.filter((f) => {
    if (!f.title.toLowerCase().includes(q) && !f.path.toLowerCase().includes(q))
      return false;
    if (typeFilter !== "all") {
      if (typeFilter === "mod") {
        const expectedPrefix = isPluginServer ? "plugins/" : "mods/";
        if (!f.path.startsWith(expectedPrefix)) return false;
      }
      if (typeFilter === "plugin" && !f.path.startsWith("plugins/"))
        return false;
      if (typeFilter === "resourcepack" && !f.path.startsWith("resourcepacks/"))
        return false;
      if (typeFilter === "shader" && !f.path.startsWith("shaderpacks/"))
        return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    const label = isPluginServer ? "plugins" : "mods";
    grid.innerHTML = `<p class="text-muted">No installed ${label} found.</p>`;
    return;
  }
  filtered.forEach((f) => {
    const c = document.createElement("div");
    c.className = "mod-card";
    const filename = f.path.split("/")[1];
    c.innerHTML = `<div style="display:flex;align-items:center;gap:8px;">
            <img src="${f.icon_url || "https://docs.modrinth.com/img/logo.svg"}" style="width:32px;height:32px;border-radius:6px;object-fit:cover;">
            <div style="flex:1;overflow:hidden;">
                <h4 style="margin:0;font-size:0.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.title}</h4>
                <div style="font-size:0.75rem;color:var(--muted);">${filename}</div>
            </div>
            </div>
            <button class="btn danger outline small" onclick="deleteInstalledMod('${f.path}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i> Delete</button>`;
    grid.appendChild(c);
  });
  lucide.createIcons();
}

async function deleteInstalledMod(path) {
  if (!confirm(`Delete ${path.split("/")[1]}?`)) return;
  await apiPost(
    `/servers/${encodeURIComponent(currentServer)}/files/delete?path=${encodeURIComponent(path)}`,
  );
  showToast("Deleted");
  fetchInstalledMods();
}

let activePlatform = 'modrinth';
let modSearchOffset = 0;
let isSearchingMods = false;
let hasMoreMods = true;

async function searchModrinth(isNextPage = false) {
  if (!currentServer) return;
  const q = document.getElementById("mod-search-input").value;
  const t = document.getElementById("mod-type-filter").value;

  if (isSearchingMods && isNextPage) return;

  if (!isNextPage) {
    modSearchOffset = 0;
    hasMoreMods = true;
  } else {
    if (!hasMoreMods) return;
  }

  isSearchingMods = true;

  // ensure we know what's installed
  if (installedModsCache.length === 0) {
    try {
      const res = await apiGet(
        `/servers/${encodeURIComponent(currentServer)}/installed_mods`,
      );
      installedModsCache = res.files || [];
    } catch (e) {}
  }

  const grid = document.getElementById("mod-results");
  if (!isNextPage) {
    grid.innerHTML = '<p class="text-muted">Searching…</p>';
  }

  // Build loader param: only filter by loader for mods (not resource packs/shaders)
  const loaderMap = {
    fabric: "fabric",
    forge: "forge",
    quilt: "quilt",
    neoforge: "neoforge",
    paper: "paper",
    purpur: "paper",
    spigot: "spigot",
    bukkit: "bukkit",
  };
  const loader =
    t === "mod" || t === "modpack" ? loaderMap[currentServerType.toLowerCase()] || "" : "";
  
  let url = `/modrinth/search?query=${encodeURIComponent(q)}&project_type=${t}&offset=${modSearchOffset}`;
  if (currentVersion)
    url += `&game_version=${encodeURIComponent(currentVersion)}`;
  if (loader) url += `&loader=${encodeURIComponent(loader)}`;

  try {
    const hits = await apiGet(url);
    if (!isNextPage) {
      grid.innerHTML = "";
    }
    if (hits.length === 0) {
      if (!isNextPage) {
        grid.innerHTML = '<p class="text-muted">No results found.</p>';
      }
      hasMoreMods = false;
      return;
    }

    hits.forEach((h) => {
      const isInstalled = installedModsCache.some(
        (f) =>
          f.project_id === h.project_id ||
          f.title.toLowerCase().includes(h.slug.toLowerCase()),
      );

      const c = document.createElement("div");
      c.className = "mod-card";
      let actionBtn = `<button id="btn-mod-${h.project_id}" class="btn primary small" onclick="installMod('${h.project_id}','${t}')"><i data-lucide="download" style="width:14px;height:14px;"></i> Install</button>`;

      if (isInstalled) {
        actionBtn = `<button class="btn success small" disabled><i data-lucide="check" style="width:14px;height:14px;"></i> Installed</button>`;
      }

      c.innerHTML = `<img src="${h.icon_url || "https://docs.modrinth.com/img/logo.svg"}">
              <h4>${h.title}</h4><p>${(h.description || "").substring(0, 90)}…</p>
              <div id="mod-action-${h.project_id}">${actionBtn}</div>`;
      grid.appendChild(c);
    });

    modSearchOffset += hits.length;
    if (hits.length < 36) {
      hasMoreMods = false;
    }
    lucide.createIcons();
  } catch (e) {
    if (!isNextPage) {
      grid.innerHTML = '<p class="text-danger">Failed to load results.</p>';
    }
  } finally {
    isSearchingMods = false;
    
    // Toggle Load More button
    const loadMoreContainer = document.getElementById("mod-load-more-container");
    const loadMoreBtn = document.getElementById("btn-load-more-mods");
    if (loadMoreContainer) {
      if (hasMoreMods && grid.children.length > 0) {
        loadMoreContainer.style.display = "flex";
      } else {
        loadMoreContainer.style.display = "none";
      }
    }
    if (loadMoreBtn) {
      loadMoreBtn.disabled = false;
      loadMoreBtn.innerHTML = '<i data-lucide="chevron-down"></i> Show more';
      lucide.createIcons();
    }
  }
}

function switchPlatform(platform) {
  if (activePlatform === platform) return;
  
  const curtain = document.getElementById("diagonal-curtain");
  if (curtain) {
    const serverType = (currentServerType || "vanilla").toLowerCase();
    let gradient = "linear-gradient(135deg, #1bd96a 0%, rgba(10, 10, 12, 0.98) 100%)";
    let shadow = "20px 0 50px rgba(27, 217, 106, 0.8)";

    if (serverType === "fabric") {
      gradient = "linear-gradient(135deg, #ffd11a 0%, #ffa500 50%, rgba(10, 10, 12, 0.98) 100%)";
      shadow = "20px 0 50px rgba(255, 209, 26, 0.8)";
    } else if (serverType === "forge") {
      gradient = "linear-gradient(135deg, #ff6a00 0%, #ee0979 50%, rgba(10, 10, 12, 0.98) 100%)";
      shadow = "20px 0 50px rgba(255, 106, 0, 0.8)";
    } else if (serverType === "neoforge") {
      gradient = "linear-gradient(135deg, #ff0844 0%, #ffb199 50%, rgba(10, 10, 12, 0.98) 100%)";
      shadow = "20px 0 50px rgba(255, 8, 68, 0.8)";
    } else if (serverType === "quilt") {
      gradient = "linear-gradient(135deg, #ec008c 0%, #fc6767 50%, rgba(10, 10, 12, 0.98) 100%)";
      shadow = "20px 0 50px rgba(236, 0, 140, 0.8)";
    } else if (["paper", "purpur", "spigot", "bukkit"].includes(serverType)) {
      gradient = "linear-gradient(135deg, #00c6ff 0%, #0072ff 50%, rgba(10, 10, 12, 0.98) 100%)";
      shadow = "20px 0 50px rgba(0, 114, 255, 0.8)";
    }

    curtain.style.background = gradient;
    curtain.style.boxShadow = shadow;
  }

  curtain.classList.remove("wipe");
  void curtain.offsetWidth; // Trigger reflow
  curtain.classList.add("wipe");

  // Toggle active visual states
  document.querySelectorAll(".platform-btn").forEach(btn => {
    btn.classList.remove("active");
    btn.style.color = "var(--muted)";
    const dot = btn.querySelector("span");
    if (dot) dot.style.opacity = "0.5";
  });

  const activeBtn = document.getElementById(`platform-btn-${platform}`);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.style.color = "var(--text)";
    const dot = activeBtn.querySelector("span");
    if (dot) dot.style.opacity = "1";
  }

  // Swap content halfway through the curtain animation (400ms)
  setTimeout(() => {
    activePlatform = platform;
    const grid = document.getElementById("mod-results");
    grid.className = `results-grid platform-${platform}`;
    
    const input = document.getElementById("mod-search-input");
    input.placeholder = `Search ${platform === 'modrinth' ? 'Modrinth' : 'CurseForge'}…`;
    
    // Clear & perform new search
    searchModrinth(false);
  }, 400);

  // Clean up curtain after animation completes (800ms)
  setTimeout(() => {
    curtain.classList.remove("wipe");
  }, 800);
}

async function installMod(id, type) {
  const actionDiv = document.getElementById(`mod-action-${id}`);
  actionDiv.innerHTML = `
        <div class="mod-progress-container">
            <div class="mod-progress-fill" id="prog-fill-${id}"></div>
            <div class="mod-progress-text" id="prog-text-${id}">Starting...</div>
        </div>
    `;

  try {
    const r = await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/install`,
      { project_id: id, project_type: type },
    );
    if (!r.ok) throw new Error("Failed to start install");

    const interval = setInterval(async () => {
      const stat = await apiGet(
        `/servers/${encodeURIComponent(currentServer)}/install_progress?project_id=${id}`,
      );
      if (stat.status === "error") {
        clearInterval(interval);
        actionDiv.innerHTML = `<button class="btn danger small" disabled>Error</button>`;
        showToast("Installation failed.");
      } else if (stat.status === "installed") {
        clearInterval(interval);
        actionDiv.innerHTML = `<button class="btn success small" disabled><i data-lucide="check" style="width:14px;height:14px;"></i> Installed</button>`;
        lucide.createIcons();
        // refresh installed mods cache in background
        const res = await apiGet(
          `/servers/${encodeURIComponent(currentServer)}/installed_mods`,
        );
        installedModsCache = res.files || [];
      } else if (stat.status === "downloading") {
        const fill = document.getElementById(`prog-fill-${id}`);
        const text = document.getElementById(`prog-text-${id}`);
        if (fill && text && stat.total > 0) {
          const pct = (stat.downloaded / stat.total) * 100;
          fill.style.width = pct + "%";
          const mbDl = (stat.downloaded / 1048576).toFixed(1);
          const mbTot = (stat.total / 1048576).toFixed(1);
          text.innerText = `${mbDl} MB / ${mbTot} MB`;
        }
      }
    }, 500);
  } catch (e) {
    actionDiv.innerHTML = `<button class="btn danger small" disabled>Failed</button>`;
    showToast("Error starting installation.");
  }
}

let aceEditor = null;
let editingPath = "";

async function editFile(path) {
  if (!currentServer) return;
  try {
    const data = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/files/content?path=${encodeURIComponent(path)}`,
    );
    document.getElementById("editor-filename").innerHTML =
      `<i data-lucide="file-edit" style="width:18px;height:18px;vertical-align:middle;margin-right:6px;"></i> ${path}`;
    document.getElementById("editor-modal").classList.add("active");

    if (!aceEditor) {
      aceEditor = ace.edit("editor-container");
      aceEditor.setTheme("ace/theme/one_dark");
      aceEditor.setOptions({
        fontSize: "14px",
        showPrintMargin: false,
      });
    }

    const ext = path.split(".").pop().toLowerCase();
    const modeMap = {
      json: "json",
      yml: "yaml",
      yaml: "yaml",
      properties: "properties",
      txt: "text",
      html: "html",
      js: "javascript",
      css: "css",
      bat: "batch",
      sh: "sh",
    };
    aceEditor.session.setMode(`ace/mode/${modeMap[ext] || "text"}`);
    aceEditor.setValue(data.content, -1);
    editingPath = path;
  } catch (e) {
    alert("Cannot edit this file (might be binary or too large)");
  }
}

async function saveFileContent(btn) {
  if (!currentServer || !editingPath || !aceEditor) return;
  const content = aceEditor.getValue();
  await withButtonState(btn, async () => {
    await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/files/content`,
      { path: editingPath, content },
    );
    showToast("File saved successfully!");
  });
}

function closeEditor() {
  document.getElementById("editor-modal").classList.remove("active");
  editingPath = "";
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let subdomainTimeout = null;
function initSubdomainValidation() {
  const input = document.getElementById("server-subdomain");
  const error = document.getElementById("subdomain-error");
  const createBtn = document.getElementById("btn-create-server");

  if (!input) return;

  input.addEventListener("input", () => {
    clearTimeout(subdomainTimeout);
    const val = input.value.trim();

    if (!val) {
      error.style.display = "none";
      createBtn.disabled = false;
      return;
    }

    subdomainTimeout = setTimeout(async () => {
      try {
        const r = await fetch(
          `/api/validate_subdomain?name=${encodeURIComponent(val)}`,
        );
        const data = await r.json();
        if (data.available === false) {
          error.style.display = "block";
          createBtn.disabled = true;
        } else {
          error.style.display = "none";
          createBtn.disabled = false;
        }
      } catch (e) {
        console.error("Subdomain check failed", e);
      }
    }, 300);
  });
}

async function showCreateModal() {
  console.log("[CreateModal] Attempting to open Create Server modal...");
  const modal = document.getElementById("create-modal");
  if (!modal) {
      console.error("[CreateModal] ERROR: Could not find element with id 'create-modal'!");
      return;
  }
  
  modal.classList.add("active");
  console.log("[CreateModal] 'active' class added to modal.");

  // Reset UI
  const errorEl = document.getElementById("subdomain-error");
  if (errorEl) {
      errorEl.style.display = "none";
  } else {
      console.warn("[CreateModal] WARNING: 'subdomain-error' element not found in DOM.");
  }
  document.getElementById("btn-create-server").disabled = false;

  console.log(`[CreateModal] systemSpecsFetched is: ${systemSpecsFetched}`);
  if (!systemSpecsFetched) {
    try {
      console.log("[CreateModal] Fetching /system_specs from backend...");
      const spec = await apiGet("/system_specs");
      console.log("[CreateModal] Received system_specs:", spec);
      
      const maxRam = spec.total_ram_gb || 8;
      const slider = document.getElementById("server-ram");
      slider.max = maxRam;
      if (slider.value > maxRam) slider.value = maxRam;
      document.getElementById("ram-slider-max-label").innerText =
        `${maxRam} GB (System Max)`;
      
      console.log(`[CreateModal] Setting RAM slider max to ${maxRam} GB`);
      updateRamSliderDisplay(slider, "ram-slider-val");
      systemSpecsFetched = true;
    } catch (e) {
      console.error("[CreateModal] Failed to fetch system_specs!", e);
    }
  }
  
  console.log("[CreateModal] Fetching versions for software...");
  fetchVersionsForSoftware();
}
function closeCreateModal() {
  document.getElementById("create-modal").classList.remove("active");
}

function updateRamSliderBackground(sliderEl) {
  const max = parseInt(sliderEl.max, 10) || 8;
  const pct3 = (3 / max) * 100;
  const pct11 = (11 / max) * 100;
  
  let gradient = "";
  if (max <= 3) {
    gradient = "linear-gradient(to right, #facc15 0%, #facc15 100%)";
  } else if (max <= 11) {
    gradient = `linear-gradient(to right, #facc15 0%, #facc15 ${pct3}%, #10b981 ${pct3}%, #10b981 100%)`;
  } else {
    gradient = `linear-gradient(to right, #facc15 0%, #facc15 ${pct3}%, #10b981 ${pct3}%, #10b981 ${pct11}%, #ef4444 ${pct11}%, #ef4444 100%)`;
  }
  sliderEl.style.background = gradient;
}

function updateRamVisualBlocks(selectedVal) {
  const container = document.getElementById("ram-visual-blocks");
  if (!container) return;
  const slider = document.getElementById("cfg-ram");
  if (!slider) return;
  const maxBlocks = parseInt(slider.max, 10) || 16;
  
  let html = "";
  for (let i = 1; i <= maxBlocks; i++) {
    let cls = "ram-block";
    if (i <= selectedVal) {
      if (i <= 3) {
        cls += " lit-under";
      } else if (i >= 12) {
        cls += " lit-danger";
      } else {
        cls += " lit-optimal";
      }
    } else {
      cls += " unlit";
    }
    html += `<div class="${cls}">${i}</div>`;
  }
  container.innerHTML = html;
}

function updateRamSliderDisplay(sliderEl, labelId) {
  const val = parseInt(sliderEl.value, 10);
  const label = document.getElementById(labelId);
  if (!label) return;
  
  let color = "var(--success)"; // Green
  let statusText = "Optimal";
  
  if (val <= 3) {
      color = "#facc15"; // Yellow
      statusText = "Under-Optimal";
  } else if (val >= 12) {
      color = "#ef4444"; // Red
      statusText = "Danger (GC Lag Risk)";
  }
  
  label.innerHTML = `<span style="color: ${color}; font-weight: bold;">${val} GB</span> <span style="font-size: 0.8rem; color: var(--muted);">(${statusText})</span>`;
  updateRamSliderBackground(sliderEl);

  if (labelId === "cfg-ram-val") {
    updateRamVisualBlocks(val);
  }
}

async function fetchVersionsForSoftware() {
  const type = document.getElementById("server-type").value;
  const select = document.getElementById("server-version");
  select.innerHTML = '<option value="">Loading versions...</option>';
  try {
    const data = await apiGet(`/versions?software=${type}`);
    select.innerHTML = "";
    if (data.versions && data.versions.length > 0) {
      data.versions.forEach((v, idx) => {
        select.appendChild(new Option(v, v, false, idx === 0)); // Select first by default
      });
    } else {
      select.innerHTML = '<option value="">No versions found</option>';
    }
  } catch (e) {
    select.innerHTML = '<option value="">Error loading versions</option>';
  }
}

async function createServer() {
  const name = document.getElementById("server-name").value.trim();
  const type = document.getElementById("server-type").value;
  const ver = document.getElementById("server-version").value;
  const network_service = document.getElementById(
    "server-network-service",
  ).value;
  const description = document
    .getElementById("server-description")
    .value.trim();
  const ram = parseInt(document.getElementById("server-ram").value) || 4;

  if (!name) return alert("Enter a server name");
  if (!ver)
    return alert("Please wait for versions to load or select a version");

  const btn = document.getElementById("btn-create-server");
  btn.innerText = "Creating…";
  btn.disabled = true;
  try {
    const r = await fetch(`${API}/servers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        type,
        version: ver,
        network_service,
        description,
        ram,
      }),
    });
    let data = {};
    try {
      data = await r.json();
    } catch (e) {}
    if (!r.ok) {
      alert(data.detail || "Failed to create server (check name characters)");
      return;
    }
    closeCreateModal();
    document.getElementById("server-name").value = "";
    document.getElementById("server-description").value = "";
    await fetchServersList();
    currentServer = name;
    document.getElementById("global-server-select").value = name;
    // Suppress the auto-tour inside onServerChange for fresh creates
    const _origTour = startOnboardingTour;
    window.startOnboardingTour = () => {}; // temporarily mute
    onServerChange("guide");
    window.startOnboardingTour = _origTour;
    // Smoothly fire the tour after a short delay
    setTimeout(startOnboardingTour, 400);

  } catch (e) {
    alert("Error: " + e.message);
  } finally {
    btn.innerText = "Create Server";
    btn.disabled = false;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add("show"), 10);
  setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

init();

// --- Global Downloads Panel Polling ---
let downloadsPanelVisible = false;
let globalDownloadsInterval = null;

function toggleDownloadsPanel() {
  const panel = document.getElementById("downloads-panel");
  downloadsPanelVisible = !downloadsPanelVisible;
  panel.style.display = downloadsPanelVisible ? "flex" : "none";
  if (downloadsPanelVisible) panel.style.flexDirection = "column";
}

function startGlobalDownloadsPolling() {
  if (globalDownloadsInterval) return;
  globalDownloadsInterval = setInterval(async () => {
    if (!currentServer) return;
    try {
      const res = await apiGet(
        `/servers/${encodeURIComponent(currentServer)}/install_progress_all`,
      );
      const panel = document.getElementById("downloads-list");
      const icon = document.getElementById("btn-global-downloads");

      const keys = Object.keys(res);
      if (keys.length === 0) {
        panel.innerHTML =
          '<p class="text-muted" style="text-align:center; font-size:0.85rem;">No active downloads.</p>';
        icon.className = "btn outline small";
        return;
      }

      let allDone = true;
      let html = "";
      for (let id of keys) {
        const prog = res[id];
        if (prog.status === "downloading") allDone = false;

        const pct =
          prog.total > 0
            ? ((prog.downloaded / prog.total) * 100).toFixed(1)
            : 0;
        const mbStr =
          prog.total > 0
            ? `${(prog.downloaded / 1048576).toFixed(1)} / ${(prog.total / 1048576).toFixed(1)} MB`
            : "Starting...";
        const statusStr =
          prog.status === "installed"
            ? "Installed"
            : prog.status === "error"
              ? "Error"
              : mbStr;
        const color =
          prog.status === "installed"
            ? "var(--success)"
            : prog.status === "error"
              ? "var(--danger)"
              : "rgba(16, 185, 129, 0.4)";

        html += `
                <div style="display:flex; align-items:center; gap:8px; background:var(--panel); padding:8px; border-radius:6px; margin-bottom: 4px;">
                    <img src="${prog.icon_url || "https://docs.modrinth.com/img/logo.svg"}" style="width:24px;height:24px;border-radius:4px;">
                    <div style="flex:1; overflow:hidden;">
                        <div style="font-size:0.85rem; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${prog.title || id}</div>
                        <div style="width:100%; height:12px; background:rgba(0,0,0,0.3); border-radius:3px; position:relative; overflow:hidden; margin-top:4px;">
                            <div style="height:100%; width:${pct}%; background:${color}; transition: width 0.3s ease;"></div>
                            <div style="position:absolute; inset:0; display:flex; align-items:center; justify-content:center; font-size:0.65rem; font-weight:bold; color:#fff;">${statusStr}</div>
                        </div>
                    </div>
                </div>`;
      }
      panel.innerHTML = html;

      if (allDone) {
        icon.style.background = "";
        icon.style.borderColor = "";
      } else {
        icon.style.background = "rgba(16,185,129,0.15)";
        icon.style.borderColor = "var(--success)";
      }
    } catch (e) {}
  }, 1000);
}

startGlobalDownloadsPolling();

function updateInstallProgress(done, total) {
  let progressEl = document.getElementById("modpack-progress-overlay");
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.id = "modpack-progress-overlay";
    progressEl.style.cssText = "position: fixed; bottom: 24px; left: 24px; background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.4); display: flex; flex-direction: column; gap: 8px; z-index: 99999; min-width: 250px; animation: slideUp 0.3s ease;";
    progressEl.innerHTML = `
      <div style="font-size:0.9rem; font-weight:700; color:var(--primary);">Installing Modpack...</div>
      <div style="font-size:0.75rem; color:var(--muted);" id="modpack-progress-text">Downloading mods: 0 / 0</div>
      <div style="width:100%; height:6px; background:rgba(255,255,255,0.1); border-radius:3px; overflow:hidden;">
        <div id="modpack-progress-bar" style="width:0%; height:100%; background:var(--primary); transition: width 0.3s ease;"></div>
      </div>
    `;
    document.body.appendChild(progressEl);
    
    if (!document.getElementById("slide-up-keyframes")) {
      const style = document.createElement("style");
      style.id = "slide-up-keyframes";
      style.textContent = `
        @keyframes slideUp {
          from { transform: translateY(100px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
  }
  
  const bar = document.getElementById("modpack-progress-bar");
  const txt = document.getElementById("modpack-progress-text");
  
  if (bar && txt) {
    const pct = total > 0 ? (done / total) * 100 : 0;
    bar.style.width = pct + "%";
    txt.textContent = `Downloading mods: ${done} / ${total}`;
    
    if (done >= total && total > 0) {
      setTimeout(() => {
        const overlay = document.getElementById("modpack-progress-overlay");
        if (overlay) overlay.remove();
        showToast("✅ Modpack installation complete!");
      }, 1500);
    }
  }
}

// --- Box Selection Logic ---
let isSelecting = false;
let selectionStart = { x: 0, y: 0 };
let selectionBox = null;

document.getElementById("fm-tbody").addEventListener("mousedown", (e) => {
  if (!e.ctrlKey) return;
  if (e.target.closest(".btn") || e.target.closest('input[type="checkbox"]'))
    return;

  isSelecting = true;
  selectionStart = { x: e.pageX, y: e.pageY };

  selectionBox = document.createElement("div");
  selectionBox.className = "selection-box";
  selectionBox.style.left = e.pageX + "px";
  selectionBox.style.top = e.pageY + "px";
  selectionBox.style.width = "0px";
  selectionBox.style.height = "0px";
  document.body.appendChild(selectionBox);
  e.preventDefault(); // prevent text selection
});

document.addEventListener("mousemove", (e) => {
  if (!isSelecting) return;
  const currentX = e.pageX;
  const currentY = e.pageY;

  const x = Math.min(selectionStart.x, currentX);
  const y = Math.min(selectionStart.y, currentY);
  const width = Math.abs(currentX - selectionStart.x);
  const height = Math.abs(currentY - selectionStart.y);

  selectionBox.style.left = x + "px";
  selectionBox.style.top = y + "px";
  selectionBox.style.width = width + "px";
  selectionBox.style.height = height + "px";

  // Check intersection with rows
  const boxRect = selectionBox.getBoundingClientRect();
  document.querySelectorAll("#fm-tbody tr").forEach((row) => {
    const rowRect = row.getBoundingClientRect();
    const intersect = !(
      boxRect.right < rowRect.left ||
      boxRect.left > rowRect.right ||
      boxRect.bottom < rowRect.top ||
      boxRect.top > rowRect.bottom
    );
    const cb = row.querySelector('input[type="checkbox"]');
    if (cb) {
      cb.checked = intersect;
    }
  });
});

document.addEventListener("mouseup", () => {
  if (isSelecting) {
    isSelecting = false;
    if (selectionBox) selectionBox.remove();
    updateSelectedFiles();
  }
});

let currentPlatform = "vanilla";

function syncPlatformUI() {
  const filter = document.getElementById("mod-type-filter");
  if (!filter) return;
  const currentVal = filter.value;
  filter.innerHTML = "";

  if (["paper", "purpur", "spigot", "bukkit"].includes(currentPlatform)) {
    // Plugin servers: show plugins, not mods
    filter.innerHTML += '<option value="plugin">Plugins</option>';
  } else {
    // Fabric, Forge, Vanilla, unknown — show mods and modpacks
    filter.innerHTML += '<option value="mod">Mods</option>';
    filter.innerHTML += '<option value="modpack">Modpacks</option>';
  }
  filter.innerHTML += '<option value="resourcepack">Resource Packs</option>';
  filter.innerHTML += '<option value="shader">Shaders</option>';

  if (Array.from(filter.options).some((o) => o.value === currentVal)) {
    filter.value = currentVal;
  } else {
    filter.value = filter.options[0].value;
    if (document.getElementById("tab-modrinth").style.display === "block")
      searchModrinth();
  }
}

let logoImage = null;
let logoZoom = 1.0;
let logoX = 0; // translation x
let logoY = 0; // translation y
let isDraggingLogo = false;
let startDragX = 0;
let startDragY = 0;

function openLogoEditor(e) {
  if (!currentServer || !e.target.files[0]) return;
  const file = e.target.files[0];
  const reader = new FileReader();
  reader.onload = function(event) {
    logoImage = new Image();
    logoImage.onload = function() {
      // Show modal
      document.getElementById("logo-editor-modal").classList.add("active");
      // Reset state
      logoZoom = 1.0;
      logoX = 0;
      logoY = 0;
      document.getElementById("logo-zoom-input").value = 100;
      document.getElementById("logo-zoom-val").textContent = "100%";
      
      initLogoCanvas();
    };
    logoImage.src = event.target.result;
  };
  reader.readAsDataURL(file);
}

function closeLogoEditorModal() {
  document.getElementById("logo-editor-modal").classList.remove("active");
  document.getElementById("server-icon-upload").value = ""; // clear input
  logoImage = null;
}

function initLogoCanvas() {
  const canvas = document.getElementById("logo-crop-canvas");
  const ctx = canvas.getContext("2d");
  
  // Set canvas size to fit container
  canvas.width = 300;
  canvas.height = 300;
  
  // Bind mouse/touch events
  canvas.onmousedown = startDrag;
  canvas.onmousemove = drag;
  canvas.onmouseup = endDrag;
  canvas.onmouseleave = endDrag;
  
  // Touch support
  canvas.ontouchstart = (e) => {
    if (e.touches.length === 1) startDrag(e.touches[0]);
  };
  canvas.ontouchmove = (e) => {
    if (e.touches.length === 1) {
      e.preventDefault();
      drag(e.touches[0]);
    }
  };
  canvas.ontouchend = endDrag;

  // Zoom slider event
  const zoomInput = document.getElementById("logo-zoom-input");
  zoomInput.oninput = function() {
    logoZoom = parseInt(zoomInput.value) / 100;
    document.getElementById("logo-zoom-val").textContent = zoomInput.value + "%";
    drawLogoCrop();
  };
  
  drawLogoCrop();
}

function startDrag(e) {
  isDraggingLogo = true;
  startDragX = e.clientX - logoX;
  startDragY = e.clientY - logoY;
}

function drag(e) {
  if (!isDraggingLogo) return;
  logoX = e.clientX - startDragX;
  logoY = e.clientY - startDragY;
  drawLogoCrop();
}

function endDrag() {
  isDraggingLogo = false;
}

function drawLogoCrop() {
  if (!logoImage) return;
  const canvas = document.getElementById("logo-crop-canvas");
  const ctx = canvas.getContext("2d");
  
  // Clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Calculate size to fit
  const cropSize = 200; // 1:1 crop square
  const cropLeft = (canvas.width - cropSize) / 2;
  const cropTop = (canvas.height - cropSize) / 2;
  
  // Draw image
  ctx.save();
  
  // Draw image center at canvas center + offset
  const imgCenterX = canvas.width / 2 + logoX;
  const imgCenterY = canvas.height / 2 + logoY;
  
  // Fit image to crop size initially
  const scaleFit = cropSize / Math.min(logoImage.width, logoImage.height);
  const w = logoImage.width * scaleFit * logoZoom;
  const h = logoImage.height * scaleFit * logoZoom;
  
  ctx.drawImage(logoImage, imgCenterX - w/2, imgCenterY - h/2, w, h);
  
  ctx.restore();
  
  // Draw crop mask (outer overlay overlaying dark shade)
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  // Top
  ctx.fillRect(0, 0, canvas.width, cropTop);
  // Bottom
  ctx.fillRect(0, cropTop + cropSize, canvas.width, canvas.height - (cropTop + cropSize));
  // Left
  ctx.fillRect(0, cropTop, cropLeft, cropSize);
  // Right
  ctx.fillRect(cropLeft + cropSize, cropTop, canvas.width - (cropLeft + cropSize), cropSize);
  
  // Draw crop bounding box border
  ctx.strokeStyle = "#10b981"; // Vibrant emerald color matching success accents
  ctx.lineWidth = 2;
  ctx.strokeRect(cropLeft, cropTop, cropSize, cropSize);
  
  // Draw inner faint lines (grid) for layout assistance
  ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  // Verticals
  ctx.moveTo(cropLeft + cropSize/3, cropTop);
  ctx.lineTo(cropLeft + cropSize/3, cropTop + cropSize);
  ctx.moveTo(cropLeft + (cropSize*2)/3, cropTop);
  ctx.lineTo(cropLeft + (cropSize*2)/3, cropTop + cropSize);
  // Horizontals
  ctx.moveTo(cropLeft, cropTop + cropSize/3);
  ctx.lineTo(cropLeft + cropSize, cropTop + cropSize/3);
  ctx.moveTo(cropLeft, cropTop + (cropSize*2)/3);
  ctx.lineTo(cropLeft + cropSize, cropTop + (cropSize*2)/3);
  ctx.stroke();
}

async function applyLogoCrop() {
  if (!logoImage) return;
  
  // Offscreen 64x64 canvas
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = 64;
  exportCanvas.height = 64;
  const exportCtx = exportCanvas.getContext("2d");
  
  const canvas = document.getElementById("logo-crop-canvas");
  const cropSize = 200;
  
  // Calculate drawing dimensions exactly as rendered in the viewport crop box
  const scaleFit = cropSize / Math.min(logoImage.width, logoImage.height);
  const w = logoImage.width * scaleFit * logoZoom;
  const h = logoImage.height * scaleFit * logoZoom;
  
  const imgDrawX = canvas.width / 2 + logoX - w/2;
  const imgDrawY = canvas.height / 2 + logoY - h/2;
  const cropX = (canvas.width - cropSize) / 2;
  const cropY = (canvas.height - cropSize) / 2;
  
  // Map crop box onto drawing scale
  const sourceX = (cropX - imgDrawX) / (scaleFit * logoZoom);
  const sourceY = (cropY - imgDrawY) / (scaleFit * logoZoom);
  const sourceW = cropSize / (scaleFit * logoZoom);
  const sourceH = cropSize / (scaleFit * logoZoom);
  
  exportCtx.drawImage(
    logoImage,
    sourceX, sourceY, sourceW, sourceH, // source crop
    0, 0, 64, 64 // export dimensions
  );
  
  exportCanvas.toBlob(async (blob) => {
    if (!blob) return;
    const formData = new FormData();
    formData.append("file", blob, "server-icon.png");
    
    try {
      const res = await fetch(
        API + `/servers/${encodeURIComponent(currentServer)}/icon`,
        {
          method: "POST",
          body: formData,
        },
      );
      if (res.ok) {
        const iconEl = document.getElementById("dash-server-icon");
        iconEl.onerror = () => {
          iconEl.src = "/static/logo.png";
          iconEl.onerror = null;
        };
        iconEl.src = `/api/servers/${encodeURIComponent(currentServer)}/icon?t=${Date.now()}`;
        showToast("Server icon updated! Restart server for in-game effect.");
        closeLogoEditorModal();
      } else {
        let errMsg = "Failed to upload server icon.";
        try {
          const errData = await res.json();
          if (errData && errData.detail) errMsg = errData.detail;
        } catch (_) {}
        showToast("❌ " + errMsg);
      }
    } catch (err) {
      console.error(err);
      showToast("❌ Error uploading server icon.");
    }
  }, "image/png");
}

async function savePlayitKey() {
  if (!currentServer) return;
  const key = document.getElementById("playit-key-input").value.trim();
  if (!key) return;
  const btn = event.target;
  withButtonState(btn, async () => {
    const res = await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/playit/key`,
      { key },
    );
    if (res.ok) {
      alert(
        "Playit key saved! Please start or restart the server to apply the permanent public IP.",
      );
      document.getElementById("playit-key-input").value = "";
    } else {
      alert("Error saving key.");
    }
  });
}

// ─── MC Color Picker ──────────────────────────────────────────────────────────
const MC_COLORS = [
  { code: "\u00a70", bg: "#000000", fg: "#fff", label: "Black" },
  { code: "\u00a71", bg: "#0000AA", fg: "#fff", label: "Dark Blue" },
  { code: "\u00a72", bg: "#00AA00", fg: "#fff", label: "Dark Green" },
  { code: "\u00a73", bg: "#00AAAA", fg: "#fff", label: "Dark Aqua" },
  { code: "\u00a74", bg: "#AA0000", fg: "#fff", label: "Dark Red" },
  { code: "\u00a75", bg: "#AA00AA", fg: "#fff", label: "Purple" },
  { code: "\u00a76", bg: "#FFAA00", fg: "#000", label: "Gold" },
  { code: "\u00a77", bg: "#AAAAAA", fg: "#000", label: "Gray" },
  { code: "\u00a78", bg: "#555555", fg: "#fff", label: "Dark Gray" },
  { code: "\u00a79", bg: "#5555FF", fg: "#fff", label: "Blue" },
  { code: "\u00a7a", bg: "#55FF55", fg: "#000", label: "Green" },
  { code: "\u00a7b", bg: "#55FFFF", fg: "#000", label: "Aqua" },
  { code: "\u00a7c", bg: "#FF5555", fg: "#fff", label: "Red" },
  { code: "\u00a7d", bg: "#FF55FF", fg: "#fff", label: "L.Purple" },
  { code: "\u00a7e", bg: "#FFFF55", fg: "#000", label: "Yellow" },
  { code: "\u00a7f", bg: "#FFFFFF", fg: "#000", label: "White" },
  { code: "\u00a7l", bg: null, label: "Bold", style: "font-weight:800" },
  { code: "\u00a7o", bg: null, label: "Italic", style: "font-style:italic" },
  {
    code: "\u00a7n",
    bg: null,
    label: "Underline",
    style: "text-decoration:underline",
  },
  { code: "\u00a7k", bg: null, label: "Obfusc.", style: "letter-spacing:2px" },
  { code: "\u00a7r", bg: null, label: "Reset", style: "opacity:0.6" },
];

function buildMcColorBar(targetId) {
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:3px;flex-wrap:wrap;margin:6px 0 4px;";
  MC_COLORS.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.title = c.label + " (" + c.code + ")";
    btn.textContent = c.bg
      ? "\u25a0"
      : c.label.substring(
          0,
          c.label === "Underline" ? 1 : c.label.length > 5 ? 1 : c.label.length,
        );
    btn.style.cssText = `padding:3px 6px;font-size:0.78rem;border-radius:4px;cursor:pointer;border:1px solid var(--border);background:${c.bg || "var(--bg2, #1a1d24)"};color:${c.fg || "var(--text)"};${c.style || ""}`;
    btn.onclick = (e) => {
      e.preventDefault();
      insertMcCode(targetId, c.code);
    };
    bar.appendChild(btn);
  });
  return bar;
}

function insertMcCode(targetId, code) {
  const el = document.getElementById(targetId);
  if (!el) return;
  const s = el.selectionStart || 0,
    e2 = el.selectionEnd || 0;
  el.value = el.value.substring(0, s) + code + el.value.substring(e2);
  el.selectionStart = el.selectionEnd = s + code.length;
  el.focus();
  if (targetId === "dash-motd-input") updateDashMotdPreview();
  if (targetId === "settings-motd-input") updateSettingsMotdPreview();
  if (targetId === "cfg-display-name") {
    const v = renderMcText(el.value);
    const prev = document.getElementById("settings-servername-preview");
    const title = document.getElementById("settings-motd-title");
    if (prev) prev.innerHTML = v;
    if (title) title.innerHTML = v;
  }
}

function renderMcText(text) {
  // Track compound state so multiple codes apply simultaneously
  const CM = {
    0: "#000000",
    1: "#0000AA",
    2: "#00AA00",
    3: "#00AAAA",
    4: "#AA0000",
    5: "#AA00AA",
    6: "#FFAA00",
    7: "#AAAAAA",
    8: "#555555",
    9: "#5555FF",
    a: "#55FF55",
    b: "#55FFFF",
    c: "#FF5555",
    d: "#FF55FF",
    e: "#FFFF55",
    f: "#FFFFFF",
  };
  let out = "";
  let state = {
    color: null,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    obfuscated: false,
  };

  function openSpan(s) {
    let style = "";
    if (s.color) style += `color:${s.color};`;
    if (s.bold) style += "font-weight:800;";
    if (s.italic) style += "font-style:italic;";
    if (s.underline) style += "text-decoration:underline;";
    if (s.strike) style += "text-decoration:line-through;";
    if (s.obfuscated)
      style += "animation:mc-obfuscate 0.05s steps(1) infinite;";
    return style ? `<span style="${style}">` : "<span>";
  }

  let i = 0;
  let openCount = 0;
  while (i < text.length) {
    const ch = text[i];
    if ((ch === "\u00a7" || ch === "&") && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (openCount > 0) {
        out += "</span>";
        openCount--;
      }
      if (code === "r") {
        state = {
          color: null,
          bold: false,
          italic: false,
          underline: false,
          strike: false,
          obfuscated: false,
        };
      } else if (CM[code]) {
        state.color = CM[code];
      } else if (code === "l") {
        state.bold = true;
      } else if (code === "o") {
        state.italic = true;
      } else if (code === "n") {
        state.underline = true;
      } else if (code === "m") {
        state.strike = true;
      } else if (code === "k") {
        state.obfuscated = true;
      }
      // Only open new span if there's something to style
      if (Object.values(state).some(Boolean)) {
        out += openSpan(state);
        openCount++;
      }
      i += 2;
    } else {
      out +=
        ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
      i++;
    }
  }
  while (openCount-- > 0) out += "</span>";
  return out || text;
}

// Inject color bars into MOTD and chat
(function injectColorBars() {
  const dashMotdBar = document.getElementById("dash-motd-color-bar");
  if (dashMotdBar) dashMotdBar.appendChild(buildMcColorBar("dash-motd-input"));
  const settingsMotdBar = document.getElementById("settings-motd-color-bar");
  if (settingsMotdBar)
    settingsMotdBar.appendChild(buildMcColorBar("settings-motd-input"));
  const chatBar = document.getElementById("chat-color-bar");
  if (chatBar) chatBar.appendChild(buildMcColorBar("chat-message"));
})();

// \u2500\u2500\u2500 Player Manager \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
function avatarUrl(uuid, name) {
  const id = uuid || name || "steve";
  return `https://minotar.net/helm/${id}/64.png`;
}

function playerCard(player, listType) {
  const uuid = player.uuid || "";
  const name = player.name || player;
  const avatar = avatarUrl(uuid, name);
  const isWhitelisted = listType === "whitelist";
  const isBanned = listType === "banned";

  const wlBtn = isWhitelisted
    ? `<button class="btn danger outline small" style="min-width:0;padding:4px 8px" onclick="whitelistRemove('${name}','${uuid}')"><i data-lucide="user-minus" style="width:13px;height:13px"></i></button>`
    : `<button class="btn success outline small" style="min-width:0;padding:4px 8px" onclick="whitelistAdd('${name}','${uuid}')"><i data-lucide="user-plus" style="width:13px;height:13px"></i></button>`;
  const banBtn = isBanned
    ? `<button class="btn outline small" style="min-width:0;padding:4px 8px" onclick="pmUnban('${name}','${uuid}')"><i data-lucide="shield-check" style="width:13px;height:13px"></i></button>`
    : `<button class="btn danger outline small" style="min-width:0;padding:4px 8px" onclick="pmBan('${name}','${uuid}')"><i data-lucide="ban" style="width:13px;height:13px"></i></button>`;

  return `<div class="player-card">
        <img src="${avatar}" alt="${name}" onerror="this.src='/static/logo.png'">
        <span class="player-card-name">${name}</span>
        <div class="player-card-actions">${wlBtn}${banBtn}</div>
    </div>`;
}

async function loadPlayers() {
  if (!currentServer) return;
  try {
    const data = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/players`,
    );
    const renderList = (listEl, items, type) => {
      if (!items || items.length === 0) {
        listEl.innerHTML =
          '<p class="text-muted" style="font-size:.85rem">Empty</p>';
      } else {
        listEl.innerHTML = items.map((p) => playerCard(p, type)).join("");
      }
      lucide.createIcons({ nodes: [listEl] });
    };
    renderList(
      document.getElementById("pm-whitelist-list"),
      data.whitelist,
      "whitelist",
    );
    renderList(document.getElementById("pm-ops-list"), data.ops, "ops");
    renderList(
      document.getElementById("pm-banned-list"),
      data.banned,
      "banned",
    );
  } catch (e) {
    console.error(e);
  }
}

async function searchPlayer() {
  const username = document.getElementById("pm-search-input").value.trim();
  if (!username) return;
  const resultDiv = document.getElementById("pm-search-result");
  resultDiv.style.display = "block";
  resultDiv.innerHTML =
    '<p class="text-muted" style="font-size:.85rem">Searching\u2026</p>';
  try {
    const profile = await apiGet(
      `/mojang/profile/${encodeURIComponent(username)}`,
    );
    resultDiv.innerHTML = `
            <div class="pm-search-card">
                <img src="${avatarUrl(profile.uuid)}" alt="${profile.name}" onerror="this.src='/static/logo.png'">
                <div style="flex:1">
                    <div style="font-weight:700;font-size:1rem;margin-bottom:6px">${profile.name}</div>
                    <div style="font-size:.75rem;color:var(--muted);margin-bottom:10px;font-family:monospace">${profile.uuid}</div>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <button class="btn success outline small" onclick="whitelistAdd('${profile.name}','${profile.uuid}')"><i data-lucide="user-plus" style="width:14px;height:14px"></i> Add to Whitelist</button>
                        <button class="btn danger outline small" onclick="whitelistRemove('${profile.name}','${profile.uuid}')"><i data-lucide="user-minus" style="width:14px;height:14px"></i> Remove from Whitelist</button>
                        <button class="btn danger small" onclick="pmBan('${profile.name}','${profile.uuid}')"><i data-lucide="ban" style="width:14px;height:14px"></i> Ban</button>
                    </div>
                </div>
            </div>`;
    lucide.createIcons({ nodes: [resultDiv] });
  } catch (e) {
    resultDiv.innerHTML =
      '<p style="color:var(--danger);font-size:.85rem">\u26a0 Player not found. Check the username.</p>';
  }
}

async function whitelistAdd(name, uuid) {
  await apiPost(`/servers/${encodeURIComponent(currentServer)}/whitelist/add`, {
    name,
    uuid,
  });
  showToast(`\u2713 ${name} added to whitelist`);
  loadPlayers();
}
async function whitelistRemove(name, uuid) {
  await apiPost(
    `/servers/${encodeURIComponent(currentServer)}/whitelist/remove`,
    { name, uuid },
  );
  showToast(`${name} removed from whitelist`);
  loadPlayers();
}
async function pmBan(name, uuid) {
  await apiPost(`/servers/${encodeURIComponent(currentServer)}/ban`, {
    name,
    uuid,
  });
  showToast(`\u{1f6ab} ${name} banned`);
  loadPlayers();
}
async function pmUnban(name, uuid) {
  await apiPost(`/servers/${encodeURIComponent(currentServer)}/unban`, {
    name,
    uuid,
  });
  showToast(`${name} unbanned`);
  loadPlayers();
}

// ─── Backups ──────────────────────────────────────────────────────────────────
async function fetchBackupSettings() {
  if (!currentServer) return;
  try {
    const res = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/meta`,
    );
    if (res.meta) {
      document.getElementById("cfg-auto-backup").value = res.meta.auto_backup
        ? "true"
        : "false";
      if (res.meta.backup_interval)
        document.getElementById("cfg-backup-interval").value =
          res.meta.backup_interval;
      if (res.meta.max_backups)
        document.getElementById("cfg-max-backups").value = res.meta.max_backups;
    }
  } catch (e) {
    console.error("Failed to fetch backup settings", e);
  }
}

async function saveBackupSettings() {
  if (!currentServer) return;
  const enabled = document.getElementById("cfg-auto-backup").value === "true";
  const interval =
    parseInt(document.getElementById("cfg-backup-interval").value) || 12;
  const max = parseInt(document.getElementById("cfg-max-backups").value) || 5;
  try {
    await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/backup-settings`,
      {
        auto_backup: enabled,
        backup_interval: interval,
        max_backups: max,
      },
    );
    showToast("Backup settings saved");
  } catch (e) {
    showToast("Failed to save backup settings");
  }
}

async function fetchBackups() {
  if (!currentServer) return;
  const tbody = document.getElementById("backups-list");
  tbody.innerHTML =
    '<tr><td colspan="4" class="text-muted" style="padding:10px;text-align:center;">Loading...</td></tr>';
  try {
    const res = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/backups`,
    );
    tbody.innerHTML = "";
    if (res.backups.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="4" class="text-muted" style="padding:10px;text-align:center;">No backups found.</td></tr>';
      return;
    }
    res.backups.forEach((b) => {
      const tr = document.createElement("tr");
      tr.style.borderBottom = "1px solid var(--border)";
      tr.innerHTML = `
                <td style="padding: 10px; font-weight: 500;">${b.filename}</td>
                <td style="padding: 10px; color: var(--muted);">${new Date(b.date * 1000).toLocaleString()}</td>
                <td style="padding: 10px; color: var(--muted);">${(b.size / (1024 * 1024)).toFixed(2)} MB</td>
                <td style="padding: 10px; text-align: right; display:flex; gap:6px; justify-content:flex-end;">
                    <button class="btn success small" onclick="restoreBackup('${b.filename}')"><i data-lucide="rotate-ccw" style="width:14px;height:14px;"></i> Restore</button>
                    <a class="btn primary small outline" href="${API}/servers/${encodeURIComponent(currentServer)}/backups/${encodeURIComponent(b.filename)}/download" download><i data-lucide="download" style="width:14px;height:14px;"></i></a>
                    <button class="btn danger small outline" onclick="deleteBackup('${b.filename}')"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
                </td>
            `;
      tbody.appendChild(tr);
    });
    lucide.createIcons();
  } catch (e) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="text-danger" style="padding:10px;text-align:center;">Failed to load backups.</td></tr>';
  }
}

async function createBackup(btn) {
  if (!currentServer) return;
  const ogHtml = btn.innerHTML;
  btn.innerHTML = `<span class="spinner" style="width:16px;height:16px;border-width:2px;margin-right:6px"></span> Creating...`;
  btn.disabled = true;
  try {
    const res = await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/backups/create`,
    );
    if (!res.ok) throw new Error(await res.text());
    showToast("Backup created successfully!");
    fetchBackups();
  } catch (e) {
    alert("Failed to create backup.");
  } finally {
    btn.innerHTML = ogHtml;
    btn.disabled = false;
    lucide.createIcons();
  }
}

async function restoreBackup(filename) {
  if (!currentServer) return;
  if (document.getElementById("server-status").textContent !== "Stopped") {
    alert(
      "Please stop the server before restoring a backup to prevent corruption.",
    );
    return;
  }
  if (
    !confirm(
      `Are you sure you want to restore ${filename}? This will overwrite your current world.`,
    )
  )
    return;

  try {
    const res = await apiPost(
      `/servers/${encodeURIComponent(currentServer)}/backups/restore`,
      { filename },
    );
    if (!res.ok) throw new Error(await res.text());
    showToast("Backup restored successfully!");
  } catch (e) {
    alert("Failed to restore backup.");
  }
}

async function deleteBackup(filename) {
  if (!currentServer) return;
  if (!confirm(`Delete backup ${filename}?`)) return;
  try {
    const res = await fetch(
      `${API}/servers/${encodeURIComponent(currentServer)}/backups/${encodeURIComponent(filename)}`,
      { method: "DELETE" },
    );
    if (!res.ok) throw new Error("Failed");
    showToast("Backup deleted");
    fetchBackups();
  } catch (e) {
    alert("Failed to delete backup.");
  }
}

// --- Deployment Modal ---
function openDeploymentModal(name, networkService) {
    document.getElementById('deployment-title').innerText = 'Deploying ' + name + '...';
    document.getElementById('deployment-modal').style.display = 'flex';
    
    for (let i = 1; i <= 3; i++) {
        document.getElementById('deploy-spin-' + i).style.display = 'none';
        document.getElementById('deploy-check-' + i).style.display = 'none';
        document.getElementById('deploy-text-' + i).style.color = 'var(--muted)';
    }
    document.getElementById('deployment-close-btn').style.display = 'none';
}

function updateDeploymentStep(step, message, isError = false) {
    if (step > 1) {
        document.getElementById('deploy-spin-' + (step - 1)).style.display = 'none';
        document.getElementById('deploy-check-' + (step - 1)).style.display = 'block';
        document.getElementById('deploy-text-' + (step - 1)).style.color = 'var(--success)';
    }

    const spin = document.getElementById('deploy-spin-' + step);
    const check = document.getElementById('deploy-check-' + step);
    const text = document.getElementById('deploy-text-' + step);

    if (spin && check && text) {
        text.innerText = step + '. ' + message;
        if (isError) {
            spin.style.display = 'none';
            check.style.display = 'block';
            check.style.color = 'var(--error)';
            text.style.color = 'var(--error)';
            document.getElementById('deployment-close-btn').style.display = 'block';
        } else {
            spin.style.display = 'block';
            check.style.display = 'none';
            text.style.color = 'var(--text)';
        }
    }
    
    if (step === 3 && (message.includes('Binding') || message.includes('Encrypted Uplink'))) {
        setTimeout(() => {
            document.getElementById('deploy-spin-3').style.display = 'none';
            document.getElementById('deploy-check-3').style.display = 'block';
            document.getElementById('deploy-text-3').style.color = 'var(--success)';
            document.getElementById('deployment-close-btn').style.display = 'block';
            fetchServersList();
        }, 1500);
    }
}

function closeDeploymentModal() {
    document.getElementById('deployment-modal').style.display = 'none';
    closeCreateModal();
    setTimeout(startOnboardingTour, 600);
}

// Infinite Scroll removed as per user request.
// ─── First-Time Onboarding Tour ──────────────────────────────────────────────
let currentTourStep = 0;
const tourSteps = [
  {
    target: "nav-guide",
    title: "Quick Setup Guide",
    desc: "Your journey starts here. This panel provides a rapid checklist to get your modpack distributed securely and instantly using Mero's advanced features.",
    tab: "guide"
  },
  {
    target: "nav-dashboard",
    title: "Dynamic Dashboard",
    desc: "Monitor live CPU & RAM usage, customize your server icon, and access the one-click Modpack Distribution panel to automatically sync with Modrinth.",
    tab: "dashboard"
  },
  {
    target: "nav-console",
    title: "Live Console",
    desc: "Interact with your server in real-time. View logs, execute commands, monitor the Playit.gg tunnel binding, and track the P2P connection status.",
    tab: "console"
  },
  {
    target: "nav-files",
    title: "Smart File Manager",
    desc: "Drag, drop, and edit your server files via the cloud. Drop .jar files into your mods/ or plugins/ folders and they'll instantly be ready for distribution.",
    tab: "files"
  },
  {
    target: "nav-modrinth",
    title: "Mods & Plugins Engine",
    desc: "A built-in async downloader. Search millions of mods and plugins from Modrinth and CurseForge. Install dependencies and shaders with a single click.",
    tab: "modrinth"
  },
  {
    target: "nav-players",
    title: "Player Manager",
    desc: "Manage server access precisely. Ban, kick, or whitelist players. Assign operator privileges seamlessly while monitoring who is online.",
    tab: "players"
  },
  {
    target: "nav-backups",
    title: "Automated Backups",
    desc: "Create manual snapshots or schedule automated hourly backups to protect your worlds. Restore your server to any point in time instantly.",
    tab: "backups"
  },
  {
    target: "nav-settings",
    title: "Server Configuration",
    desc: "Tweak deep server properties. Adjust Java arguments, set custom MOTDs, and modify server.properties effortlessly.",
    tab: "settings"
  }
];

function startOnboardingTour() {
  const key = "mero_onboarding_completed";
  if (localStorage.getItem(key)) return; // Already completed globally
  if (!currentServer) return;
  
  currentTourStep = 0;
  showTourStep(0);
}

function showTourStep(stepIndex) {
  if (stepIndex < 0 || stepIndex >= tourSteps.length) {
    endTour();
    return;
  }
  
  currentTourStep = stepIndex;
  const step = tourSteps[stepIndex];
  
  // Make sure the target element is visible (switch tab if necessary)
  if (step.tab) {
    switchTab(step.tab);
  }
  
  // Wait a short moment for DOM to settle/render
  setTimeout(() => {
    const el = document.getElementById(step.target);
    if (!el) {
      // If target not found, skip it
      nextTourStep();
      return;
    }
    
    // Position spotlight
    const rect = el.getBoundingClientRect();
    const spotlight = document.getElementById("tour-spotlight");
    spotlight.style.display = "block";
    spotlight.style.top = (rect.top - 8 + window.scrollY) + "px";
    spotlight.style.left = (rect.left - 8 + window.scrollX) + "px";
    spotlight.style.width = (rect.width + 16) + "px";
    spotlight.style.height = (rect.height + 16) + "px";
    
    // Position tooltip
    const tooltip = document.getElementById("tour-tooltip");
    tooltip.style.display = "flex";
    
    // Title, desc, progress
    document.getElementById("tour-title").innerText = step.title;
    document.getElementById("tour-desc").innerText = step.desc;
    document.getElementById("tour-progress").innerText = `${stepIndex + 1} / ${tourSteps.length}`;
    
    // Position tooltip relative to spotlight (prefer underneath, otherwise above)
    const spaceBelow = window.innerHeight - rect.bottom;
    if (spaceBelow > 220) {
      tooltip.style.top = (rect.bottom + 16 + window.scrollY) + "px";
      tooltip.style.left = Math.min(window.innerWidth - 340, Math.max(20, rect.left + (rect.width / 2) - 150 + window.scrollX)) + "px";
    } else {
      tooltip.style.top = (rect.top - 200 + window.scrollY) + "px";
      tooltip.style.left = Math.min(window.innerWidth - 340, Math.max(20, rect.left + (rect.width / 2) - 150 + window.scrollX)) + "px";
    }
    
    // Update button text
    const nextBtn = document.getElementById("tour-next-btn");
    if (stepIndex === tourSteps.length - 1) {
      nextBtn.innerText = "Finish";
    } else {
      nextBtn.innerText = "Next";
    }
    
    // Disable back button on first step
    const prevBtn = document.getElementById("tour-prev-btn");
    prevBtn.disabled = stepIndex === 0;
  }, 100);
}

function nextTourStep() {
  if (currentTourStep === tourSteps.length - 1) {
    endTour();
  } else {
    showTourStep(currentTourStep + 1);
  }
}

function prevTourStep() {
  if (currentTourStep > 0) {
    showTourStep(currentTourStep - 1);
  }
}

function endTour() {
  document.getElementById("tour-spotlight").style.display = "none";
  document.getElementById("tour-tooltip").style.display = "none";
  localStorage.setItem("mero_onboarding_completed", "true");
}

