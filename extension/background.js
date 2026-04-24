/**
 * background.js — Manifest V3 service worker
 * Handles extension lifecycle and proxies API calls from popup
 * to avoid CORS issues with the extension page itself.
 */

let API_BASE = "http://localhost:8000"; // Change to your deployed backend URL

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.action === "API_CALL") {
    handleApiCall(message.endpoint, message.method, message.body)
      .then((data) => sendResponse({ success: true, data }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true; // Keep channel open for async response
  }

  if (message.action === "UPDATE_BACKEND") {
    API_BASE = message.url;
    console.log("Backend URL updated to:", API_BASE);
    sendResponse({ success: true });
  }
});

async function handleApiCall(endpoint, method = "POST", body = null) {
  const options = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${API_BASE}${endpoint}`, options);
  if (!response.ok) {
    const err = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(err.detail || `HTTP ${response.status}`);
  }
  return response.json();
}
