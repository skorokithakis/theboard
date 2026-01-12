(function () {
  "use strict";

  var STORAGE_KEY = "theboard-route-stitch";
  var MAX_ENTRIES = 12;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", recordVisit, { once: true });
  } else {
    recordVisit();
  }

  function recordVisit() {
    try {
      var history = loadHistory();
      var path = window.location.pathname + window.location.search;
      var title = document.title || "Unknown stop";
      var heroTitle = document.querySelector(".page-title");
      if (heroTitle && heroTitle.textContent) {
        title = heroTitle.textContent.trim();
      }

      var last = history[history.length - 1];
      var timestamp = Date.now();
      if (last && last.path === path) {
        last.title = title;
        last.timestamp = timestamp;
      } else {
        history.push({ path: path, title: title, timestamp: timestamp });
      }

      if (history.length > MAX_ENTRIES) {
        history = history.slice(history.length - MAX_ENTRIES);
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch (_error) {
      /* localStorage may be unavailable; ignore and keep navigation flowing. */
    }
  }

  function loadHistory() {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    try {
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(function (entry) {
          return entry && entry.path;
        });
      }
    } catch (_error) {
      /* fall through to reset history */
    }
    return [];
  }
})();
