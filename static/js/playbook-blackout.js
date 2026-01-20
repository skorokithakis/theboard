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
    var payload = {};
    var dataEl = document.getElementById("playbook-blackout-data");
    if (!dataEl) {
      return;
    }
    try {
      payload = JSON.parse(dataEl.textContent);
    } catch (error) {
      console.warn("Unable to parse blackout payload", error);
    }

    var wordBank = Array.isArray(payload.word_bank)
      ? payload.word_bank.filter(function (word) {
          return typeof word === "string" && word.trim().length > 0;
        })
      : [];
    var planTitles = Array.isArray(payload.plan_titles) ? payload.plan_titles : [];

    var seedEl = document.querySelector("[data-blackout-seed]");
    var hiddenEl = document.querySelector("[data-blackout-hidden]");
    var whisperEl = document.querySelector("[data-blackout-whisper]");
    var button = document.querySelector("[data-blackout-redraft]");

    if (!seedEl || wordBank.length === 0) {
      return;
    }

    function clamp(text, limit) {
      var normalized = text.replace(/\s+/g, " ").trim();
      if (normalized.length <= limit) {
        return normalized;
      }
      return normalized.slice(0, limit - 3).trimEnd() + "...";
    }

    function buildWhisper(words, titles) {
      if (!words || words.length === 0) {
        return "The Board goes dark until a strange phrase glows.";
      }
      var opening = words.slice(0, 3).join(" ");
      var closing = words.slice(-3).join(" ");
      var roster =
        titles && titles.length
          ? "Source list: " + titles.slice(0, 4).join(" · ")
          : "Playbook roster stays obscured.";
      return clamp(opening + " ... " + closing + ". " + roster, 220);
    }

    function draftSeed() {
      var total = wordBank.length;
      var revealCount = Math.max(6, Math.min(22, Math.floor(total * 0.22)));
      revealCount = Math.min(revealCount, total);
      var indices = new Set();
      while (indices.size < revealCount) {
        indices.add(Math.floor(Math.random() * total));
      }
      var revealed = Array.from(indices)
        .sort(function (a, b) {
          return a - b;
        })
        .map(function (idx) {
          return wordBank[idx];
        });
      seedEl.textContent = clamp(revealed.join(" "), 180);
      if (hiddenEl) {
        hiddenEl.textContent = Math.max(total - revealed.length, 0);
      }
      if (whisperEl) {
        whisperEl.textContent = buildWhisper(revealed, planTitles);
      }
    }

    if (button) {
      button.addEventListener("click", draftSeed);
    }

    draftSeed();
  });
})();
