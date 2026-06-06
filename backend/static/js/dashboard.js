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

async function fetchStats() {
  if (!currentServer) return;
  try {
    const st = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/stats`,
    );
    window.latestServerState = st;
    
    const targetList = document.getElementById("chat-target-list");
    if (targetList) {
        let html = '<option value="@a">All Players</option><option value="@r">Random Player</option>';
        if (st.players_sample && st.players_sample.length > 0) {
            st.players_sample.forEach(p => {
                if (p.name) html += `<option value="${p.name}">${p.name}</option>`;
            });
        }
        targetList.innerHTML = html;
    }
    
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
