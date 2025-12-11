(function () {
  "use strict";

  var INTERACTIVE_SELECTOR = [
    "a[href]",
    "button",
    ".button",
    ".button-outline",
    "input:not([type='hidden'])",
    "select",
    "textarea",
    "summary",
    "[role='button']",
    "form",
    ".header-nav__link",
    ".audio-toggle",
    "[data-theme-select]",
  ].join(", ");
  var SHAKE_COOLDOWN_MS = 750;
  var BURST_SCALE_MIN = 0.8;
  var BURST_SCALE_MAX = 1.4;
  var lastShakeAt = 0;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeDepthEffects, { once: true });
  } else {
    initializeDepthEffects();
  }

  function initializeDepthEffects() {
    var targets = document.querySelectorAll(INTERACTIVE_SELECTOR);

    targets.forEach(armInteractive);
    observeNewInteractives();
    document.addEventListener("pointerdown", handlePointerActivation, true);
    document.addEventListener("keydown", handleKeyboardActivation, true);
  }

  function armInteractive(el) {
    if (!el || typeof el.classList === "undefined" || el.dataset.depthArmed === "true") {
      return;
    }
    el.dataset.depthArmed = "true";
    el.classList.add("interact-3d");
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
    el.style.setProperty("--glint-x", "0px");
    el.style.setProperty("--glint-y", "0px");
    el.addEventListener("pointermove", handleTilt, { passive: true });
    el.addEventListener("pointerleave", resetTilt, { passive: true });
    el.addEventListener("blur", resetTilt, { passive: true });
    el.addEventListener("focus", presetTilt, { passive: true });
  }

  function handleTilt(event) {
    var target = event.currentTarget;
    if (!target || target.disabled) {
      return;
    }
    var rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    var relX = (event.clientX - rect.left) / rect.width;
    var relY = (event.clientY - rect.top) / rect.height;
    var tiltX = ((0.5 - relY) * 12).toFixed(2);
    var tiltY = ((relX - 0.5) * 12).toFixed(2);
    var glintX = ((relX - 0.5) * 48).toFixed(1);
    var glintY = ((relY - 0.5) * 48).toFixed(1);
    target.style.setProperty("--tilt-x", tiltX + "deg");
    target.style.setProperty("--tilt-y", tiltY + "deg");
    target.style.setProperty("--glint-x", glintX + "px");
    target.style.setProperty("--glint-y", glintY + "px");
    target.classList.add("is-tilting");
  }

  function resetTilt(event) {
    var target = event.currentTarget;
    if (!target) {
      return;
    }
    target.style.setProperty("--tilt-x", "0deg");
    target.style.setProperty("--tilt-y", "0deg");
    target.style.setProperty("--glint-x", "0px");
    target.style.setProperty("--glint-y", "0px");
    target.classList.remove("is-tilting");
  }

  function presetTilt(event) {
    var target = event.currentTarget;
    if (!target) {
      return;
    }
    target.style.setProperty("--tilt-x", "-2deg");
    target.style.setProperty("--tilt-y", "2deg");
    target.classList.add("is-tilting");
  }

  function handlePointerActivation(event) {
    var trigger = event.target && event.target.closest(INTERACTIVE_SELECTOR);
    if (!trigger) {
      return;
    }
    spawnBurst(event.clientX, event.clientY);
    triggerShake();
  }

  function handleKeyboardActivation(event) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    var trigger = event.target && event.target.closest(INTERACTIVE_SELECTOR);
    if (!trigger) {
      return;
    }
    var rect = trigger.getBoundingClientRect();
    var x = rect.left + rect.width / 2;
    var y = rect.top + rect.height / 2;
    spawnBurst(x, y);
    triggerShake();
  }

  function spawnBurst(x, y) {
    if (!document.body) {
      return;
    }
    var burst = document.createElement("span");
    var hue = Math.floor(Math.random() * 360);
    var scale = randomBetween(BURST_SCALE_MIN, BURST_SCALE_MAX);
    burst.className = "vfx-burst";
    burst.style.left = x + "px";
    burst.style.top = y + "px";
    burst.style.setProperty("--burst-hue", hue);
    burst.style.setProperty("--burst-scale", scale);
    document.body.appendChild(burst);
    requestAnimationFrame(function activate() {
      burst.classList.add("is-active");
    });
    burst.addEventListener("animationend", function cleanup() {
      burst.remove();
    });
  }

  function triggerShake() {
    var now = Date.now();
    if (now - lastShakeAt < SHAKE_COOLDOWN_MS) {
      return;
    }
    lastShakeAt = now;
    document.body.classList.add("is-shaking");
    window.setTimeout(function removeShake() {
      document.body.classList.remove("is-shaking");
    }, 420);
  }

  function randomBetween(min, max) {
    return (Math.random() * (max - min) + min).toFixed(2);
  }

  function observeNewInteractives() {
    if (!document.body || typeof MutationObserver === "undefined") {
      return;
    }
    var observer = new MutationObserver(function handleMutations(mutations) {
      mutations.forEach(function (mutation) {
        mutation.addedNodes.forEach(function (node) {
          armTree(node);
        });
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function armTree(node) {
    if (!node || node.nodeType !== 1) {
      return;
    }
    var element = node;
    if (element.matches(INTERACTIVE_SELECTOR)) {
      armInteractive(element);
    }
    var descendants = element.querySelectorAll
      ? element.querySelectorAll(INTERACTIVE_SELECTOR)
      : [];
    descendants.forEach(armInteractive);
  }
})();
