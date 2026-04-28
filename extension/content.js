/**
 * content.js
 * Runs on every page. Detects whether it's YouTube or a website,
 * extracts relevant content, and responds to messages from popup.js
 */

(function () {
  "use strict";

  // ─── Page type detection ────────────────────────────────────────────────────

  async function detectPage() {
    const url = window.location.href;
    const hostname = window.location.hostname;
    const params = new URLSearchParams(window.location.search);

    // YouTube watch page
    if (
      (hostname === "www.youtube.com" || hostname === "youtube.com") &&
      url.includes("/watch") &&
      params.get("v")
    ) {
      return {
        type: "youtube",
        videoId: params.get("v"),
        url: url,
        title: document.title.replace(" - YouTube", "").trim(),
        transcript: await extractYouTubeTranscript(),
        description: extractYouTubeDescription(),
        comments: extractYouTubeComments(),
      };
    }

    // YouTube Shorts
    if (hostname.includes("youtube.com") && url.includes("/shorts/")) {
      const videoId = url.split("/shorts/")[1]?.split("?")[0];
      if (videoId) {
        return {
          type: "youtube",
          videoId,
          url,
          title: document.title.replace(" - YouTube", "").trim(),
          transcript: await extractYouTubeTranscript(),
          description: extractYouTubeDescription(),
          comments: extractYouTubeComments(),
        };
      }
    }

    // Regular website / blog
    return {
      type: "website",
      url: url,
      title: document.title.trim(),
      text: extractPageText(),
    };
  }

  async function extractYouTubeTranscript() {
    console.log("[PageMindAI] Attempting transcript extraction...");
    try {
      let data = null;
      const scripts = Array.from(document.getElementsByTagName('script'));
      
      // Pattern 1: ytInitialPlayerResponse in a script tag
      const playerScript = scripts.find(s => s.textContent.includes('ytInitialPlayerResponse ='));
      if (playerScript) {
        const text = playerScript.textContent;
        const startIdx = text.indexOf('{');
        const endIdx = text.lastIndexOf('}');
        if (startIdx !== -1 && endIdx !== -1) {
          try {
            data = JSON.parse(text.substring(startIdx, endIdx + 1));
            console.log("[PageMindAI] Found ytInitialPlayerResponse in script tag");
          } catch (e) {
            console.error("[PageMindAI] JSON.parse failed for playerScript:", e);
          }
        }
      }

      // Pattern 2: ytInitialData as fallback
      if (!data?.captions) {
        const dataScript = scripts.find(s => s.textContent.includes('ytInitialData ='));
        if (dataScript) {
          const text = dataScript.textContent;
          const startIdx = text.indexOf('{');
          const endIdx = text.lastIndexOf('}');
          if (startIdx !== -1 && endIdx !== -1) {
            try {
              const fullData = JSON.parse(text.substring(startIdx, endIdx + 1));
              if (fullData.captions) data = fullData;
              console.log("[PageMindAI] Found captions in ytInitialData");
            } catch (e) {
              console.error("[PageMindAI] JSON.parse failed for dataScript:", e);
            }
          }
        }
      }

      const tracks = data?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

      if (tracks && tracks.length > 0) {
        // Prefer English, then English auto-generated, then first available
        const enTrack = tracks.find(t => t.languageCode === 'en') || 
                        tracks.find(t => t.languageCode.startsWith('en')) || 
                        tracks[0];
        
        console.log("[PageMindAI] Selected track:", enTrack.languageCode, enTrack.kind || "manual");
        
        // Try JSON format first
        let transcriptText = await fetchTranscript(enTrack.baseUrl + "&fmt=json3");
        
        // If JSON is empty or failed, try XML (default)
        if (!transcriptText) {
          console.log("[PageMindAI] JSON transcript empty, falling back to XML...");
          transcriptText = await fetchTranscript(enTrack.baseUrl);
        }

        if (transcriptText) {
          return transcriptText;
        }
      } 
      
      console.warn("[PageMindAI] No caption tracks found or fetch failed. Falling back to description...");
      const desc = extractYouTubeDescription();
      if (desc) {
        console.log("[PageMindAI] Using video description as fallback");
        return "VIDEO DESCRIPTION: " + desc;
      }
    } catch (e) {
      console.error("[PageMindAI] Error extracting transcript:", e);
    }
    return null;
  }

  async function fetchTranscript(url) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) return null;
      
      const rawText = await resp.text();
      if (!rawText || rawText.trim().length === 0) return null;

      // Try parsing as JSON first
      if (rawText.trim().startsWith('{')) {
        try {
          const data = JSON.parse(rawText);
          if (data.events) {
            return data.events
              .filter(e => e.segs)
              .map(e => e.segs.map(s => s.utf8).join(""))
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
          }
        } catch (e) {
          console.warn("[PageMindAI] Failed to parse transcript as JSON");
        }
      }

      // Try parsing as XML (standard YouTube format)
      if (rawText.includes('<transcript>')) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(rawText, "text/xml");
        const texts = Array.from(xmlDoc.getElementsByTagName('text'));
        return texts
          .map(t => t.textContent)
          .join(" ")
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/\s+/g, " ")
          .trim();
      }

      return null;
    } catch (err) {
      console.error("[PageMindAI] fetchTranscript error:", err);
      return null;
    }
  }

  function extractYouTubeDescription() {
    const selectors = [
      'div#description-inner',
      'yt-formatted-string#description',
      '#description-text',
      'meta[name="description"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.tagName === 'META' ? el.content : el.innerText).trim();
        if (text) return text;
      }
    }
    return "";
  }

  function extractYouTubeComments() {
    const comments = [];
    const commentEls = document.querySelectorAll('ytd-comment-thread-renderer #content-text');
    commentEls.forEach(el => {
      const text = el.innerText.trim();
      if (text) comments.push(text);
    });
    // Limit to top 20 visible comments to avoid overwhelming the context
    return comments.slice(0, 20).join("\n---\n");
  }

  function videoIdFromUrl(url) {
    const params = new URLSearchParams(new URL(url).search);
    return params.get("v") || url.split("/shorts/")[1]?.split("?")[0];
  }

  // ─── Text extraction ────────────────────────────────────────────────────────

  function extractPageText() {
    // Clone body to avoid mutating the live DOM
    const clone = document.body.cloneNode(true);

    // Remove noise
    const noiseSelectors = [
      "script", "style", "noscript", "iframe",
      "nav", "footer", "header", "aside",
      ".nav", ".navbar", ".footer", ".sidebar",
      ".cookie-banner", ".advertisement", ".ad",
      '[role="navigation"]', '[role="banner"]', '[role="complementary"]',
    ];
    noiseSelectors.forEach((sel) => {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    });

    // Prefer semantic content containers (priority order)
    const contentSelectors = [
      "article",
      "main",
      '[role="main"]',
      ".post-content",
      ".article-body",
      ".entry-content",
      ".post-body",
      ".article-content",
      "#content",
      "#main-content",
      ".content",
    ];

    for (const sel of contentSelectors) {
      const el = clone.querySelector(sel);
      if (el) {
        const text = cleanText(el.innerText || el.textContent);
        if (text.length > 200) return text;
      }
    }

    // Fallback: full body
    return cleanText(clone.innerText || clone.textContent || "");
  }

  function cleanText(raw) {
    return raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 15) // drop short noise lines
      .join("\n")
      .slice(0, 50000); // cap at 50k chars
  }

  // ─── Message listener (from popup.js) ───────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.action === "GET_PAGE_INFO") {
      detectPage()
        .then(info => sendResponse({ success: true, data: info }))
        .catch(err => sendResponse({ success: false, error: err.message }));
    }
    // Return true to indicate async response is possible
    return true;
  });
})();
