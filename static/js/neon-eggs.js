(function () {
  "use strict";

  var layer = document.querySelector(".neon-eggs-layer");
  if (!layer) {
    return;
  }

  var eggsData = [];
  var eggsScript = document.getElementById("neon-eggs-data");
  if (eggsScript && eggsScript.textContent) {
    try {
      eggsData = JSON.parse(eggsScript.textContent);
    } catch (err) {
      console.warn("Unable to parse neon egg metadata", err);
    }
  }

  var eggsByKey = {};
  eggsData.forEach(function (egg) {
    eggsByKey[egg.key] = egg;
  });

  var claimUrl = layer.dataset.claimUrl || "/api/easter-eggs/claim";
  var featuresUrl = layer.dataset.featuresUrl || "/api/features";
  var sitekey = (document.body && document.body.dataset.turnstileSitekey) || "";
  var featuresCache = null;
  var modal = null;
  var modalPanel = null;
  var modalTitle = null;
  var modalHint = null;
  var selectEl = null;
  var statusEl = null;
  var submitButton = null;
  var closeButtons = [];
  var turnstileContainer = null;
  var lastEggKey = null;
  var lastTrigger = null;
  var turnstileScriptLoaded = false;

  bootstrapTurnstileSupport();
  buildModal();

  layer.addEventListener("click", function (event) {
    var button = event.target.closest(".neon-egg");
    if (!button) {
      return;
    }
    var eggKey = button.dataset.eggKey;
    if (!eggKey) {
      return;
    }
    lastEggKey = eggKey;
    lastTrigger = button;
    openModal(eggKey);
  });

  function bootstrapTurnstileSupport() {
    if (window._turnstileInitQueue && typeof window.onTurnstileLoad === "function") {
      return;
    }

    if (!window._turnstileInitQueue) {
      window._turnstileInitQueue = [];
    }

    if (typeof window.onTurnstileLoad !== "function") {
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
    }

    if (!sitekey) {
      return;
    }

    var existing = document.querySelector(
      'script[src*="challenges.cloudflare.com/turnstile"]'
    );
    if (existing) {
      turnstileScriptLoaded = true;
      return;
    }

    var script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    script.onload = function () {
      turnstileScriptLoaded = true;
      if (typeof window.onTurnstileLoad === "function") {
        window.onTurnstileLoad();
      }
    };
    script.onerror = function () {
      console.warn("Failed to load Turnstile script for neon eggs.");
    };
    document.head.appendChild(script);
  }

  function buildModal() {
    modal = document.createElement("div");
    modal.className = "neon-egg-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = [
      '<div class="neon-egg-modal__backdrop" data-neon-dismiss></div>',
      '<div class="neon-egg-modal__panel">',
      '  <div class="neon-egg-modal__header">',
      '    <p class="neon-egg-modal__eyebrow">Neon revival</p>',
      '    <h2 class="neon-egg-modal__title">Neon egg</h2>',
      '    <p class="neon-egg-modal__hint"></p>',
      '  </div>',
      '  <form class="neon-egg-modal__form">',
      '    <label class="neon-egg-modal__label" for="neon-egg-feature">Pick a feature to boost</label>',
      '    <select id="neon-egg-feature" class="neon-egg-modal__select" required></select>',
      '    <p class="neon-egg-modal__help">Found an egg? Drop its neon vote onto the idea that deserves it.</p>',
      '    <div class="neon-egg-status" aria-live="polite"></div>',
      (sitekey
        ? '    <div class="cf-turnstile neon-egg-turnstile" data-sitekey="" data-response-field-name="turnstile_token"></div>'
        : ""),
      '    <div class="neon-egg-modal__actions">',
      '      <button type="submit" class="button">Claim neon vote</button>',
      '      <button type="button" class="button-muted" data-neon-dismiss>Close</button>',
      "    </div>",
      "  </form>",
      "</div>",
    ].join("");

    modalPanel = modal.querySelector(".neon-egg-modal__panel");
    modalTitle = modal.querySelector(".neon-egg-modal__title");
    modalHint = modal.querySelector(".neon-egg-modal__hint");
    selectEl = modal.querySelector(".neon-egg-modal__select");
    statusEl = modal.querySelector(".neon-egg-status");
    submitButton = modal.querySelector('button[type="submit"]');
    turnstileContainer = modal.querySelector(".neon-egg-turnstile");
    closeButtons = modal.querySelectorAll("[data-neon-dismiss]");

    if (turnstileContainer && sitekey) {
      turnstileContainer.dataset.sitekey = sitekey;
      queueTurnstileRender(turnstileContainer);
    }

    modal
      .querySelector(".neon-egg-modal__form")
      .addEventListener("submit", handleSubmit);
    modal.addEventListener("keydown", handleEscape);
    closeButtons.forEach(function (button) {
      button.addEventListener("click", closeModal);
    });

    document.body.appendChild(modal);
  }

  function queueTurnstileRender(container) {
    if (!container || !sitekey) {
      return;
    }

    function render() {
      if (container.dataset.turnstileWidgetId) {
        return;
      }
      if (!(window.turnstile && typeof window.turnstile.render === "function")) {
        return;
      }
      var widgetId = window.turnstile.render(container, {
        sitekey: sitekey,
        action: "neon-egg-claim",
      });
      container.dataset.turnstileWidgetId = widgetId;
    }

    if (window.turnstile && typeof window.turnstile.render === "function") {
      render();
    } else {
      window._turnstileInitQueue = window._turnstileInitQueue || [];
      window._turnstileInitQueue.push(render);
      if (!turnstileScriptLoaded) {
        bootstrapTurnstileSupport();
      }
    }
  }

  function openModal(eggKey) {
    var egg = eggsByKey[eggKey] || {};
    modalTitle.textContent = egg.label || "Neon egg";
    modalHint.textContent = egg.hint || "Hidden neon vote ready to deploy.";
    if (egg.accent) {
      modalPanel.style.setProperty("--neon-accent", egg.accent);
    } else {
      modalPanel.style.removeProperty("--neon-accent");
    }
    setStatus("Loading queue…", "muted");
    submitButton.disabled = true;
    modal.setAttribute("aria-hidden", "false");
    modal.classList.add("is-visible");
    document.body.classList.add("neon-egg-modal-open");

    fetchFeatures()
      .then(function (data) {
        populateOptions(data.list);
        if (!data.user) {
          setStatus("Sign in to claim neon votes.", "error");
          submitButton.disabled = true;
        } else {
          setStatus("Pick a feature and drop the neon boost.", "info");
          submitButton.disabled = false;
          selectEl.focus();
        }
      })
      .catch(function () {
        setStatus("Unable to load the queue. Try again in a moment.", "error");
      });

    if (turnstileContainer) {
      queueTurnstileRender(turnstileContainer);
    }
  }

  function closeModal() {
    modal.classList.remove("is-visible");
    modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("neon-egg-modal-open");
    if (lastTrigger) {
      lastTrigger.focus();
    }
  }

  function handleEscape(event) {
    if (event.key === "Escape") {
      closeModal();
    }
  }

  function fetchFeatures() {
    if (featuresCache) {
      return Promise.resolve(featuresCache);
    }

    return fetch(featuresUrl, { credentials: "same-origin" })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to load features");
        }
        return response.json();
      })
      .then(function (data) {
        var pending = Array.isArray(data.features) ? data.features : [];
        featuresCache = {
          list: pending,
          user: data.user,
        };
        return featuresCache;
      });
  }

  function populateOptions(features) {
    selectEl.innerHTML = "";
    if (!features.length) {
      var empty = document.createElement("option");
      empty.value = "";
      empty.textContent = "No pending features yet";
      selectEl.appendChild(empty);
      selectEl.size = 1;
      selectEl.disabled = true;
      return;
    }

    selectEl.disabled = false;
    selectEl.size = Math.max(Math.min(features.length, 6), 2);
    features.forEach(function (feature) {
      var option = document.createElement("option");
      option.value = feature.id;
      option.textContent = truncate(feature.title, 64);
      selectEl.appendChild(option);
    });
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!featuresCache) {
      setStatus("Still loading features…", "muted");
      return;
    }
    if (!featuresCache.user) {
      setStatus("Sign in first, then claim the neon vote.", "error");
      return;
    }

    var selectedId = parseInt(selectEl.value, 10);
    if (!selectedId) {
      setStatus("Choose an idea to receive the neon vote.", "error");
      return;
    }

    submitButton.disabled = true;
    setStatus("Dropping neon vote…", "muted");

    var tokenInput = modal.querySelector('input[name="turnstile_token"]');
    var tokenValue = tokenInput ? tokenInput.value : "";

    fetch(claimUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        egg_key: lastEggKey,
        feature_id: selectedId,
        turnstile_token: tokenValue || null,
      }),
    })
      .then(function (response) {
        if (!response.ok) {
          return response.json().then(function (payload) {
            var message = payload && payload.error ? payload.error : "Unable to claim neon vote.";
            throw new Error(message);
          });
        }
        return response.json();
      })
      .then(function (payload) {
        submitButton.disabled = false;
        var feature = payload.feature;
        var claimed = Boolean(payload.already_claimed);
        var message = payload.message || "Neon vote processed.";
        setStatus(message, claimed ? "muted" : "success");
        markEggClaimed(lastEggKey);
        updateFeatureData(feature);
        updateFeatureCard(feature);
        if (!claimed) {
          flashCard(feature.id);
        }
        resetTurnstileResponse();
      })
      .catch(function (err) {
        submitButton.disabled = false;
        setStatus(err.message || "Unable to claim neon vote.", "error");
        resetTurnstileResponse();
      });
  }

  function updateFeatureData(feature) {
    if (!feature || !featuresCache || !Array.isArray(featuresCache.list)) {
      return;
    }
    var replaced = false;
    featuresCache.list = featuresCache.list.map(function (item) {
      if (item.id === feature.id) {
        replaced = true;
        return feature;
      }
      return item;
    });
    if (!replaced) {
      featuresCache.list.unshift(feature);
    }
  }

  function updateFeatureCard(feature) {
    if (!feature || !feature.id) {
      return;
    }
    var card = document.getElementById("feature-" + feature.id);
    if (!card) {
      return;
    }
    var voteEl = card.querySelector(".feature-card__votes");
    if (voteEl) {
      voteEl.textContent = "Votes: " + feature.vote_total;
    }
    var neonEl = card.querySelector(".feature-card__neon");
    if (!neonEl) {
      neonEl = document.createElement("span");
      neonEl.className = "feature-card__neon";
      var signals = card.querySelector(".feature-card__signals");
      if (signals) {
        signals.appendChild(neonEl);
      } else {
        card.appendChild(neonEl);
      }
    }
    neonEl.textContent = "+" + feature.bonus_votes + " neon";
    card.classList.add("feature-card--neon");
  }

  function flashCard(featureId) {
    var card = document.getElementById("feature-" + featureId);
    if (!card) {
      return;
    }
    card.classList.add("feature-card--flash");
    window.setTimeout(function () {
      card.classList.remove("feature-card--flash");
    }, 1200);
  }

  function markEggClaimed(eggKey) {
    var buttons = layer.querySelectorAll('[data-egg-key="' + eggKey + '"]');
    buttons.forEach(function (button) {
      button.classList.add("neon-egg--claimed");
    });
  }

  function resetTurnstileResponse() {
    if (!turnstileContainer) {
      return;
    }
    var widgetId = turnstileContainer.dataset.turnstileWidgetId;
    if (widgetId && window.turnstile && typeof window.turnstile.reset === "function") {
      window.turnstile.reset(widgetId);
    }
    var tokenInput = modal.querySelector('input[name="turnstile_token"]');
    if (tokenInput) {
      tokenInput.value = "";
    }
  }

  function setStatus(message, variant) {
    if (!statusEl) {
      return;
    }
    statusEl.textContent = message || "";
    statusEl.dataset.variant = variant || "";
  }

  function truncate(text, max) {
    if (!text || text.length <= max) {
      return text;
    }
    return text.slice(0, max - 1) + "…";
  }
})();
