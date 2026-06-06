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
