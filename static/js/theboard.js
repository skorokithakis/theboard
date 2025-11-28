(function () {
  "use strict";

  var FLAG = "__the_board_widget__";
  if (window[FLAG]) {
    return;
  }
  window[FLAG] = true;

  // Initialize Turnstile queue and callback
  window._turnstileInitQueue = window._turnstileInitQueue || [];
  window.onTurnstileLoad = function () {
    while (window._turnstileInitQueue.length) {
      var cb = window._turnstileInitQueue.shift();
      try {
        cb();
      } catch (err) {
        console.error(err);
      }
    }
  };

  var API_BASE = "/api";
  var ENDPOINTS = {
    features: API_BASE + "/features",
    createFeature: API_BASE + "/features/create",
    vote: function (id) {
      return API_BASE + "/features/" + id + "/vote";
    },
    deleteFeature: function (id) {
      return API_BASE + "/features/" + id + "/delete";
    },
    featureDetail: function (id) {
      return API_BASE + "/features/" + id;
    },
    login: API_BASE + "/auth/login",
    logout: API_BASE + "/auth/logout",
    signup: API_BASE + "/auth/signup",
  };

  var STATE = {
    features: [],
    implementedFeatures: [],
    graveyardFeatures: [],
    user: null,
    canSubmit: false,
    loading: false,
    error: null,
    authView: "login",
    authError: null,
    showSubmitForm: false,
    submitError: null,
    submitDefaults: null,
    nextIterationAt: null,
  };

  var VOTE_IN_FLIGHT = new Set();
  var DELETE_IN_FLIGHT = new Set();
  var ELEMENTS = {};
  var countdownTimer = null;
  var countdownTimeFormatter = null;
  var lastCountdownTargetMs = null;
  var cachedLocalTimeLabel = "";
  var fetchPromise = null;
  var authModalOpen = false;
  var detailModalOpen = false;
  var detailFeatureId = null;
  var lastDetailTrigger = null;
  var implementedModalOpen = false;
  var lastImplementedTrigger = null;
  var graveyardModalOpen = false;
  var lastGraveyardTrigger = null;
  var DETAIL_VARIATIONS_CACHE = Object.create(null);
  var DETAIL_VARIATIONS_REQUESTS = Object.create(null);
  var SQUEAK_LISTENER_OPTIONS = { capture: true };
  var squeakState = {
    context: null,
    enabled: true,
    lastPlayedAt: 0,
  };
  var WINTER_MONTHS = { 0: true, 10: true, 11: true };
  var SNOWFLAKE_LAYER_CLASS = "snowfall-layer";
  var MELT_CLASS = "is-melting";

  ready(initialize);
  ready(initializeTurnstileAutoRender);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initialize() {
    injectCSS();
    createLauncher();
    createModal();
    createFeatureDetailModal();
    createImplementedFeaturesModal();
    createGraveyardModal();
    createAuthModal();
    initializeSnowfall();
    initializeMeltEffect();
    ELEMENTS.heroCountdown = document.getElementById("next-iteration-countdown");
    if (
      ELEMENTS.heroCountdown &&
      ELEMENTS.heroCountdown.dataset &&
      ELEMENTS.heroCountdown.dataset.nextIteration
    ) {
      var initialTarget = parseNextIterationDate(
        ELEMENTS.heroCountdown.dataset.nextIteration
      );
      if (initialTarget) {
        STATE.nextIterationAt = initialTarget;
      }
    }
    attachGlobalShortcuts();
    initializeSqueakyCursor();
    updateCountdownDisplay();
    ensureCountdownTimer();
    renderHeaderUser();
    renderAuth();
    renderSubmitPanel();
    renderControlsActions();
    renderStatus();
    renderFeatures();
    renderGraveyardFeatures();
  }

  function initializeTurnstileAutoRender() {
    function withTurnstile(callback) {
      if (window.turnstile && typeof window.turnstile.render === "function") {
        callback();
      } else {
        window._turnstileInitQueue = window._turnstileInitQueue || [];
        window._turnstileInitQueue.push(callback);
      }
    }

    function renderWidgets(scope) {
      if (!(window.turnstile && typeof window.turnstile.render === "function")) {
        return;
      }
      var root = scope || document;
      root.querySelectorAll(".cf-turnstile").forEach(function (el) {
        if (el.dataset.turnstileWidgetId) {
          return;
        }
        var options = {};
        if (el.dataset.sitekey) {
          options.sitekey = el.dataset.sitekey;
        }
        if (el.dataset.action) {
          options.action = el.dataset.action;
        }
        if (el.dataset.theme) {
          options.theme = el.dataset.theme;
        }
        var widgetId = window.turnstile.render(el, options);
        el.dataset.turnstileWidgetId = widgetId;
      });
    }

    function queueRender(scope) {
      withTurnstile(function () {
        renderWidgets(scope);
      });
    }

    queueRender(document);
  }

  function initializeSnowfall() {
    if (!WINTER_MONTHS[new Date().getMonth()]) {
      return;
    }
    if (!document.body || document.querySelector("." + SNOWFLAKE_LAYER_CLASS)) {
      return;
    }
    var flakeCount = determineSnowflakeCount();
    var snowLayer = document.createElement("div");
    snowLayer.className = SNOWFLAKE_LAYER_CLASS;
    var usedSlots = {};
    for (var i = 0; i < flakeCount; i += 1) {
      snowLayer.appendChild(createSnowflakeElement(i, usedSlots));
    }
    if (document.body.firstChild) {
      document.body.insertBefore(snowLayer, document.body.firstChild);
    } else {
      document.body.appendChild(snowLayer);
    }
  }

  function initializeMeltEffect() {
    if (!document.body) {
      return;
    }
    var observer = new MutationObserver(handleMeltMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    document.querySelectorAll("div").forEach(applyMeltEffect);
  }

  function handleMeltMutations(mutations) {
    for (var i = 0; i < mutations.length; i += 1) {
      var mutation = mutations[i];
      if (!mutation.addedNodes || !mutation.addedNodes.length) {
        continue;
      }
      mutation.addedNodes.forEach(function (node) {
        applyMeltEffect(node);
        if (node.querySelectorAll) {
          node.querySelectorAll("div").forEach(applyMeltEffect);
        }
      });
    }
  }

  function applyMeltEffect(node) {
    if (!node || node.nodeType !== 1 || node.tagName !== "DIV") {
      return;
    }
    if (node.classList.contains(MELT_CLASS)) {
      return;
    }
    node.classList.add(MELT_CLASS);
    var delay = Math.random() * 4.5;
    var duration = 13 + Math.random() * 9;
    var distance = 4 + Math.random() * 10;
    node.style.setProperty("--melt-delay", delay.toFixed(2) + "s");
    node.style.setProperty("--melt-duration", duration.toFixed(2) + "s");
    node.style.setProperty("--melt-distance", distance.toFixed(1) + "px");
  }

  function determineSnowflakeCount() {
    var perWidth = Math.round(window.innerWidth / 22);
    return Math.max(32, Math.min(90, perWidth));
  }

  function createSnowflakeElement(index, usedSlots) {
    // Randomize every attribute so each snowflake feels unique.
    var flake = document.createElement("span");
    flake.className = "snowflake";
    var horizontalSlot = pickSnowflakeHorizontalSlot(usedSlots);
    flake.style.left = horizontalSlot + "%";
    var scale = randomBetween(0.55, 1.4);
    var blur = randomBetween(0, 2.4);
    var opacity = randomBetween(0.35, 0.95);
    var duration = randomBetween(12, 26);
    var delay = randomBetween(-26, 4);
    var drift = randomBetween(-60, 60);
    var rotationStart = randomBetween(0, 360);
    var rotationEnd = rotationStart + randomBetween(180, 720);
    flake.style.setProperty("--snow-scale", scale.toFixed(2));
    flake.style.setProperty("--snow-blur", blur.toFixed(2) + "px");
    flake.style.setProperty("--snow-opacity", opacity.toFixed(2));
    flake.style.setProperty("--snow-duration", duration.toFixed(2) + "s");
    flake.style.setProperty("--snow-delay", delay.toFixed(2) + "s");
    flake.style.setProperty("--snow-drift", drift.toFixed(2) + "px");
    flake.style.setProperty("--snow-rotation-start", rotationStart.toFixed(2) + "deg");
    flake.style.setProperty("--snow-rotation-end", rotationEnd.toFixed(2) + "deg");
    flake.dataset.snowflakeId =
      "flake-" + index + "-" + horizontalSlot + "-" + rotationStart.toFixed(2);
    return flake;
  }

  function pickSnowflakeHorizontalSlot(cache) {
    var slot = Math.round(randomBetween(0, 1000)) / 10;
    var key = slot.toFixed(1);
    var guard = 0;
    while (cache[key] && guard < 8) {
      slot = Math.round(randomBetween(0, 1000)) / 10;
      key = slot.toFixed(1);
      guard += 1;
    }
    cache[key] = true;
    return slot;
  }

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  function initializeSqueakyCursor() {
    if (!(window.AudioContext || window.webkitAudioContext)) {
      squeakState.enabled = false;
      return;
    }
    document.addEventListener(
      "pointerdown",
      handleSqueakPointerDown,
      SQUEAK_LISTENER_OPTIONS
    );
  }

  function ensureSqueakContext() {
    if (!squeakState.enabled) {
      return null;
    }
    if (!squeakState.context) {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      try {
        squeakState.context = new AudioCtor();
      } catch (err) {
        squeakState.enabled = false;
        return null;
      }
    }
    return squeakState.context;
  }

  function resumeSqueakContext(ctx) {
    if (!ctx || typeof ctx.resume !== "function") {
      return Promise.resolve();
    }
    if (ctx.state === "running") {
      return Promise.resolve();
    }
    try {
      return ctx.resume();
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function handleSqueakPointerDown(event) {
    if (typeof event.isPrimary === "boolean" && !event.isPrimary) {
      return;
    }
    var ctx = ensureSqueakContext();
    if (!ctx) {
      disableSqueakyCursor();
      return;
    }
    resumeSqueakContext(ctx)
      .then(function () {
        var now = ctx.currentTime;
        if (
          squeakState.lastPlayedAt &&
          now - squeakState.lastPlayedAt < 0.08
        ) {
          return;
        }
        squeakState.lastPlayedAt = now;
        try {
          playSqueak(ctx, now);
        } catch (err) {
          disableSqueakyCursor();
        }
      })
      .catch(disableSqueakyCursor);
  }

  function playSqueak(ctx, when) {
    var duration = 0.2;
    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter =
      typeof ctx.createBiquadFilter === "function"
        ? ctx.createBiquadFilter()
        : null;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(1400, when);
    oscillator.frequency.exponentialRampToValueAtTime(700, when + duration);
    if (oscillator.detune && typeof oscillator.detune.setValueAtTime === "function") {
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 120, when);
    }

    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(0.18, when + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, when + duration);

    oscillator.connect(gain);
    if (filter) {
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1000, when);
      filter.Q.value = 6;
      gain.connect(filter);
      filter.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }

    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  function disableSqueakyCursor() {
    squeakState.enabled = false;
    document.removeEventListener(
      "pointerdown",
      handleSqueakPointerDown,
      SQUEAK_LISTENER_OPTIONS
    );
    if (squeakState.context) {
      try {
        squeakState.context.close();
      } catch (err) {
        // Ignore context close errors
      }
    }
    squeakState.context = null;
    squeakState.lastPlayedAt = 0;
  }

  function injectCSS() {
    if (document.getElementById("the-board-widget-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "the-board-widget-style";
    var css = [
      ".tb-launcher { position: fixed; top: 50%; right: -2.5rem; transform: translateY(-50%) rotate(-90deg); display: inline-flex; align-items: center; gap: 0.6rem; padding: 0.65rem 1.2rem; border-radius: 999px; font-size: 0.95rem; font-weight: 600; color: #0b161b; background: linear-gradient(135deg, #f3c969, #dba53c); border: none; box-shadow: 0 12px 28px rgba(243, 201, 105, 0.35); cursor: pointer; z-index: 2147483640; transition: all 0.2s ease; font-family: inherit; }",
      ".tb-launcher-dot { width: 1.65rem; height: 1.65rem; border-radius: 999px; background: rgba(43, 179, 175, 0.25); display: inline-flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 2px rgba(43, 179, 175, 0.4); position: relative; }",
      ".tb-launcher-dot::after { content: \"\"; width: 0.65rem; height: 0.65rem; border-radius: 50%; background: #2bb3af; opacity: 0.9; }",
      ".tb-launcher-label { letter-spacing: -0.02em; }",
      ".tb-launcher:hover { transform: translateY(-50%) translateX(-2px) rotate(-90deg); box-shadow: 0 20px 50px rgba(243, 201, 105, 0.45); }",
      ".tb-launcher:active { transform: translateY(-50%) rotate(-90deg); box-shadow: 0 10px 25px rgba(243, 201, 105, 0.3); }",
      ".tb-launcher:focus-visible { outline: 3px solid rgba(243, 201, 105, 0.4); outline-offset: 4px; }",
      ".tb-launcher-hidden { opacity: 0; pointer-events: none; }",
      "body.tb-modal-open { overflow: hidden; }",
      ".tb-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2147483630; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-modal { position: relative; width: min(900px, 95vw); max-height: 85vh; background: #0f2731; color: #fdf7e3; border-radius: 20px; border: 1px solid rgba(243, 201, 105, 0.32); box-shadow: 0 24px 48px -24px rgba(0, 0, 0, 0.75); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-auth-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2147483635; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-auth-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-auth-modal { position: relative; width: min(480px, 95vw); background: #0f2731; color: #fdf7e3; border-radius: 20px; border: 1px solid rgba(243, 201, 105, 0.32); box-shadow: 0 24px 48px -24px rgba(0, 0, 0, 0.75); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-detail-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(5, 17, 24, 0.78); backdrop-filter: blur(4px); z-index: 2147483636; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-detail-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-detail-modal { position: relative; width: min(720px, 95vw); max-height: 85vh; background: #0f2731; color: #fdf7e3; border-radius: 20px; border: 1px solid rgba(243, 201, 105, 0.32); box-shadow: 0 24px 48px -24px rgba(0, 0, 0, 0.75); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-implemented-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(5, 17, 24, 0.78); backdrop-filter: blur(4px); z-index: 2147483635; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-implemented-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-implemented-modal { position: relative; width: min(840px, 95vw); max-height: 85vh; background: #0f2731; color: #fdf7e3; border-radius: 20px; border: 1px solid rgba(243, 201, 105, 0.32); box-shadow: 0 24px 48px -24px rgba(0, 0, 0, 0.75); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-implemented-body { flex: 1; overflow-y: auto; padding: 0; background: #0d1f29; color: #fdf7e3; min-height: 0; }",
      ".tb-implemented-body::-webkit-scrollbar { width: 8px; }",
      ".tb-implemented-body::-webkit-scrollbar-thumb { background: #143b47; border-radius: 4px; }",
      ".tb-graveyard-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(6, 0, 21, 0.82); backdrop-filter: blur(8px); z-index: 2147483634; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.3s ease; }",
      ".tb-graveyard-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-graveyard-modal { position: relative; width: min(860px, 95vw); max-height: 85vh; background: radial-gradient(circle at top, rgba(58, 35, 84, 0.75), rgba(12, 16, 29, 0.95) 60%); border-radius: 24px; border: 1px solid rgba(147, 112, 219, 0.45); box-shadow: 0 32px 60px -40px rgba(0, 0, 0, 0.9); color: #f8eaff; overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-graveyard-header { background: linear-gradient(180deg, rgba(36, 17, 52, 0.92), rgba(18, 11, 32, 0.92)); border-bottom-color: rgba(147, 112, 219, 0.35); }",
      ".tb-graveyard-body { position: relative; display: flex; flex-direction: column; gap: 1.5rem; padding: 1.75rem 2rem 2rem; background: rgba(12, 16, 29, 0.92); }",
      ".tb-graveyard-scenery { position: relative; height: 160px; border-radius: 18px; background: linear-gradient(180deg, rgba(41, 19, 60, 0.85), rgba(8, 11, 24, 0.95)); overflow: hidden; border: 1px solid rgba(147, 112, 219, 0.25); box-shadow: inset 0 0 32px rgba(0, 0, 0, 0.35); }",
      ".tb-graveyard-moon { position: absolute; top: 18px; right: 28px; width: 84px; height: 84px; border-radius: 50%; background: radial-gradient(circle at 30% 30%, #ffe6b3, #d69e2e 55%, rgba(0, 0, 0, 0) 72%); box-shadow: 0 0 22px rgba(255, 230, 179, 0.4); }",
      ".tb-graveyard-hill { position: absolute; left: -40px; right: -40px; bottom: -20px; height: 120px; background: radial-gradient(circle at 50% 0, rgba(31, 41, 55, 0.8), rgba(15, 23, 42, 0.96)); border-top-left-radius: 50% 100%; border-top-right-radius: 50% 100%; }",
      ".tb-graveyard-ghost { position: absolute; width: 72px; height: 90px; border-radius: 36px 36px 28px 28px; background: rgba(255, 255, 255, 0.88); box-shadow: 0 18px 24px -12px rgba(255, 255, 255, 0.45); animation: tb-ghost-float 4s ease-in-out infinite; }",
      ".tb-graveyard-ghost::before { content: \"\"; position: absolute; top: 26px; left: 18px; width: 14px; height: 14px; border-radius: 50%; background: rgba(30, 41, 59, 0.9); box-shadow: 22px 0 0 rgba(30, 41, 59, 0.9); }",
      ".tb-graveyard-ghost::after { content: \"\"; position: absolute; left: 50%; bottom: -16px; transform: translateX(-50%); width: 56px; height: 26px; border-radius: 50%; background: rgba(255, 255, 255, 0.85); box-shadow: 0 -8px 0 rgba(12, 16, 29, 0.92); }",
      ".tb-graveyard-ghost-left { left: 18%; top: 38px; animation-delay: 0s; }",
      ".tb-graveyard-ghost-right { left: 48%; top: 26px; animation-delay: 1.5s; }",
      ".tb-graveyard-shadows { position: absolute; bottom: 16px; left: 20%; width: 60%; height: 12px; background: radial-gradient(circle, rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0)); filter: blur(6px); opacity: 0.65; }",
      ".tb-graveyard-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; max-height: 42vh; overflow-y: auto; padding: 0.5rem 0.25rem 0.5rem 0; }",
      ".tb-graveyard-list::-webkit-scrollbar { width: 8px; }",
      ".tb-graveyard-list::-webkit-scrollbar-thumb { background: rgba(147, 112, 219, 0.45); border-radius: 999px; }",
      ".tb-graveyard-status { padding: 1.5rem; text-align: center; border-radius: 14px; font-weight: 600; }",
      ".tb-graveyard-status-loading { background: rgba(39, 21, 57, 0.85); color: #d6bbff; }",
      ".tb-graveyard-status-error { background: rgba(75, 0, 70, 0.82); color: #fbcfe8; }",
      ".tb-graveyard-status-empty { background: rgba(24, 18, 41, 0.85); color: rgba(216, 191, 255, 0.82); }",
      ".tb-graveyard-card { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 0.65rem; padding: 1.35rem 1rem 1.1rem; border-radius: 18px; background: radial-gradient(circle at 50% -40%, rgba(196, 181, 253, 0.14), transparent 55%), linear-gradient(180deg, rgba(29, 19, 45, 0.95), rgba(11, 12, 26, 0.95)); border: 1px solid rgba(147, 112, 219, 0.45); box-shadow: 0 18px 28px -30px rgba(0, 0, 0, 0.9); color: #f5f3ff; cursor: pointer; text-align: center; transition: transform 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease; }",
      ".tb-graveyard-card::before { content: \"\"; position: absolute; top: -18px; left: 12%; right: 12%; height: 28px; border-radius: 16px 16px 4px 4px; background: radial-gradient(circle at 50% 10%, rgba(196, 181, 253, 0.28), rgba(17, 17, 40, 0.95)); border: 1px solid rgba(147, 112, 219, 0.35); box-shadow: 0 12px 28px -16px rgba(0, 0, 0, 0.8); }",
      ".tb-graveyard-card:hover { transform: translateY(-3px); border-color: rgba(244, 114, 182, 0.6); box-shadow: 0 22px 46px -28px rgba(0, 0, 0, 0.95); }",
      ".tb-graveyard-card:focus-visible { outline: 2px solid rgba(244, 114, 182, 0.7); outline-offset: 3px; }",
      ".tb-graveyard-emblem { font-size: 1.6rem; line-height: 1; color: #c4b5fd; filter: drop-shadow(0 6px 14px rgba(147, 112, 219, 0.45)); }",
      ".tb-graveyard-content { position: relative; z-index: 1; display: flex; flex-direction: column; align-items: center; gap: 0.35rem; padding-top: 0.25rem; }",
      ".tb-graveyard-title { margin: 0.25rem 0 0; font-size: 1rem; letter-spacing: 0.08em; text-transform: uppercase; color: #f5f3ff; }",
      ".tb-graveyard-meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.35rem; font-size: 0.85rem; color: rgba(216, 191, 255, 0.8); }",
      ".tb-graveyard-dot { color: rgba(216, 191, 255, 0.35); }",
      ".tb-graveyard-author { font-style: italic; }",
      ".tb-graveyard-expired { color: #f9a8d4; font-weight: 600; }",
      ".tb-graveyard-votes { color: #c4b5fd; font-weight: 600; }",
      ".tb-graveyard-epitaph { display: none; }",
      ".tb-graveyard-title-button { display: none; }",
      ".tb-graveyard-actions { display: none; }",
      ".tb-graveyard-detail-button { display: none; }",
      ".tb-detail-body { flex: 1; overflow-y: auto; padding: 1.5rem 2rem 2rem; background: #0d1f29; color: #fdf7e3; min-height: 0; }",
      ".tb-detail-body::-webkit-scrollbar { width: 8px; }",
      ".tb-detail-body::-webkit-scrollbar-thumb { background: #143b47; border-radius: 4px; }",
      ".tb-detail-content { display: flex; flex-direction: column; gap: 1.25rem; }",
      ".tb-detail-feature-title { font-size: 1.5rem; font-weight: 600; color: #f8fafc; margin: 0; }",
      ".tb-detail-meta { font-size: 0.95rem; color: #d8cbb3; }",
      ".tb-detail-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 2rem; border-top: 1px solid rgba(243, 201, 105, 0.28); background: rgba(12, 32, 41, 0.95); }",
      ".tb-detail-actions { display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.9rem; }",
      ".tb-detail-actions .tb-meta-dot { color: #d8cbb3; }",
      ".tb-detail-variations { display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(148, 163, 184, 0.3); }",
      ".tb-detail-variations.tb-detail-variations-visible { display: block; }",
      ".tb-detail-subtitle { margin: 0 0 0.5rem; font-size: 0.95rem; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; font-weight: 600; }",
      ".tb-variation-header { display: flex; align-items: baseline; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.5rem; }",
      ".tb-variation-count { font-size: 0.85rem; color: #cbd5f5; }",
      ".tb-variation-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }",
      ".tb-variation-item { margin: 0; }",
      ".tb-variation-link { border: none; background: rgba(59, 130, 246, 0.08); color: #bfdbfe; border-radius: 999px; padding: 0.35rem 0.95rem; font-size: 0.92rem; font-weight: 500; cursor: pointer; text-align: left; transition: background 0.2s ease, color 0.2s ease; }",
      ".tb-variation-link:hover { background: rgba(59, 130, 246, 0.18); color: #e0f2fe; }",
      ".tb-variation-link:focus-visible { outline: 2px solid rgba(59, 130, 246, 0.9); outline-offset: 2px; }",
      ".tb-variation-status { font-size: 0.9rem; color: #94a3b8; }",
      ".tb-variation-status-error { color: #fecaca; }",
      ".tb-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.5rem 2rem; border-bottom: 2px solid rgba(243, 201, 105, 0.28); flex-shrink: 0; background: rgba(14, 38, 48, 0.95); color: #fdf7e3; }",
      ".tb-brand { display: flex; flex-direction: column; gap: 0.4rem; }",
      ".tb-logo { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; background: linear-gradient(135deg, #f3c969, #dba53c); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }",
      ".tb-subtitle { font-size: 0.875rem; color: #d8cbb3; }",
      ".tb-header-user { display: inline-flex; align-items: center; gap: 1rem; font-size: 0.875rem; color: #d8cbb3; }",
      ".tb-link { background: none; border: none; padding: 0; font-size: 0.875rem; font-weight: 500; color: #2bb3af; cursor: pointer; text-decoration: none; transition: color 0.2s ease; }",
      ".tb-link:hover { color: #7fe0d8; }",
      ".tb-close { width: 2rem; height: 2rem; border-radius: 50%; border: none; background: transparent; color: #d8cbb3; font-size: 1.5rem; line-height: 1; cursor: pointer; transition: all 0.2s ease; }",
      ".tb-close:hover { background: #153946; color: #fdf7e3; }",
      ".tb-body { display: flex; flex-direction: column; flex: 1; overflow: auto; background: #0d1f29; color: #fdf7e3; min-height: 0; }",
      ".tb-body::-webkit-scrollbar { width: 8px; }",
      ".tb-body::-webkit-scrollbar-thumb { background: #143b47; border-radius: 4px; }",
      ".tb-auth-panel { flex: 0 0 auto; padding: 1.5rem 2rem; border-bottom: 1px solid rgba(243, 201, 105, 0.28); background: rgba(14, 38, 48, 0.95); color: #fdf7e3; }",
      ".tb-submit-panel { flex: 0 0 auto; padding: 1.5rem 2rem; border-bottom: 1px solid rgba(243, 201, 105, 0.28); background: rgba(14, 38, 48, 0.95); color: #fdf7e3; }",
      ".tb-button-group { display: flex; gap: 0.75rem; }",
      ".tb-btn-secondary { border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; background: rgba(14, 49, 63, 0.7); color: #fdf7e3; border: 2px solid rgba(243, 201, 105, 0.26); cursor: pointer; transition: all 0.2s ease; min-height: 46px; font-family: inherit; }",
      ".tb-btn-secondary:hover { background: rgba(43, 179, 175, 0.24); border-color: rgba(43, 179, 175, 0.45); }",
      ".tb-btn-secondary[disabled] { opacity: 0.5; cursor: not-allowed; }",
      ".tb-btn-spooky { border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 600; background: linear-gradient(135deg, rgba(147, 112, 219, 0.85), rgba(59, 7, 100, 0.9)); color: #f8eaff; border: 2px solid rgba(147, 112, 219, 0.5); cursor: pointer; transition: transform 0.2s ease, box-shadow 0.2s ease, opacity 0.2s ease; min-height: 46px; font-family: inherit; letter-spacing: 0.05em; text-transform: uppercase; }",
      ".tb-btn-spooky:hover { transform: translateY(-1px); box-shadow: 0 12px 30px rgba(147, 112, 219, 0.35); }",
      ".tb-btn-spooky[disabled] { opacity: 0.55; cursor: not-allowed; background: linear-gradient(135deg, rgba(66, 45, 94, 0.9), rgba(32, 24, 54, 0.9)); border-color: rgba(147, 112, 219, 0.25); }",
      ".tb-main-panel { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }",
      ".tb-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 2rem; border-bottom: 1px solid rgba(243, 201, 105, 0.28); background: rgba(14, 38, 48, 0.95); color: #fdf7e3; }",
      ".tb-controls-info { display: flex; flex-direction: column; gap: 0.35rem; flex: 1 1 auto; min-width: 0; }",
      ".tb-next-run { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase; color: #f3c969; }",
      ".tb-status { font-size: 0.875rem; font-weight: 500; color: #f3c969; flex: 1 1 auto; }",
      ".tb-status-info { color: #2bb3af; }",
      ".tb-status-warning { color: #ea580c; }",
      ".tb-status-error { color: #dc2626; }",
      ".tb-status-muted { color: #d8cbb3; }",
      ".tb-refresh { width: 2rem; height: 2rem; border-radius: 50%; border: none; background: transparent; color: #d8cbb3; font-size: 1.125rem; line-height: 1; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center; }",
      ".tb-refresh:hover { background: rgba(43, 179, 175, 0.18); color: #7fe0d8; }",
      ".tb-btn-primary { border-radius: 8px; padding: 0.5rem 1.5rem; font-size: 0.875rem; font-weight: 500; background: #f3c969; color: #0b161b; border: 2px solid #dba53c; cursor: pointer; transition: all 0.2s ease; min-height: 36px; font-family: inherit; }",
      ".tb-btn-primary:hover { background: #ffe1a3; border-color: #f3c969; box-shadow: 0 1px 2px rgba(243, 201, 105, 0.4); }",
      ".tb-feature-list { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }",
      ".tb-feature { display: flex; gap: 1rem; padding: 1.5rem 2rem; background: rgba(14, 40, 52, 0.94); border-bottom: 1px solid rgba(243, 201, 105, 0.24); color: #fdf7e3; transition: all 0.2s ease; }",
      ".tb-feature:hover { background: rgba(17, 52, 66, 0.94); border-color: rgba(43, 179, 175, 0.4); box-shadow: 0 10px 22px rgba(0, 0, 0, 0.55); }",
      ".tb-feature-expiring { position: relative; background: rgba(64, 20, 36, 0.82); border-color: rgba(248, 113, 113, 0.45); box-shadow: 0 16px 32px -24px rgba(248, 113, 113, 0.35); }",
      ".tb-feature-expiring::before { content: \"\"; position: absolute; inset: 0; background: linear-gradient(135deg, rgba(248, 113, 113, 0.18), transparent 65%); pointer-events: none; }",
      ".tb-feature-expiring:hover { background: rgba(78, 23, 42, 0.85); border-color: rgba(248, 113, 113, 0.6); box-shadow: 0 20px 38px -24px rgba(248, 113, 113, 0.45); }",
      ".tb-feature-implemented-failed { background: rgba(58, 11, 18, 0.9); border-color: rgba(239, 68, 68, 0.65); box-shadow: 0 20px 40px -24px rgba(239, 68, 68, 0.55); }",
      ".tb-feature-implemented-failed:hover { background: rgba(74, 12, 22, 0.92); border-color: rgba(248, 113, 113, 0.8); box-shadow: 0 24px 48px -24px rgba(248, 113, 113, 0.65); }",
      ".tb-feature-implemented-failed .tb-feature-title { color: #ffe4e6; }",
      ".tb-feature:last-child { border-bottom: 0; }",
      ".tb-feature-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-feature-title { font-size: 1.125rem; font-weight: 600; color: #ffe6b3; line-height: 1.3; margin: 0; }",
      ".tb-feature-title-button { border: none; background: none; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; display: inline-flex; align-items: center; gap: 0.35rem; }",
      ".tb-feature-title-button:hover { text-decoration: underline; }",
      ".tb-feature-title-button:focus-visible { outline: 2px solid rgba(147, 197, 253, 0.65); outline-offset: 2px; border-radius: 6px; }",
      ".tb-feature-description { font-size: 1rem; color: #cbd5f5; line-height: 1.5; }",
      ".tb-feature-description-preview { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }",
      ".tb-feature-description p { margin: 0 0 0.75rem; }",
      ".tb-feature-description p:last-child { margin-bottom: 0; }",
      ".tb-feature-description ul, .tb-feature-description ol { margin: 0 0 0.75rem 1.25rem; padding: 0; }",
      ".tb-feature-description li { margin: 0.25rem 0; }",
      ".tb-feature-description blockquote { margin: 0 0 0.75rem; padding-left: 1rem; border-left: 3px solid rgba(96, 165, 250, 0.5); color: #bfdbfe; background: rgba(15, 23, 42, 0.6); }",
      ".tb-feature-description pre { margin: 0 0 0.75rem; padding: 0.75rem 1rem; background: #0b162b; border-radius: 12px; overflow: auto; font-size: 0.9em; color: #e2e8f0; box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18); }",
      ".tb-feature-description pre code { background: none; color: inherit; padding: 0; }",
      ".tb-feature-description h1, .tb-feature-description h2, .tb-feature-description h3, .tb-feature-description h4, .tb-feature-description h5, .tb-feature-description h6 { margin: 1.25rem 0 0.75rem; font-weight: 600; line-height: 1.2; color: #f8fafc; }",
      ".tb-feature-description h1 { font-size: 1.6rem; }",
      ".tb-feature-description h2 { font-size: 1.45rem; }",
      ".tb-feature-description h3 { font-size: 1.3rem; }",
      ".tb-feature-description h4 { font-size: 1.15rem; }",
      ".tb-feature-status { display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.75rem 1rem; border-radius: 12px; background: rgba(15, 39, 52, 0.82); border: 1px solid rgba(59, 130, 246, 0.28); color: #e2e8f0; }",
      ".tb-feature-status-label { font-size: 0.75rem; letter-spacing: 0.1em; text-transform: uppercase; color: #93c5fd; flex: 0 0 auto; padding-top: 0.1rem; }",
      ".tb-feature-status-text { flex: 1 1 auto; font-weight: 600; color: #f8fafc; word-break: break-word; }",
      ".tb-feature-status-empty .tb-feature-status-text { color: #cbd5f5; font-weight: 500; }",
      ".tb-feature-status-inline { margin-top: 0.25rem; }",
      ".tb-detail-profile { border: 1px solid rgba(59, 130, 246, 0.28); background: linear-gradient(135deg, rgba(14, 38, 48, 0.95), rgba(9, 28, 38, 0.95)); border-radius: 14px; padding: 1rem 1.1rem; display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-detail-profile-header { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; font-size: 0.95rem; color: #e2e8f0; }",
      ".tb-detail-profile-meta { display: inline-flex; align-items: baseline; gap: 0.5rem; }",
      ".tb-detail-profile-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; color: #93c5fd; }",
      ".tb-detail-profile-actions { display: inline-flex; gap: 0.75rem; align-items: center; }",
      ".tb-feature-description h5 { font-size: 1.05rem; }",
      ".tb-feature-description h6 { font-size: 0.95rem; color: #a5b4fc; }",
      ".tb-feature-description h1:first-child, .tb-feature-description h2:first-child, .tb-feature-description h3:first-child, .tb-feature-description h4:first-child, .tb-feature-description h5:first-child, .tb-feature-description h6:first-child { margin-top: 0; }",
      '.tb-feature-description code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.85em; background: rgba(96, 165, 250, 0.2); color: #dbeafe; padding: 0.1em 0.3em; border-radius: 6px; }',
      ".tb-feature-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: #94a3b8; }",
      ".tb-feature-meta span, .tb-feature-meta time { color: #94a3b8; }",
      ".tb-meta-implementation-state { text-transform: uppercase; font-size: 0.75rem; letter-spacing: 0.08em; font-weight: 600; }",
      ".tb-meta-implementation-failed { color: #fca5a5; }",
      ".tb-meta-implementation-success { color: #86efac; }",
      ".tb-meta-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 0.5rem; }",
      ".tb-feature-delete { border: none; background: transparent; color: #fca5a5; font-size: 0.875rem; font-weight: 500; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; transition: color 0.2s ease, background 0.2s ease; }",
      ".tb-feature-delete:hover { color: #fecaca; background: rgba(248, 113, 113, 0.18); }",
      ".tb-feature-delete[disabled] { opacity: 0.6; cursor: not-allowed; }",
      ".tb-feature-variation { border: none; background: transparent; color: #93c5fd; font-size: 0.875rem; font-weight: 500; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; transition: color 0.2s ease, background 0.2s ease; }",
      ".tb-feature-variation:hover { color: #e0f2fe; background: rgba(59, 130, 246, 0.18); }",
      ".tb-feature-variation[disabled] { opacity: 0.6; cursor: not-allowed; }",
      ".tb-meta-item { color: inherit; }",
      ".tb-meta-dot { color: #94a3b8; }",
      ".tb-meta-dot:first-child, .tb-meta-dot:last-child { display: none; }",
      ".tb-meta-expiration { color: #fca5a5; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }",
      ".tb-vote { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 56px; height: 56px; padding: 0.5rem 1rem; background: rgba(15, 23, 42, 0.35); border: 2px solid rgba(148, 163, 184, 0.35); border-radius: 8px; color: #cbd5f5; font-weight: 600; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease; }",
      ".tb-vote:hover { border-color: rgba(96, 165, 250, 0.65); background: #2563eb; color: #ffffff; transform: translateY(-2px); }",
      ".tb-vote[data-voted=\"true\"] { border-color: #16a34a; background: #16a34a; color: #ffffff; }",
      ".tb-vote[data-voted=\"true\"]:hover { border-color: #16a34a; background: #16a34a; }",
      ".tb-vote-arrow { font-size: 1.125rem; line-height: 1; }",
      ".tb-vote-count { font-size: 0.875rem; }",
      ".tb-vote.tb-vote-loading { pointer-events: none; position: relative; color: transparent; }",
      ".tb-vote.tb-vote-loading::after { content: \"\"; position: absolute; width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 2px solid rgba(43, 179, 175, 0.3); border-top-color: #2bb3af; animation: tb-spin 0.8s linear infinite; }",
      ".tb-vote.tb-vote-disabled { pointer-events: none; opacity: 0.6; }",
      ".tb-loading { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem 1rem; color: #fdf7e3; font-weight: 600; background: rgba(12, 32, 41, 0.95); }",
      ".tb-spinner { width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 2px solid rgba(43, 179, 175, 0.3); border-top-color: #2bb3af; animation: tb-spin 0.8s linear infinite; }",
      ".tb-empty { padding: 3rem 2rem; text-align: center; color: #94a3b8; background: rgba(14, 40, 52, 0.94); font-weight: 500; }",
      ".tb-auth-card { background: rgba(14, 40, 52, 0.94); border-radius: 12px; padding: 1.5rem; border: 1px solid rgba(243, 201, 105, 0.24); display: flex; flex-direction: column; gap: 1rem; color: #fdf7e3; }",
      ".tb-auth-card-compact { gap: 0.75rem; }",
      ".tb-auth-tabs { display: inline-flex; background: rgba(14, 49, 63, 0.7); border-radius: 999px; padding: 0.25rem; gap: 0.25rem; align-self: center; }",
      ".tb-tab { border: none; border-radius: 999px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; background: transparent; color: #d8cbb3; cursor: pointer; transition: all 0.2s ease; font-family: inherit; }",
      ".tb-tab:hover { color: #fdf7e3; }",
      ".tb-tab-active { background: rgba(243, 201, 105, 0.85); color: #0b161b; }",
      ".tb-submit-title { margin: 0; font-size: 1.125rem; font-weight: 600; color: #2bb3af; }",
      ".tb-helper { font-size: 0.875rem; color: #d8cbb3; }",
      ".tb-variation-notice { margin: 1rem 0 0; padding: 0.75rem 1rem; border-radius: 10px; background: rgba(37, 99, 235, 0.12); color: #bfdbfe; font-size: 0.875rem; font-weight: 500; border: 1px solid rgba(59, 130, 246, 0.35); }",
      ".tb-form { display: flex; flex-direction: column; gap: 1rem; }",
      ".tb-input-group { display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-label { font-size: 0.875rem; font-weight: 500; color: #fdf7e3; }",
      ".tb-input { border-radius: 8px; border: 2px solid rgba(243, 201, 105, 0.28); padding: 1rem; font-size: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #fdf7e3; background: rgba(11, 31, 38, 0.85); transition: all 0.2s ease; }",
      ".tb-input::placeholder { color: #d8cbb3; }",
      ".tb-input:focus { border-color: rgba(243, 201, 105, 0.55); outline: none; box-shadow: 0 0 0 3px rgba(243, 201, 105, 0.2); }",
      ".tb-textarea { border-radius: 8px; border: 2px solid rgba(243, 201, 105, 0.28); padding: 1rem; font-size: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #fdf7e3; background: rgba(11, 31, 38, 0.85); transition: all 0.2s ease; resize: vertical; min-height: 120px; }",
      ".tb-textarea::placeholder { color: #d8cbb3; }",
      ".tb-textarea:focus { border-color: rgba(243, 201, 105, 0.55); outline: none; box-shadow: 0 0 0 3px rgba(243, 201, 105, 0.2); }",
      ".tb-submit { border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; background: #2bb3af; color: #062027; border: 2px solid #2bb3af; cursor: pointer; transition: all 0.2s ease; min-height: 46px; font-family: inherit; }",
      ".tb-submit:hover { background: #7fe0d8; border-color: #7fe0d8; color: #062027; box-shadow: 0 2px 8px rgba(43, 179, 175, 0.35); }",
      ".tb-submit:disabled { opacity: 0.6; cursor: wait; transform: none; box-shadow: none; }",
      ".tb-form-note { font-size: 0.75rem; color: #d8cbb3; }",
      ".tb-form-error { font-size: 0.875rem; color: #ffd5dc; background: rgba(244, 91, 105, 0.18); padding: 0.75rem 1rem; border-radius: 8px; border: 1px solid rgba(244, 91, 105, 0.35); }",
      ".tb-user-card { display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-user-badge { display: flex; align-items: center; gap: 0.75rem; }",
      ".tb-user-avatar { width: 2.75rem; height: 2.75rem; border-radius: 14px; background: linear-gradient(135deg, #f3c969, #dba53c); color: #0c1f27; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; }",
      ".tb-user-name { font-size: 1rem; font-weight: 600; color: #f1f5f9; }",
      ".tb-user-handle { font-size: 0.875rem; color: #94a3b8; }",
      ".tb-user-actions { display: inline-flex; gap: 0.75rem; align-items: center; }",
      ".tb-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 2rem; border-top: 2px solid rgba(243, 201, 105, 0.28); flex-shrink: 0; background: rgba(14, 38, 48, 0.95); color: #fdf7e3; }",
      ".tb-footer-nav { display: flex; gap: 1rem; align-items: center; }",
      ".tb-footer-nav a { color: #94a3b8; font-size: 0.875rem; font-weight: 500; text-decoration: none; transition: color 0.2s ease; display: inline-flex; align-items: center; gap: 0.5rem; }",
      ".tb-footer-nav a:hover { color: #dbeafe; }",
      ".tb-footer-icon { width: 1.25rem; height: 1.25rem; fill: currentColor; }",
      ".tb-auth-section { display: flex; align-items: center; gap: 1rem; }",
      ".tb-footer-username { font-size: 0.875rem; color: #d8cbb3; }",
      ".tb-btn-text { background: transparent; color: #d8cbb3; border: none; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.2s ease; border-radius: 8px; }",
      ".tb-btn-text:hover { color: #fdf7e3; background: rgba(243, 201, 105, 0.18); }",
      ".tb-toast-stack { position: fixed; bottom: 2rem; right: 2rem; display: flex; flex-direction: column; gap: 1rem; z-index: 2147483647; pointer-events: none; }",
      ".tb-toast { min-width: 300px; background: #1a1a1a; color: #ffffff; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 14px 40px rgba(2, 10, 28, 0.55); font-weight: 500; font-size: 0.875rem; opacity: 0; transform: translateY(20px); transition: all 0.2s; pointer-events: auto; animation: tb-toast-in 0.2s forwards; }",
      ".tb-toast-success { background: #16a34a; }",
      ".tb-toast-warn { background: #ea580c; }",
      ".tb-toast-error { background: #dc2626; }",
      "@keyframes tb-toast-in { to { opacity: 1; transform: translateY(0); } }",
      "@keyframes tb-toast-out { to { opacity: 0; transform: translateY(-8px); } }",
      "@keyframes tb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }",
      "@keyframes tb-ghost-float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-12px); } }",
      "@media (max-width: 900px) { .tb-header { padding: 1.25rem 1.5rem; } .tb-body { padding: 0; } .tb-auth-panel { padding: 1.5rem; } .tb-controls { padding: 1rem 1.5rem; } .tb-feature { padding: 1.5rem; } .tb-footer { padding: 1rem 1.5rem; flex-direction: column; gap: 0.5rem; } .tb-close { width: 2rem; height: 2rem; font-size: 1.25rem; } }",
      "@media (max-width: 700px) { .tb-modal { border-radius: 0; max-height: 85vh; width: 100vw; } .tb-implemented-overlay, .tb-detail-overlay, .tb-graveyard-overlay { padding: 0.5rem; } .tb-implemented-modal, .tb-detail-modal, .tb-graveyard-modal { max-height: 80vh; } .tb-feature { flex-direction: column; } .tb-vote { width: fit-content; flex-direction: row; height: auto; padding: 0.5rem 1rem; } }",
    ];
    style.textContent = css.join("\n");
    document.head.appendChild(style);
  }

  function createLauncher() {
    if (!document.body || ELEMENTS.launcher) {
      return;
    }

    var launcher = document.createElement("button");
    launcher.type = "button";
    launcher.id = "the-board-launcher";
    launcher.className = "tb-launcher";
    launcher.setAttribute("aria-haspopup", "dialog");
    launcher.setAttribute("aria-expanded", "false");

    var dot = document.createElement("span");
    dot.className = "tb-launcher-dot";
    launcher.appendChild(dot);

    var label = document.createElement("span");
    label.className = "tb-launcher-label";
    label.textContent = "The Board";
    launcher.appendChild(label);

    launcher.addEventListener("click", openModal);
    document.body.appendChild(launcher);
    ELEMENTS.launcher = launcher;
  }

  function createModal() {
    if (!document.body || ELEMENTS.overlay) {
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "tb-overlay";
    overlay.setAttribute("aria-hidden", "true");

    var modal = document.createElement("div");
    modal.className = "tb-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tb-modal-title");
    modal.tabIndex = -1;

    modal.innerHTML = [
      '<header class="tb-header">',
      '  <div class="tb-brand">',
      '    <span class="tb-logo" id="tb-modal-title">THE BOARD</span>',
      "  </div>",
      '  <button type="button" class="tb-close" aria-label="Close The Board">&times;</button>',
      "</header>",
      '<div class="tb-body">',
      '  <aside class="tb-submit-panel" id="tb-submit-panel"></aside>',
      '  <section class="tb-main-panel">',
      '    <div class="tb-controls">',
      '      <div class="tb-controls-info">',
      '        <div class="tb-next-run" id="tb-next-run"></div>',
      '        <div class="tb-status tb-status-muted" id="tb-status">Loading the board...</div>',
      '      </div>',
      '      <div id="tb-controls-actions"></div>',
      "    </div>",
      '    <div class="tb-feature-list" id="tb-feature-list"></div>',
      "  </section>",
      "</div>",
      '<footer class="tb-footer">',
      '  <nav class="tb-footer-nav">',
      '    <a href="https://github.com/skorokithakis/theboard" target="_blank" aria-label="View on GitHub">',
      '      <svg class="tb-footer-icon" viewBox="0 0 16 16" aria-hidden="true">',
      '        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>',
      "      </svg>",
      "    </a>",
      "  </nav>",
      '  <div class="tb-auth-section" id="tb-auth-section"></div>',
      "</footer>",
    ].join("");

    overlay.appendChild(modal);

    var toastStack = document.createElement("div");
    toastStack.className = "tb-toast-stack";
    overlay.appendChild(toastStack);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        closeModal();
      }
    });

    document.body.appendChild(overlay);

    ELEMENTS.overlay = overlay;
    ELEMENTS.modal = modal;
    ELEMENTS.toastStack = toastStack;
    ELEMENTS.close = modal.querySelector(".tb-close");
    ELEMENTS.submitPanel = modal.querySelector("#tb-submit-panel");
    ELEMENTS.authSection = modal.querySelector("#tb-auth-section");
    ELEMENTS.nextRun = modal.querySelector("#tb-next-run");
    ELEMENTS.status = modal.querySelector("#tb-status");
    ELEMENTS.featureList = modal.querySelector("#tb-feature-list");
    ELEMENTS.controlsActions = modal.querySelector("#tb-controls-actions");

    if (ELEMENTS.close) {
      ELEMENTS.close.addEventListener("click", closeModal);
    }
  }

  function createAuthModal() {
    if (!document.body || ELEMENTS.authOverlay) {
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "tb-auth-overlay";
    overlay.setAttribute("aria-hidden", "true");

    var modal = document.createElement("div");
    modal.className = "tb-auth-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tb-auth-modal-title");
    modal.tabIndex = -1;

    modal.innerHTML = [
      '<header class="tb-header">',
      '  <div class="tb-brand">',
      '    <span class="tb-logo" id="tb-auth-modal-title">THE BOARD</span>',
      '    <span class="tb-subtitle">Authentication</span>',
      "  </div>",
      '  <button type="button" class="tb-close" aria-label="Close">&times;</button>',
      "</header>",
      '<div class="tb-body">',
      '  <aside class="tb-auth-panel" id="tb-auth-panel-standalone"></aside>',
      "</div>",
    ].join("");

    overlay.appendChild(modal);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        closeAuthModal();
      }
    });

    document.body.appendChild(overlay);

    ELEMENTS.authOverlay = overlay;
    ELEMENTS.authModal = modal;
    ELEMENTS.authClose = modal.querySelector(".tb-close");
    ELEMENTS.authPanelStandalone = modal.querySelector("#tb-auth-panel-standalone");

    if (ELEMENTS.authClose) {
      ELEMENTS.authClose.addEventListener("click", closeAuthModal);
    }
  }

  function createFeatureDetailModal() {
    if (!document.body || ELEMENTS.detailOverlay) {
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "tb-detail-overlay";
    overlay.setAttribute("aria-hidden", "true");

    var modal = document.createElement("div");
    modal.className = "tb-detail-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tb-detail-title");
    modal.tabIndex = -1;

    modal.innerHTML = [
      '<header class="tb-header tb-detail-header">',
      '  <div class="tb-brand">',
      '    <span class="tb-logo" id="tb-detail-title">THE BOARD</span>',
      '    <span class="tb-subtitle">Feature details</span>',
      "  </div>",
      '  <button type="button" class="tb-close" aria-label="Close feature details">&times;</button>',
      "</header>",
      '<div class="tb-detail-body">',
      '  <article class="tb-detail-content">',
      '    <h2 class="tb-detail-feature-title" id="tb-detail-feature-title"></h2>',
      '    <div class="tb-detail-profile" id="tb-detail-profile" aria-live="polite"></div>',
      '    <div class="tb-feature-description" id="tb-detail-description"></div>',
      '    <div class="tb-detail-variations" id="tb-detail-variations" aria-live="polite"></div>',
      "  </article>",
      "</div>",
      '<footer class="tb-detail-footer">',
      '  <div class="tb-detail-meta" id="tb-detail-meta"></div>',
      '  <div class="tb-detail-actions" id="tb-detail-actions"></div>',
      "</footer>",
    ].join("");

    overlay.appendChild(modal);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        closeFeatureDetail();
      }
    });

    document.body.appendChild(overlay);

    ELEMENTS.detailOverlay = overlay;
    ELEMENTS.detailModal = modal;
    ELEMENTS.detailClose = modal.querySelector(".tb-close");
    ELEMENTS.detailFeatureTitle = modal.querySelector(
      "#tb-detail-feature-title"
    );
    ELEMENTS.detailMeta = modal.querySelector("#tb-detail-meta");
    ELEMENTS.detailActions = modal.querySelector("#tb-detail-actions");
    ELEMENTS.detailDescription = modal.querySelector("#tb-detail-description");
    ELEMENTS.detailVariations = modal.querySelector("#tb-detail-variations");
    ELEMENTS.detailProfile = modal.querySelector("#tb-detail-profile");

    if (ELEMENTS.detailClose) {
      ELEMENTS.detailClose.addEventListener("click", closeFeatureDetail);
    }
  }

  function createImplementedFeaturesModal() {
    if (!document.body || ELEMENTS.implementedOverlay) {
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "tb-implemented-overlay";
    overlay.setAttribute("aria-hidden", "true");

    var modal = document.createElement("div");
    modal.className = "tb-implemented-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tb-implemented-title");
    modal.tabIndex = -1;
    modal.tabIndex = -1;

    modal.innerHTML = [
      '<header class="tb-header tb-implemented-header">',
      '  <div class="tb-brand">',
      '    <span class="tb-logo" id="tb-implemented-title">THE BOARD</span>',
      '    <span class="tb-subtitle">Implemented features</span>',
      "  </div>",
      '  <button type="button" class="tb-close" aria-label="Close implemented features">&times;</button>',
      "</header>",
      '<div class="tb-implemented-body">',
      '  <div class="tb-feature-list" id="tb-implemented-feature-list"></div>',
      "</div>",
    ].join("");

    overlay.appendChild(modal);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        closeImplementedFeaturesModal();
      }
    });

    document.body.appendChild(overlay);

    ELEMENTS.implementedOverlay = overlay;
    ELEMENTS.implementedModal = modal;
    ELEMENTS.implementedList = modal.querySelector(
      "#tb-implemented-feature-list"
    );
    ELEMENTS.implementedClose = modal.querySelector(".tb-close");

    if (ELEMENTS.implementedClose) {
      ELEMENTS.implementedClose.addEventListener(
        "click",
        closeImplementedFeaturesModal
      );
    }
  }

  function openImplementedFeaturesModal(trigger) {
    if (!ELEMENTS.implementedOverlay || !ELEMENTS.implementedModal) {
      return;
    }
    lastImplementedTrigger = trigger || null;
    renderImplementedFeatures();
    ELEMENTS.implementedOverlay.classList.add("tb-open");
    ELEMENTS.implementedOverlay.setAttribute("aria-hidden", "false");
    implementedModalOpen = true;
    document.body.classList.add("tb-modal-open");
    setTimeout(function () {
      if (ELEMENTS.implementedModal) {
        ELEMENTS.implementedModal.focus();
      }
    }, 0);
  }

  function closeImplementedFeaturesModal() {
    if (!ELEMENTS.implementedOverlay) {
      return;
    }
    if (detailModalOpen) {
      closeFeatureDetail();
    }
    ELEMENTS.implementedOverlay.classList.remove("tb-open");
    ELEMENTS.implementedOverlay.setAttribute("aria-hidden", "true");
    implementedModalOpen = false;
    if (
      !detailModalOpen &&
      !authModalOpen &&
      !isOpen() &&
      document.body.classList.contains("tb-modal-open")
    ) {
      document.body.classList.remove("tb-modal-open");
    }
    if (lastImplementedTrigger && typeof lastImplementedTrigger.focus === "function") {
      try {
        lastImplementedTrigger.focus();
      } catch (error) {
        // Ignore focus errors
      }
    }
    lastImplementedTrigger = null;
  }

  function createGraveyardModal() {
    if (!document.body || ELEMENTS.graveyardOverlay) {
      return;
    }

    var overlay = document.createElement("div");
    overlay.className = "tb-graveyard-overlay";
    overlay.setAttribute("aria-hidden", "true");

    var modal = document.createElement("div");
    modal.className = "tb-graveyard-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "tb-graveyard-title");
    modal.tabIndex = -1;

    modal.innerHTML = [
      '<header class="tb-header tb-graveyard-header">',
      '  <div class="tb-brand">',
      '    <span class="tb-logo" id="tb-graveyard-title">THE BOARD</span>',
      '    <span class="tb-subtitle">Feature graveyard</span>',
      "  </div>",
      '  <button type="button" class="tb-close" aria-label="Close feature graveyard">&times;</button>',
      "</header>",
      '<div class="tb-graveyard-body">',
      '  <div class="tb-graveyard-scenery" aria-hidden="true">',
      '    <div class="tb-graveyard-moon"></div>',
      '    <div class="tb-graveyard-hill"></div>',
      '    <div class="tb-graveyard-ghost tb-graveyard-ghost-left"></div>',
      '    <div class="tb-graveyard-ghost tb-graveyard-ghost-right"></div>',
      '    <div class="tb-graveyard-shadows"></div>',
      "  </div>",
      '  <div class="tb-graveyard-list" id="tb-graveyard-feature-list"></div>',
      "</div>",
    ].join("");

    overlay.appendChild(modal);

    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) {
        closeGraveyardModal();
      }
    });

    document.body.appendChild(overlay);

    ELEMENTS.graveyardOverlay = overlay;
    ELEMENTS.graveyardModal = modal;
    ELEMENTS.graveyardList = modal.querySelector("#tb-graveyard-feature-list");
    ELEMENTS.graveyardClose = modal.querySelector(".tb-close");

    if (ELEMENTS.graveyardClose) {
      ELEMENTS.graveyardClose.addEventListener("click", closeGraveyardModal);
    }
  }

  function openGraveyardModal(trigger) {
    if (!ELEMENTS.graveyardOverlay || !ELEMENTS.graveyardModal) {
      return;
    }
    lastGraveyardTrigger = trigger || null;
    renderGraveyardFeatures();
    ELEMENTS.graveyardOverlay.classList.add("tb-open");
    ELEMENTS.graveyardOverlay.setAttribute("aria-hidden", "false");
    graveyardModalOpen = true;
    document.body.classList.add("tb-modal-open");
    setTimeout(function () {
      if (ELEMENTS.graveyardModal) {
        ELEMENTS.graveyardModal.focus();
      }
    }, 0);
  }

  function closeGraveyardModal() {
    if (!ELEMENTS.graveyardOverlay) {
      return;
    }
    if (detailModalOpen) {
      closeFeatureDetail();
    }
    ELEMENTS.graveyardOverlay.classList.remove("tb-open");
    ELEMENTS.graveyardOverlay.setAttribute("aria-hidden", "true");
    graveyardModalOpen = false;
    if (
      !detailModalOpen &&
      !authModalOpen &&
      !isOpen() &&
      !implementedModalOpen &&
      document.body.classList.contains("tb-modal-open")
    ) {
      document.body.classList.remove("tb-modal-open");
    }
    if (lastGraveyardTrigger && typeof lastGraveyardTrigger.focus === "function") {
      try {
        lastGraveyardTrigger.focus();
      } catch (error) {
        // Ignore focus errors
      }
    }
    lastGraveyardTrigger = null;
  }

  function attachGlobalShortcuts() {
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (detailModalOpen) {
          closeFeatureDetail();
        } else if (graveyardModalOpen) {
          closeGraveyardModal();
        } else if (implementedModalOpen) {
          closeImplementedFeaturesModal();
        } else if (authModalOpen) {
          closeAuthModal();
        } else if (isOpen()) {
          closeModal();
        }
      }
    });
  }

  function isOpen() {
    return Boolean(
      ELEMENTS.overlay && ELEMENTS.overlay.classList.contains("tb-open")
    );
  }

  function openModal() {
    if (!ELEMENTS.overlay || !ELEMENTS.modal) {
      return;
    }
    ELEMENTS.overlay.classList.add("tb-open");
    ELEMENTS.overlay.setAttribute("aria-hidden", "false");
    if (ELEMENTS.launcher) {
      ELEMENTS.launcher.setAttribute("aria-expanded", "true");
      ELEMENTS.launcher.classList.add("tb-launcher-hidden");
    }
    document.body.classList.add("tb-modal-open");
    setTimeout(function () {
      if (ELEMENTS.modal) {
        ELEMENTS.modal.focus();
      }
    }, 0);
    fetchFeatures();
  }

  function closeModal() {
    if (!ELEMENTS.overlay) {
      return;
    }
    closeFeatureDetail();
    closeImplementedFeaturesModal();
    closeGraveyardModal();
    ELEMENTS.overlay.classList.remove("tb-open");
    ELEMENTS.overlay.setAttribute("aria-hidden", "true");
    document.body.classList.remove("tb-modal-open");
    if (ELEMENTS.launcher) {
      ELEMENTS.launcher.setAttribute("aria-expanded", "false");
      ELEMENTS.launcher.classList.remove("tb-launcher-hidden");
      if (typeof ELEMENTS.launcher.focus === "function") {
        ELEMENTS.launcher.focus({ preventScroll: true });
      }
    }
  }

  function openAuthModal(view) {
    if (!ELEMENTS.authOverlay || !ELEMENTS.authModal) {
      return;
    }
    if (view) {
      STATE.authView = view;
    }
    STATE.authError = null;
    ELEMENTS.authOverlay.classList.add("tb-open");
    ELEMENTS.authOverlay.setAttribute("aria-hidden", "false");
    document.body.classList.add("tb-modal-open");
    authModalOpen = true;
    renderAuth();
    setTimeout(function () {
      if (ELEMENTS.authModal) {
        ELEMENTS.authModal.focus();
      }
    }, 0);
  }

  function closeAuthModal() {
    if (!ELEMENTS.authOverlay) {
      return;
    }
    ELEMENTS.authOverlay.classList.remove("tb-open");
    ELEMENTS.authOverlay.setAttribute("aria-hidden", "true");
    authModalOpen = false;
    if (!isOpen()) {
      document.body.classList.remove("tb-modal-open");
    }
  }

  function fetchFeatures(force) {
    if (STATE.loading) {
      return fetchPromise;
    }

    STATE.error = null;
    setLoading(true);
    renderStatus();
    renderFeatures();

    fetchPromise = fetch(ENDPOINTS.features, {
      credentials: "include",
    })
      .then(function (response) {
        if (!response.ok) {
          return extractError(response, "Unable to load features.").then(
            function (message) {
              throw new Error(message);
            }
          );
        }
        return response.json();
      })
      .then(function (data) {
        var features = Array.isArray(data.features) ? data.features : [];
        var implemented = Array.isArray(data.implemented_features)
          ? data.implemented_features
          : [];
        var graveyard = Array.isArray(data.graveyard_features)
          ? data.graveyard_features
          : [];
        STATE.features = features.filter(function (feature) {
          return !feature.implemented_at && !feature.expired_at;
        });
        STATE.implementedFeatures = implemented;
        STATE.graveyardFeatures = graveyard;
        STATE.user = data.user || null;
        STATE.canSubmit = Boolean(data.can_submit);
        STATE.authError = null;
        STATE.nextIterationAt = parseNextIterationDate(
          data.next_iteration_at
        );
        if (ELEMENTS.heroCountdown) {
          if (data.next_iteration_at) {
            ELEMENTS.heroCountdown.dataset.nextIteration =
              data.next_iteration_at;
          } else {
            delete ELEMENTS.heroCountdown.dataset.nextIteration;
          }
        }
        lastCountdownTargetMs = null;
        updateCountdownDisplay();
        if (STATE.user) {
          STATE.authView = "profile";
        } else if (STATE.authView === "profile") {
          STATE.authView = "login";
        }
        DETAIL_VARIATIONS_CACHE = Object.create(null);
      })
      .catch(function (error) {
        STATE.error = error.message || "Unable to load features.";
      })
      .finally(function () {
        setLoading(false);
        renderHeaderUser();
        renderAuth();
        renderSubmitPanel();
        renderControlsActions();
        renderStatus();
        renderFeatures();
        renderImplementedFeatures();
        renderGraveyardFeatures();
        if (force) {
          if (STATE.error) {
            showToast(STATE.error, "error");
          } else {
            showToast("Board refreshed.", "success");
          }
        }
      });

    return fetchPromise;
  }

  function setLoading(isLoading) {
    STATE.loading = Boolean(isLoading);
  }

  function fetchFeatureDetail(featureId) {
    var id = String(featureId);
    if (!DETAIL_VARIATIONS_REQUESTS[id]) {
      DETAIL_VARIATIONS_REQUESTS[id] = fetch(ENDPOINTS.featureDetail(id), {
        credentials: "include",
      })
        .then(function (response) {
          if (!response.ok) {
            return extractError(response, "Unable to load feature details.").then(
              function (message) {
                throw new Error(message);
              }
            );
          }
          return response.json();
        })
        .finally(function () {
          delete DETAIL_VARIATIONS_REQUESTS[id];
        });
    }
    return DETAIL_VARIATIONS_REQUESTS[id];
  }

  function renderControlsActions() {
    var container = ELEMENTS.controlsActions;
    if (!container) {
      return;
    }
    container.innerHTML = "";

    var buttonGroup = document.createElement("div");
    buttonGroup.className = "tb-button-group";

    if (STATE.user && STATE.canSubmit && !STATE.showSubmitForm) {
      var submitButton = document.createElement("button");
      submitButton.type = "button";
      submitButton.className = "tb-btn-primary";
      submitButton.textContent = "Submit Feature";
      submitButton.addEventListener("click", function () {
        STATE.showSubmitForm = true;
        STATE.submitError = null;
        STATE.submitDefaults = null;
        renderSubmitPanel();
        renderControlsActions();
      });
      buttonGroup.appendChild(submitButton);
    }

    var implementedButton = document.createElement("button");
    implementedButton.type = "button";
    implementedButton.className = "tb-btn-secondary";
    implementedButton.textContent = "View implemented";
    implementedButton.disabled = STATE.implementedFeatures.length === 0;
    if (implementedButton.disabled) {
      implementedButton.setAttribute("aria-disabled", "true");
      implementedButton.title = "No implemented features yet.";
    } else {
      implementedButton.removeAttribute("aria-disabled");
      implementedButton.title = "See recently implemented features.";
      implementedButton.addEventListener("click", function (event) {
        openImplementedFeaturesModal(event.currentTarget);
      });
    }
    buttonGroup.appendChild(implementedButton);

    var graveyardButton = document.createElement("button");
    graveyardButton.type = "button";
    graveyardButton.className = "tb-btn-spooky";
    graveyardButton.textContent = "Visit graveyard";
    graveyardButton.disabled = STATE.graveyardFeatures.length === 0;
    if (graveyardButton.disabled) {
      graveyardButton.setAttribute("aria-disabled", "true");
      graveyardButton.title = "No expired features yet.";
    } else {
      graveyardButton.removeAttribute("aria-disabled");
      graveyardButton.title = "Pay respects to retired ideas.";
      graveyardButton.addEventListener("click", function (event) {
        openGraveyardModal(event.currentTarget);
      });
    }
    buttonGroup.appendChild(graveyardButton);

    var refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = "tb-refresh";
    refreshButton.setAttribute("aria-label", "Refresh features");
    refreshButton.innerHTML = "&#8635;";
    refreshButton.addEventListener("click", function () {
      fetchFeatures(true);
    });
    buttonGroup.appendChild(refreshButton);

    container.appendChild(buttonGroup);
  }

  function renderStatus() {
    var status = ELEMENTS.status;
    if (!status) {
      return;
    }
    status.className = "tb-status";
    if (STATE.loading) {
      status.classList.add("tb-status-info");
      status.textContent = "Loading the latest feature ideas...";
      return;
    }
    if (STATE.error) {
      status.classList.add("tb-status-error");
      status.textContent = STATE.error;
      return;
    }
    if (STATE.user && !STATE.canSubmit) {
      status.classList.add("tb-status-warning");
      status.textContent =
        "Daily submission limit reached. Thanks for contributing!";
      return;
    }
    status.classList.add("tb-status-muted");
    status.textContent = STATE.user
      ? ""
      : "Sign in to vote and help shape what ships next.";
  }

  function ensureCountdownTimer() {
    if (countdownTimer) {
      return;
    }
    countdownTimer = window.setInterval(updateCountdownDisplay, 1000);
  }

  function updateCountdownDisplay() {
    var target = getCountdownTarget();
    if (!target) {
      setCountdownMessage(ELEMENTS.nextRun, "");
      setCountdownMessage(ELEMENTS.heroCountdown, "");
      return;
    }
    var nowMs = Date.now();
    var targetMs = target.getTime();
    var diff = targetMs - nowMs;
    if (diff <= 0) {
      target = computeNextLocalIteration(new Date(nowMs));
      targetMs = target.getTime();
      diff = targetMs - nowMs;
    }
    if (diff < 0) {
      diff = 0;
    }
    if (lastCountdownTargetMs !== targetMs) {
      cachedLocalTimeLabel = formatLocalTime(target);
      lastCountdownTargetMs = targetMs;
    }
    var countdownText = formatCountdown(diff);
    var utcLabel = formatUtcTime(target);
    var message =
      "Next iteration in " +
      countdownText +
      " (" +
      utcLabel +
      " UTC / " +
      cachedLocalTimeLabel +
      " your time)";
    setCountdownMessage(ELEMENTS.nextRun, message);
    setCountdownMessage(ELEMENTS.heroCountdown, message);
  }

  function setCountdownMessage(element, message) {
    if (!element) {
      return;
    }
    if (element.textContent !== message) {
      element.textContent = message;
    }
  }

  function getCountdownTarget() {
    var target = STATE.nextIterationAt;
    if (target && !(target instanceof Date)) {
      target = parseNextIterationDate(target);
      STATE.nextIterationAt = target;
    }
    if (target instanceof Date && !Number.isNaN(target.getTime())) {
      if (target.getTime() - Date.now() > 1000) {
        return target;
      }
    }
    return computeNextLocalIteration();
  }

  function computeNextLocalIteration(reference) {
    var now = reference instanceof Date ? reference : new Date();
    var year = now.getUTCFullYear();
    var month = now.getUTCMonth();
    var day = now.getUTCDate();
    var nowMs = now.getTime();
    var noonTargetMs = Date.UTC(year, month, day, 12, 0, 0, 0);
    if (nowMs < noonTargetMs) {
      return new Date(noonTargetMs);
    }
    var midnightNextMs = Date.UTC(year, month, day + 1, 0, 0, 0, 0);
    return new Date(midnightNextMs);
  }

  function parseNextIterationDate(value) {
    if (!value) {
      return null;
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return date;
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
    parts.push(String(hours).padStart(2, "0") + "h");
    parts.push(String(minutes).padStart(2, "0") + "m");
    parts.push(String(seconds).padStart(2, "0") + "s");
    return parts.join(" ");
  }

  function formatUtcTime(date) {
    var hours = String(date.getUTCHours()).padStart(2, "0");
    var minutes = String(date.getUTCMinutes()).padStart(2, "0");
    return hours + ":" + minutes;
  }

  function formatLocalTime(date) {
    if (typeof Intl !== "undefined" && Intl.DateTimeFormat) {
      try {
        if (!countdownTimeFormatter) {
          countdownTimeFormatter = new Intl.DateTimeFormat(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
        }
        return countdownTimeFormatter.format(date);
      } catch (error) {
        // Ignore and fallback to toLocaleString
      }
    }
    return date.toLocaleString();
  }

  function renderHeaderUser() {
    var authSection = ELEMENTS.authSection;
    if (!authSection) {
      return;
    }

    authSection.innerHTML = "";

    if (STATE.user) {
      var usernameLabel = document.createElement("span");
      usernameLabel.className = "tb-footer-username";
      usernameLabel.textContent = STATE.user.username || "";
      authSection.appendChild(usernameLabel);
      var logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "tb-btn-text";
      logoutBtn.textContent = "Sign out";
      logoutBtn.addEventListener("click", function () {
        handleLogout();
      });
      authSection.appendChild(logoutBtn);
    } else {
      var loginBtn = document.createElement("button");
      loginBtn.type = "button";
      loginBtn.className = "tb-btn-text";
      loginBtn.textContent = "Sign in";
      loginBtn.addEventListener("click", function () {
        openAuthModal("login");
      });
      authSection.appendChild(loginBtn);

      var signupBtn = document.createElement("button");
      signupBtn.type = "button";
      signupBtn.className = "tb-btn-text";
      signupBtn.textContent = "Sign up";
      signupBtn.addEventListener("click", function () {
        openAuthModal("signup");
      });
      authSection.appendChild(signupBtn);
    }
  }

  function renderAuth() {
    var panel = authModalOpen ? ELEMENTS.authPanelStandalone : ELEMENTS.authPanel;
    if (!panel) {
      return;
    }
    panel.innerHTML = "";

    if (STATE.user) {
      var card = document.createElement("div");
      card.className = "tb-auth-card tb-auth-card-compact";

      var helper = document.createElement("p");
      helper.className = "tb-helper";
      helper.textContent = "You are ready to vote and follow new ideas.";
      card.appendChild(helper);

      var badge = document.createElement("div");
      badge.className = "tb-user-badge";

      var avatar = document.createElement("span");
      avatar.className = "tb-user-avatar";
      avatar.textContent = getInitials(STATE.user);
      badge.appendChild(avatar);

      var info = document.createElement("div");
      info.className = "tb-user-card";

      var name = document.createElement("span");
      name.className = "tb-user-name";
      name.textContent =
        STATE.user.display_name || STATE.user.username || "Board member";
      info.appendChild(name);

      var handle = document.createElement("span");
      handle.className = "tb-user-handle";
      handle.textContent = STATE.user.username;
      info.appendChild(handle);

      badge.appendChild(info);
      card.appendChild(badge);

      var actions = document.createElement("div");
      actions.className = "tb-user-actions";

      var profileLink = document.createElement("a");
      profileLink.className = "tb-link";
      profileLink.href = "/profile/";
      profileLink.textContent = "View profile";
      actions.appendChild(profileLink);

      var logout = document.createElement("button");
      logout.type = "button";
      logout.className = "tb-link";
      logout.textContent = "Log out";
      logout.addEventListener("click", function () {
        handleLogout();
      });
      actions.appendChild(logout);

      card.appendChild(actions);
      panel.appendChild(card);
      return;
    }

    var formCard = document.createElement("div");
    formCard.className = "tb-auth-card";

    var tabs = document.createElement("div");
    tabs.className = "tb-auth-tabs";

    var loginTab = document.createElement("button");
    loginTab.type = "button";
    loginTab.className =
      "tb-tab" + (STATE.authView !== "signup" ? " tb-tab-active" : "");
    loginTab.textContent = "Sign in";
    loginTab.addEventListener("click", function () {
      STATE.authView = "login";
      STATE.authError = null;
      renderAuth();
    });
    tabs.appendChild(loginTab);

    var signupTab = document.createElement("button");
    signupTab.type = "button";
    signupTab.className =
      "tb-tab" + (STATE.authView === "signup" ? " tb-tab-active" : "");
    signupTab.textContent = "Create account";
    signupTab.addEventListener("click", function () {
      STATE.authView = "signup";
      STATE.authError = null;
      renderAuth();
    });
    tabs.appendChild(signupTab);

    formCard.appendChild(tabs);

    if (STATE.authError) {
      var error = document.createElement("div");
      error.className = "tb-form-error";
      error.textContent = STATE.authError;
      formCard.appendChild(error);
    }

    var form = document.createElement("form");
    form.className = "tb-form";

    if (STATE.authView === "signup") {
      buildInput(form, {
        id: "tb-signup-username",
        label: "Username",
        type: "text",
        name: "username",
        autocomplete: "username",
        required: true,
      });
      buildInput(form, {
        id: "tb-signup-password",
        label: "Password",
        type: "password",
        name: "password",
        autocomplete: "new-password",
        required: true,
      });
      buildInput(form, {
        id: "tb-signup-confirm",
        label: "Confirm password",
        type: "password",
        name: "password_confirm",
        autocomplete: "new-password",
        required: true,
      });
      var signupButton = document.createElement("button");
      signupButton.type = "submit";
      signupButton.className = "tb-submit";
      signupButton.textContent = "Create account";
      form.appendChild(signupButton);

      form.addEventListener("submit", handleSignup);
    } else {
      buildInput(form, {
        id: "tb-login-username",
        label: "Username",
        type: "text",
        name: "username",
        autocomplete: "username",
        required: true,
      });
      buildInput(form, {
        id: "tb-login-password",
        label: "Password",
        type: "password",
        name: "password",
        autocomplete: "current-password",
        required: true,
      });

      var loginButton = document.createElement("button");
      loginButton.type = "submit";
      loginButton.className = "tb-submit";
      loginButton.textContent = "Sign in";
      form.appendChild(loginButton);

      form.addEventListener("submit", handleLogin);
    }

    formCard.appendChild(form);
    panel.appendChild(formCard);
  }

  function buildInput(form, options) {
    var group = document.createElement("div");
    group.className = "tb-input-group";

    var label = document.createElement("label");
    label.className = "tb-label";
    label.setAttribute("for", options.id);
    label.textContent = options.label;
    group.appendChild(label);

    var input = document.createElement("input");
    input.className = "tb-input";
    input.id = options.id;
    input.name = options.name;
    input.type = options.type;
    if (options.autocomplete) {
      input.setAttribute("autocomplete", options.autocomplete);
    }
    if (options.required) {
      input.required = true;
    }
    if (Object.prototype.hasOwnProperty.call(options, "value")) {
      input.value = options.value;
    }

    group.appendChild(input);
    form.appendChild(group);
    return input;
  }

  function renderSubmitPanel() {
    var panel = ELEMENTS.submitPanel;
    if (!panel) {
      return;
    }
    panel.innerHTML = "";

    if (!STATE.showSubmitForm) {
      panel.style.display = "none";
      return;
    }

    panel.style.display = "";

    var defaults = STATE.submitDefaults || {};

    var card = document.createElement("div");
    card.className = "tb-auth-card";

    var title = document.createElement("h3");
    title.className = "tb-submit-title";
    title.textContent = "Submit a New Feature";
    card.appendChild(title);

    var helper = document.createElement("p");
    helper.className = "tb-helper";
    helper.textContent =
      "Share what you would like to see added or changed.";
    card.appendChild(helper);

    if (defaults.parentTitle) {
      var variationNotice = document.createElement("div");
      variationNotice.className = "tb-variation-notice";
      variationNotice.textContent =
        'Adding a variation of "' + defaults.parentTitle + '".';
      card.appendChild(variationNotice);
    }

    if (STATE.submitError) {
      var error = document.createElement("div");
      error.className = "tb-form-error";
      error.textContent = STATE.submitError;
      card.appendChild(error);
    }

    var form = document.createElement("form");
    form.className = "tb-form";
    form.id = "tb-submit-form";

    buildInput(form, {
      id: "tb-feature-title",
      label: "Title",
      type: "text",
      name: "title",
      required: true,
      value: defaults.title || "",
    });

    var descGroup = document.createElement("div");
    descGroup.className = "tb-input-group";
    var descLabel = document.createElement("label");
    descLabel.className = "tb-label";
    descLabel.setAttribute("for", "tb-feature-description");
    descLabel.textContent = "Description";
    descGroup.appendChild(descLabel);
    var descTextarea = document.createElement("textarea");
    descTextarea.className = "tb-textarea";
    descTextarea.id = "tb-feature-description";
    descTextarea.name = "description";
    descTextarea.required = true;
    descTextarea.value = defaults.description || "";
    descGroup.appendChild(descTextarea);
    form.appendChild(descGroup);

    var parentInput = document.createElement("input");
    parentInput.type = "hidden";
    parentInput.name = "parent_id";
    if (
      defaults.parentId !== undefined &&
      defaults.parentId !== null &&
      defaults.parentId !== ""
    ) {
      parentInput.value = String(defaults.parentId);
    } else {
      parentInput.value = "";
    }
    form.appendChild(parentInput);

    var turnstileContainer = document.createElement("div");
    turnstileContainer.className = "cf-turnstile";
    turnstileContainer.id = "tb-submit-turnstile";
    form.appendChild(turnstileContainer);

    var buttonGroup = document.createElement("div");
    buttonGroup.className = "tb-button-group";

    var submitButton = document.createElement("button");
    submitButton.type = "submit";
    submitButton.className = "tb-submit";
    submitButton.textContent = "Submit Feature";
    buttonGroup.appendChild(submitButton);

    var cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "tb-btn-secondary";
    cancelButton.textContent = "Cancel";
    cancelButton.addEventListener("click", function () {
      STATE.showSubmitForm = false;
      STATE.submitError = null;
      STATE.submitDefaults = null;
      renderSubmitPanel();
      renderControlsActions();
    });
    buttonGroup.appendChild(cancelButton);

    form.appendChild(buttonGroup);

    form.addEventListener("submit", handleFeatureCreate);

    card.appendChild(form);
    panel.appendChild(card);

    queueTurnstileRender(turnstileContainer);
  }

  function queueTurnstileRender(container) {
    if (typeof window._turnstileInitQueue === "undefined") {
      window._turnstileInitQueue = [];
    }
    window._turnstileInitQueue.push(function () {
      if (container.dataset.turnstileWidgetId) {
        return;
      }
      try {
        var sitekey = "";
        if (document.body && document.body.dataset) {
          sitekey = document.body.dataset.turnstileSitekey || "";
        }
        if (!sitekey) {
          console.warn("Turnstile sitekey not found; skipping feature form render.");
          return;
        }
        var options = { action: "feature_create", sitekey: sitekey };
        var widgetId = window.turnstile.render(container, options);
        container.dataset.turnstileWidgetId = widgetId;
      } catch (error) {
        console.error("Turnstile render error:", error);
      }
    });
    if (typeof window.onTurnstileLoad === "function") {
      window.onTurnstileLoad();
    }
  }

  function renderFeatures() {
    var list = ELEMENTS.featureList;
    if (!list) {
      return;
    }
    list.innerHTML = "";

    if (STATE.loading) {
      var loading = document.createElement("div");
      loading.className = "tb-loading";
      var spinner = document.createElement("span");
      spinner.className = "tb-spinner";
      loading.appendChild(spinner);
      var label = document.createElement("span");
      label.textContent = "Loading the board...";
      loading.appendChild(label);
      list.appendChild(loading);
      return;
    }

    if (STATE.error) {
      var emptyError = document.createElement("div");
      emptyError.className = "tb-empty";
      var message = document.createElement("p");
      message.textContent = STATE.error;
      emptyError.appendChild(message);
      var retry = document.createElement("button");
      retry.type = "button";
      retry.className = "tb-refresh";
      retry.textContent = "Try again";
      retry.addEventListener("click", function () {
        fetchFeatures(true);
      });
      emptyError.appendChild(retry);
      list.appendChild(emptyError);
      return;
    }

    if (!STATE.features.length) {
      var empty = document.createElement("div");
      empty.className = "tb-empty";
      empty.textContent =
        "No feature ideas yet. Share yours from the main site to get the ball rolling.";
      list.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    var ordered = STATE.features.slice().sort(function (a, b) {
      var aVotes = typeof (a && a.vote_total) === "number" ? a.vote_total : 0;
      var bVotes = typeof (b && b.vote_total) === "number" ? b.vote_total : 0;
      if (aVotes !== bVotes) {
        return bVotes - aVotes;
      }
      var aCreated = a && a.created_at ? new Date(a.created_at).getTime() : 0;
      var bCreated = b && b.created_at ? new Date(b.created_at).getTime() : 0;
      return bCreated - aCreated;
    });
    ordered.forEach(function (feature) {
      fragment.appendChild(createFeatureCard(feature));
    });
    list.appendChild(fragment);

    refreshOpenFeatureDetail();
  }

  function renderImplementedFeatures() {
    var list = ELEMENTS.implementedList;
    if (!list) {
      return;
    }

    list.innerHTML = "";

    if (STATE.loading && !STATE.implementedFeatures.length) {
      var loading = document.createElement("div");
      loading.className = "tb-status tb-status-info";
      loading.textContent = "Loading implemented features...";
      list.appendChild(loading);
      return;
    }

    if (STATE.error) {
      var error = document.createElement("div");
      error.className = "tb-status tb-status-error";
      error.textContent = STATE.error;
      list.appendChild(error);
      return;
    }

    if (!STATE.implementedFeatures.length) {
      var empty = document.createElement("div");
      empty.className = "tb-empty";
      empty.textContent = "No features have been implemented yet.";
      list.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    var ordered = STATE.implementedFeatures.slice().sort(function (a, b) {
      var aImplemented = a && a.implemented_at ? new Date(a.implemented_at).getTime() : 0;
      var bImplemented = b && b.implemented_at ? new Date(b.implemented_at).getTime() : 0;
      if (aImplemented === bImplemented) {
        var aCreated = a && a.created_at ? new Date(a.created_at).getTime() : 0;
        var bCreated = b && b.created_at ? new Date(b.created_at).getTime() : 0;
        return bCreated - aCreated;
      }
      return bImplemented - aImplemented;
    });
    ordered.forEach(function (feature) {
      fragment.appendChild(createFeatureCard(feature));
    });
    list.appendChild(fragment);

    refreshOpenFeatureDetail();
  }

  function renderGraveyardFeatures() {
    var list = ELEMENTS.graveyardList;
    if (!list) {
      return;
    }

    list.innerHTML = "";

    if (STATE.loading && !STATE.graveyardFeatures.length) {
      var loading = document.createElement("div");
      loading.className = "tb-graveyard-status tb-graveyard-status-loading";
      loading.textContent = "Summoning retired spirits...";
      list.appendChild(loading);
      return;
    }

    if (STATE.error) {
      var error = document.createElement("div");
      error.className = "tb-graveyard-status tb-graveyard-status-error";
      error.textContent = STATE.error;
      list.appendChild(error);
      return;
    }

    if (!STATE.graveyardFeatures.length) {
      var empty = document.createElement("div");
      empty.className = "tb-graveyard-status tb-graveyard-status-empty";
      empty.textContent = "No spirits linger here... yet.";
      list.appendChild(empty);
      return;
    }

    var fragment = document.createDocumentFragment();
    var ordered = STATE.graveyardFeatures.slice().sort(function (a, b) {
      var aExpired = a && a.expired_at ? new Date(a.expired_at).getTime() : 0;
      var bExpired = b && b.expired_at ? new Date(b.expired_at).getTime() : 0;
      if (aExpired === bExpired) {
        var aVotes = typeof (a && a.vote_total) === "number" ? a.vote_total : 0;
        var bVotes = typeof (b && b.vote_total) === "number" ? b.vote_total : 0;
        return bVotes - aVotes;
      }
      return bExpired - aExpired;
    });
    ordered.forEach(function (feature) {
      fragment.appendChild(createGraveyardFeatureCard(feature));
    });
    list.appendChild(fragment);
  }

  function createGraveyardFeatureCard(feature) {
    var card = document.createElement("article");
    card.className = "tb-graveyard-card";
    card.setAttribute("role", "button");
    card.tabIndex = 0;
    card.title = "View full request details";
    card.setAttribute(
      "aria-label",
      "View details for " + (feature.title || "Untitled idea")
    );
    var descriptionHtml = renderMarkdown(feature.description || "");

    function openGraveyardDetail(trigger) {
      openFeatureDetail(feature, descriptionHtml, trigger || card);
    }

    card.addEventListener("click", function (event) {
      event.preventDefault();
      openGraveyardDetail(card);
    });

    card.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGraveyardDetail(card);
      }
    });

    var emblem = document.createElement("div");
    emblem.className = "tb-graveyard-emblem";
    emblem.setAttribute("aria-hidden", "true");
    emblem.textContent = "☠";
    card.appendChild(emblem);

    var content = document.createElement("div");
    content.className = "tb-graveyard-content";

    var title = document.createElement("h3");
    title.className = "tb-graveyard-title";
    title.textContent = feature.title || "Untitled idea";
    title.title = "View full request details";
    content.appendChild(title);

    var meta = document.createElement("div");
    meta.className = "tb-graveyard-meta";

    if (feature.creator) {
      var author = document.createElement("span");
      author.className = "tb-graveyard-author";
      author.appendChild(document.createTextNode("by "));
      author.appendChild(createProfileLink(feature.creator));
      meta.appendChild(author);
    }

    if (feature.expired_at) {
      var expired = document.createElement("span");
      expired.className = "tb-graveyard-expired";
      expired.textContent = formatLocalTime(new Date(feature.expired_at));
      if (meta.childNodes.length) {
        appendGraveyardSeparator(meta);
      }
      meta.appendChild(expired);
    }

    content.appendChild(meta);
    card.appendChild(content);

    return card;
  }

  function appendGraveyardSeparator(container) {
    if (!container) {
      return;
    }
    var dot = document.createElement("span");
    dot.className = "tb-graveyard-dot";
    dot.textContent = "•";
    container.appendChild(dot);
  }

  function createFeatureCard(feature) {
    var card = document.createElement("article");
    card.className = "tb-feature";

    var isImplemented = Boolean(feature.implemented_at);
    var isExpired = Boolean(feature.expired_at);
    var expiresAt = feature.expires_at ? new Date(feature.expires_at) : null;
    var implementationState =
      typeof feature.implemented_state === "string"
        ? feature.implemented_state.toLowerCase()
        : "";
    var isUnsuccessfulImplementation =
      isImplemented && implementationState === "unsuccessful";
    var isExpiringSoon =
      !isImplemented && !isExpired && expiresAt && !Number.isNaN(expiresAt.getTime())
        ? expiresAt.getTime() - Date.now() <= 48 * 60 * 60 * 1000
        : false;

    if (isExpiringSoon) {
      card.classList.add("tb-feature-expiring");
    }
    if (isUnsuccessfulImplementation) {
      card.classList.add("tb-feature-implemented-failed");
    }

    var vote = document.createElement("button");
    vote.type = "button";
    vote.className = "tb-vote";
    vote.setAttribute("data-voted", feature.user_has_voted ? "true" : "false");
    if (VOTE_IN_FLIGHT.has(feature.id)) {
      vote.classList.add("tb-vote-loading");
    }
    if (isImplemented || isExpired) {
      vote.classList.add("tb-vote-disabled");
      vote.disabled = true;
      vote.setAttribute("aria-disabled", "true");
    }

    var arrow = document.createElement("span");
    arrow.className = "tb-vote-arrow";
    arrow.textContent = "▲";
    vote.appendChild(arrow);

    var count = document.createElement("span");
    count.className = "tb-vote-count";
    count.textContent = formatNumber(feature.vote_total);
    vote.appendChild(count);

    if (!isImplemented && !isExpired) {
      vote.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        handleVote(feature.id);
      });
    }

    var body = document.createElement("div");
    body.className = "tb-feature-body";

    var descriptionHtml = renderMarkdown(feature.description || "");

    var title = document.createElement("h3");
    title.className = "tb-feature-title";
    var titleButton = document.createElement("button");
    titleButton.type = "button";
    titleButton.className = "tb-feature-title-button";
    titleButton.textContent = feature.title;
    titleButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      openFeatureDetail(feature, descriptionHtml, titleButton);
    });
    title.appendChild(titleButton);
    body.appendChild(title);

    var description = document.createElement("div");
    description.className = "tb-feature-description tb-feature-description-preview";
    var previewText = getFeaturePreviewText(descriptionHtml, feature.description || "");
    if (previewText) {
      description.textContent = previewText;
    } else {
      description.textContent = "";
    }
    body.appendChild(description);

    var statusBlock = createStatusBlock(feature.creator, {
      hideWhenEmpty: true,
      extraClass: "tb-feature-status-inline",
    });
    if (statusBlock) {
      body.appendChild(statusBlock);
    }

    var meta = document.createElement("div");
    meta.className = "tb-feature-meta";

    var creatorItem = document.createElement("span");
    creatorItem.className = "tb-meta-item";
    creatorItem.appendChild(document.createTextNode("by "));
    creatorItem.appendChild(createProfileLink(feature.creator));
    meta.appendChild(creatorItem);

    meta.appendChild(createMetaDot());
    var time = document.createElement("span");
    time.className = "tb-meta-item";
    var timeline = feature.implemented_at
      ? "Implemented " + formatRelativeTime(feature.implemented_at)
      : formatRelativeTime(feature.created_at);
    time.textContent = timeline;
    meta.appendChild(time);

    if (expiresAt && !Number.isNaN(expiresAt.getTime())) {
      meta.appendChild(createMetaDot());
      var expiration = document.createElement("span");
      expiration.className = "tb-meta-item tb-meta-expiration";
      expiration.textContent = formatTimeUntil(expiresAt);
      meta.appendChild(expiration);
    }

    if (
      typeof feature.variation_count === "number" &&
      feature.variation_count > 0
    ) {
      meta.appendChild(createMetaDot());
      var variations = document.createElement("span");
      variations.className = "tb-meta-item";
      variations.textContent =
        "Variations: " + formatNumber(feature.variation_count);
      meta.appendChild(variations);
    }

    if (isImplemented && implementationState === "unsuccessful") {
      meta.appendChild(createMetaDot());
      var implementationBadge = document.createElement("span");
      implementationBadge.className =
        "tb-meta-item tb-meta-implementation-state";
      implementationBadge.classList.add("tb-meta-implementation-failed");
      implementationBadge.textContent = "FAILED";
      meta.appendChild(implementationBadge);
    }

    var actionsGroup = document.createElement("span");
    actionsGroup.className = "tb-meta-actions";
    appendMetaAction(actionsGroup, createVariationButton(feature));
    appendMetaAction(actionsGroup, createDeleteButton(feature));
    if (actionsGroup.childNodes.length) {
      meta.appendChild(actionsGroup);
    }

    body.appendChild(meta);

    card.appendChild(vote);
    card.appendChild(body);

    return card;
  }

  function createMetaDot() {
    var dot = document.createElement("span");
    dot.className = "tb-meta-dot";
    dot.textContent = "·";
    return dot;
  }

  function appendMetaAction(container, action) {
    if (!container || !action) {
      return;
    }
    container.appendChild(createMetaDot());
    container.appendChild(action);
  }

  function canDeleteFeature(feature) {
    if (!STATE.user || !feature || feature.implemented_at || feature.expired_at) {
      return false;
    }
    if (STATE.user.is_superuser) {
      return true;
    }
    return (
      feature.creator &&
      Number(STATE.user.id) === Number(feature.creator.id)
    );
  }

  function createVariationButton(feature) {
    if (!feature || feature.implemented_at || feature.expired_at) {
      return null;
    }
    var variationButton = document.createElement("button");
    variationButton.type = "button";
    variationButton.className = "tb-feature-variation";
    variationButton.textContent = "Add variation";
    variationButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      handleAddVariation(feature);
    });
    return variationButton;
  }

  function createDeleteButton(feature) {
    if (!canDeleteFeature(feature)) {
      return null;
    }
    var deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "tb-feature-delete";
    var inFlight = DELETE_IN_FLIGHT.has(feature.id);
    deleteButton.textContent = inFlight ? "Deleting..." : "Delete";
    deleteButton.disabled = inFlight;
    deleteButton.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      handleFeatureDelete(feature);
    });
    return deleteButton;
  }

  function getFeaturePreviewText(descriptionHtml, fallbackText) {
    var source = descriptionHtml || "";
    if (!source && fallbackText) {
      source = fallbackText;
    }
    if (!source) {
      return "";
    }
    var text = source;
    if (descriptionHtml) {
      var temp = document.createElement("div");
      temp.innerHTML = descriptionHtml;
      text = temp.textContent || temp.innerText || "";
    }
    var normalized = (text || "").replace(/\s+/g, " ").trim();
    if (normalized.length > 220) {
      normalized = normalized.slice(0, 220).trimEnd() + "…";
    }
    return normalized;
  }

  function createStatusBlock(user, options) {
    var settings = options || {};
    var status =
      user && typeof user.status === "string" ? user.status.trim() : "";

    if (!status && settings.hideWhenEmpty) {
      return null;
    }

    var wrapper = document.createElement("div");
    wrapper.className = "tb-feature-status";
    if (settings.extraClass) {
      wrapper.className += " " + settings.extraClass;
    }
    if (!status) {
      wrapper.classList.add("tb-feature-status-empty");
    }

    var label = document.createElement("span");
    label.className = "tb-feature-status-label";
    label.textContent = "Status";
    wrapper.appendChild(label);

    var text = document.createElement("span");
    text.className = "tb-feature-status-text";
    text.textContent =
      status || settings.emptyText || "No status shared yet.";
    wrapper.appendChild(text);

    return wrapper;
  }

  function openFeatureDetail(feature, descriptionHtml, triggerElement) {
    if (!ELEMENTS.detailOverlay || !ELEMENTS.detailModal || !feature) {
      return;
    }

    lastDetailTrigger = triggerElement || null;
    detailFeatureId = String(feature.id);
    setFeatureDetailContent(feature, descriptionHtml);
    ELEMENTS.detailOverlay.classList.add("tb-open");
    ELEMENTS.detailOverlay.setAttribute("aria-hidden", "false");
    detailModalOpen = true;

    setTimeout(function () {
      if (ELEMENTS.detailModal) {
        ELEMENTS.detailModal.focus();
      }
    }, 0);
  }

  function setFeatureDetailContent(feature, descriptionHtml) {
    if (!feature) {
      return;
    }

    if (ELEMENTS.detailFeatureTitle) {
      ELEMENTS.detailFeatureTitle.textContent = feature.title || "";
    }

    if (ELEMENTS.detailMeta) {
      ELEMENTS.detailMeta.innerHTML = "";
      ELEMENTS.detailMeta.appendChild(buildFeatureMetaFragment(feature));
    }

    renderDetailProfile(feature);

    if (ELEMENTS.detailDescription) {
      var html = descriptionHtml || renderMarkdown(feature.description || "");
      if (html) {
        ELEMENTS.detailDescription.innerHTML = html;
      } else {
        ELEMENTS.detailDescription.textContent = feature.description || "";
      }
    }

    renderDetailActions(feature);
    renderDetailVariations(feature);
  }

  function renderDetailProfile(feature) {
    var container = ELEMENTS.detailProfile;
    if (!container) {
      return;
    }
    container.innerHTML = "";
    if (!feature || !feature.creator) {
      return;
    }

    var header = document.createElement("div");
    header.className = "tb-detail-profile-header";

    var meta = document.createElement("div");
    meta.className = "tb-detail-profile-meta";

    var label = document.createElement("span");
    label.className = "tb-detail-profile-label";
    label.textContent = "Profile";
    meta.appendChild(label);

    meta.appendChild(createProfileLink(feature.creator, "tb-detail-profile-link"));
    header.appendChild(meta);

    var actions = document.createElement("div");
    actions.className = "tb-detail-profile-actions";

    var viewProfile = document.createElement("a");
    viewProfile.className = "tb-link";
    viewProfile.href =
      "/profiles/" + encodeURIComponent(feature.creator.username);
    viewProfile.textContent = "View profile";
    actions.appendChild(viewProfile);

    if (
      STATE.user &&
      feature.creator &&
      Number(STATE.user.id) === Number(feature.creator.id)
    ) {
      var editStatus = document.createElement("a");
      editStatus.className = "tb-link";
      editStatus.href = "/profile/";
      editStatus.textContent = "Edit status";
      actions.appendChild(editStatus);
    }

    if (actions.childNodes.length) {
      header.appendChild(actions);
    }

    container.appendChild(header);

    var statusBlock = createStatusBlock(feature.creator, {
      emptyText: "No status yet. Share what you're working on.",
      hideWhenEmpty: false,
    });
    if (statusBlock) {
      container.appendChild(statusBlock);
    }
  }

  function renderDetailActions(feature) {
    if (!ELEMENTS.detailActions) {
      return;
    }
    var container = ELEMENTS.detailActions;
    container.innerHTML = "";
    if (!feature) {
      return;
    }

    var fragment = document.createDocumentFragment();
    var variationButton = createVariationButton(feature);
    if (variationButton) {
      fragment.appendChild(createMetaDot());
      fragment.appendChild(variationButton);
    }

    var deleteButton = createDeleteButton(feature);
    if (deleteButton) {
      fragment.appendChild(createMetaDot());
      fragment.appendChild(deleteButton);
    }

    if (!fragment.childNodes.length) {
      return;
    }

    container.appendChild(fragment);
  }

  function renderDetailVariations(feature) {
    var container = ELEMENTS.detailVariations;
    if (!container) {
      return;
    }

    resetDetailVariationsContainer(container);
    if (!feature || typeof feature.id === "undefined") {
      return;
    }

    var variationCount =
      typeof feature.variation_count === "number" ? feature.variation_count : null;
    if (variationCount === 0) {
      return;
    }

    var featureId = String(feature.id);
    container.dataset.featureId = featureId;
    container.classList.add("tb-detail-variations-visible");
    container.appendChild(createDetailVariationsHeader(variationCount));

    var cached = DETAIL_VARIATIONS_CACHE[featureId];
    if (Array.isArray(cached)) {
      if (!cached.length || !appendDetailVariationsList(container, cached)) {
        resetDetailVariationsContainer(container);
      }
      return;
    }

    container.appendChild(createDetailVariationsStatus("Loading variations…"));

    fetchFeatureDetail(featureId)
      .then(function (detail) {
        if (container.dataset.featureId !== featureId) {
          return;
        }
        var variations = Array.isArray(detail && detail.variations)
          ? detail.variations
          : [];
        DETAIL_VARIATIONS_CACHE[featureId] = variations;
        if (!variations.length) {
          resetDetailVariationsContainer(container);
          return;
        }
        var updatedCount =
          detail &&
          detail.feature &&
          typeof detail.feature.variation_count === "number"
            ? detail.feature.variation_count
            : variationCount;
        container.innerHTML = "";
        container.dataset.featureId = featureId;
        container.classList.add("tb-detail-variations-visible");
        container.appendChild(createDetailVariationsHeader(updatedCount));
        if (!appendDetailVariationsList(container, variations)) {
          resetDetailVariationsContainer(container);
        }
      })
      .catch(function (error) {
        if (container.dataset.featureId !== featureId) {
          return;
        }
        container.innerHTML = "";
        container.dataset.featureId = featureId;
        container.classList.add("tb-detail-variations-visible");
        container.appendChild(createDetailVariationsHeader(variationCount));
        container.appendChild(
          createDetailVariationsStatus(
            error && error.message
              ? error.message
              : "Unable to load variations.",
            true
          )
        );
      });
  }

  function resetDetailVariationsContainer(container) {
    container.innerHTML = "";
    container.classList.remove("tb-detail-variations-visible");
    delete container.dataset.featureId;
  }

  function createDetailVariationsHeader(count) {
    var header = document.createElement("div");
    header.className = "tb-variation-header";
    var title = document.createElement("h3");
    title.className = "tb-detail-subtitle";
    title.textContent = "Variations";
    header.appendChild(title);
    if (typeof count === "number" && count > 0) {
      var label = document.createElement("span");
      label.className = "tb-variation-count";
      label.textContent = count === 1 ? "1 idea" : count + " ideas";
      header.appendChild(label);
    }
    return header;
  }

  function createDetailVariationsStatus(message, isError) {
    var className = "tb-variation-status";
    if (isError) {
      className += " tb-variation-status-error";
    }
    var status = document.createElement("div");
    status.className = className;
    status.textContent = message;
    return status;
  }

  function appendDetailVariationsList(container, variations) {
    var list = createDetailVariationsList(variations);
    if (!list.childNodes.length) {
      return false;
    }
    container.appendChild(list);
    return true;
  }

  function createDetailVariationsList(variations) {
    var list = document.createElement("ul");
    list.className = "tb-variation-list";
    variations.forEach(function (variation) {
      if (!variation || typeof variation.id === "undefined") {
        return;
      }
      var item = document.createElement("li");
      item.className = "tb-variation-item";
      var button = document.createElement("button");
      button.type = "button";
      button.className = "tb-variation-link";
      button.textContent = variation.title || "Untitled variation";
      button.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        handleDetailVariationSelect(variation.id, button);
      });
      item.appendChild(button);
      list.appendChild(item);
    });
    return list;
  }

  function handleDetailVariationSelect(variationId, triggerElement) {
    if (variationId == null) {
      return;
    }
    var feature = getFeatureById(variationId);
    if (feature) {
      var descriptionHtml = renderMarkdown(feature.description || "");
      openFeatureDetail(feature, descriptionHtml, triggerElement);
      return;
    }
    fetchFeatureDetail(variationId)
      .then(function (detail) {
        if (!detail || !detail.feature) {
          throw new Error("Unable to load variation.");
        }
        var html = renderMarkdown(detail.feature.description || "");
        if (Array.isArray(detail.variations)) {
          DETAIL_VARIATIONS_CACHE[String(detail.feature.id)] = detail.variations;
        }
        openFeatureDetail(detail.feature, html, triggerElement);
      })
      .catch(function (error) {
        showToast(
          (error && error.message) || "Unable to open variation.",
          "error"
        );
      });
  }

  function refreshOpenFeatureDetail() {
    if (!detailModalOpen || detailFeatureId === null) {
      return;
    }
    var feature = getFeatureById(detailFeatureId);
    if (!feature) {
      closeFeatureDetail();
      return;
    }
    var descriptionHtml = renderMarkdown(feature.description || "");
    setFeatureDetailContent(feature, descriptionHtml);
  }

  function closeFeatureDetail() {
    if (!ELEMENTS.detailOverlay) {
      return;
    }
    ELEMENTS.detailOverlay.classList.remove("tb-open");
    ELEMENTS.detailOverlay.setAttribute("aria-hidden", "true");
    detailModalOpen = false;
    detailFeatureId = null;
    if (lastDetailTrigger && typeof lastDetailTrigger.focus === "function") {
      try {
        lastDetailTrigger.focus();
      } catch (error) {
        // Ignore focus errors
      }
    }
    lastDetailTrigger = null;
  }

  function getFeatureMetaParts(feature) {
    var parts = [];
    var timeline = feature.implemented_at
      ? "Implemented " + formatRelativeTime(feature.implemented_at)
      : formatRelativeTime(feature.created_at);
    parts.push(timeline);
    var implementationState =
      typeof feature.implemented_state === "string"
        ? feature.implemented_state.toLowerCase()
        : "";
    if (feature.implemented_at && implementationState === "unsuccessful") {
      parts.push("FAILED");
    }
    if (typeof feature.variation_count === "number" && feature.variation_count > 0) {
      parts.push("Variations: " + formatNumber(feature.variation_count));
    }
    return parts;
  }

  function buildFeatureMetaFragment(feature) {
    var fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode("by "));
    fragment.appendChild(createProfileLink(feature && feature.creator ? feature.creator : null));
    var parts = getFeatureMetaParts(feature);
    parts.forEach(function (part) {
      fragment.appendChild(document.createTextNode(" · " + part));
    });
    return fragment;
  }

  function formatFeatureMeta(feature) {
    var parts = getFeatureMetaParts(feature);
    parts.unshift("by " + getCreatorName(feature));
    return parts.join(" · ");
  }

  function getFeatureById(id) {
    if (id === null || typeof id === "undefined") {
      return null;
    }
    var target = String(id);
    var pools = [STATE.features, STATE.implementedFeatures];
    for (var p = 0; p < pools.length; p += 1) {
      var list = pools[p] || [];
      for (var i = 0; i < list.length; i += 1) {
        var feature = list[i];
        if (String(feature.id) === target) {
          return feature;
        }
      }
    }
    return null;
  }

  function handleVote(featureId) {
    if (VOTE_IN_FLIGHT.has(featureId)) {
      return;
    }

    var targetFeature = getFeatureById(featureId);
    if (targetFeature && targetFeature.implemented_at) {
      showToast("Implemented features are read-only.", "info");
      return;
    }

    if (!STATE.user) {
      STATE.authView = "login";
      STATE.authError = "Please sign in to vote on features.";
      renderHeaderUser();
      openAuthModal("login");
      showToast("Sign in to add your vote.", "warn");
      return;
    }

    VOTE_IN_FLIGHT.add(featureId);
    renderFeatures();

    function executeVote(turnstileToken) {
      fetch(ENDPOINTS.vote(featureId), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({ turnstile_token: turnstileToken }),
      })
        .then(function (response) {
          if (response.status === 401) {
            STATE.user = null;
            STATE.authView = "login";
            STATE.authError = "Please sign in to vote on features.";
            renderHeaderUser();
            openAuthModal("login");
            showToast("Sign in to add your vote.", "warn");
            throw new Error("unauthorized");
          }
          if (!response.ok) {
            return extractError(response, "Unable to update vote.").then(function (
              message
            ) {
              throw new Error(message);
            });
          }
          return response.json();
        })
        .then(function (result) {
          STATE.features = STATE.features.map(function (feature) {
            if (feature.id === featureId) {
              return Object.assign({}, feature, {
                vote_total: result.vote_total,
                user_has_voted: result.has_voted,
              });
            }
            return feature;
          });
          renderFeatures();
          showToast(
            result.action === "added" ? "Vote added." : "Vote removed.",
            "success"
          );
        })
        .catch(function (error) {
          if (error && error.message === "unauthorized") {
            return;
          }
          showToast(error.message || "Unable to update vote.", "error");
        })
        .finally(function () {
          VOTE_IN_FLIGHT.delete(featureId);
          renderFeatures();
        });
    }

    if (window.turnstile && typeof window.turnstile.render === "function") {
      var tempContainer = document.createElement("div");
      tempContainer.style.position = "fixed";
      tempContainer.style.top = "-9999px";
      tempContainer.style.left = "-9999px";
      document.body.appendChild(tempContainer);

      try {
        var sitekey = document.body.dataset.turnstileSitekey;
        if (!sitekey) {
          if (tempContainer.parentNode) {
            document.body.removeChild(tempContainer);
          }
          executeVote("");
          return;
        }
        var widgetId = window.turnstile.render(tempContainer, {
          sitekey: sitekey,
          action: "vote",
          size: "invisible",
          execution: "execute",
          callback: function (token) {
            if (tempContainer.parentNode) {
              document.body.removeChild(tempContainer);
            }
            executeVote(token);
          },
          "expired-callback": function () {
            if (tempContainer.parentNode) {
              document.body.removeChild(tempContainer);
            }
            VOTE_IN_FLIGHT.delete(featureId);
            renderFeatures();
            showToast("Verification expired. Please try again.", "warn");
          },
          "error-callback": function () {
            if (tempContainer.parentNode) {
              document.body.removeChild(tempContainer);
            }
            VOTE_IN_FLIGHT.delete(featureId);
            renderFeatures();
            showToast("Verification failed. Please try again.", "error");
          },
        });
        try {
          if (typeof window.turnstile.execute === "function") {
            window.turnstile.execute(widgetId);
          } else {
            throw new Error("Turnstile execute API unavailable");
          }
        } catch (executeError) {
          if (tempContainer.parentNode) {
            document.body.removeChild(tempContainer);
          }
          VOTE_IN_FLIGHT.delete(featureId);
          renderFeatures();
          showToast("Unable to verify. Please try again.", "error");
        }
      } catch (error) {
        if (tempContainer.parentNode) {
          document.body.removeChild(tempContainer);
        }
        VOTE_IN_FLIGHT.delete(featureId);
        renderFeatures();
        showToast("Unable to verify. Please try again.", "error");
      }
    } else {
      executeVote("");
    }
  }

  function handleFeatureDelete(feature) {
    if (!feature || !STATE.user) {
      return;
    }

    var isCreator =
      feature.creator &&
      Number(feature.creator.id) === Number(STATE.user.id);
    var canDelete = isCreator || Boolean(STATE.user.is_superuser);
    if (!canDelete) {
      return;
    }

    var featureId = feature.id;
    if (DELETE_IN_FLIGHT.has(featureId)) {
      return;
    }

    var confirmed = window.confirm(
      "Delete this feature request? This action cannot be undone."
    );
    if (!confirmed) {
      return;
    }

    DELETE_IN_FLIGHT.add(featureId);
    renderFeatures();

    fetch(ENDPOINTS.deleteFeature(featureId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    })
      .then(function (response) {
        if (response.status === 401) {
          STATE.user = null;
          STATE.authView = "login";
          STATE.authError = "Please sign in to manage your features.";
          renderHeaderUser();
          openAuthModal("login");
          showToast("Sign in to delete features.", "warn");
          throw new Error("unauthorized");
        }
        if (!response.ok) {
          return extractError(response, "Unable to delete feature.").then(
            function (message) {
              throw new Error(message);
            }
          );
        }
        return response.json();
      })
      .then(function () {
        STATE.features = STATE.features.filter(function (item) {
          return item.id !== featureId;
        });
        renderFeatures();
        showToast("Feature deleted.", "success");
        fetchFeatures();
      })
      .catch(function (error) {
        if (error && error.message === "unauthorized") {
          return;
        }
        showToast(error.message || "Unable to delete feature.", "error");
      })
      .finally(function () {
        DELETE_IN_FLIGHT.delete(featureId);
        renderFeatures();
      });
  }

  function handleAddVariation(feature) {
    if (!feature) {
      return;
    }

    if (!STATE.user) {
      STATE.authView = "login";
      STATE.authError = "Please sign in to submit features.";
      renderHeaderUser();
      openAuthModal("login");
      showToast("Sign in to submit features.", "warn");
      return;
    }

    if (!STATE.canSubmit) {
      showToast(
        "Daily submission limit reached. Thanks for contributing!",
        "warn"
      );
      return;
    }

    STATE.showSubmitForm = true;
    STATE.submitError = null;
    STATE.submitDefaults = {
      title: feature.title || "",
      description: feature.description || "",
      parentId: feature.id,
      parentTitle: feature.title || "",
    };
    renderSubmitPanel();
    renderControlsActions();

    if (
      ELEMENTS.submitPanel &&
      typeof ELEMENTS.submitPanel.scrollIntoView === "function"
    ) {
      ELEMENTS.submitPanel.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  }

  function handleLogin(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var username = (form.elements.username.value || "").trim();
    var password = form.elements.password.value || "";

    if (!username || !password) {
      STATE.authError = "Username and password are required.";
      renderAuth();
      return;
    }

    toggleFormDisabled(form, true);

    fetch(ENDPOINTS.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ username: username, password: password }),
    })
      .then(function (response) {
        if (!response.ok) {
          return extractError(response, "Unable to sign in.").then(function (
            message
          ) {
            throw new Error(message);
          });
        }
        return response.json();
      })
      .then(function (data) {
        STATE.user = data.user || null;
        STATE.authView = "profile";
        STATE.authError = null;
        showToast("Signed in.", "success");
        closeAuthModal();
        fetchFeatures(true);
      })
      .catch(function (error) {
        STATE.authError = error.message || "Unable to sign in.";
        renderAuth();
      })
      .finally(function () {
        toggleFormDisabled(form, false);
      });
  }

  function handleSignup(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var username = (form.elements.username.value || "").trim();
    var password = form.elements.password.value || "";
    var confirm = form.elements.password_confirm.value || "";

    if (!username || !password || !confirm) {
      STATE.authError = "All fields are required.";
      renderAuth();
      return;
    }
    if (password !== confirm) {
      STATE.authError = "Passwords do not match.";
      renderAuth();
      return;
    }

    toggleFormDisabled(form, true);

    fetch(ENDPOINTS.signup, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        username: username,
        password: password,
        password_confirm: confirm,
      }),
    })
      .then(function (response) {
        if (!response.ok) {
          return extractError(response, "Unable to create your account.").then(
            function (message) {
              throw new Error(message);
            }
          );
        }
        return response.json();
      })
      .then(function (data) {
        STATE.user = data.user || null;
        STATE.authView = "profile";
        STATE.authError = null;
        showToast("Account created. Welcome!", "success");
        closeAuthModal();
        fetchFeatures(true);
      })
      .catch(function (error) {
        STATE.authError = error.message || "Unable to create your account.";
        renderAuth();
      })
      .finally(function () {
        toggleFormDisabled(form, false);
      });
  }

  function handleLogout() {
    fetch(ENDPOINTS.logout, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: "{}",
    })
      .then(function (response) {
        if (!response.ok) {
          return extractError(response, "Could not log out right now.").then(
            function (message) {
              throw new Error(message);
            }
          );
        }
        return null;
      })
      .then(function () {
        STATE.user = null;
        STATE.authView = "login";
        STATE.authError = null;
        showToast("Signed out.", "success");
        fetchFeatures(true);
      })
      .catch(function (error) {
        showToast(error.message || "Could not log out right now.", "error");
      });
  }

  function handleFeatureCreate(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var title = (form.elements.title.value || "").trim();
    var description = (form.elements.description.value || "").trim();
    var parentElement = form.elements.parent_id;
    var parentValue = parentElement ? parentElement.value : "";
    var parentId = parentValue ? Number(parentValue) : null;
    if (Number.isNaN(parentId)) {
      parentId = null;
    }

    if (parentId) {
      var existingDefaults =
        STATE.submitDefaults && typeof STATE.submitDefaults === "object"
          ? STATE.submitDefaults
          : {};
      STATE.submitDefaults = Object.assign({}, existingDefaults, {
        parentId: parentId,
        title: title,
        description: description,
      });
    } else {
      STATE.submitDefaults = null;
    }

    if (!title || !description) {
      STATE.submitError = "Title and description are required.";
      renderSubmitPanel();
      return;
    }

    var turnstileToken = "";
    var turnstileContainer = document.getElementById("tb-submit-turnstile");
    if (turnstileContainer && turnstileContainer.dataset.turnstileWidgetId) {
      try {
        turnstileToken = window.turnstile.getResponse(
          turnstileContainer.dataset.turnstileWidgetId
        );
      } catch (error) {
        console.error("Turnstile getResponse error:", error);
      }
    }

    toggleFormDisabled(form, true);

    fetch(ENDPOINTS.createFeature, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        title: title,
        description: description,
        parent_id: parentId,
        turnstile_token: turnstileToken,
      }),
    })
      .then(function (response) {
        if (response.status === 401) {
          STATE.user = null;
          STATE.authView = "login";
          STATE.authError = "Please sign in to submit features.";
          STATE.showSubmitForm = false;
          STATE.submitDefaults = null;
          renderHeaderUser();
          openAuthModal("login");
          renderSubmitPanel();
          renderControlsActions();
          showToast("Sign in to submit features.", "warn");
          throw new Error("unauthorized");
        }
        if (!response.ok) {
          return extractError(response, "Unable to submit feature.").then(
            function (message) {
              throw new Error(message);
            }
          );
        }
        return response.json();
      })
      .then(function (data) {
        STATE.showSubmitForm = false;
        STATE.submitError = null;
        STATE.submitDefaults = null;
        if (data && data.feature) {
          var feature = data.feature;
          if (Array.isArray(STATE.features)) {
            STATE.features = [feature].concat(STATE.features);
          } else {
            STATE.features = [feature];
          }
          renderFeatures();
        }
        renderSubmitPanel();
        renderControlsActions();
        showToast("Feature submitted with your vote!", "success");
        fetchFeatures(true);
      })
      .catch(function (error) {
        if (error && error.message === "unauthorized") {
          return;
        }
        STATE.submitError = error.message || "Unable to submit feature.";
        renderSubmitPanel();
        if (turnstileContainer && turnstileContainer.dataset.turnstileWidgetId) {
          try {
            window.turnstile.reset(turnstileContainer.dataset.turnstileWidgetId);
          } catch (resetError) {
            console.error("Turnstile reset error:", resetError);
          }
        }
      })
      .finally(function () {
        toggleFormDisabled(form, false);
      });
  }

  function toggleFormDisabled(form, disabled) {
    Array.prototype.forEach.call(form.elements, function (element) {
      element.disabled = disabled;
    });
    if (disabled) {
      form.classList.add("tb-busy");
    } else {
      form.classList.remove("tb-busy");
    }
  }

  function showToast(message, tone) {
    if (!message || !ELEMENTS.toastStack) {
      return;
    }
    var toast = document.createElement("div");
    var className = "tb-toast";
    if (tone === "success") {
      className += " tb-toast-success";
    } else if (tone === "warn") {
      className += " tb-toast-warn";
    } else if (tone === "error") {
      className += " tb-toast-error";
    }
    toast.className = className;
    toast.textContent = message;
    ELEMENTS.toastStack.appendChild(toast);

    setTimeout(function () {
      toast.style.animation = "tb-toast-out 0.3s forwards";
      var remove = function () {
        toast.removeEventListener("animationend", remove);
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      };
      toast.addEventListener("animationend", remove);
    }, 3200);
  }

  function extractError(response, fallback) {
    return response
      .json()
      .then(function (data) {
        if (data && typeof data.error === "string") {
          return data.error;
        }
        return fallback;
      })
      .catch(function () {
        return fallback;
      });
  }

  function renderMarkdown(markdown) {
    if (markdown == null) {
      return "";
    }
    var normalized = String(markdown)
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .trim();
    if (!normalized) {
      return "";
    }
    var blocks = normalized.split(/\n{2,}/);
    var html = blocks
      .map(function (block) {
        return renderMarkdownBlock(block);
      })
      .filter(Boolean)
      .join("");
    return html;
  }

  function renderMarkdownBlock(block) {
    var trimmed = block.trim();
    if (!trimmed) {
      return "";
    }

    if (/^```/.test(trimmed)) {
      return renderFencedCode(trimmed);
    }

    var headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      var level = Math.min(headingMatch[1].length, 6);
      var content = headingMatch[2] || "";
      return (
        "<h" +
        level +
        ">" +
        renderInlineMarkdown(content) +
        "</h" +
        level +
        ">"
      );
    }

    var lines = trimmed.split("\n");
    if (isListBlock(lines, false)) {
      var unordered = lines
        .map(function (line) {
          var text = line.trim();
          if (!text) {
            return "";
          }
          var content = text.replace(/^[-*+]\s+/, "");
          return "<li>" + renderInlineMarkdown(content) + "</li>";
        })
        .filter(Boolean)
        .join("");
      if (unordered) {
        return "<ul>" + unordered + "</ul>";
      }
    }

    if (isListBlock(lines, true)) {
      var ordered = lines
        .map(function (line) {
          var text = line.trim();
          if (!text) {
            return "";
          }
          var content = text.replace(/^\d+\.\s+/, "");
          return "<li>" + renderInlineMarkdown(content) + "</li>";
        })
        .filter(Boolean)
        .join("");
      if (ordered) {
        return "<ol>" + ordered + "</ol>";
      }
    }

    var isBlockquote = lines.every(function (line) {
      return !line.trim() || /^>\s?/.test(line);
    });
    if (isBlockquote) {
      var quoteHtml = lines
        .map(function (line) {
          if (!line.trim()) {
            return "";
          }
          return renderInlineMarkdown(line.replace(/^>\s?/, ""));
        })
        .filter(Boolean)
        .join("<br>");
      if (quoteHtml) {
        return '<blockquote class="tb-md-quote">' + quoteHtml + "</blockquote>";
      }
    }

    return "<p>" + renderInlineMarkdown(trimmed) + "</p>";
  }

  function renderFencedCode(block) {
    var lines = block.split("\n");
    var firstLine = lines.shift();
    if (!firstLine) {
      return "";
    }
    var fenceMatch = firstLine.match(/^```(\w+)?\s*$/);
    var language = fenceMatch && fenceMatch[1] ? fenceMatch[1].toLowerCase() : "";
    if (lines.length && lines[lines.length - 1].trim() === "```") {
      lines.pop();
    }
    var code = lines.join("\n");
    var className = language
      ? ' class="language-' + escapeHtml(language) + '"'
      : "";
    return "<pre><code" + className + ">" + escapeHtml(code) + "</code></pre>";
  }

  function isListBlock(lines, ordered) {
    return lines.every(function (line) {
      var trimmed = line.trim();
      if (!trimmed) {
        return true;
      }
      if (ordered) {
        return /^\d+\.\s+/.test(trimmed);
      }
      return /^[-*+]\s+/.test(trimmed);
    });
  }

  function renderInlineMarkdown(text) {
    if (!text) {
      return "";
    }
    var escaped = escapeHtml(text);

    var codeTokens = [];
    escaped = escaped.replace(/`([^`]+)`/g, function (_, code) {
      var token = "__TB_CODE_SPAN_" + codeTokens.length + "__";
      codeTokens.push(code);
      return token;
    });

    var escapedChars = [];
    escaped = escaped.replace(/\\([\\`*_~\[\]()])/g, function (_, char) {
      var token = "__TB_ESCAPED_CHAR_" + escapedChars.length + "__";
      escapedChars.push(char);
      return token;
    });

    escaped = escaped.replace(/\*\*([^\s*][^*]*?)\*\*/g, "<strong>$1</strong>");
    escaped = escaped.replace(/__([^\s_][^_]*?)__/g, "<strong>$1</strong>");
    escaped = escaped.replace(/\*([^\s*][^*]*?)\*/g, "<em>$1</em>");
    escaped = escaped.replace(/_([^\s_][^_]*?)_/g, "<em>$1</em>");
    escaped = escaped.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (
      _,
      label,
      href
    ) {
      var cleanHref = sanitizeUrl(href);
      if (!cleanHref) {
        return label;
      }
      return (
        '<a href="' +
        cleanHref +
        '" target="_blank" rel="noopener noreferrer">' +
        label +
        "</a>"
      );
    });

    escaped = escaped.replace(/\n/g, "<br>");

    escaped = escaped.replace(/__TB_CODE_SPAN_(\d+)__/g, function (_, index) {
      var code = codeTokens[Number(index)] || "";
      return "<code>" + code + "</code>";
    });

    return escaped.replace(/__TB_ESCAPED_CHAR_(\d+)__/g, function (_, index) {
      var char = escapedChars[Number(index)] || "";
      return char;
    });
  }

  function sanitizeUrl(url) {
    if (!url) {
      return null;
    }
    var trimmed = String(url).trim();
    if (!trimmed) {
      return null;
    }
    try {
      var parsed = new URL(trimmed, window.location.origin);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  function escapeHtml(value) {
    if (value == null) {
      return "";
    }
    return String(value).replace(/[&<>"']/g, function (char) {
      switch (char) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return char;
      }
    });
  }

  function formatRelativeTime(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    var now = Date.now();
    var diff = now - date.getTime();
    var minute = 60000;
    var hour = 60 * minute;
    var day = 24 * hour;
    if (diff < minute) {
      return "just now";
    }
    if (diff < hour) {
      var mins = Math.round(diff / minute);
      return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
    }
    if (diff < day) {
      var hours = Math.round(diff / hour);
      return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
    }
    var days = Math.round(diff / day);
    if (days <= 7) {
      return days + " day" + (days === 1 ? "" : "s") + " ago";
    }
    return date.toLocaleDateString();
  }

  function formatTimeUntil(value) {
    var target = new Date(value);
    if (Number.isNaN(target.getTime())) {
      return "";
    }
    var diff = target.getTime() - Date.now();
    var minute = 60000;
    var hour = 60 * minute;
    var day = 24 * hour;
    if (diff <= 0) {
      return "Expires soon";
    }
    if (diff < hour) {
      var mins = Math.ceil(diff / minute);
      return "Expires in " + mins + " minute" + (mins === 1 ? "" : "s");
    }
    if (diff < day) {
      var hours = Math.ceil(diff / hour);
      return "Expires in " + hours + " hour" + (hours === 1 ? "" : "s");
    }
    var days = Math.ceil(diff / day);
    return "Expires in " + days + " day" + (days === 1 ? "" : "s");
  }

  function formatNumber(value) {
    if (typeof Intl !== "undefined" && Intl.NumberFormat) {
      return new Intl.NumberFormat().format(value);
    }
    return String(value);
  }

  function createProfileLink(user, extraClass) {
    var label = "Unknown member";
    if (user && (user.display_name || user.username)) {
      label = user.display_name || user.username;
    }
    var classes = ["tb-profile-link"];
    if (extraClass) {
      classes.push(extraClass);
    }
    var className = classes.join(" ");
    if (!user || !user.username) {
      var fallback = document.createElement("span");
      fallback.className = className;
      fallback.textContent = label;
      return fallback;
    }
    var link = document.createElement("a");
    link.href = "/profiles/" + encodeURIComponent(user.username);
    link.textContent = label;
    link.className = className;
    link.setAttribute("data-profile-username", user.username);
    return link;
  }

  function getCreatorName(feature) {
    if (feature && feature.creator) {
      return (
        feature.creator.display_name || feature.creator.username || "Unknown"
      );
    }
    return "Unknown";
  }

  function getInitials(user) {
    var name = (user.display_name || user.username || "TB").trim();
    var parts = name.split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return "TB";
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
})();
