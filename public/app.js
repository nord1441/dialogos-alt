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
  const modelSelector = document.getElementById("model-selector");

  let isStreaming = false;
  let allModels = {};
  let enabledModels = [];
  let activeModel = { provider: "anthropic", model: "claude-opus-4-6" };

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

  // --- font ---
  function getFont() {
    return localStorage.getItem("font") || "doto";
  }

  function setFont(font) {
    if (font === "doto") {
      document.documentElement.removeAttribute("data-font");
    } else {
      document.documentElement.setAttribute("data-font", font);
    }
    localStorage.setItem("font", font);

    document.querySelectorAll(".font-option").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.font === font);
    });
  }

  setFont(getFont());

  document.querySelectorAll(".font-option").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const font = btn.dataset.font;
      setFont(font);
      await fetch("/api/settings/font", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ font }),
      });
    });
  });

  // --- settings tabs ---
  document.querySelectorAll(".settings-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".settings-tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".settings-tab-content").forEach((c) => c.classList.remove("active"));
      tab.classList.add("active");
      document.querySelector(`.settings-tab-content[data-tab="${tab.dataset.tab}"]`).classList.add("active");

      if (tab.dataset.tab === "models") {
        loadModels();
      }
    });
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

    activeModel = data.activeModel || { provider: "anthropic", model: "claude-opus-4-6" };
    enabledModels = data.enabledModels || [];

    // Apply font setting from server
    if (data.font) {
      setFont(data.font);
    }

    // Populate provider config status
    if (data.providers) {
      for (const [provider, info] of Object.entries(data.providers)) {
        updateKeyStatus(provider, info.hasApiKey);
        const urlInput = document.querySelector(`.provider-base-url[data-provider="${provider}"]`);
        if (urlInput) urlInput.value = info.baseUrl || "";
      }
    }

    updateModelSelector();
  }

  function updateKeyStatus(provider, hasKey) {
    const el = document.getElementById(`${provider}-key-status`);
    if (!el) return;
    if (hasKey) {
      el.textContent = "configured";
      el.className = "key-status configured";
    } else {
      el.textContent = "not set";
      el.className = "key-status";
    }
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

  // --- save provider config (api key + base url) ---
  document.querySelectorAll(".save-provider-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      const keyInput = document.querySelector(`.provider-api-key[data-provider="${provider}"]`);
      const urlInput = document.querySelector(`.provider-base-url[data-provider="${provider}"]`);
      const origText = btn.textContent;
      btn.textContent = "...";

      const body = { provider };
      if (keyInput.value) body.apiKey = keyInput.value;
      body.baseUrl = urlInput.value;

      await fetch("/api/settings/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (keyInput.value) {
        updateKeyStatus(provider, !!keyInput.value.trim());
        keyInput.value = "";
      }

      btn.textContent = "saved";
      setTimeout(() => {
        btn.textContent = origText;
      }, 1200);
    });
  });

  // --- test provider connection ---
  document.querySelectorAll(".test-provider-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const provider = btn.dataset.provider;
      const resultEl = document.getElementById(`${provider}-test-result`);
      const origText = btn.textContent;

      btn.textContent = "...";
      btn.disabled = true;
      resultEl.textContent = "testing...";
      resultEl.className = "test-result testing";

      try {
        const res = await fetch("/api/settings/provider/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        const data = await res.json();

        if (data.ok) {
          resultEl.textContent = "connected";
          resultEl.className = "test-result success";
        } else {
          resultEl.textContent = data.message || "failed";
          resultEl.className = "test-result failure";
        }
      } catch {
        resultEl.textContent = "request failed";
        resultEl.className = "test-result failure";
      }

      btn.textContent = origText;
      btn.disabled = false;

      setTimeout(() => {
        resultEl.textContent = "";
        resultEl.className = "test-result";
      }, 5000);
    });
  });

  // --- models ---
  async function loadModels() {
    const res = await fetch("/api/models");
    allModels = await res.json();
    renderModelsList();
  }

  function renderModelsList() {
    const container = document.getElementById("models-list");
    container.innerHTML = "";

    const providerNames = {
      anthropic: "Anthropic",
      openai: "OpenAI",
      gemini: "Gemini",
      ollama: "Ollama",
    };

    for (const [provider, models] of Object.entries(allModels)) {
      if (!models.length && provider !== "ollama") continue;

      const section = document.createElement("div");
      section.className = "models-provider-section";

      const header = document.createElement("div");
      header.className = "models-provider-header";
      header.textContent = providerNames[provider] || provider;
      section.appendChild(header);

      if (models.length === 0) {
        const empty = document.createElement("div");
        empty.className = "models-empty";
        empty.textContent = provider === "ollama" ? "no models found - check ollama endpoint" : "no models available";
        section.appendChild(empty);
      } else {
        for (const model of models) {
          const label = document.createElement("label");
          label.className = "model-checkbox-label";

          const checkbox = document.createElement("input");
          checkbox.type = "checkbox";
          checkbox.className = "model-checkbox";
          checkbox.dataset.provider = provider;
          checkbox.dataset.model = model.id;
          checkbox.checked = enabledModels.some(
            (m) => m.provider === provider && m.model === model.id
          );

          const span = document.createElement("span");
          span.textContent = model.name;

          label.appendChild(checkbox);
          label.appendChild(span);
          section.appendChild(label);
        }
      }

      container.appendChild(section);
    }
  }

  // --- save models ---
  document.getElementById("save-models-btn").addEventListener("click", async () => {
    const btn = document.getElementById("save-models-btn");
    const checkboxes = document.querySelectorAll(".model-checkbox:checked");
    const models = [];
    checkboxes.forEach((cb) => {
      models.push({ provider: cb.dataset.provider, model: cb.dataset.model });
    });

    const origText = btn.textContent;
    btn.textContent = "...";
    await fetch("/api/settings/enabled-models", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ models }),
    });
    enabledModels = models;
    updateModelSelector();
    btn.textContent = "saved";
    setTimeout(() => {
      btn.textContent = origText;
    }, 1200);
  });

  // --- model selector ---
  function updateModelSelector() {
    modelSelector.innerHTML = "";

    if (enabledModels.length === 0) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "no models enabled";
      modelSelector.appendChild(opt);
      return;
    }

    for (const m of enabledModels) {
      const opt = document.createElement("option");
      opt.value = `${m.provider}:${m.model}`;
      opt.textContent = `${m.model}`;
      if (m.provider === activeModel.provider && m.model === activeModel.model) {
        opt.selected = true;
      }
      modelSelector.appendChild(opt);
    }
  }

  modelSelector.addEventListener("change", async () => {
    const val = modelSelector.value;
    if (!val) return;
    const [provider, ...rest] = val.split(":");
    const model = rest.join(":");
    activeModel = { provider, model };
    await fetch("/api/settings/active-model", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activeModel),
    });
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
