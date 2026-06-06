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

  const baseCmd = cmd.startsWith("/") ? cmd.substring(1).split(" ")[0].toLowerCase() : cmd.split(" ")[0].toLowerCase();
  let custom = JSON.parse(localStorage.getItem("meroCustomCommands") || "[]");
  if (!MC_COMMANDS.includes(baseCmd) && !custom.includes(baseCmd)) {
      custom.push(baseCmd);
      localStorage.setItem("meroCustomCommands", JSON.stringify(custom));
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

const MC_COMMANDS = [
  "help", "tp", "op", "deop", "kick", "ban", "pardon", "stop", "say", 
  "time", "weather", "gamemode", "give", "clear", "difficulty", "seed",
  "whitelist", "gamerule", "kill", "list", "save-all", "save-off", "save-on"
];

function initConsoleAutocomplete() {
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
    if (match && match.toLowerCase().startsWith(val.toLowerCase())) {
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
        let match = currentSuggestions[Math.max(0, autocompleteSelectedIndex)];
        if (match) {
            inp.value = match;
        }
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
          let match = currentSuggestions[Math.max(0, autocompleteSelectedIndex)];
          if (match) {
              inp.value = match;
              inp.dispatchEvent(new Event('input')); // trigger update
          }
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
      const customCmds = JSON.parse(localStorage.getItem("meroCustomCommands") || "[]");
      const allCmds = [...new Set([...MC_COMMANDS, ...customCmds])];
      currentSuggestions = allCmds.filter(c => c.startsWith(cmd)).map(c => "/" + c);
    } else if (parts.length === 2 && ["tp", "op", "deop", "kick", "ban", "pardon", "give"].includes(cmd)) {
      const players = window.latestServerState?.players_sample || [];
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
  const target = document.getElementById("chat-target").value.trim() || "@a";
  const color = document.getElementById("chat-color-select").value;
  if (!msg) return;
  await apiPost(`/servers/${encodeURIComponent(currentServer)}/chat`, {
    message: msg,
    player,
    target,
    color,
  });
  document.getElementById("chat-message").value = "";
  showToast(player ? `Sent to ${target} as <${player}>` : `Announcement sent to ${target}!`);
}
