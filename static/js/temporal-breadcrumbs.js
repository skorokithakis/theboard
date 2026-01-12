(function () {
  "use strict";

  var STORAGE_KEY = "theboard-route-stitch";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeBreadcrumbs, {
      once: true,
    });
  } else {
    initializeBreadcrumbs();
  }

  function initializeBreadcrumbs() {
    var container = document.querySelector("[data-temporal-breadcrumbs]");
    if (!container) {
      return;
    }

    var trailList = container.querySelector("[data-breadcrumb-trail]");
    var futuresList = container.querySelector("[data-breadcrumb-futures]");
    var emptyState = container.querySelector("[data-breadcrumb-empty]");
    var nowLabel = container.querySelector("[data-breadcrumb-now-label]");
    var rewindButton = container.querySelector("[data-breadcrumb-rewind]");

    if (!trailList || !futuresList || !emptyState || !nowLabel || !rewindButton) {
      return;
    }

    var history = loadHistory();
    if (!history.length) {
      emptyState.hidden = false;
      container.classList.add("temporal-breadcrumbs--empty");
      rewindButton.disabled = true;
      return;
    }

    emptyState.hidden = true;
    var current = history[history.length - 1];
    nowLabel.textContent = current.title || window.location.pathname;

    renderTrail(trailList, history);
    renderFutures(futuresList, history);

    var rewindTarget = findRewindTarget(history);
    if (rewindTarget) {
      rewindButton.addEventListener("click", function () {
        window.location.assign(rewindTarget);
      });
    } else {
      rewindButton.disabled = true;
    }
  }

  function loadHistory() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return [];
      }
      var parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter(function (entry) {
          return entry && entry.path;
        });
      }
    } catch (_error) {
      return [];
    }
    return [];
  }

  function renderTrail(list, history) {
    list.innerHTML = "";
    var recent = history.slice(-6);
    recent.forEach(function (entry, index) {
      var item = document.createElement("li");
      item.className = "temporal-breadcrumbs__trail-item";
      if (index === recent.length - 1) {
        item.classList.add("is-current");
      }

      var link = document.createElement("a");
      link.href = entry.path;
      link.textContent = entry.title || entry.path;
      link.className = "temporal-breadcrumbs__trail-link";

      var meta = document.createElement("span");
      meta.className = "temporal-breadcrumbs__trail-meta";
      meta.textContent = formatAge(entry.timestamp);

      item.appendChild(link);
      item.appendChild(meta);
      list.appendChild(item);
    });
  }

  function renderFutures(list, history) {
    list.innerHTML = "";
    var destinations = readDestinations();
    var visited = new Set(
      history.map(function (entry) {
        return entry.path;
      })
    );

    var candidates = destinations.filter(function (destination) {
      if (destination.external) {
        return false;
      }
      try {
        var url = new URL(destination.url, window.location.origin);
        return !visited.has(url.pathname);
      } catch (_error) {
        return false;
      }
    });

    if (!candidates.length) {
      var none = document.createElement("li");
      none.textContent = "Every path is stitched—explore anywhere to write a new thread.";
      none.className = "temporal-breadcrumbs__future-item";
      list.appendChild(none);
      return;
    }

    candidates.slice(0, 4).forEach(function (destination) {
      var item = document.createElement("li");
      item.className = "temporal-breadcrumbs__future-item";

      var link = document.createElement("a");
      link.href = destination.url;
      link.className = "temporal-breadcrumbs__future-link";
      link.innerHTML =
        "<strong>" +
        destination.name +
        "</strong><span>" +
        (destination.summary || "Jump to a fresh branch.") +
        "</span>";

      item.appendChild(link);
      list.appendChild(item);
    });
  }

  function readDestinations() {
    var dataElement = document.getElementById("sitemap-data");
    if (!dataElement) {
      return [];
    }
    try {
      var parsed = JSON.parse(dataElement.textContent || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function findRewindTarget(history) {
    if (history.length < 2) {
      return null;
    }
    var currentPath = window.location.pathname + window.location.search;
    for (var i = history.length - 2; i >= 0; i -= 1) {
      var entry = history[i];
      if (entry.path && entry.path !== currentPath) {
        return entry.path;
      }
    }
    return null;
  }

  function formatAge(timestamp) {
    if (!timestamp) {
      return "moments ago";
    }
    var now = Date.now();
    var delta = Math.max(0, now - timestamp);
    var seconds = Math.floor(delta / 1000);
    if (seconds < 60) {
      return "just now";
    }
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return minutes + "m ago";
    }
    var hours = Math.floor(minutes / 60);
    if (hours < 48) {
      return hours + "h ago";
    }
    var days = Math.floor(hours / 24);
    return days + "d ago";
  }
})();
