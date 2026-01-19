(function () {
  "use strict";

  var STORAGE_KEY = "theboard:zero-decibel";
  var body = null;
  var liveRegion = null;

  ready(initialize);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initialize() {
    body = document.body;
    liveRegion = document.querySelector("[data-zero-decibel-live]");
    var stored = readStoredPreference();
    applyMode(stored, { skipAnnounce: true });
    bindToggles();
    bindPulses();
    announce(
      stored
        ? "Zero-decibel mode active. Audio cues muted; tactile pulses ready."
        : "Zero-decibel mode idle. Tap to silence audio cues and mirror signals into text."
    );
  }

  function bindToggles() {
    var toggles = document.querySelectorAll("[data-zero-decibel-toggle]");
    toggles.forEach(function (toggle) {
      toggle.addEventListener("click", function () {
        var enabled = isEnabled();
        applyMode(!enabled);
      });
    });
  }

  function bindPulses() {
    var pulses = document.querySelectorAll("[data-zero-decibel-pulse]");
    pulses.forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        var label = trigger.getAttribute("data-zero-decibel-pulse") || "Pulse";
        var parsed = parsePattern(trigger.getAttribute("data-zero-decibel-pattern"));
        var fallback =
          trigger.getAttribute("data-zero-decibel-fallback") || parsed.readable;
        var enabled = isEnabled();

        if (enabled && parsed.sequence.length && supportsVibration()) {
          try {
            navigator.vibrate(parsed.sequence);
          } catch (err) {}
        }

        var message = label + " · " + (fallback || "steady");
        setTimeout(function () {
          announce(message);
        }, 0);
        trigger.classList.add("pulse-chip--fired");
        window.setTimeout(function () {
          trigger.classList.remove("pulse-chip--fired");
        }, 320);
      });
    });
  }

  function parsePattern(raw) {
    if (!raw || typeof raw !== "string") {
      return { sequence: [], readable: "" };
    }
    var parts = raw
      .split(",")
      .map(function (value) {
        var num = parseInt(value.trim(), 10);
        return isFinite(num) && num > 0 ? num : null;
      })
      .filter(function (num) {
        return num !== null;
      });
    var readable = parts
      .map(function (num) {
        if (num >= 300) {
          return "anchor";
        }
        if (num >= 180) {
          return "long";
        }
        return "short";
      })
      .join(" · ");
    return { sequence: parts, readable: readable };
  }

  function applyMode(enabled, options) {
    if (!body) {
      return;
    }
    var isEnabledValue = !!enabled;
    body.dataset.zeroDecibel = isEnabledValue ? "true" : "false";
    body.classList.toggle("zero-decibel-mode", isEnabledValue);
    syncToggles(isEnabledValue);
    renderStatus(
      isEnabledValue,
      options && options.skipAnnounce
        ? null
        : isEnabledValue
        ? "Zero-decibel mode armed. Audio cues muted; tactile/text pulses will mirror important states."
        : "Zero-decibel mode idle. Standard audio cues are available."
    );
    persistPreference(isEnabledValue);
    dispatchModeChange(isEnabledValue);
  }

  function syncToggles(enabled) {
    var toggles = document.querySelectorAll("[data-zero-decibel-toggle]");
    toggles.forEach(function (toggle) {
      toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
      var indicator = toggle.querySelector("[data-zero-decibel-indicator]");
      if (indicator) {
        indicator.textContent = enabled ? "On" : "Off";
      }
    });
  }

  function renderStatus(enabled, message) {
    var statusBlocks = document.querySelectorAll("[data-zero-decibel-status]");
    statusBlocks.forEach(function (block) {
      var label = block.querySelector("[data-zero-decibel-status-label]");
      var note = block.querySelector("[data-zero-decibel-status-note]");
      if (label) {
        label.textContent = enabled
          ? "Mode armed · zero-decibel"
          : "Mode idle · sound cues allowed";
      }
      if (note && message) {
        note.textContent = message;
      }
    });
    if (message) {
      announce(message);
    }
  }

  function announce(message) {
    if (!message || !liveRegion) {
      return;
    }
    liveRegion.textContent = message;
  }

  function readStoredPreference() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch (err) {
      return false;
    }
  }

  function persistPreference(enabled) {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
    } catch (err) {}
  }

  function dispatchModeChange(enabled) {
    try {
      document.dispatchEvent(
        new CustomEvent("zero-decibel:change", {
          detail: { enabled: enabled },
        })
      );
    } catch (err) {}
  }

  function isEnabled() {
    return (
      !!body &&
      (body.dataset.zeroDecibel === "true" || readStoredPreference() === true)
    );
  }

  function supportsVibration() {
    return (
      typeof window !== "undefined" &&
      "navigator" in window &&
      typeof navigator.vibrate === "function"
    );
  }
})();
