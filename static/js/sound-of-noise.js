(function () {
  "use strict";

  var audioCtx = null;
  var squeakHandler = null;
  var squeakLastPlayed = 0;
  var bayhemTimer = null;
  var graveyardTimer = null;
  var graveyardAudio = null;
  var graveyardPrimed = false;
  var metronomeInterval = null;
  var metronomeToggle = null;
  var reduceMotion = prefersReducedMotion();
  var zeroDecibelMode = false;

  ready(initialize);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initialize() {
    zeroDecibelMode = isZeroDecibelEnabled();
    bindGlobalSqueaks();
    bindFormBayhem();
    armGraveyardSounds();
    installRecordsMetronome();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("zero-decibel:change", handleZeroDecibelChange);
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

  function ensureAudioContext() {
    if (zeroDecibelMode) {
      return null;
    }
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

  function bindGlobalSqueaks() {
    if (zeroDecibelMode) {
      return;
    }
    if (squeakHandler) {
      return;
    }
    squeakHandler = function (event) {
      if (event.button && event.button > 1) {
        return;
      }
      var ctx = ensureAudioContext();
      if (!ctx) {
        disableSqueaks();
        return;
      }
      resumeContext(ctx)
        .then(function (runningCtx) {
          playSqueak(runningCtx);
        })
        .catch(disableSqueaks);
    };
    document.addEventListener("pointerdown", squeakHandler, { capture: true });
  }

  function disableSqueaks() {
    if (!squeakHandler) {
      return;
    }
    document.removeEventListener("pointerdown", squeakHandler, {
      capture: true,
    });
    squeakHandler = null;
  }

  function playSqueak(ctx) {
    var now = ctx.currentTime;
    if (squeakLastPlayed && now - squeakLastPlayed < 0.08) {
      return;
    }
    squeakLastPlayed = now;

    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter =
      typeof ctx.createBiquadFilter === "function"
        ? ctx.createBiquadFilter()
        : null;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(1500, now);
    oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.2);
    if (oscillator.detune && typeof oscillator.detune.setValueAtTime === "function") {
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 160, now);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    oscillator.connect(gain);
    if (filter) {
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1200, now);
      filter.Q.value = 8;
      gain.connect(filter);
      filter.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }

    oscillator.start(now);
    oscillator.stop(now + 0.26);
  }

  function bindFormBayhem() {
    document.addEventListener(
      "submit",
      function (event) {
        if (!(event.target instanceof HTMLFormElement)) {
          return;
        }
        triggerBayhem();
        playRumble();
      },
      true
    );
  }

  function triggerBayhem() {
    if (reduceMotion) {
      return;
    }
    clearTimeout(bayhemTimer);
    document.body.classList.add("bayhem-active");
    bayhemTimer = window.setTimeout(clearBayhem, 900);
  }

  function clearBayhem() {
    document.body.classList.remove("bayhem-active");
  }

  function playRumble() {
    if (zeroDecibelMode) {
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      return;
    }
    resumeContext(ctx)
      .then(function (runningCtx) {
        var now = runningCtx.currentTime;
        var osc = runningCtx.createOscillator();
        var gain = runningCtx.createGain();

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(68, now);
        osc.frequency.exponentialRampToValueAtTime(22, now + 0.6);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

        osc.connect(gain);
        gain.connect(runningCtx.destination);
        osc.start(now);
        osc.stop(now + 0.75);
      })
      .catch(function () {
        /* ignore rumble errors so submissions still work */
      });
  }

  function armGraveyardSounds() {
    if (zeroDecibelMode) {
      return;
    }
    var graveyard = document.querySelector(".graveyard-page");
    if (!graveyard) {
      return;
    }
    var spookySrc = graveyard.dataset.spookySound;
    if (!spookySrc) {
      return;
    }
    graveyardAudio = new Audio(spookySrc);
    graveyardAudio.preload = "auto";
    graveyardAudio.loop = false;
    graveyardAudio.volume = 0.55;

    var starter = function () {
      if (graveyardPrimed) {
        return;
      }
      graveyardPrimed = true;
      queueGraveyardTone();
    };

    document.addEventListener("pointermove", starter, { once: true });
    document.addEventListener("scroll", starter, { once: true });
  }

  function queueGraveyardTone() {
    clearTimeout(graveyardTimer);
    if (!graveyardAudio || document.hidden) {
      return;
    }
    var delay = randomBetween(5200, 11800);
    graveyardTimer = window.setTimeout(function () {
      graveyardAudio.currentTime = 0;
      graveyardAudio.play().catch(function () {});
      queueGraveyardTone();
    }, delay);
  }

  function installRecordsMetronome() {
    var section = document.querySelector('[data-nav-section="records"]');
    if (!section || section.querySelector(".records-metronome")) {
      return;
    }
    var toggle = section.querySelector(".site-nav__section-toggle");
    if (!toggle) {
      return;
    }

    metronomeToggle = document.createElement("button");
    metronomeToggle.type = "button";
    metronomeToggle.className = "records-metronome";
    metronomeToggle.setAttribute(
      "aria-label",
      "Toggle the hidden Records metronome"
    );
    metronomeToggle.title = "Records metronome";
    metronomeToggle.textContent = "⏱";

    toggle.insertAdjacentElement("afterend", metronomeToggle);
    metronomeToggle.addEventListener("click", toggleMetronome);
    metronomeToggle.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMetronome();
      }
    });
  }

  function toggleMetronome() {
    if (zeroDecibelMode) {
      stopMetronome();
      return;
    }
    if (!metronomeToggle) {
      return;
    }
    if (metronomeInterval) {
      stopMetronome();
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      return;
    }
    resumeContext(ctx)
      .then(function (runningCtx) {
        startMetronome(runningCtx);
      })
      .catch(stopMetronome);
  }

  function startMetronome(ctx) {
    var beat = 0;
    metronomeToggle.classList.add("records-metronome--on");
    metronomeInterval = window.setInterval(function () {
      var accent = beat % 4 === 0;
      playMetronomeTick(ctx, accent);
      beat += 1;
    }, 640);
  }

  function stopMetronome() {
    clearInterval(metronomeInterval);
    metronomeInterval = null;
    if (metronomeToggle) {
      metronomeToggle.classList.remove("records-metronome--on");
    }
  }

  function playMetronomeTick(ctx, accent) {
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(accent ? 1240 : 880, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.25 : 0.14, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimeout(graveyardTimer);
      if (graveyardAudio) {
        graveyardAudio.pause();
      }
      if (metronomeInterval) {
        stopMetronome();
      }
      return;
    }
    if (graveyardPrimed && !zeroDecibelMode) {
      queueGraveyardTone();
    }
  }

  function handleZeroDecibelChange(event) {
    zeroDecibelMode = !!(event && event.detail && event.detail.enabled);
    if (zeroDecibelMode) {
      disableSqueaks();
      stopMetronome();
      clearTimeout(graveyardTimer);
      if (graveyardAudio) {
        graveyardAudio.pause();
      }
    } else {
      bindGlobalSqueaks();
      installRecordsMetronome();
      if (graveyardPrimed) {
        queueGraveyardTone();
      }
    }
  }

  function isZeroDecibelEnabled() {
    var body = document.body;
    return body && body.dataset.zeroDecibel === "true";
  }

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }
})();
