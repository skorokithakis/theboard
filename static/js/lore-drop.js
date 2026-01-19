(function () {
  "use strict";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeLoreDrop, { once: true });
  } else {
    initializeLoreDrop();
  }

  function initializeLoreDrop() {
    var hero = document.querySelector(".lore-drop__hero");
    var torchButton = document.querySelector("[data-torch-toggle]");
    var status = document.querySelector("[data-torch-status]");
    var signals = document.querySelector(".lore-drop__signals");
    var mythForm = document.querySelector("[data-myth-form]");
    var mythInput = document.querySelector("[data-myth-input]");
    var mythLog = document.querySelector("[data-myth-log]");
    var randomButton = document.querySelector("[data-random-myth]");
    var mythSeeds = loadMythSeeds();
    var seenTexts = collectExistingMyths(mythLog);

    if (signals && !signals.dataset.torchActive) {
      signals.dataset.torchActive = "false";
    }

    if (torchButton) {
      torchButton.addEventListener("click", function () {
        var isCurrentlyLit = torchButton.getAttribute("aria-pressed") === "true";
        setTorchState(!isCurrentlyLit, hero, status, signals, torchButton);
      });
    }

    if (mythForm && mythInput) {
      mythForm.addEventListener("submit", function (event) {
        event.preventDefault();
        var raw = mythInput.value;
        var trimmed = raw.trim();
        if (!trimmed) {
          return;
        }
        appendMyth(mythLog, seenTexts, "Visitor whisper", raw);
        mythInput.value = "";
      });
    }

    if (randomButton) {
      randomButton.addEventListener("click", function () {
        if (!mythSeeds.length) {
          return;
        }
        var available = mythSeeds.filter(function (seed) {
          return !seenTexts.has((seed.text || "").trim());
        });
        var pool = available.length ? available : mythSeeds;
        var selected = pool[Math.floor(Math.random() * pool.length)];
        appendMyth(mythLog, seenTexts, selected.title, selected.text);
        setTorchState(true, hero, status, signals, torchButton);
      });
    }
  }

  function setTorchState(isLit, hero, status, signals, torchButton) {
    if (hero) {
      hero.classList.toggle("is-lit", isLit);
    }
    if (torchButton) {
      torchButton.setAttribute("aria-pressed", isLit ? "true" : "false");
    }
    if (signals) {
      signals.dataset.torchActive = isLit ? "true" : "false";
    }
    if (status) {
      status.textContent = isLit
        ? "Pixel torch lit. Tunnel runes glow and mascots are on duty."
        : "Pixel torch unlit. Ritual waiting.";
      status.classList.toggle("lore-drop__status--lit", isLit);
    }
  }

  function appendMyth(mythLog, seenTexts, title, text) {
    if (!mythLog || !text) {
      return;
    }
    var entry = document.createElement("li");
    var heading = document.createElement("strong");
    heading.textContent = title || "Tunnel myth";
    var body = document.createElement("p");
    body.className = "lore-drop__detail";
    body.textContent = text;

    entry.appendChild(heading);
    entry.appendChild(body);

    mythLog.prepend(entry);
    seenTexts.add((text || "").trim());
  }

  function collectExistingMyths(mythLog) {
    var texts = new Set();
    if (!mythLog) {
      return texts;
    }
    mythLog.querySelectorAll("p").forEach(function (paragraph) {
      var text = (paragraph.textContent || "").trim();
      if (text) {
        texts.add(text);
      }
    });
    return texts;
  }

  function loadMythSeeds() {
    var script = document.getElementById("myth-seeds-data");
    if (!script || !script.textContent) {
      return [];
    }
    try {
      var parsed = JSON.parse(script.textContent);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter(function (item) {
          return item && (item.title || item.text);
        })
        .map(function (item) {
          return {
            title: item.title || "Tunnel myth",
            text: item.text || "",
          };
        });
    } catch (error) {
      console.warn("Failed to parse myth seeds", error);
      return [];
    }
  }
})();
