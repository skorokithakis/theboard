(function () {
  "use strict";

  var STORAGE_KEY = "theboard:jumpscare-fired";
  var overlay = null;
  var audioCtx = null;
  var reduceMotion = false;
  var zeroDecibelMode = false;
  var audioPlayed = false;
  var dismissed = false;

  ready(initialize);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initialize() {
    if (!document.body) {
      return;
    }
    zeroDecibelMode = isZeroDecibelEnabled();
    reduceMotion = prefersReducedMotion();
    if (sessionAlreadyScared()) {
      return;
    }
    buildOverlay();
    document.addEventListener("zero-decibel:change", handleZeroDecibelChange);
    window.setTimeout(reveal, 220);
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

  function buildOverlay() {
    overlay = document.createElement("div");
    overlay.className = "jumpscare";
    overlay.setAttribute("hidden", "hidden");
    overlay.innerHTML =
      '<div class="jumpscare__static" aria-hidden="true"></div>' +
      '<div class="jumpscare__inner" role="dialog" aria-modal="true" aria-labelledby="jumpscare-headline" aria-describedby="jumpscare-message">' +
      '<p class="jumpscare__eyebrow">Intrusion detected</p>' +
      '<h2 class="jumpscare__headline" id="jumpscare-headline">The Board sees you</h2>' +
      '<p class="jumpscare__message" id="jumpscare-message">It was already awake. So are you.</p>' +
      '<div class="jumpscare__actions">' +
      '<button type="button" class="button jumpscare__dismiss" data-jumpscare-dismiss>Steady my nerves</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(overlay);
    overlay.addEventListener("click", handleOverlayInteraction);
    overlay.addEventListener("pointerdown", handleOverlayInteraction, {
      passive: true,
    });
    var dismissButton = overlay.querySelector("[data-jumpscare-dismiss]");
    if (dismissButton) {
      dismissButton.addEventListener("click", dismiss);
    }
  }

  function reveal() {
    if (!overlay || dismissed) {
      return;
    }
    overlay.hidden = false;
    document.body.classList.add("jumpscare-active");
    window.requestAnimationFrame(function () {
      overlay.classList.add("is-visible");
      if (!reduceMotion) {
        overlay.classList.add("is-rattling");
      }
      focusDismiss();
      fireAudio();
    });
    window.setTimeout(dismiss, 2200);
  }

  function handleOverlayInteraction() {
    fireAudio();
    window.setTimeout(dismiss, 280);
  }

  function focusDismiss() {
    var button = overlay.querySelector("[data-jumpscare-dismiss]");
    if (!button) {
      return;
    }
    try {
      button.focus({ preventScroll: true });
    } catch (err) {}
  }

  function fireAudio() {
    if (audioPlayed || zeroDecibelMode) {
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      audioPlayed = true;
      return;
    }
    resumeContext(ctx)
      .then(function (running) {
        audioPlayed = true;
        playJumpscareTone(running);
      })
      .catch(function () {
        audioPlayed = true;
      });
  }

  function dismiss() {
    if (!overlay || dismissed) {
      return;
    }
    dismissed = true;
    markSession();
    overlay.classList.add("is-dismissed");
    document.body.classList.remove("jumpscare-active");
    window.setTimeout(function () {
      if (overlay && overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
    }, 360);
  }

  function playJumpscareTone(ctx) {
    var now = ctx.currentTime;
    var master = ctx.createGain();
    master.gain.setValueAtTime(0, now);
    master.gain.linearRampToValueAtTime(0.85, now + 0.04);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);

    var scream = ctx.createOscillator();
    scream.type = "sawtooth";
    scream.frequency.setValueAtTime(820, now);
    scream.frequency.exponentialRampToValueAtTime(140, now + 0.6);
    var screamGain = ctx.createGain();
    screamGain.gain.setValueAtTime(0.001, now);
    screamGain.gain.exponentialRampToValueAtTime(0.7, now + 0.12);
    screamGain.gain.exponentialRampToValueAtTime(0.002, now + 0.9);
    scream.connect(screamGain);

    var noise = ctx.createBufferSource();
    var duration = 1.2;
    var noiseBuffer = ctx.createBuffer(
      1,
      Math.ceil(ctx.sampleRate * duration),
      ctx.sampleRate
    );
    var data = noiseBuffer.getChannelData(0);
    for (var i = 0; i < data.length; i++) {
      var t = i / data.length;
      var envelope = Math.max(0, 1 - t * 1.1);
      data[i] = (Math.random() * 2 - 1) * envelope;
    }
    noise.buffer = noiseBuffer;
    var noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.55, now + 0.05);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    var noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 860;
    noiseFilter.Q.value = 3.6;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);

    var thump = ctx.createOscillator();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(90, now);
    thump.frequency.exponentialRampToValueAtTime(36, now + 0.42);
    var thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.001, now);
    thumpGain.gain.linearRampToValueAtTime(0.6, now + 0.02);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    thump.connect(thumpGain);

    screamGain.connect(master);
    noiseGain.connect(master);
    thumpGain.connect(master);
    master.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
    scream.start(now);
    scream.stop(now + 1.05);
    thump.start(now);
    thump.stop(now + 0.7);
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
    if (!ctx || typeof ctx.resume !== "function") {
      return Promise.resolve(ctx);
    }
    if (ctx.state === "running") {
      return Promise.resolve(ctx);
    }
    return ctx.resume();
  }

  function handleZeroDecibelChange(event) {
    zeroDecibelMode = !!(event && event.detail && event.detail.enabled);
  }

  function isZeroDecibelEnabled() {
    var body = document.body;
    return body && body.dataset.zeroDecibel === "true";
  }

  function sessionAlreadyScared() {
    try {
      return window.sessionStorage.getItem(STORAGE_KEY) === "true";
    } catch (err) {
      return false;
    }
  }

  function markSession() {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, "true");
    } catch (err) {}
  }
})();
