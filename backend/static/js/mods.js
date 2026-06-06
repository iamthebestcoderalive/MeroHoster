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
