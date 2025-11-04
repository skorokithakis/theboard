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
    login: API_BASE + "/auth/login",
    logout: API_BASE + "/auth/logout",
    signup: API_BASE + "/auth/signup",
  };

  var STATE = {
    features: [],
    implementedFeatures: [],
    user: null,
    canSubmit: false,
    loading: false,
    error: null,
    authView: "login",
    authError: null,
    showSubmitForm: false,
    submitError: null,
    submitDefaults: null,
  };

  var VOTE_IN_FLIGHT = new Set();
  var DELETE_IN_FLIGHT = new Set();
  var ELEMENTS = {};
  var fetchPromise = null;
  var authModalOpen = false;
  var detailModalOpen = false;
  var detailFeatureId = null;
  var lastDetailTrigger = null;
  var implementedModalOpen = false;
  var lastImplementedTrigger = null;

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
    createAuthModal();
    attachGlobalShortcuts();
    renderHeaderUser();
    renderAuth();
    renderSubmitPanel();
    renderControlsActions();
    renderStatus();
    renderFeatures();
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

  function injectCSS() {
    if (document.getElementById("the-board-widget-style")) {
      return;
    }

    var style = document.createElement("style");
    style.id = "the-board-widget-style";
    var css = [
      ".tb-launcher { position: fixed; top: 50%; right: -2.5rem; transform: translateY(-50%) rotate(-90deg); display: inline-flex; align-items: center; gap: 0.6rem; padding: 0.65rem 1.2rem; border-radius: 999px; font-size: 0.95rem; font-weight: 600; color: #ffffff; background: linear-gradient(135deg, #10b981, #059669); border: none; box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3); cursor: pointer; z-index: 2147483640; transition: all 0.2s ease; }",
      ".tb-launcher-dot { width: 1.65rem; height: 1.65rem; border-radius: 999px; background: rgba(255, 255, 255, 0.25); display: inline-flex; align-items: center; justify-content: center; box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.35); position: relative; }",
      ".tb-launcher-dot::after { content: \"\"; width: 0.65rem; height: 0.65rem; border-radius: 50%; background: #ffffff; opacity: 0.9; }",
      ".tb-launcher-label { letter-spacing: -0.02em; }",
      ".tb-launcher:hover { transform: translateY(-50%) translateX(-2px) rotate(-90deg); box-shadow: 0 20px 50px rgba(16, 185, 129, 0.4); }",
      ".tb-launcher:active { transform: translateY(-50%) rotate(-90deg); box-shadow: 0 10px 25px rgba(16, 185, 129, 0.3); }",
      ".tb-launcher:focus-visible { outline: 3px solid rgba(16, 185, 129, 0.4); outline-offset: 4px; }",
      ".tb-launcher-hidden { opacity: 0; pointer-events: none; }",
      "body.tb-modal-open { overflow: hidden; }",
      ".tb-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2147483630; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-modal { position: relative; width: min(900px, 95vw); max-height: 85vh; background: #ffffff; border-radius: 20px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-auth-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2147483635; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-auth-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-auth-modal { position: relative; width: min(480px, 95vw); background: #ffffff; border-radius: 20px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-detail-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2147483636; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-detail-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-detail-modal { position: relative; width: min(720px, 95vw); max-height: 85vh; background: #ffffff; border-radius: 20px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-implemented-overlay { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; padding: 2rem; background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(4px); z-index: 2147483635; opacity: 0; visibility: hidden; pointer-events: none; transition: opacity 0.2s ease; }",
      ".tb-implemented-overlay.tb-open { opacity: 1; visibility: visible; pointer-events: auto; }",
      ".tb-implemented-modal { position: relative; width: min(840px, 95vw); max-height: 85vh; background: #ffffff; border-radius: 20px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.2); overflow: hidden; display: flex; flex-direction: column; }",
      ".tb-implemented-body { flex: 1; overflow-y: auto; padding: 1.5rem 2rem 2rem; }",
      ".tb-implemented-body::-webkit-scrollbar { width: 8px; }",
      ".tb-implemented-body::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 4px; }",
      ".tb-detail-body { flex: 1; overflow-y: auto; padding: 1.5rem 2rem 2rem; }",
      ".tb-detail-body::-webkit-scrollbar { width: 8px; }",
      ".tb-detail-body::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 4px; }",
      ".tb-detail-content { display: flex; flex-direction: column; gap: 1.25rem; }",
      ".tb-detail-feature-title { font-size: 1.5rem; font-weight: 600; color: #0f172a; margin: 0; }",
      ".tb-detail-meta { font-size: 0.95rem; color: #4b5563; }",
      ".tb-detail-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 2rem; border-top: 1px solid #e5e5e5; background: #fafafa; }",
      ".tb-detail-actions { display: inline-flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; font-size: 0.9rem; }",
      ".tb-detail-actions .tb-meta-dot { color: #999999; }",
      ".tb-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1.5rem 2rem; border-bottom: 2px solid #e5e5e5; flex-shrink: 0; }",
      ".tb-brand { display: flex; flex-direction: column; gap: 0.4rem; }",
      ".tb-logo { font-size: 1.5rem; font-weight: 700; letter-spacing: -0.02em; background: linear-gradient(135deg, #10b981, #059669); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }",
      ".tb-subtitle { font-size: 0.875rem; color: #666666; }",
      ".tb-header-user { display: inline-flex; align-items: center; gap: 1rem; font-size: 0.875rem; }",
      ".tb-link { background: none; border: none; padding: 0; font-size: 0.875rem; font-weight: 500; color: #059669; cursor: pointer; text-decoration: none; transition: color 0.2s ease; }",
      ".tb-link:hover { color: #047857; }",
      ".tb-close { width: 2rem; height: 2rem; border-radius: 50%; border: none; background: transparent; color: #999999; font-size: 1.5rem; line-height: 1; cursor: pointer; transition: all 0.2s ease; }",
      ".tb-close:hover { background: #f5f5f5; color: #1a1a1a; }",
      ".tb-body { display: flex; flex-direction: column; flex: 1; overflow: auto; }",
      ".tb-body::-webkit-scrollbar { width: 8px; }",
      ".tb-body::-webkit-scrollbar-thumb { background: #d4d4d4; border-radius: 4px; }",
      ".tb-auth-panel { flex: 0 0 auto; padding: 1.5rem 2rem; border-bottom: 1px solid #e5e5e5; background: #fafafa; }",
      ".tb-submit-panel { flex: 0 0 auto; padding: 1.5rem 2rem; border-bottom: 1px solid #e5e5e5; background: #fafafa; }",
      ".tb-button-group { display: flex; gap: 0.75rem; }",
      ".tb-btn-secondary { border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; background: transparent; color: #666666; border: 2px solid #e5e5e5; cursor: pointer; transition: all 0.2s ease; min-height: 46px; }",
      ".tb-btn-secondary:hover { background: #f5f5f5; border-color: #d4d4d4; }",
      ".tb-btn-secondary[disabled] { opacity: 0.6; cursor: not-allowed; }",
      ".tb-main-panel { flex: 1 1 auto; display: flex; flex-direction: column; }",
      ".tb-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 2rem; border-bottom: 1px solid #e5e5e5; background: #fafafa; }",
      ".tb-status { font-size: 0.875rem; font-weight: 500; color: #666666; flex: 1 1 auto; }",
      ".tb-status-info { color: #059669; }",
      ".tb-status-warning { color: #ea580c; }",
      ".tb-status-error { color: #dc2626; }",
      ".tb-status-muted { color: #999999; }",
      ".tb-refresh { width: 2rem; height: 2rem; border-radius: 50%; border: none; background: transparent; color: #999999; font-size: 1.125rem; line-height: 1; cursor: pointer; transition: all 0.2s ease; display: inline-flex; align-items: center; justify-content: center; }",
      ".tb-refresh:hover { background: #f5f5f5; color: #059669; }",
      ".tb-btn-primary { border-radius: 8px; padding: 0.5rem 1.5rem; font-size: 0.875rem; font-weight: 500; background: #059669; color: #ffffff; border: 2px solid #059669; cursor: pointer; transition: all 0.2s ease; min-height: 36px; }",
      ".tb-btn-primary:hover { background: #047857; border-color: #047857; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }",
      ".tb-feature-list { flex: 1 1 auto; display: flex; flex-direction: column; }",
      ".tb-feature { display: flex; gap: 1rem; padding: 1.5rem 2rem; background: white; border-bottom: 1px solid #e5e5e5; transition: all 0.2s ease; }",
      ".tb-feature:hover { background: #f5f5f5; border-color: #d4d4d4; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); }",
      ".tb-feature:last-child { border-bottom: 0; }",
      ".tb-feature-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-feature-title { font-size: 1.125rem; font-weight: 600; color: #1a1a1a; line-height: 1.3; }",
      ".tb-feature-title-button { border: none; background: none; padding: 0; margin: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; display: inline-flex; align-items: center; gap: 0.35rem; }",
      ".tb-feature-title-button:hover { text-decoration: underline; }",
      ".tb-feature-title-button:focus-visible { outline: 2px solid #059669; outline-offset: 2px; border-radius: 6px; }",
      ".tb-feature-description { font-size: 1rem; color: #666666; line-height: 1.5; }",
      ".tb-feature-description-preview { overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }",
      ".tb-feature-description p { margin: 0 0 0.75rem; }",
      ".tb-feature-description p:last-child { margin-bottom: 0; }",
      ".tb-feature-description ul, .tb-feature-description ol { margin: 0 0 0.75rem 1.25rem; padding: 0; }",
      ".tb-feature-description li { margin: 0.25rem 0; }",
      ".tb-feature-description blockquote { margin: 0 0 0.75rem; padding-left: 1rem; border-left: 3px solid rgba(16, 185, 129, 0.6); color: #047857; }",
      ".tb-feature-description pre { margin: 0 0 0.75rem; padding: 0.75rem 1rem; background: #f0fdfa; border-radius: 12px; overflow: auto; font-size: 0.9em; }",
      ".tb-feature-description pre code { background: none; color: inherit; padding: 0; }",
      ".tb-feature-description h1, .tb-feature-description h2, .tb-feature-description h3, .tb-feature-description h4, .tb-feature-description h5, .tb-feature-description h6 { margin: 1.25rem 0 0.75rem; font-weight: 600; line-height: 1.2; color: #0f172a; }",
      ".tb-feature-description h1 { font-size: 1.6rem; }",
      ".tb-feature-description h2 { font-size: 1.45rem; }",
      ".tb-feature-description h3 { font-size: 1.3rem; }",
      ".tb-feature-description h4 { font-size: 1.15rem; }",
      ".tb-feature-description h5 { font-size: 1.05rem; }",
      ".tb-feature-description h6 { font-size: 0.95rem; color: #334155; }",
      ".tb-feature-description h1:first-child, .tb-feature-description h2:first-child, .tb-feature-description h3:first-child, .tb-feature-description h4:first-child, .tb-feature-description h5:first-child, .tb-feature-description h6:first-child { margin-top: 0; }",
      '.tb-feature-description code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace; font-size: 0.85em; background: rgba(15, 118, 110, 0.08); color: #0f766e; padding: 0.1em 0.3em; border-radius: 6px; }',
      ".tb-feature-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; font-size: 0.875rem; color: #999999; }",
      ".tb-meta-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 0.5rem; }",
      ".tb-feature-delete { border: none; background: transparent; color: #dc2626; font-size: 0.875rem; font-weight: 500; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; transition: color 0.2s ease, background 0.2s ease; }",
      ".tb-feature-delete:hover { color: #b91c1c; background: rgba(220, 38, 38, 0.08); }",
      ".tb-feature-delete[disabled] { opacity: 0.6; cursor: not-allowed; }",
      ".tb-feature-variation { border: none; background: transparent; color: #0ea5e9; font-size: 0.875rem; font-weight: 500; padding: 0.35rem 0.6rem; border-radius: 6px; cursor: pointer; transition: color 0.2s ease, background 0.2s ease; }",
      ".tb-feature-variation:hover { color: #0369a1; background: rgba(14, 165, 233, 0.12); }",
      ".tb-feature-variation[disabled] { opacity: 0.6; cursor: not-allowed; }",
      ".tb-meta-item { color: inherit; }",
      ".tb-meta-dot { color: #d4d4d4; }",
      ".tb-vote { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; min-width: 56px; height: 56px; padding: 0.5rem 1rem; background: transparent; border: 2px solid #e5e5e5; border-radius: 8px; color: #666666; font-weight: 600; cursor: pointer; flex-shrink: 0; transition: all 0.2s ease; }",
      ".tb-vote:hover { border-color: #059669; background: #059669; color: #ffffff; transform: translateY(-2px); }",
      ".tb-vote[data-voted=\"true\"] { border-color: #16a34a; background: #16a34a; color: #ffffff; }",
      ".tb-vote[data-voted=\"true\"]:hover { border-color: #059669; background: #059669; }",
      ".tb-vote-arrow { font-size: 1.125rem; line-height: 1; }",
      ".tb-vote-count { font-size: 0.875rem; }",
      ".tb-vote.tb-vote-loading { pointer-events: none; position: relative; color: transparent; }",
      ".tb-vote.tb-vote-loading::after { content: \"\"; position: absolute; width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 2px solid rgba(5, 150, 105, 0.3); border-top-color: #059669; animation: tb-spin 0.8s linear infinite; }",
      ".tb-vote.tb-vote-disabled { pointer-events: none; opacity: 0.6; }",
      ".tb-loading { display: flex; align-items: center; justify-content: center; gap: 0.75rem; padding: 3rem 1rem; color: #1a1a1a; font-weight: 600; background: rgba(5, 150, 105, 0.05); }",
      ".tb-spinner { width: 1.1rem; height: 1.1rem; border-radius: 50%; border: 2px solid rgba(5, 150, 105, 0.3); border-top-color: #059669; animation: tb-spin 0.8s linear infinite; }",
      ".tb-empty { padding: 3rem 2rem; text-align: center; color: #999999; background: #fafafa; font-weight: 500; }",
      ".tb-auth-card { background: #ffffff; border-radius: 12px; padding: 1.5rem; border: 1px solid #e5e5e5; display: flex; flex-direction: column; gap: 1rem; }",
      ".tb-auth-card-compact { gap: 0.75rem; }",
      ".tb-auth-tabs { display: inline-flex; background: #f5f5f5; border-radius: 999px; padding: 0.25rem; gap: 0.25rem; }",
      ".tb-tab { border: none; border-radius: 999px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; background: transparent; color: #666666; cursor: pointer; transition: all 0.2s ease; }",
      ".tb-tab-active { background: #059669; color: #ffffff; }",
      ".tb-helper { font-size: 0.875rem; color: #999999; }",
      ".tb-variation-notice { margin: 1rem 0 0; padding: 0.75rem 1rem; border-radius: 10px; background: rgba(14, 165, 233, 0.08); color: #0369a1; font-size: 0.875rem; font-weight: 500; }",
      ".tb-form { display: flex; flex-direction: column; gap: 1rem; }",
      ".tb-input-group { display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-label { font-size: 0.875rem; font-weight: 500; color: #1a1a1a; }",
      ".tb-input { border-radius: 8px; border: 2px solid #e5e5e5; padding: 1rem; font-size: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; transition: all 0.2s ease; }",
      ".tb-input:focus { border-color: #059669; outline: none; box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.1); }",
      ".tb-textarea { border-radius: 8px; border: 2px solid #e5e5e5; padding: 1rem; font-size: 1rem; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #1a1a1a; transition: all 0.2s ease; resize: vertical; min-height: 120px; }",
      ".tb-textarea:focus { border-color: #059669; outline: none; box-shadow: 0 0 0 3px rgba(5, 150, 105, 0.1); }",
      ".tb-submit { border-radius: 8px; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; background: #059669; color: #ffffff; border: 2px solid #059669; cursor: pointer; transition: all 0.2s ease; min-height: 46px; }",
      ".tb-submit:hover { background: #047857; border-color: #047857; box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05); }",
      ".tb-submit:disabled { opacity: 0.6; cursor: wait; transform: none; box-shadow: none; }",
      ".tb-form-note { font-size: 0.75rem; color: #999999; }",
      ".tb-form-error { font-size: 0.875rem; color: #dc2626; background: rgba(248, 113, 113, 0.1); padding: 0.75rem 1rem; border-radius: 8px; }",
      ".tb-user-card { display: flex; flex-direction: column; gap: 0.5rem; }",
      ".tb-user-badge { display: flex; align-items: center; gap: 0.75rem; }",
      ".tb-user-avatar { width: 2.75rem; height: 2.75rem; border-radius: 14px; background: linear-gradient(135deg, #10b981, #059669); color: #ffffff; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 1rem; }",
      ".tb-user-name { font-size: 1rem; font-weight: 600; color: #1a1a1a; }",
      ".tb-user-email { font-size: 0.875rem; color: #999999; }",
      ".tb-user-actions { display: inline-flex; gap: 0.75rem; align-items: center; }",
      ".tb-footer { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 2rem; border-top: 2px solid #e5e5e5; flex-shrink: 0; background: #fafafa; }",
      ".tb-footer-nav { display: flex; gap: 1rem; align-items: center; }",
      ".tb-footer-nav a { color: #666666; font-size: 0.875rem; font-weight: 500; text-decoration: none; transition: color 0.2s ease; display: inline-flex; align-items: center; gap: 0.5rem; }",
      ".tb-footer-nav a:hover { color: #1a1a1a; }",
      ".tb-footer-icon { width: 1.25rem; height: 1.25rem; fill: currentColor; }",
      ".tb-auth-section { display: flex; align-items: center; gap: 1rem; }",
      ".tb-footer-email { font-size: 0.875rem; color: #666666; }",
      ".tb-btn-text { background: transparent; color: #666666; border: none; padding: 0.5rem 1rem; font-size: 0.875rem; font-weight: 500; cursor: pointer; transition: all 0.2s ease; border-radius: 8px; }",
      ".tb-btn-text:hover { color: #1a1a1a; background: #f5f5f5; }",
      ".tb-toast-stack { position: fixed; bottom: 2rem; right: 2rem; display: flex; flex-direction: column; gap: 1rem; z-index: 2147483647; pointer-events: none; }",
      ".tb-toast { min-width: 300px; background: #1a1a1a; color: #ffffff; padding: 1rem 1.5rem; border-radius: 8px; box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15); font-weight: 500; font-size: 0.875rem; opacity: 0; transform: translateY(20px); transition: all 0.2s; pointer-events: auto; animation: tb-toast-in 0.2s forwards; }",
      ".tb-toast-success { background: #16a34a; }",
      ".tb-toast-warn { background: #ea580c; }",
      ".tb-toast-error { background: #dc2626; }",
      "@keyframes tb-toast-in { to { opacity: 1; transform: translateY(0); } }",
      "@keyframes tb-toast-out { to { opacity: 0; transform: translateY(-8px); } }",
      "@keyframes tb-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }",
      "@media (max-width: 900px) { .tb-header { padding: 1.25rem 1.5rem; } .tb-body { padding: 0; } .tb-auth-panel { padding: 1.5rem; } .tb-controls { padding: 1rem 1.5rem; } .tb-feature { padding: 1.5rem; } .tb-footer { padding: 1rem 1.5rem; flex-direction: column; gap: 0.5rem; } .tb-close { width: 2rem; height: 2rem; font-size: 1.25rem; } }",
      "@media (max-width: 700px) { .tb-modal { border-radius: 0; max-height: 100vh; width: 100vw; } .tb-feature { flex-direction: column; } .tb-vote { width: fit-content; flex-direction: row; height: auto; padding: 0.5rem 1rem; } }",
    ];

    if (document.body && document.body.classList.contains("theme-dark")) {
      css = css.concat([
        ".tb-launcher { background: linear-gradient(135deg, #f3c969, #dba53c); box-shadow: 0 12px 28px rgba(243, 201, 105, 0.35); }",
        ".tb-launcher:hover { box-shadow: 0 20px 50px rgba(243, 201, 105, 0.45); }",
        ".tb-launcher-dot { background: rgba(43, 179, 175, 0.25); box-shadow: inset 0 0 0 2px rgba(43, 179, 175, 0.4); }",
        ".tb-launcher-dot::after { background: #2bb3af; }",
        ".tb-modal, .tb-auth-modal, .tb-detail-modal, .tb-implemented-modal { background: #0f2731; color: #fdf7e3; border: 1px solid rgba(243, 201, 105, 0.32); box-shadow: 0 24px 48px -24px rgba(0, 0, 0, 0.75); }",
        ".tb-detail-overlay, .tb-implemented-overlay { background: rgba(5, 17, 24, 0.78); }",
        ".tb-body, .tb-detail-body, .tb-implemented-body { background: #0d1f29; color: #fdf7e3; }",
        ".tb-body::-webkit-scrollbar-thumb, .tb-detail-body::-webkit-scrollbar-thumb, .tb-implemented-body::-webkit-scrollbar-thumb { background: #143b47; }",
        ".tb-header, .tb-footer, .tb-auth-panel, .tb-submit-panel, .tb-controls { background: rgba(14, 38, 48, 0.95); border-color: rgba(243, 201, 105, 0.28); color: #fdf7e3; }",
        ".tb-detail-footer { background: rgba(12, 32, 41, 0.95); border-top-color: rgba(243, 201, 105, 0.28); }",
        ".tb-header-user, .tb-footer-email, .tb-helper, .tb-form-note, .tb-subtitle, .tb-feature-meta { color: #d8cbb3; }",
        ".tb-detail-meta { color: #d8cbb3; }",
        ".tb-detail-actions .tb-meta-dot { color: #d8cbb3; }",
        ".tb-status { color: #f3c969; }",
        ".tb-link { color: #2bb3af; }",
        ".tb-link:hover { color: #7fe0d8; }",
        ".tb-close { color: #d8cbb3; }",
        ".tb-close:hover { background: #153946; color: #fdf7e3; }",
        ".tb-refresh { color: #d8cbb3; }",
        ".tb-refresh:hover { background: rgba(43, 179, 175, 0.18); color: #7fe0d8; }",
        ".tb-btn-primary { background: #f3c969; border-color: #dba53c; color: #0b161b; }",
        ".tb-btn-primary:hover { background: #ffe1a3; border-color: #f3c969; box-shadow: 0 1px 2px rgba(243, 201, 105, 0.4); }",
        ".tb-btn-secondary { color: #fdf7e3; border-color: rgba(243, 201, 105, 0.26); background: rgba(14, 49, 63, 0.7); }",
        ".tb-btn-secondary:hover { background: rgba(43, 179, 175, 0.24); border-color: rgba(43, 179, 175, 0.45); }",
        ".tb-btn-secondary[disabled] { opacity: 0.5; cursor: not-allowed; }",
        ".tb-btn-text { color: #d8cbb3; }",
        ".tb-btn-text:hover { color: #fdf7e3; background: rgba(243, 201, 105, 0.18); }",
        ".tb-input, .tb-textarea { background: rgba(11, 31, 38, 0.85); border-color: rgba(243, 201, 105, 0.28); color: #fdf7e3; }",
        ".tb-input::placeholder, .tb-textarea::placeholder { color: #d8cbb3; }",
        ".tb-input:focus, .tb-textarea:focus { border-color: rgba(243, 201, 105, 0.55); box-shadow: 0 0 0 3px rgba(243, 201, 105, 0.2); }",
        ".tb-form-error { background: rgba(244, 91, 105, 0.18); color: #ffd5dc; border: 1px solid rgba(244, 91, 105, 0.35); }",
        ".tb-feature { background: rgba(14, 40, 52, 0.94); border-color: rgba(243, 201, 105, 0.24); color: #fdf7e3; }",
        ".tb-feature:hover { background: rgba(17, 52, 66, 0.94); border-color: rgba(43, 179, 175, 0.4); box-shadow: 0 10px 22px rgba(0, 0, 0, 0.55); }",
        ".tb-feature-title { color: #ffe6b3; }",
        ".tb-detail-feature-title { color: #f8fafc; }",
        ".tb-feature-title-button:focus-visible { outline-color: rgba(147, 197, 253, 0.65); }",
        ".tb-feature-description { color: #cbd5f5; }",
        ".tb-feature-description h1, .tb-feature-description h2, .tb-feature-description h3, .tb-feature-description h4, .tb-feature-description h5 { color: #f8fafc; }",
        ".tb-feature-description h6 { color: #a5b4fc; }",
        ".tb-feature-description blockquote { border-left-color: rgba(96, 165, 250, 0.5); color: #bfdbfe; background: rgba(15, 23, 42, 0.6); }",
        ".tb-feature-description pre { background: #0b162b; color: #e2e8f0; box-shadow: inset 0 0 0 1px rgba(148, 163, 184, 0.18); }",
        '.tb-feature-description code { background: rgba(96, 165, 250, 0.2); color: #dbeafe; }',
        ".tb-feature-meta span, .tb-feature-meta time { color: #94a3b8; }",
        ".tb-feature-delete { color: #fca5a5; }",
        ".tb-feature-delete:hover { background: rgba(248, 113, 113, 0.18); color: #fecaca; }",
        ".tb-meta-actions { margin-left: auto; display: inline-flex; align-items: center; gap: 0.5rem; }",
        ".tb-feature-variation { color: #93c5fd; }",
        ".tb-feature-variation:hover { background: rgba(59, 130, 246, 0.18); color: #e0f2fe; }",
        ".tb-variation-notice { background: rgba(37, 99, 235, 0.12); color: #bfdbfe; border: 1px solid rgba(59, 130, 246, 0.35); }",
        ".tb-vote { border-color: rgba(148, 163, 184, 0.35); color: #cbd5f5; background: rgba(15, 23, 42, 0.35); }",
        ".tb-vote:hover { border-color: rgba(96, 165, 250, 0.65); background: #2563eb; color: #ffffff; }",
        ".tb-vote[data-voted=\"true\"] { border-color: #16a34a; background: #16a34a; color: #ffffff; }",
        ".tb-vote.tb-vote-disabled { opacity: 0.5; }",
        ".tb-toast { box-shadow: 0 14px 40px rgba(2, 10, 28, 0.55); }",
        ".tb-footer-nav a { color: #94a3b8; }",
        ".tb-footer-nav a:hover { color: #dbeafe; }",
        ".tb-user-name { color: #f1f5f9; }",
        ".tb-user-email { color: #94a3b8; }"
      ]);
    }
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
      '      <div class="tb-status tb-status-muted" id="tb-status">Loading the board...</div>',
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
      '    <div class="tb-feature-description" id="tb-detail-description"></div>',
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

  function attachGlobalShortcuts() {
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        if (detailModalOpen) {
          closeFeatureDetail();
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
        STATE.features = features.filter(function (feature) {
          return !feature.implemented_at;
        });
        STATE.implementedFeatures = implemented;
        STATE.user = data.user || null;
        STATE.canSubmit = Boolean(data.can_submit);
        STATE.authError = null;
        if (STATE.user) {
          STATE.authView = "profile";
        } else if (STATE.authView === "profile") {
          STATE.authView = "login";
        }
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

  function renderHeaderUser() {
    var authSection = ELEMENTS.authSection;
    if (!authSection) {
      return;
    }

    authSection.innerHTML = "";

    if (STATE.user) {
      var email = document.createElement("span");
      email.className = "tb-footer-email";
      email.textContent = STATE.user.email || "";
      authSection.appendChild(email);
      var logoutBtn = document.createElement("button");
      logoutBtn.type = "button";
      logoutBtn.className = "tb-btn-text";
      logoutBtn.textContent = "Logout";
      logoutBtn.addEventListener("click", function () {
        handleLogout();
      });
      authSection.appendChild(logoutBtn);
    } else {
      var loginBtn = document.createElement("button");
      loginBtn.type = "button";
      loginBtn.className = "tb-btn-text";
      loginBtn.textContent = "Login";
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
        STATE.user.display_name || STATE.user.email || "Board member";
      info.appendChild(name);

      var email = document.createElement("span");
      email.className = "tb-user-email";
      email.textContent = STATE.user.email;
      info.appendChild(email);

      badge.appendChild(info);
      card.appendChild(badge);

      var actions = document.createElement("div");
      actions.className = "tb-user-actions";

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
        id: "tb-signup-email",
        label: "Email",
        type: "email",
        name: "email",
        autocomplete: "email",
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
        id: "tb-login-email",
        label: "Email",
        type: "email",
        name: "email",
        autocomplete: "email",
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
    title.style.margin = "0";
    title.style.fontSize = "1.125rem";
    title.style.fontWeight = "600";
    title.style.color = "#1a1a1a";
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
    STATE.features.forEach(function (feature) {
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

  function createFeatureCard(feature) {
    var card = document.createElement("article");
    card.className = "tb-feature";

    var isImplemented = Boolean(feature.implemented_at);

    var vote = document.createElement("button");
    vote.type = "button";
    vote.className = "tb-vote";
    vote.setAttribute("data-voted", feature.user_has_voted ? "true" : "false");
    if (VOTE_IN_FLIGHT.has(feature.id)) {
      vote.classList.add("tb-vote-loading");
    }
    if (isImplemented) {
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

    if (!isImplemented) {
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

    var meta = document.createElement("div");
    meta.className = "tb-feature-meta";

    var creatorItem = document.createElement("span");
    creatorItem.className = "tb-meta-item";
    creatorItem.textContent = "by " + getCreatorName(feature);
    meta.appendChild(creatorItem);

    meta.appendChild(createMetaDot());
    var time = document.createElement("span");
    time.className = "tb-meta-item";
    var timeline = feature.implemented_at
      ? "Implemented " + formatRelativeTime(feature.implemented_at)
      : formatRelativeTime(feature.created_at);
    time.textContent = timeline;
    meta.appendChild(time);

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
    if (!STATE.user || !feature || feature.implemented_at) {
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
    if (!feature || feature.implemented_at) {
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
      ELEMENTS.detailMeta.textContent = formatFeatureMeta(feature);
    }

    if (ELEMENTS.detailDescription) {
      var html = descriptionHtml || renderMarkdown(feature.description || "");
      if (html) {
        ELEMENTS.detailDescription.innerHTML = html;
      } else {
        ELEMENTS.detailDescription.textContent = feature.description || "";
      }
    }

    renderDetailActions(feature);
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

  function formatFeatureMeta(feature) {
    var parts = [];
    parts.push("by " + getCreatorName(feature));
    var timeline = feature.implemented_at
      ? "Implemented " + formatRelativeTime(feature.implemented_at)
      : formatRelativeTime(feature.created_at);
    parts.push(timeline);
    if (typeof feature.variation_count === "number" && feature.variation_count > 0) {
      parts.push("Variations: " + formatNumber(feature.variation_count));
    }
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
    var email = (form.elements.email.value || "").trim();
    var password = form.elements.password.value || "";

    if (!email || !password) {
      STATE.authError = "Email and password are required.";
      renderAuth();
      return;
    }

    toggleFormDisabled(form, true);

    fetch(ENDPOINTS.login, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email: email, password: password }),
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
    var email = (form.elements.email.value || "").trim();
    var password = form.elements.password.value || "";
    var confirm = form.elements.password_confirm.value || "";

    if (!email || !password || !confirm) {
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
        email: email,
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

  function formatNumber(value) {
    if (typeof Intl !== "undefined" && Intl.NumberFormat) {
      return new Intl.NumberFormat().format(value);
    }
    return String(value);
  }

  function getCreatorName(feature) {
    if (feature && feature.creator) {
      return feature.creator.display_name || feature.creator.email || "Unknown";
    }
    return "Unknown";
  }

  function getInitials(user) {
    var name = (user.display_name || user.email || "TB").trim();
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
