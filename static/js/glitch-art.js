(function () {
  "use strict";

  var root = document.querySelector("[data-glitch-lab]");
  if (!root) {
    return;
  }

  var viewport = document.querySelector("[data-glitch-viewport]");
  var randomizeButton = document.querySelector("[data-glitch-randomize]");
  var frameButton = document.querySelector("[data-glitch-frame]");
  var resetButton = document.querySelector("[data-glitch-reset]");
  var currentLabel = document.querySelector("[data-glitch-current]");
  var status = document.querySelector("[data-glitch-status]");
  var gallery = document.querySelector("[data-glitch-gallery]");
  var placeholder = document.querySelector("[data-glitch-placeholder]");
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
      if (item.dataset.filterName === name) {
        item.classList.add("is-active");
      } else {
        item.classList.remove("is-active");
      }
    });
  }

  function applyFilter(option, animate) {
    if (!viewport) {
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

    var title = document.createElement("h3");
    title.className = "glitch-frame__title";
    title.textContent = activeFilter && activeFilter.name ? activeFilter.name : "Unfiltered capture";

    var note = document.createElement("p");
    note.className = "glitch-frame__note";
    note.textContent = activeFilter && activeFilter.note ? activeFilter.note : "Captured the raw board signal.";

    var meta = document.createElement("div");
    meta.className = "glitch-frame__meta";

    var tag = document.createElement("span");
    tag.className = "glitch-frame__tag";
    tag.textContent = "Frame " + String(frameCount + 1).padStart(2, "0");

    var timestamp = document.createElement("span");
    timestamp.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    meta.appendChild(tag);
    meta.appendChild(timestamp);

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

  if (randomizeButton) {
    randomizeButton.addEventListener("click", chooseRandomFilter);
  }
  if (frameButton) {
    frameButton.addEventListener("click", frameCurrent);
  }
  if (resetButton) {
    resetButton.addEventListener("click", resetFilter);
  }

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
