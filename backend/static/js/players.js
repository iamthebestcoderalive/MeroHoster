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
  const isOnline = listType === "online";

  const wlBtn = isWhitelisted
    ? `<button class="btn danger outline small" style="min-width:0;padding:4px 8px" onclick="whitelistRemove('${name}','${uuid}')" title="Remove from Whitelist"><i data-lucide="user-minus" style="width:13px;height:13px"></i></button>`
    : `<button class="btn success outline small" style="min-width:0;padding:4px 8px" onclick="whitelistAdd('${name}','${uuid}')" title="Add to Whitelist"><i data-lucide="user-plus" style="width:13px;height:13px"></i></button>`;
  const banBtn = isBanned
    ? `<button class="btn outline small" style="min-width:0;padding:4px 8px" onclick="pmUnban('${name}','${uuid}')" title="Unban"><i data-lucide="shield-check" style="width:13px;height:13px"></i></button>`
    : `<button class="btn danger outline small" style="min-width:0;padding:4px 8px" onclick="pmBan('${name}','${uuid}')" title="Ban"><i data-lucide="ban" style="width:13px;height:13px"></i></button>`;
  const kickBtn = isOnline
    ? `<button class="btn warning outline small" style="min-width:0;padding:4px 8px;margin-left:4px" onclick="pmKick('${name}')" title="Kick Player"><i data-lucide="user-x" style="width:13px;height:13px"></i></button>`
    : "";

  return `<div class="player-card">
        <img src="${avatar}" alt="${name}" onerror="this.src='/static/logo.png'">
        <span class="player-card-name">${name}</span>
        <div class="player-card-actions">${wlBtn}${banBtn}${kickBtn}</div>
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
    
    const onlinePlayers = window.latestServerState?.players_sample || [];
    renderList(
      document.getElementById("pm-online-list"),
      onlinePlayers,
      "online"
    );
    
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
  await sendConsoleCommand("ban " + name);
  setTimeout(loadPlayers, 1000);
}

async function pmKick(name) {
  if (!confirm(`Are you sure you want to kick ${name}?`)) return;
  await sendConsoleCommand("kick " + name);
  setTimeout(loadPlayers, 1000);
}

async function pmUnban(name, uuid) {
  await apiPost(`/servers/${encodeURIComponent(currentServer)}/unban`, {
    name,
    uuid,
  });
  showToast(`${name} unbanned`);
  loadPlayers();
}
