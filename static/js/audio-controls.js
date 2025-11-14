(function () {
  "use strict";

  var track = null;
  var toggle = null;
  var STORAGE_KEY = "theboard:music-muted";
  var interactionHooked = false;

  function init() {
    track = document.querySelector("[data-audio-track]");
    toggle = document.querySelector("[data-audio-toggle]");
    if (!track || !toggle) {
      return;
    }

    var startMuted = false;
    try {
      startMuted = window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch (err) {}

    track.volume = 0.65;
    track.loop = true;
    track.preload = "auto";
    track.muted = startMuted;

    var icon = toggle.querySelector("[data-audio-icon]");
    var label = toggle.querySelector("[data-audio-label]");

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
      toggle.setAttribute(
        "aria-label",
        track.muted ? "Enable background music" : "Mute background music"
      );
      toggle.title = track.muted ? "Enable chiptune background" : "Mute chiptune background";
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

    function warmPlayback() {
      var promise = track.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(function () {});
      }
    }

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
    updateUI();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
