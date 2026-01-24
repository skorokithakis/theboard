(function () {
  "use strict";

  var STORAGE_KEY = "theboard:infinite-decibel";
  var body = null;
  var liveRegion = null;
  var audioCtx = null;
  var sirenInterval = null;
  var reduceMotion = false;

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
    if (!body) {
      return;
    }
    liveRegion = document.querySelector("[data-infinite-decibel-live]");
    reduceMotion = prefersReducedMotion();
    var stored = readStoredPreference();
    applyMode(stored, { skipAnnounce: true });
    bindToggles();
    bindBlasts();
    document.addEventListener("zero-decibel:change", handleZeroDecibelChange);
    announce(
      stored
        ? "Infinite-decibel engaged. Sirens override silence and zero-decibel is disarmed."
        : "Infinite-decibel idle. The quiet pact still holds—until you click."
    );
  }

  function bindToggles() {
    var toggles = document.querySelectorAll("[data-infinite-decibel-toggle]");
    toggles.forEach(function (toggle) {
      toggle.addEventListener("click", function () {
        var enabled = isEnabled();
        applyMode(!enabled);
      });
    });
  }

  function bindBlasts() {
    var blasts = document.querySelectorAll("[data-infinite-decibel-blast]");
    blasts.forEach(function (trigger) {
      trigger.addEventListener("click", function () {
        var label = trigger.getAttribute("data-alarm-label") || "Blast";
        var phrase = trigger.getAttribute("data-alarm-phrase") || "chaotic chord";
        var tone = parseInt(trigger.getAttribute("data-alarm-tone") || "600", 10);
        fireBlast(tone || 600);
        announce(label + " · " + phrase);
      });
    });
  }

  function handleZeroDecibelChange(event) {
    var zeroEnabled = !!(event && event.detail && event.detail.enabled);
    if (!zeroEnabled) {
      return;
    }
    if (isEnabled()) {
      applyMode(false, { skipAnnounce: true });
      announce("Infinite-decibel stowed because zero-decibel reclaimed control.");
    }
  }

  function applyMode(enabled, options) {
    if (!body) {
      return;
    }
    var isEnabledValue = !!enabled;
    if (isEnabledValue) {
      disarmZeroDecibel();
    }
    body.dataset.infiniteDecibel = isEnabledValue ? "true" : "false";
    body.classList.toggle("infinite-decibel-mode", isEnabledValue);
    syncToggles(isEnabledValue);
    renderStatus(
      isEnabledValue,
      options && options.skipAnnounce
        ? null
        : isEnabledValue
        ? "Mode unleashed. Expect alarms, strobing gradients, and zero-decibel sabotage."
        : "Mode idle. Accessibility is spared until the next detonation."
    );
    persistPreference(isEnabledValue);
    dispatchModeChange(isEnabledValue);
    if (isEnabledValue) {
      startSirenLoop();
    } else {
      stopSirenLoop();
    }
  }

  function syncToggles(enabled) {
    var toggles = document.querySelectorAll("[data-infinite-decibel-toggle]");
    toggles.forEach(function (toggle) {
      toggle.setAttribute("aria-pressed", enabled ? "true" : "false");
      var indicator = toggle.querySelector("[data-infinite-decibel-indicator]");
      if (indicator) {
        indicator.textContent = enabled ? "Armed" : "Idle";
      }
    });
  }

  function renderStatus(enabled, message) {
    var statusBlocks = document.querySelectorAll("[data-infinite-decibel-status]");
    statusBlocks.forEach(function (block) {
      var label = block.querySelector("[data-infinite-decibel-status-label]");
      var note = block.querySelector("[data-infinite-decibel-status-note]");
      if (label) {
        label.textContent = enabled
          ? "Mode unleashed · zero-decibel sabotaged"
          : "Mode idle · accessibility intact";
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
        new CustomEvent("infinite-decibel:change", {
          detail: { enabled: enabled },
        })
      );
    } catch (err) {}
  }

  function startSirenLoop() {
    stopSirenLoop();
    fireBlast(760);
    sirenInterval = window.setInterval(function () {
      if (reduceMotion) {
        return;
      }
      var base = Math.max(220, Math.floor(Math.random() * 520) + 260);
      fireBlast(base);
    }, 3600);
  }

  function stopSirenLoop() {
    if (sirenInterval) {
      window.clearInterval(sirenInterval);
      sirenInterval = null;
    }
  }

  function fireBlast(tone) {
    var ctx = ensureAudioContext();
    if (!ctx) {
      return;
    }
    resumeContext(ctx)
      .then(function (running) {
        var now = running.currentTime;
        var oscillator = running.createOscillator();
        var gain = running.createGain();
        oscillator.type = "sawtooth";
        var startTone = tone || 680;
        oscillator.frequency.setValueAtTime(startTone, now);
        oscillator.frequency.linearRampToValueAtTime(Math.max(110, startTone / 3), now + 0.7);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.3, now + 0.06);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);
        oscillator.connect(gain);
        gain.connect(running.destination);
        oscillator.start(now);
        oscillator.stop(now + 1.7);
      })
      .catch(function () {});
  }

  function disarmZeroDecibel() {
    try {
      window.localStorage.setItem("theboard:zero-decibel", "false");
    } catch (err) {}
    body.dataset.zeroDecibel = "false";
    body.classList.remove("zero-decibel-mode");
    var toggles = document.querySelectorAll("[data-zero-decibel-toggle]");
    toggles.forEach(function (toggle) {
      toggle.setAttribute("aria-pressed", "false");
      var indicator = toggle.querySelector("[data-zero-decibel-indicator]");
      if (indicator) {
        indicator.textContent = "Off";
      }
    });
    try {
      document.dispatchEvent(
        new CustomEvent("zero-decibel:change", { detail: { enabled: false } })
      );
    } catch (err) {}
  }

  function ensureAudioContext() {
    if (audioCtx) {
      return audioCtx;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    try {
      audioCtx = new Ctor();
    } catch (err) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function resumeContext(ctx) {
    if (!ctx) {
      return Promise.reject(new Error("No audio context"));
    }
    if (typeof ctx.resume !== "function") {
      return Promise.resolve(ctx);
    }
    if (ctx.state === "running") {
      return Promise.resolve(ctx);
    }
    try {
      return ctx.resume().then(function () {
        return ctx;
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function isEnabled() {
    if (!body) {
      return false;
    }
    return (
      body.dataset.infiniteDecibel === "true" ||
      readStoredPreference() === true
    );
  }

  function prefersReducedMotion() {
    var query = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (query && typeof query.addEventListener === "function") {
      query.addEventListener("change", function (event) {
        reduceMotion = !!(event && event.matches);
      });
    }
    return query ? query.matches : false;
  }
})();
