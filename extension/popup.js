/**
 * popup.js — PageMindAI Chrome Extension
 * Orchestrates page detection, content loading, and chat UI.
 */

"use strict";

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  sessionId: null,
  pageType: null,
  ready: false,
  loading: false,
  backendUrl: "http://localhost:8000",
  history: [], // Array of {role, text}
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const pageBadge   = $("pageBadge");
const badgeDot    = $("badgeDot");
const badgeText   = $("badgeText");
const pageTitle   = $("pageTitle");
const pageUrl     = $("pageUrl");
const statusBar   = $("statusBar");
const statusSpinner = $("statusSpinner");
const statusText  = $("statusText");
const chatArea    = $("chatArea");
const emptyState  = $("emptyState");
const suggestions = $("suggestions");
const chatInput   = $("chatInput");
const sendBtn     = $("sendBtn");
const settingsToggle = $("settingsToggle");
const settingsPanel  = $("settingsPanel");
const backendUrlInput = $("backendUrl");
const saveSettingsBtn = $("saveSettings");

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  // Load saved backend URL
  const stored = await chrome.storage.local.get(["backendUrl", "chatHistory"]);
  if (stored.backendUrl) {
    state.backendUrl = stored.backendUrl;
    backendUrlInput.value = stored.backendUrl;
  } else {
    backendUrlInput.value = state.backendUrl;
  }

  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return showError("No active tab found.");

  // Use URL-based session ID to persist state for this specific page
  // Simple hash for sessionId
  const urlKey = tab.url.replace(/[^a-zA-Z0-9]/g, '_').slice(-20);
  state.sessionId = `rag_${urlKey}`;

  // Load history for this page if it exists
  const pageHistory = stored.chatHistory?.[tab.url] || [];
  state.history = pageHistory;

  try {
    // Ensure content script is injected
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    }).catch(() => {});

    // Ask content script for page info
    const response = await chrome.tabs.sendMessage(tab.id, { action: "GET_PAGE_INFO" });
    if (!response?.success) throw new Error(response?.error || "Failed to detect page");

    const info = response.data;
    
    // If YouTube, try a more powerful extraction from the MAIN world context
    if (info.type === "youtube" && !info.transcript) {
      try {
        const [results] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: 'MAIN',
          func: () => {
            const data = window.ytInitialPlayerResponse || window.ytInitialData;
            const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
            if (tracks && tracks.length > 0) {
              const enTrack = tracks.find(t => t.languageCode === 'en' || t.languageCode.startsWith('en')) || tracks[0];
              return enTrack.baseUrl;
            }
            return null;
          }
        });

        if (results.result) {
          console.log("[PageMindAI] Found transcript URL in MAIN world:", results.result);
          
          // Helper to fetch and parse within popup context
          const fetchTranscript = async (url) => {
            try {
              const resp = await fetch(url);
              if (!resp.ok) return null;
              const rawText = await resp.text();
              if (!rawText || rawText.trim().length === 0) return null;

              if (rawText.trim().startsWith('{')) {
                const data = JSON.parse(rawText);
                return data.events?.filter(e => e.segs).map(e => e.segs.map(s => s.utf8).join("")).join(" ");
              }
              if (rawText.includes('<transcript>')) {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(rawText, "text/xml");
                return Array.from(xmlDoc.getElementsByTagName('text')).map(t => t.textContent).join(" ");
              }
              return null;
            } catch (e) { return null; }
          };

          let text = await fetchTranscript(results.result + "&fmt=json3");
          if (!text) {
            console.log("[PageMindAI] MAIN world JSON empty, trying XML...");
            text = await fetchTranscript(results.result);
          }

          if (text) {
            info.transcript = text.replace(/\s+/g, " ").trim();
            console.log("[PageMindAI] Successfully fetched video content from MAIN world URL");
          } else {
            console.warn("[PageMindAI] MAIN world: transcript response was empty or failed");
          }
        }
      } catch (e) {
        console.error("[PageMindAI] MAIN world extraction failed:", e);
      }
    }

    renderPageInfo(info);

    // If we have history, show it immediately
    if (state.history.length > 0) {
      emptyState.remove();
      state.history.forEach(m => addMessage(m.role, m.text, false)); // false = don't save again
      renderSuggestions(info.type);
      enableChat();
      setStatus("Ready (history loaded)", "ok");
    }

    // Always re-load content to backend to ensure session is active
    await loadContent(info);
  } catch (err) {
    showError(`Could not read page: ${err.message}`);
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function renderPageInfo(info) {
  state.pageType = info.type;

  pageTitle.textContent = info.title || "Untitled page";
  pageUrl.textContent   = info.url || "";

  if (info.type === "youtube") {
    pageBadge.className = "page-badge badge-yt";
    badgeDot.className  = "badge-dot dot-yt";
    badgeText.textContent = "▶ YouTube video";
  } else {
    pageBadge.className = "page-badge badge-web";
    badgeDot.className  = "badge-dot dot-web";
    badgeText.textContent = "🌐 Website / Blog";
  }
}

function setStatus(msg, type = "loading") {
  statusBar.classList.remove("hidden");
  statusText.className = type === "ok" ? "status-ok" : type === "error" ? "status-err" : "status-text";
  statusText.textContent = msg;
  statusSpinner.style.display = type === "loading" ? "block" : "none";

  if (type !== "loading") {
    setTimeout(() => statusBar.classList.add("hidden"), 3000);
  }
}

function hideStatus() {
  statusBar.classList.add("hidden");
}

function showError(msg) {
  emptyState.innerHTML = `<div class="empty-icon">⚠</div><div>${msg}</div>`;
  pageBadge.className  = "page-badge badge-loading";
  badgeText.textContent = "Error";
}

function enableChat() {
  state.ready = true;
  emptyState.remove();
  chatInput.disabled = false;
  chatInput.focus();
  sendBtn.disabled = false;
}

function addMessage(role, text, save = true) {
  const div = document.createElement("div");
  div.className = `msg msg-${role}`;
  div.textContent = text;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;

  if (save) {
    state.history.push({ role, text });
    saveHistory();
  }
  return div;
}

async function saveHistory() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const stored = await chrome.storage.local.get("chatHistory") || {};
  const history = stored.chatHistory || {};
  history[tab.url] = state.history;
  await chrome.storage.local.set({ chatHistory: history });
}

