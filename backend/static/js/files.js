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
