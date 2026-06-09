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
                    <button class="btn primary small outline" onclick="saveBackup('${b.filename}')"><i data-lucide="download" style="width:14px;height:14px;"></i></button>
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

  showCustomConfirm(
    "Restore Backup",
    `Are you sure you want to use this backup (${filename})?\n\n<b>WARNING:</b> This will delete all your old server files and replace them with the files from this backup.`,
    async () => {
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
  );
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

async function saveBackup(filename) {
  if (!currentServer) return;
  try {
    const res = await apiGet(
      `/servers/${encodeURIComponent(currentServer)}/backups/${encodeURIComponent(filename)}/save`
    );
    if (res.message && res.message !== "Save cancelled") {
      showToast(res.message);
    }
  } catch (e) {
    alert("Failed to save backup: " + e.message);
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