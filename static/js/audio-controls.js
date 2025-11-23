(function () {
  "use strict";

  var track = null;
  var toggle = null;
  var icon = null;
  var label = null;
  var trackLabel = null;
  var STORAGE_KEY = "theboard:music-muted";
  var interactionHooked = false;
  var soundtrackObserver = null;
  var soundtrackZones = new Map();
  var zoneOrder = new Map();
  var soundtracks = {};
  var defaultSoundtrackId = null;
  var activeSoundtrackId = null;

  function init() {
    track = document.querySelector("[data-audio-track]");
    toggle = document.querySelector("[data-audio-toggle]");
    if (!track || !toggle) {
      return;
    }

    icon = toggle.querySelector("[data-audio-icon]");
    label = toggle.querySelector("[data-audio-label]");
    trackLabel = toggle.querySelector("[data-audio-track-label]");

    soundtracks = buildSoundtrackCatalog(track);
    if (!Object.keys(soundtracks).length) {
      return;
    }
    defaultSoundtrackId = determineDefaultSoundtrack(track, soundtracks);
    activeSoundtrackId = null;

    var startMuted = readMutedPreference();
    configureTrack(startMuted);
    registerSoundtrackZones();
    setSoundtrack(pickTopSoundtrack() || defaultSoundtrackId);
    bindEvents(startMuted);
    updateUI();
  }

  function buildSoundtrackCatalog(trackEl) {
    var definitions = {
      atrium: { label: "Atrium Bloom", datasetKey: "soundtrackAtrium" },
      greenhouse: { label: "Greenhouse Hush", datasetKey: "soundtrackGreenhouse" },
      arcade: { label: "Arcade Pulse", datasetKey: "soundtrackArcade" },
      graveyard: { label: "Graveyard Chime", datasetKey: "soundtrackGraveyard" },
    };
    var catalog = {};
    Object.keys(definitions).forEach(function (id) {
      var src = trackEl.dataset[definitions[id].datasetKey];
      if (!src) {
        return;
      }
      catalog[id] = {
        id: id,
        label: definitions[id].label,
        src: src,
      };
    });
    return catalog;
  }

  function determineDefaultSoundtrack(trackEl, catalog) {
    var requested = trackEl.dataset.soundtrackDefault;
    if (requested && catalog[requested]) {
      return requested;
    }
    var keys = Object.keys(catalog);
    return keys.length ? keys[0] : null;
  }

  function readMutedPreference() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch (err) {
      return false;
    }
  }

  function updateUI() {
    toggle.setAttribute("aria-pressed", track.muted ? "false" : "true");
    toggle.classList.toggle("audio-toggle--muted", track.muted);
    var iconChar = track.muted ? "🔇" : "🔊";
    if (icon) {
      icon.textContent = iconChar;
    }
    if (label) {
      label.textContent = track.muted ? "Music Off" : "Music On";
    }
    var soundtrackLabel = getActiveSoundtrackLabel();
    if (trackLabel) {
      trackLabel.textContent = soundtrackLabel || "Soundtrack";
    }
    var controlLabel = track.muted ? "Enable site soundtrack" : "Mute site soundtrack";
    if (soundtrackLabel) {
      controlLabel += " (" + soundtrackLabel + ")";
    }
    toggle.setAttribute("aria-label", controlLabel);
    toggle.title = controlLabel;
  }

  function persistPreference() {
    try {
      window.localStorage.setItem(STORAGE_KEY, track.muted ? "true" : "false");
    } catch (err) {}
  }

  function ensurePlayback() {
    if (!track || track.muted) {
      return;
    }
    var playPromise = track.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(function () {
        if (interactionHooked) {
          return;
        }
        interactionHooked = true;
        var resume = function () {
          interactionHooked = false;
          window.removeEventListener("pointerdown", resume);
          window.removeEventListener("keydown", resume);
          ensurePlayback();
        };
        window.addEventListener("pointerdown", resume, { once: true });
        window.addEventListener("keydown", resume, { once: true });
      });
    }
  }

  function registerSoundtrackZones() {
    var zones = document.querySelectorAll("[data-soundtrack]");
    if (!zones.length) {
      return;
    }
    soundtrackObserver = new IntersectionObserver(handleSoundtrackIntersect, {
      threshold: [0, 0.2, 0.4, 0.65, 0.85],
    });
    zones.forEach(function (zone, index) {
      var key = zone.dataset.soundtrack;
      if (!resolveSoundtrack(key)) {
        return;
      }
      zoneOrder.set(zone, index);
      soundtrackZones.set(zone, computeVisibility(zone));
      soundtrackObserver.observe(zone);
    });
  }

  function handleSoundtrackIntersect(entries) {
    entries.forEach(function (entry) {
      soundtrackZones.set(entry.target, entry.isIntersecting ? entry.intersectionRatio : 0);
    });
    var next = pickTopSoundtrack();
    if (next) {
      setSoundtrack(next);
    }
  }

  function computeVisibility(el) {
    if (!el || typeof el.getBoundingClientRect !== "function") {
      return 0;
    }
    var rect = el.getBoundingClientRect();
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1;
    if (rect.bottom <= 0 || rect.top >= viewportHeight) {
      return 0;
    }
    var visible = Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0);
    var ratio = visible / Math.max(rect.height, 1);
    return Math.max(0, Math.min(1, ratio));
  }

  function pickTopSoundtrack() {
    var bestKey = null;
    var bestRatio = 0;
    var bestOrder = Number.MAX_SAFE_INTEGER;
    soundtrackZones.forEach(function (ratio, el) {
      var key = el.dataset.soundtrack;
      if (!resolveSoundtrack(key)) {
        return;
      }
      var order = zoneOrder.get(el) || 0;
      var ratioWins = ratio > bestRatio + 0.02;
      var tieWins = Math.abs(ratio - bestRatio) < 0.02 && order < bestOrder;
      if (ratioWins || tieWins) {
        bestKey = key;
        bestRatio = ratio;
        bestOrder = order;
      }
    });
    if (!bestKey) {
      return defaultSoundtrackId;
    }
    return bestKey;
  }

  function resolveSoundtrack(id) {
    if (id && soundtracks[id]) {
      return soundtracks[id];
    }
    return null;
  }

  function setSoundtrack(id) {
    var next = resolveSoundtrack(id) || resolveSoundtrack(defaultSoundtrackId);
    if (!next) {
      return;
    }
    if (activeSoundtrackId === next.id && track.dataset.currentSrc === next.src) {
      updateUI();
      return;
    }
    track.pause();
    track.src = next.src;
    track.load();
    activeSoundtrackId = next.id;
    track.dataset.currentSrc = next.src;
    track.dataset.currentSoundtrack = next.id;
    if (!track.muted) {
      ensurePlayback();
    }
    updateUI();
  }

  function getActiveSoundtrackLabel() {
    var active = resolveSoundtrack(activeSoundtrackId) || resolveSoundtrack(defaultSoundtrackId);
    return active ? active.label : "";
  }

  function configureTrack(startMuted) {
    track.volume = 0.65;
    track.loop = true;
    track.preload = "auto";
    track.muted = startMuted;
  }

  function warmPlayback() {
    var promise = track.play();
    if (promise && typeof promise.catch === "function") {
      promise.catch(function () {});
    }
  }

  function bindEvents(startMuted) {
    toggle.addEventListener("click", function () {
      track.muted = !track.muted;
      if (!track.muted) {
        ensurePlayback();
      }
      updateUI();
      persistPreference();
    });

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && !track.muted) {
        ensurePlayback();
      }
    });

    if (startMuted) {
      warmPlayback();
    } else {
      ensurePlayback();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
