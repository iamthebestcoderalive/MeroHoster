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

async function resetPlayitTunnel() {
  if (!currentServer) return;
  if (!confirm("Are you sure you want to reset your Playit tunnel?\nThis will generate a new claim link on the next server start.")) return;
  
  try {
    const r = await fetch(`${API}/servers/${encodeURIComponent(currentServer)}/playit/key`, {
      method: "DELETE"
    });
    const data = await r.json();
    if (r.ok) {
      showToast(data.message || "Playit tunnel reset. Restart server.");
    } else {
      alert("Failed to reset: " + (data.detail || "Unknown error"));
    }
  } catch (e) {
    alert("Error resetting tunnel: " + e.message);
  }
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

  const devModpackPanel = document.getElementById("dev-modpack-panel");
  const isVanilla = currentPlatform === "vanilla";
  const isAutoSync = (window.currentManifestSync || "manual") === "automatic";
  if (devModpackPanel) {
    const showPanel = !(isVanilla || isAutoSync);
    devModpackPanel.style.display = showPanel ? "block" : "none";
    const divider = devModpackPanel.previousElementSibling;
    if (divider && divider.classList.contains("dash-divider")) {
      divider.style.display = showPanel ? "block" : "none";
    }
  }

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

function showCustomConfirm(title, message, onYes) {
    document.getElementById("custom-confirm-title").innerText = title;
    document.getElementById("custom-confirm-text").innerHTML = message.replace(/\n/g, '<br>');
    
    const modal = document.getElementById("custom-confirm-modal");
    modal.style.display = "flex";
    
    const btnYes = document.getElementById("custom-confirm-yes");
    const btnNo = document.getElementById("custom-confirm-no");
    
    const newBtnYes = btnYes.cloneNode(true);
    const newBtnNo = btnNo.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtnYes, btnYes);
    btnNo.parentNode.replaceChild(newBtnNo, btnNo);
    
    newBtnYes.onclick = () => {
        modal.style.display = "none";
        if (onYes) onYes();
    };
    newBtnNo.onclick = () => {
        modal.style.display = "none";
    };
    
    lucide.createIcons();
}
