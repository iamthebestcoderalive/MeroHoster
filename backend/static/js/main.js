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

let latestUpdateVersion = null;

async function checkForUpdates() {
    try {
        const res = await apiGet("/update/check");
        if (res.update_available) {
            latestUpdateVersion = res.latest_version;
            const skipped = localStorage.getItem("skippedUpdateVersion");
            if (skipped === latestUpdateVersion) return; // User skipped this version

            const modal = document.getElementById("update-modal");
            const text = document.getElementById("update-modal-text");
            if (modal && text) {
                text.innerText = `Version ${res.latest_version} is available!`;
                modal.style.display = "flex";
                setTimeout(() => { if(window.lucide) lucide.createIcons(); }, 50);
            }
        }
    } catch (e) {
        console.error("Failed to check for updates", e);
    }
}

function skipUpdate() {
    if (latestUpdateVersion) {
        localStorage.setItem("skippedUpdateVersion", latestUpdateVersion);
    }
    document.getElementById("update-modal").style.display = "none";
}

async function installUpdate() {
    const modal = document.getElementById("update-modal");
    const overlay = document.getElementById("update-overlay");
    const overlayText = document.getElementById("update-overlay-text");
    const tipText = document.getElementById("update-tip-text");
    
    if(modal) modal.style.display = "none";
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

    const urlParams = new URLSearchParams(window.location.search);
    const requestedServer = urlParams.get('server');

    if (requestedServer && servers.find((s) => s.name === requestedServer) && !currentServer) {
      currentServer = requestedServer;
      sel.value = currentServer;
      onServerChange();
      switchTab('dashboard');
    } else if (!currentServer || !servers.find((s) => s.name === currentServer)) {
      const wasEmpty = !currentServer;
      currentServer = servers[0].name;
      sel.value = currentServer;
      onServerChange();
      if (wasEmpty) {
          switchTab('dashboard');
      }
    } else {
      sel.value = currentServer;
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

init();
