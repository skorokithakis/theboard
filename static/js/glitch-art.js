(function () {
  "use strict";

  var root = document.querySelector("[data-glitch-lab]");
  if (!root) {
    return;
  }
  var boardPulse = root.dataset.boardPulse || "";

  var viewport = document.querySelector("[data-glitch-viewport]");
  var randomizeButton = document.querySelector("[data-glitch-randomize]");
  var frameButton = document.querySelector("[data-glitch-frame]");
  var resetButton = document.querySelector("[data-glitch-reset]");
  var ritualButton = document.querySelector("[data-glitch-ritual]");
  var currentLabel = document.querySelector("[data-glitch-current]");
  var status = document.querySelector("[data-glitch-status]");
  var gallery = document.querySelector("[data-glitch-gallery]");
  var placeholder = document.querySelector("[data-glitch-placeholder]");
  var canvas = document.querySelector("[data-glitch-canvas]");
  var filterItems = Array.prototype.slice.call(
    document.querySelectorAll("[data-glitch-filter-item]")
  );
  var filters = [];
  var activeFilter = null;
  var frameCount = 0;

  try {
    var rawFilters = document.getElementById("glitch-filter-data");
    if (rawFilters && rawFilters.textContent) {
      filters = JSON.parse(rawFilters.textContent);
    }
  } catch (_error) {
    filters = [];
  }

  function setStatus(message) {
    if (!status) {
      return;
    }
    status.textContent = message;
  }

  function highlightFilter(name) {
    filterItems.forEach(function (item) {
      var isActive = item.dataset.filterName === name;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function applyFilter(option, animate) {
    if (!viewport || !option) {
      return;
    }
    var filterValue = option.filter || "none";
    activeFilter = option;
    viewport.style.setProperty("--glitch-filter", filterValue);
    viewport.dataset.activeFilter = option.name || "Clean signal";
    if (currentLabel) {
      currentLabel.textContent = option.name || "Clean signal";
    }
    setStatus(option.note || "Signal stabilized.");
    highlightFilter(option.name || "");
    if (animate) {
      viewport.classList.add("is-glitching");
      window.setTimeout(function () {
        viewport.classList.remove("is-glitching");
      }, 260);
    }
  }

  function findFilterByName(name) {
    var option =
      filters.find(function (item) {
        return item.name === name;
      }) || null;

    if (option) {
      return option;
    }

    var fallback = filterItems.find(function (item) {
      return item.dataset.filterName === name;
    });
    if (!fallback) {
      return null;
    }
    return {
      name: name || "Clean signal",
      filter: fallback.dataset.filterValue || "none",
      note: fallback.dataset.filterNote || "Manual glitch activation.",
    };
  }

  function chooseRandomFilter() {
    if (!filters.length) {
      applyFilter(
        {
          name: "Clean signal",
          filter: "none",
          note: "No glitch presets loaded—holding steady.",
        },
        true
      );
      return;
    }
    var index = Math.floor(Math.random() * filters.length);
    if (filters.length > 1 && activeFilter && activeFilter.name === filters[index].name) {
      index = (index + 1) % filters.length;
    }
    applyFilter(filters[index], true);
  }

  function handleFilterActivation(event) {
    var isKeyboard = event.type === "keydown";
    if (isKeyboard && event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (isKeyboard) {
      event.preventDefault();
    }
    var target = event.currentTarget;
    var name = target.dataset.filterName || "";
    var option = findFilterByName(name);
    if (option) {
      applyFilter(option, true);
    }
  }

  function cloneCanvas() {
    if (!canvas) {
      return null;
    }
    var replica = canvas.cloneNode(true);
    replica.classList.add("glitch-frame__canvas");
    replica.removeAttribute("data-glitch-canvas");
    replica.setAttribute("aria-hidden", "true");
    return replica;
  }

  function frameCurrent() {
    if (!gallery || !viewport) {
      return;
    }
    var frame = document.createElement("article");
    frame.className = "glitch-frame";
    frame.dataset.glitchFrame = "true";

    var preview = document.createElement("div");
    preview.className = "glitch-frame__preview";
    preview.style.setProperty(
      "--glitch-frame-filter",
      viewport.style.getPropertyValue("--glitch-filter") || "none"
    );
    preview.setAttribute("aria-hidden", "true");
    var snapshot = cloneCanvas();
    if (snapshot) {
      preview.appendChild(snapshot);
    }

    var title = document.createElement("h3");
    title.className = "glitch-frame__title";
    title.textContent = activeFilter && activeFilter.name ? activeFilter.name : "Unfiltered capture";

    var note = document.createElement("p");
    note.className = "glitch-frame__note";
    note.textContent = activeFilter && activeFilter.note ? activeFilter.note : "Captured the raw board signal.";

    var meta = document.createElement("div");
    meta.className = "glitch-frame__meta";

    var metaRow = document.createElement("div");
    metaRow.className = "glitch-frame__meta-row";

    var tag = document.createElement("span");
    tag.className = "glitch-frame__tag";
    tag.textContent = "Frame " + String(frameCount + 1).padStart(2, "0");

    var timestamp = document.createElement("span");
    timestamp.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    metaRow.appendChild(tag);
    metaRow.appendChild(timestamp);
    meta.appendChild(metaRow);
    if (boardPulse) {
      var pulse = document.createElement("span");
      pulse.className = "glitch-frame__pulse";
      pulse.textContent = "Board pulse: " + boardPulse;
      meta.appendChild(pulse);
    }

    frame.appendChild(preview);
    frame.appendChild(title);
    frame.appendChild(note);
    frame.appendChild(meta);
    if (activeFilter && activeFilter.name) {
      frame.dataset.filterName = activeFilter.name;
    }

    if (placeholder) {
      placeholder.remove();
      placeholder = null;
    }
    gallery.appendChild(frame);
    frameCount += 1;
    setStatus("Captured " + title.textContent + " at " + timestamp.textContent + ".");
  }

  function resetFilter() {
    applyFilter(
      {
        name: "Calmed signal",
        filter: "none",
        note: "Signal resting until the next glitch.",
      },
      true
    );
  }

  function runRitual() {
    if (!ritualButton) {
      return;
    }
    if (ritualButton.disabled) {
      return;
    }
    ritualButton.disabled = true;
    var defaultLabel = ritualButton.dataset.defaultLabel || ritualButton.textContent || "Run the ritual";
    var runningLabel = ritualButton.dataset.runningLabel || "Framing ritual...";
    ritualButton.textContent = runningLabel;
    setStatus("Ritual in progress: releasing a glitch and framing the capture.");
    chooseRandomFilter();
    window.setTimeout(function () {
      frameCurrent();
      ritualButton.disabled = false;
      ritualButton.textContent = defaultLabel;
    }, 320);
  }

  if (randomizeButton) {
    randomizeButton.addEventListener("click", chooseRandomFilter);
  }
  if (frameButton) {
    frameButton.addEventListener("click", frameCurrent);
  }
  if (resetButton) {
    resetButton.addEventListener("click", resetFilter);
  }
  if (ritualButton) {
    ritualButton.addEventListener("click", runRitual);
  }

  filterItems.forEach(function (item) {
    item.addEventListener("click", handleFilterActivation);
    item.addEventListener("keydown", handleFilterActivation);
  });

  if (filters.length) {
    chooseRandomFilter();
  } else {
    applyFilter(
      {
        name: "Clean signal",
        filter: "none",
        note: "No presets yet—create a feature to seed the chaos.",
      },
      false
    );
  }
})();
