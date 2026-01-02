(function () {
  "use strict";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeCountdowns, {
      once: true,
    });
  } else {
    initializeCountdowns();
  }

  function initializeCountdowns() {
    var elements = Array.prototype.slice
      .call(document.querySelectorAll("[data-next-iteration]"))
      .map(function (node) {
        var rawValue = node.dataset.nextIteration;
        var label = (node.dataset.countdownLabel || "Next iteration").trim();
        var target = parseTarget(rawValue);
        if (!target) {
          return null;
        }
        return { node: node, target: target, label: label };
      })
      .filter(Boolean);

    if (!elements.length) {
      return;
    }

    var tick = function () {
      updateCountdowns(elements);
    };
    tick();
    window.setInterval(tick, 1000);
  }

  function updateCountdowns(list) {
    var now = Date.now();
    list.forEach(function (entry) {
      var target = entry.target;
      var diff = target.getTime() - now;
      if (diff <= 0) {
        target = computeNextIteration(now);
        entry.target = target;
        diff = target.getTime() - now;
      }
      if (diff < 0) {
        diff = 0;
      }
      var message = formatCountdownMessage(entry.label, target, diff);
      if (entry.node.textContent !== message) {
        entry.node.textContent = message;
      }
    });
  }

  function formatCountdownMessage(label, target, diffMs) {
    var countdown = formatCountdown(diffMs);
    var utcTime = formatTimeForZone(target, "UTC");
    var localTime = formatTimeForZone(target);
    return (
      label +
      " in " +
      countdown +
      " (" +
      utcTime +
      " / " +
      localTime +
      " your time)"
    );
  }

  function formatCountdown(diffMs) {
    var totalSeconds = Math.max(0, Math.floor(diffMs / 1000));
    var days = Math.floor(totalSeconds / 86400);
    var hours = Math.floor((totalSeconds % 86400) / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    var parts = [];
    if (days) {
      parts.push(days + "d");
    }
    parts.push(pad(hours) + "h");
    parts.push(pad(minutes) + "m");
    parts.push(pad(seconds) + "s");
    return parts.join(" ");
  }

  function formatTimeForZone(date, timeZone) {
    var options = {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    };
    if (timeZone) {
      options.timeZone = timeZone;
    }
    try {
      return date.toLocaleString(undefined, options);
    } catch (_error) {
      return date.toISOString();
    }
  }

  function parseTarget(rawValue) {
    if (!rawValue) {
      return null;
    }
    var parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  function computeNextIteration(referenceMs) {
    var now = referenceMs ? new Date(referenceMs) : new Date();
    var year = now.getUTCFullYear();
    var month = now.getUTCMonth();
    var day = now.getUTCDate();
    var nowMs = now.getTime();
    var noonMs = Date.UTC(year, month, day, 12, 0, 0, 0);
    if (nowMs < noonMs) {
      return new Date(noonMs);
    }
    var midnightMs = Date.UTC(year, month, day + 1, 0, 0, 0, 0);
    return new Date(midnightMs);
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }
})();
