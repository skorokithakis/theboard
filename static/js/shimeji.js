(function () {
  "use strict";

  if (window.__BOARD_SHIMEJI__) {
    return;
  }
  window.__BOARD_SHIMEJI__ = true;

  var STORAGE_KEY = "board-shimeji-state";
  var MOVE_MIN = 2.5;
  var MOVE_MAX = 8.5;
  var EDGE_PADDING = 48;
  var TALK_COOLDOWN = 2200;
  var shopPanel = null;
  var buddy = null;
  var wanderTimer = null;
  var anchors = [];
  var visibleAnchors = [];
  var featureTitles = [];
  var featureDescriptions = [];

  var root = document.body;
  if (!root) {
    return;
  }

  var dataset = root.dataset || {};
  var startingBalance = parseInt(dataset.shimejiBalance || "0", 10);
  if (isNaN(startingBalance)) {
    startingBalance = 0;
  }
  var stored = readState();
  var state = {
    awake: stored.awake !== false,
    paused: !!stored.paused,
    balance:
      typeof stored.balance === "number"
        ? stored.balance
        : Math.max(startingBalance, 18),
    inventory: Array.isArray(stored.inventory) ? stored.inventory : [],
    mood: stored.mood || "Curious",
    anchorLabel: "Roaming",
    lastSpokenAt: 0,
    lastStepAt: 0,
  };

  anchors = collectAnchors();
  featureTitles = collectFeatureField("title");
  featureDescriptions = collectFeatureField("description");

  buddy = createBuddy();
  shopPanel = createShop();
  wireControls();
  wireInteractiveElements();
  observeAnchors();
  updateBuddyReadouts();

  if (state.awake) {
    wakeBuddy(false);
  }

  function collectFeatureField(field) {
    var holder = document.getElementById("feature-button-data");
    if (!holder || !holder.textContent) {
      return [];
    }
    try {
      var parsed = JSON.parse(holder.textContent);
      return parsed
        .map(function (entry) {
          return entry[field] || "";
        })
        .filter(Boolean);
    } catch (err) {
      return [];
    }
  }

  function collectAnchors() {
    var nodes = Array.prototype.slice.call(
      document.querySelectorAll("[data-shimeji-anchor]")
    );
    return nodes.map(function (node) {
      return {
        el: node,
        label:
          node.getAttribute("data-shimeji-label") ||
          node.getAttribute("aria-label") ||
          "section",
      };
    });
  }

  function readState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (err) {
      return {};
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          awake: state.awake,
          paused: state.paused,
          balance: state.balance,
          inventory: state.inventory,
          mood: state.mood,
        })
      );
    } catch (err) {
      /* ignore */
    }
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function createBuddy() {
    var wrapper = document.createElement("div");
    wrapper.className = "desktop-buddy is-hidden";
    wrapper.setAttribute("aria-live", "polite");
    wrapper.setAttribute("data-shimeji-root", "true");
    wrapper.style.transform = "translate3d(64px, 70vh, 0)";

    var shadow = document.createElement("div");
    shadow.className = "desktop-buddy__shadow";

    var sprite = document.createElement("div");
    sprite.className = "desktop-buddy__sprite";
    sprite.innerHTML =
      '<span class="desktop-buddy__ear desktop-buddy__ear--left"></span>' +
      '<span class="desktop-buddy__ear desktop-buddy__ear--right"></span>' +
      '<span class="desktop-buddy__face">' +
      '<span class="desktop-buddy__eye desktop-buddy__eye--left"></span>' +
      '<span class="desktop-buddy__eye desktop-buddy__eye--right"></span>' +
      '<span class="desktop-buddy__glow"></span>' +
      "</span>" +
      '<span class="desktop-buddy__tail"></span>' +
      '<span class="desktop-buddy__crest"></span>';

    var bubble = document.createElement("div");
    bubble.className = "desktop-buddy__bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");

    var badge = document.createElement("div");
    badge.className = "desktop-buddy__badge";
    badge.innerHTML =
      '<span class="desktop-buddy__badge-label">Buddy coins</span>' +
      '<span class="desktop-buddy__badge-value" data-buddy-balance>—</span>';

    var giftButton = document.createElement("button");
    giftButton.type = "button";
    giftButton.className = "desktop-buddy__button";
    giftButton.textContent = "Gift shelf";
    giftButton.addEventListener("click", function (event) {
      event.preventDefault();
      openShop();
      say("Pick a gift to drop by my paws.", "soft");
    });

    var pauseButton = document.createElement("button");
    pauseButton.type = "button";
    pauseButton.className = "desktop-buddy__button desktop-buddy__button--muted";
    pauseButton.textContent = "Perch";
    pauseButton.addEventListener("click", function (event) {
      event.preventDefault();
      state.paused = !state.paused;
      pauseButton.textContent = state.paused ? "Resume" : "Perch";
      if (!state.paused) {
        scheduleWander(true);
      } else if (wanderTimer) {
        clearTimeout(wanderTimer);
      }
      saveState();
      say(state.paused ? "Holding position." : "Back on patrol.", "status");
    });

    sprite.addEventListener("mouseenter", function () {
      say(randomLine("hello"), "soft");
      spark();
    });

    sprite.addEventListener("click", function (event) {
      event.preventDefault();
      say(randomLine("poke"), "loud");
      pingNearestAnchor();
      nudgeBalance(1);
    });

    wrapper.appendChild(shadow);
    wrapper.appendChild(sprite);
    wrapper.appendChild(bubble);
    wrapper.appendChild(badge);
    wrapper.appendChild(giftButton);
    wrapper.appendChild(pauseButton);
    root.appendChild(wrapper);

    return {
      el: wrapper,
      sprite: sprite,
      bubble: bubble,
      badge: badge,
      pauseButton: pauseButton,
      giftButton: giftButton,
      position: { x: 64, y: window.innerHeight * 0.7 },
    };
  }

  function wakeBuddy(announce) {
    state.awake = true;
    buddy.el.classList.remove("is-hidden");
    buddy.el.classList.add("is-awake");
    saveState();
    if (announce !== false) {
      say("I'm up! Point me toward something shiny.", "status");
    }
    scheduleWander(true);
  }

  function scheduleWander(force) {
    if (!state.awake || state.paused) {
      return;
    }
    if (wanderTimer) {
      clearTimeout(wanderTimer);
    }
    if (force) {
      moveBuddy();
    }
    wanderTimer = setTimeout(function () {
      moveBuddy();
      scheduleWander(false);
    }, 4400 + Math.random() * 3000);
  }

  function moveBuddy() {
    var target = chooseTarget();
    var dx = target.x - buddy.position.x;
    var dy = target.y - buddy.position.y;
    var distance = Math.sqrt(dx * dx + dy * dy);
    var duration = clamp(distance / 180, MOVE_MIN, MOVE_MAX);
    var facingLeft = dx < 0;

    buddy.position = target;
    buddy.el.style.setProperty("--buddy-speed", duration.toFixed(2) + "s");
    buddy.el.style.transform =
      "translate3d(" +
      target.x.toFixed(1) +
      "px," +
      target.y.toFixed(1) +
      "px,0)";
    buddy.el.classList.add("is-walking");
    if (facingLeft) {
      buddy.el.classList.add("is-facing-left");
    } else {
      buddy.el.classList.remove("is-facing-left");
    }

    setTimeout(function () {
      buddy.el.classList.remove("is-walking");
      if (target.anchor) {
        state.anchorLabel = target.anchor.label;
        pulseAnchor(target.anchor.el);
        say("Inspecting " + target.anchor.label + ".", "soft");
      } else {
        state.anchorLabel = "Roaming";
      }
      updateBuddyReadouts();
    }, duration * 1000 + 60);

    state.lastStepAt = Date.now();
  }

  function chooseTarget() {
    var bounds = getViewportBounds();
    var anchor = pickAnchor();
    if (anchor) {
      var rect = anchor.el.getBoundingClientRect();
      var centerX = rect.left + rect.width * 0.5;
      var centerY = rect.top + rect.height * 0.5;
      return {
        x: clamp(centerX, EDGE_PADDING, bounds.width - EDGE_PADDING),
        y: clamp(centerY, EDGE_PADDING, bounds.height - EDGE_PADDING),
        anchor: anchor,
      };
    }
    return {
      x: randomInRange(EDGE_PADDING, bounds.width - EDGE_PADDING),
      y: randomInRange(EDGE_PADDING, bounds.height - EDGE_PADDING),
      anchor: null,
    };
  }

  function pickAnchor() {
    if (!visibleAnchors.length) {
      return null;
    }
    var index = Math.floor(Math.random() * visibleAnchors.length);
    return visibleAnchors[index];
  }

  function pulseAnchor(el) {
    if (!el) {
      return;
    }
    el.classList.add("shimeji-pulse");
    setTimeout(function () {
      el.classList.remove("shimeji-pulse");
    }, 1200);
  }

  function pingNearestAnchor() {
    if (!anchors.length) {
      return;
    }
    var bounds = getViewportBounds();
    var current = buddy.position;
    var nearest = anchors[0];
    var bestDistance = Infinity;
    for (var i = 0; i < anchors.length; i += 1) {
      var rect = anchors[i].el.getBoundingClientRect();
      var cx = clamp(rect.left + rect.width * 0.5, 0, bounds.width);
      var cy = clamp(rect.top + rect.height * 0.5, 0, bounds.height);
      var dx = cx - current.x;
      var dy = cy - current.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDistance) {
        bestDistance = dist;
        nearest = anchors[i];
      }
    }
    if (nearest) {
      state.anchorLabel = nearest.label;
      updateBuddyReadouts();
      say("On my way to " + nearest.label + ".", "status");
      moveBuddyToAnchor(nearest);
    }
  }

  function moveBuddyToAnchor(anchor) {
    if (!anchor) {
      return;
    }
    var rect = anchor.el.getBoundingClientRect();
    var bounds = getViewportBounds();
    var target = {
      x: clamp(rect.left + rect.width * 0.5, EDGE_PADDING, bounds.width - EDGE_PADDING),
      y: clamp(rect.top + rect.height * 0.4, EDGE_PADDING, bounds.height - EDGE_PADDING),
      anchor: anchor,
    };
    buddy.position = target;
    buddy.el.style.transform =
      "translate3d(" + target.x + "px," + target.y + "px,0)";
  }

  function say(message, tone) {
    if (!buddy || !message) {
      return;
    }
    var now = Date.now();
    if (now - state.lastSpokenAt < TALK_COOLDOWN) {
      return;
    }
    buddy.bubble.textContent = message;
    buddy.bubble.className = "desktop-buddy__bubble";
    if (tone === "status") {
      buddy.bubble.classList.add("desktop-buddy__bubble--status");
    } else if (tone === "loud") {
      buddy.bubble.classList.add("desktop-buddy__bubble--loud");
    }
    buddy.bubble.classList.add("is-visible");
    state.mood = tone === "loud" ? "Excited" : tone === "status" ? "Alert" : "Curious";
    state.lastSpokenAt = now;
    updateBuddyReadouts();
    setTimeout(function () {
      buddy.bubble.classList.remove("is-visible");
    }, 3800);
  }

  function randomLine(reason) {
    var lines = [
      "Keep the votes flowing and I will mist the terrarium.",
      "Hover near a feature button and I'll check its vibe.",
      "I can perch on the header or climb the brick breaker wall.",
      "Gift me something shiny and I'll sprint to the next anchor.",
      "If the board goes quiet, I'll remind folks to vote.",
    ];
    if (featureTitles.length) {
      lines.push('I like "' + pickRandom(featureTitles) + '". Worth a vote?');
    }
    if (featureDescriptions.length && reason === "hello") {
      lines.push(pickRandom(featureDescriptions).slice(0, 96) + "...");
    }
    if (reason === "poke") {
      lines.push("Ow! Kidding. That got my attention.");
      lines.push("Tapping my head? I'll find a fresh badge to land on.");
    }
    return pickRandom(lines);
  }

  function pickRandom(list) {
    if (!list || !list.length) {
      return "";
    }
    return list[Math.floor(Math.random() * list.length)];
  }

  function spark() {
    buddy.el.classList.add("is-sparking");
    setTimeout(function () {
      buddy.el.classList.remove("is-sparking");
    }, 900);
  }

  function createShop() {
    var panel = document.createElement("div");
    panel.className = "shimeji-shop";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Buddy gift shelf");
    panel.innerHTML =
      '<div class="shimeji-shop__header">' +
      '<div class="shimeji-shop__meta">' +
      '<p class="shimeji-shop__eyebrow">Buddy coins</p>' +
      '<p class="shimeji-shop__balance" data-shop-balance>—</p>' +
      '<p class="shimeji-shop__note">Spending here does not touch your real board balance.</p>' +
      "</div>" +
      '<button class="shimeji-shop__close" type="button" aria-label="Close gift shelf">&times;</button>' +
      "</div>" +
      '<div class="shimeji-shop__items" data-shop-items></div>';
    document.body.appendChild(panel);

    panel
      .querySelector(".shimeji-shop__close")
      .addEventListener("click", function () {
        closeShop();
      });

    renderShopItems(panel);
    return panel;
  }

  function renderShopItems(panel) {
    var itemsHost = panel.querySelector("[data-shop-items]");
    if (!itemsHost) {
      return;
    }
    var items = getShopItems();
    var html = "";
    for (var i = 0; i < items.length; i += 1) {
      var item = items[i];
      var owned = state.inventory.indexOf(item.id) !== -1;
      html +=
        '<article class="shimeji-item' +
        (owned ? " is-owned" : "") +
        '" data-item-id="' +
        item.id +
        '">' +
        '<header class="shimeji-item__header">' +
        '<h3 class="shimeji-item__title">' +
        escapeHtml(item.name) +
        "</h3>" +
        '<span class="shimeji-item__cost">' +
        item.cost +
        "c</span>" +
        "</header>" +
        '<p class="shimeji-item__desc">' +
        escapeHtml(item.description) +
        "</p>" +
        '<button class="shimeji-item__action" type="button" data-purchase="' +
        item.id +
        '"' +
        (owned ? " disabled" : "") +
        ">" +
        (owned ? "Equipped" : "Gift this") +
        "</button>" +
        "</article>";
    }
    itemsHost.innerHTML = html;

    itemsHost.querySelectorAll("[data-purchase]").forEach(function (btn) {
      btn.addEventListener("click", function (event) {
        var id = event.currentTarget.getAttribute("data-purchase");
        attemptPurchase(id);
      });
    });

    updateShopBalance();
  }

  function getShopItems() {
    return [
      {
        id: "ribbon",
        name: "Star silk ribbon",
        description: "Adds a glowy ribbon and a confidence boost.",
        cost: 12,
        className: "has-ribbon",
      },
      {
        id: "snack",
        name: "Glowing mochi snack",
        description: "Energy snack that makes the buddy sprint.",
        cost: 9,
        className: "has-snack",
      },
      {
        id: "lantern",
        name: "Signal lantern",
        description: "Buddy pings anchors you highlight for it.",
        cost: 14,
        className: "has-lantern",
      },
      {
        id: "confetti",
        name: "Confetti thruster",
        description: "Launch a celebratory burst near fresh votes.",
        cost: 7,
        className: "has-confetti",
      },
    ];
  }

  function attemptPurchase(id) {
    var items = getShopItems();
    var item = null;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i].id === id) {
        item = items[i];
        break;
      }
    }
    if (!item) {
      return;
    }
    if (state.inventory.indexOf(item.id) !== -1) {
      say("Already wearing that gift.", "soft");
      return;
    }
    if (state.balance < item.cost) {
      say("Need more buddy coins for that gift.", "loud");
      return;
    }
    state.balance -= item.cost;
    state.inventory.push(item.id);
    saveState();
    updateBuddyReadouts();
    renderShopItems(shopPanel);
    applyInventory();
    say("Thanks for the " + item.name + "!", "status");
    spark();
  }

  function updateBuddyReadouts() {
    var balanceTargets = document.querySelectorAll(
      "[data-buddy-balance],[data-shimeji-balance-display]"
    );
    balanceTargets.forEach(function (node) {
      node.textContent = state.balance + "c";
    });
    var moodNode = document.querySelector("[data-shimeji-mood]");
    if (moodNode) {
      moodNode.textContent = state.mood;
    }
    var anchorNode = document.querySelector("[data-shimeji-anchor-label]");
    if (anchorNode) {
      anchorNode.textContent = state.anchorLabel;
    }
    applyInventory();
    updateShopBalance();
  }

  function updateShopBalance() {
    var shopBalance = document.querySelector("[data-shop-balance]");
    if (shopBalance) {
      shopBalance.textContent = state.balance + "c";
    }
  }

  function applyInventory() {
    var classList = buddy.el.classList;
    var items = getShopItems();
    for (var i = 0; i < items.length; i += 1) {
      var hasItem = state.inventory.indexOf(items[i].id) !== -1;
      classList.toggle(items[i].className, hasItem);
    }
  }

  function openShop() {
    if (!shopPanel) {
      return;
    }
    shopPanel.classList.add("is-open");
    updateShopBalance();
  }

  function closeShop() {
    if (!shopPanel) {
      return;
    }
    shopPanel.classList.remove("is-open");
  }

  function nudgeBalance(amount) {
    if (typeof amount !== "number") {
      return;
    }
    state.balance += amount;
    saveState();
    updateBuddyReadouts();
  }

  function wireControls() {
    ready(function () {
      document
        .querySelectorAll("[data-shimeji-summon]")
        .forEach(function (node) {
          node.addEventListener("click", function (event) {
            event.preventDefault();
            wakeBuddy(true);
          });
        });
      document
        .querySelectorAll("[data-shimeji-open-shop]")
        .forEach(function (node) {
          node.addEventListener("click", function (event) {
            event.preventDefault();
            openShop();
            wakeBuddy(false);
            say("Gift shelf opened. Coins are for the mascot only.", "status");
          });
        });
      document
        .querySelectorAll("[data-shimeji-toggle]")
        .forEach(function (node) {
          node.addEventListener("click", function (event) {
            event.preventDefault();
            state.paused = !state.paused;
            node.textContent = state.paused ? "Resume wander" : "Pause wander";
            buddy.pauseButton.textContent = node.textContent.includes("Resume")
              ? "Resume"
              : "Perch";
            saveState();
            scheduleWander(true);
          });
        });
    });

    window.addEventListener("resize", function () {
      state.lastSpokenAt = 0;
      say("Adjusting to the new window.", "status");
      moveBuddy();
    });

    document.addEventListener(
      "visibilitychange",
      function () {
        if (document.visibilityState === "visible") {
          scheduleWander(true);
        }
      },
      false
    );
  }

  function wireInteractiveElements() {
    var buttons = document.querySelectorAll(".feature-button");
    buttons.forEach(function (btn) {
      btn.addEventListener("mouseenter", function () {
        var titleNode = btn.querySelector(".feature-button__title");
        var label =
          btn.getAttribute("aria-label") ||
          (titleNode && titleNode.textContent) ||
          "feature";
        say("Perching on " + label + ".", "soft");
      });
    });

    var terrarium = document.querySelector(".plant-terrarium");
    if (terrarium) {
      terrarium.addEventListener("click", function () {
        say("Misting the terrarium while you browse.", "status");
        spark();
      });
    }

    var scoreboard = document.querySelector(".scoreboard-grid");
    if (scoreboard) {
      scoreboard.addEventListener("mouseenter", function () {
        say("Scoreboard looks lively—keep voting daily!", "status");
      });
    }
  }

  function observeAnchors() {
    if (!anchors.length || !("IntersectionObserver" in window)) {
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          var anchor = findAnchor(entry.target);
          if (!anchor) {
            return;
          }
          if (entry.isIntersecting) {
            if (visibleAnchors.indexOf(anchor) === -1) {
              visibleAnchors.push(anchor);
            }
            state.anchorLabel = anchor.label;
            updateBuddyReadouts();
            say("I can see the " + anchor.label + ".", "soft");
            pulseAnchor(anchor.el);
          } else {
            var idx = visibleAnchors.indexOf(anchor);
            if (idx > -1) {
              visibleAnchors.splice(idx, 1);
            }
          }
        });
      },
      { threshold: 0.15 }
    );
    anchors.forEach(function (anchor) {
      observer.observe(anchor.el);
      anchor.el.addEventListener("mouseenter", function () {
        state.anchorLabel = anchor.label;
        say("Need me over at " + anchor.label + "?", "soft");
        spark();
      });
    });
  }

  function findAnchor(node) {
    for (var i = 0; i < anchors.length; i += 1) {
      if (anchors[i].el === node) {
        return anchors[i];
      }
    }
    return null;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }

  function getViewportBounds() {
    return {
      width: Math.max(document.documentElement.clientWidth, window.innerWidth || 0),
      height: Math.max(document.documentElement.clientHeight, window.innerHeight || 0),
    };
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, function (char) {
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
})();
