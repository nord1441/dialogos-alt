(() => {
  // --- elements ---
  const messagesEl = document.getElementById("messages");
  const chatForm = document.getElementById("chat-form");
  const chatInput = document.getElementById("chat-input");
  const settingsBtn = document.getElementById("settings-btn");
  const settingsModal = document.getElementById("settings-modal");
  const settingsClose = document.getElementById("settings-close");
  const modalBackdrop = settingsModal.querySelector(".modal-backdrop");
  const systemPromptEl = document.getElementById("system-prompt");
  const savePromptBtn = document.getElementById("save-prompt-btn");
  const avatarUpload = document.getElementById("avatar-upload");
  const removeAvatarBtn = document.getElementById("remove-avatar-btn");
  const avatarPreview = document.getElementById("avatar-preview");
  const avatarFrame = document.getElementById("avatar-frame");
  const themeToggle = document.getElementById("theme-toggle");
  const clearBtn = document.getElementById("clear-btn");

  let isStreaming = false;

  // --- theme ---
  function getTheme() {
    return localStorage.getItem("theme") || "dark";
  }

  function setTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
  }

  setTheme(getTheme());

  themeToggle.addEventListener("click", () => {
    setTheme(getTheme() === "dark" ? "light" : "dark");
  });

  // --- settings modal ---
  settingsBtn.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
  });

  function closeSettings() {
    settingsModal.classList.add("hidden");
  }

  settingsClose.addEventListener("click", closeSettings);
  modalBackdrop.addEventListener("click", closeSettings);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeSettings();
  });

  // --- load settings ---
  async function loadSettings() {
    const res = await fetch("/api/settings");
    const data = await res.json();

    systemPromptEl.value = data.systemPrompt || "";
    updateAvatar(data.avatarUrl);
  }

  function updateAvatar(url) {
    avatarFrame.innerHTML = "";
    avatarPreview.innerHTML = "";

    if (!url) {
      avatarFrame.innerHTML = `
        <div id="avatar-placeholder">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="20" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="M10 42c0-7.73 6.27-14 14-14s14 6.27 14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </div>`;
      return;
    }

    const cacheBust = `?t=${Date.now()}`;

    if (url.match(/\.(mp4|webm)$/i)) {
      const vid1 = document.createElement("video");
      vid1.src = url + cacheBust;
      vid1.autoplay = true;
      vid1.loop = true;
      vid1.muted = true;
      vid1.playsInline = true;
      avatarFrame.appendChild(vid1);

      const vid2 = vid1.cloneNode(true);
      vid2.src = url + cacheBust;
      avatarPreview.appendChild(vid2);
    } else {
      const img1 = document.createElement("img");
      img1.src = url + cacheBust;
      img1.alt = "avatar";
      avatarFrame.appendChild(img1);

      const img2 = img1.cloneNode(true);
      img2.src = url + cacheBust;
      avatarPreview.appendChild(img2);
    }
  }

  // --- save system prompt ---
  savePromptBtn.addEventListener("click", async () => {
    const text = savePromptBtn.textContent;
    savePromptBtn.textContent = "...";
    await fetch("/api/settings/system-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ systemPrompt: systemPromptEl.value }),
    });
    savePromptBtn.textContent = "saved";
    setTimeout(() => {
      savePromptBtn.textContent = text;
    }, 1200);
  });

  // --- upload avatar ---
  avatarUpload.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append("avatar", file);

    const res = await fetch("/api/settings/avatar", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (data.avatarUrl) {
      updateAvatar(data.avatarUrl);
    }
    avatarUpload.value = "";
  });

  // --- remove avatar ---
  removeAvatarBtn.addEventListener("click", async () => {
    await fetch("/api/settings/avatar", { method: "DELETE" });
    updateAvatar(null);
  });

  // --- messages ---
  async function loadMessages() {
    const res = await fetch("/api/messages");
    const data = await res.json();

    messagesEl.innerHTML = "";

    if (data.length === 0) {
      messagesEl.innerHTML = '<div class="empty-state">start a conversation</div>';
      return;
    }

    for (const msg of data) {
      appendMessage(msg.role, msg.content);
    }
    scrollToBottom();
  }

  function appendMessage(role, content) {
    // Remove empty state
    const empty = messagesEl.querySelector(".empty-state");
    if (empty) empty.remove();

    const div = document.createElement("div");
    div.className = `message ${role}`;

    const roleLabel = document.createElement("div");
    roleLabel.className = "message-role";
    roleLabel.textContent = role === "user" ? "you" : "ai";

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = content;

    div.appendChild(roleLabel);
    div.appendChild(body);
    messagesEl.appendChild(div);
    return body;
  }

  function scrollToBottom() {
    const panel = document.getElementById("messages-panel");
    panel.scrollTop = panel.scrollHeight;
  }

  // --- clear chat ---
  clearBtn.addEventListener("click", async () => {
    await fetch("/api/messages", { method: "DELETE" });
    loadMessages();
  });

  // --- send message ---
  chatForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isStreaming) return;

    const text = chatInput.value.trim();
    if (!text) return;

    chatInput.value = "";
    appendMessage("user", text);
    scrollToBottom();

    isStreaming = true;
    chatInput.disabled = true;

    // Create assistant message container
    const body = appendMessage("assistant", "");
    const cursor = document.createElement("span");
    cursor.className = "cursor";
    body.appendChild(cursor);
    scrollToBottom();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6);
          try {
            const event = JSON.parse(json);
            if (event.type === "delta") {
              body.insertBefore(document.createTextNode(event.text), cursor);
              scrollToBottom();
            } else if (event.type === "error") {
              cursor.remove();
              body.textContent = `error: ${event.error}`;
              body.parentElement.classList.add("error");
            }
          } catch {}
        }
      }

      cursor.remove();
    } catch (err) {
      body.textContent = "connection error";
    }

    isStreaming = false;
    chatInput.disabled = false;
    chatInput.focus();
  });

  // --- init ---
  loadSettings();
  loadMessages();
})();
