(function () {
  "use strict";

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    var dataEl = document.getElementById("playbook-inversion-data");
    var seedEl = document.querySelector("[data-inversion-seed]");
    var recapEl = document.querySelector("[data-inversion-recap]");
    var buttons = document.querySelectorAll("[data-inversion-redraft]");

    if (!dataEl || !seedEl) {
      return;
    }

    var payload = {};
    try {
      payload = JSON.parse(dataEl.textContent);
    } catch (error) {
      console.warn("Unable to parse inversion payload", error);
      return;
    }

    var rules = Array.isArray(payload.rules) ? payload.rules : [];
    var pairs = Array.isArray(payload.pairs) ? payload.pairs : [];
    var wordBank = Array.isArray(payload.word_bank) ? payload.word_bank : [];
    var ritual =
      typeof payload.ritual === "string" && payload.ritual.trim().length > 0
        ? payload.ritual
        : "Pause, scan the list, flip the predictable rule, and draft a surprising seed.";

    function clamp(text, limit) {
      var normalized = text.replace(/\s+/g, " ").trim();
      if (normalized.length <= limit) {
        return normalized;
      }
      return normalized.slice(0, limit - 3).trimEnd() + "...";
    }

    function pickRandom(items) {
      if (!items || items.length === 0) {
        return null;
      }
      var index = Math.floor(Math.random() * items.length);
      return items[index];
    }

    function buildSignal(bank) {
      if (!bank || bank.length === 0) {
        return "";
      }
      var size = Math.max(3, Math.min(7, Math.floor(bank.length * 0.08)));
      var selected = [];
      var used = new Set();
      while (selected.length < size && used.size < bank.length) {
        var next = Math.floor(Math.random() * bank.length);
        if (used.has(next)) {
          continue;
        }
        used.add(next);
        selected.push(bank[next]);
      }
      if (selected.length === 0) {
        return "";
      }
      return clamp(selected.reverse().join(" "), 120);
    }

    function draftSeed() {
      var rule = pickRandom(rules) || {};
      var pair = pickRandom(pairs) || {};
      var leader = pair.leader || null;
      var underdog = pair.underdog || null;
      var lines = [];

      if (rule.inverted) {
        lines.push(rule.inverted);
      } else if (rule.default) {
        lines.push("Flip this: " + rule.default);
      } else {
        lines.push("Invert the expected move and narrate the risk.");
      }

      if (underdog && underdog.title) {
        lines.push(
          'Start with "' +
            underdog.title +
            '" while the louder idea waits its turn.'
        );
      } else if (leader && leader.title) {
        lines.push(
          'Let "' +
            leader.title +
            '" cool while you imagine its mirror image first.'
        );
      } else {
        lines.push("Wait for the quietest idea and place it at the top.");
      }

      var signal = buildSignal(wordBank);
      if (signal) {
        lines.push("Signal pulled from the playbook: " + signal);
      }

      lines.push(ritual);

      seedEl.textContent = clamp(lines.join(" "), 280);
      if (recapEl) {
        var defaultLine = rule.default
          ? "Default: " + rule.default
          : "Default: Ship the loudest idea first.";
        recapEl.textContent = clamp(defaultLine, 220);
      }
    }

    if (buttons.length) {
      buttons.forEach(function (button) {
        button.addEventListener("click", draftSeed);
      });
    }

    draftSeed();
  });
})();