function addTyping() {
  const div = document.createElement("div");
  div.className = "msg msg-bot";
  div.id = "_typing";
  div.innerHTML = `<div class="typing-indicator">
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
    <div class="typing-dot"></div>
  </div>`;
  chatArea.appendChild(div);
  chatArea.scrollTop = chatArea.scrollHeight;
  return div;
}

function renderSuggestions(type) {
  const ytSuggs  = ["Summarize", "Key points", "Main topic", "Any timestamps?", "Who is speaking?"];
  const webSuggs = ["Summarize", "Main argument", "Key takeaways", "TL;DR", "What's the conclusion?"];
  const list = type === "youtube" ? ytSuggs : webSuggs;

  suggestions.innerHTML = "";
  list.forEach((label) => {
    const btn = document.createElement("button");
    btn.className = "sugg-btn";
    btn.textContent = label;
    btn.onclick = () => sendMessage(label);
    suggestions.appendChild(btn);
  });
}

function setSuggestionsEnabled(enabled) {
  suggestions.querySelectorAll(".sugg-btn").forEach((b) => (b.disabled = !enabled));
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function apiCall(endpoint, body) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "API_CALL", endpoint, method: "POST", body },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response?.success) {
          reject(new Error(response?.error || "Unknown API error"));
        } else {
          resolve(response.data);
        }
      }
    );
  });
}

// ─── Content loading ──────────────────────────────────────────────────────────

async function loadContent(info) {
  setStatus("Indexing content…", "loading");

  const payload = {
    session_id: state.sessionId,
    type: info.type,
  };

  if (info.type === "youtube") {
    payload.video_id = info.videoId;
    if (info.transcript) payload.transcript = info.transcript;
    if (info.description) payload.description = info.description;
    if (info.comments) payload.comments = info.comments;
  } else {
    payload.url  = info.url;
    payload.text = info.text; // pre-extracted by content.js
  }

  try {
    const result = await apiCall("/load", payload);
    const chars = result.char_count ? ` (${(result.char_count / 1000).toFixed(1)}k chars)` : "";
    
    if (state.history.length === 0) {
      // Only show welcome message if it's a new session
      if (emptyState.parentNode) emptyState.remove();
      addMessage("bot", result.message || "Content loaded. Ask me anything!");
      renderSuggestions(info.type);
      enableChat();
    } else {
      // Just update status if history exists
      enableChat();
    }
    setStatus(`Ready${chars}`, "ok");
  } catch (err) {
    setStatus(`Failed: ${err.message}`, "error");
    if (state.history.length === 0) {
      showError(`Could not index content: ${err.message}`);
    }
  }
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

async function sendMessage(text) {
  text = (text || chatInput.value).trim();
  if (!text || !state.ready || state.loading) return;

  state.loading = true;
  chatInput.value = "";
  chatInput.style.height = "auto";
  chatInput.disabled = true;
  sendBtn.disabled   = true;
  setSuggestionsEnabled(false);

  addMessage("user", text);
  const typing = addTyping();

  try {
    const result = await apiCall("/chat", {
      session_id: state.sessionId,
      question: text,
    });

    typing.remove();
    addMessage("bot", result.answer);
  } catch (err) {
    typing.remove();
    addMessage("bot", `⚠ Error: ${err.message}`);
  } finally {
    state.loading = false;
    chatInput.disabled = false;
    sendBtn.disabled   = false;
    setSuggestionsEnabled(true);
    chatInput.focus();
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

sendBtn.addEventListener("click", () => sendMessage());

chatInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = Math.min(chatInput.scrollHeight, 80) + "px";
});

settingsToggle.addEventListener("click", () => {
  settingsPanel.classList.toggle("open");
});

saveSettingsBtn.addEventListener("click", async () => {
  const url = backendUrlInput.value.trim().replace(/\/$/, "");
  if (!url) return;
  state.backendUrl = url;
  await chrome.storage.local.set({ backendUrl: url });

  // Update background service worker
  chrome.runtime.sendMessage({ action: "UPDATE_BACKEND", url });
  settingsPanel.classList.remove("open");
  setStatus("Settings saved", "ok");
});

// ─── Start ────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", init);
