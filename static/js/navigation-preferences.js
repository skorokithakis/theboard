(function () {
  "use strict";

  var SIDE_KEY = "theboard.menu.side";
  var COLLAPSE_KEY = "theboard.menu.collapsed";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeNavigationPreferences, { once: true });
  } else {
    initializeNavigationPreferences();
  }

  function initializeNavigationPreferences() {
    var body = document.body;
    var shell = document.querySelector(".site-shell");
    var sidebar = document.querySelector(".site-sidebar");
    var sideInput = document.querySelector("[data-menu-side-input]");
    var collapsedInput = document.querySelector("[data-menu-collapsed-input]");
    if (!body || !shell || !sidebar) {
      return;
    }

    var preferenceUrl = body.dataset.navPreferenceUrl || "";
    var isAuthenticated = body.dataset.shimejiAuth === "true";
    var state = {
      side: normalizeSide(body.dataset.menuSide || shell.dataset.menuSide || "left"),
      collapsed: parseBoolean(body.dataset.menuCollapsed || shell.dataset.menuCollapsed || "false"),
    };

    var savedSide = readLocal(SIDE_KEY);
    var savedCollapsed = readLocal(COLLAPSE_KEY);
    if (savedSide && normalizeSide(savedSide)) {
      state.side = normalizeSide(savedSide);
    }
    if (typeof savedCollapsed === "string") {
      state.collapsed = parseBoolean(savedCollapsed);
    }

    var collapseToggles = document.querySelectorAll("[data-sidebar-toggle]");
    var sideButtons = document.querySelectorAll("[data-menu-side]");

    collapseToggles.forEach(function (toggle) {
      toggle.addEventListener("click", function (event) {
        event.preventDefault();
        state.collapsed = !state.collapsed;
        applyState(state, {
          shell: shell,
          sidebar: sidebar,
          body: body,
          toggles: collapseToggles,
          sideButtons: sideButtons,
          sideInput: sideInput,
          collapsedInput: collapsedInput,
        });
        persistState(state, preferenceUrl, isAuthenticated);
      });
    });

    sideButtons.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        var desiredSide = normalizeSide(event.currentTarget.dataset.menuSide);
        if (!desiredSide || desiredSide === state.side) {
          return;
        }
        state.side = desiredSide;
        applyState(state, {
          shell: shell,
          sidebar: sidebar,
          body: body,
          toggles: collapseToggles,
          sideButtons: sideButtons,
          sideInput: sideInput,
          collapsedInput: collapsedInput,
        });
        persistState(state, preferenceUrl, isAuthenticated);
      });
    });

    applyState(state, {
      shell: shell,
      sidebar: sidebar,
      body: body,
      toggles: collapseToggles,
      sideButtons: sideButtons,
      sideInput: sideInput,
      collapsedInput: collapsedInput,
    });
  }

  function applyState(state, handles) {
    var shell = handles.shell;
    var sidebar = handles.sidebar;
    var body = handles.body;
    var toggles = handles.toggles || [];
    var sideButtons = handles.sideButtons || [];
    var sideInput = handles.sideInput;
    var collapsedInput = handles.collapsedInput;

    if (shell) {
      shell.dataset.menuSide = state.side;
      shell.dataset.menuCollapsed = state.collapsed ? "true" : "false";
    }
    if (sidebar) {
      sidebar.dataset.menuSide = state.side;
      sidebar.dataset.menuCollapsed = state.collapsed ? "true" : "false";
    }
    if (body) {
      body.dataset.menuSide = state.side;
      body.dataset.menuCollapsed = state.collapsed ? "true" : "false";
    }

    toggles.forEach(function (toggle) {
      toggle.setAttribute("aria-pressed", state.collapsed ? "true" : "false");
      toggle.setAttribute("aria-expanded", state.collapsed ? "false" : "true");
      if (toggle.name === "menu_collapsed") {
        toggle.value = state.collapsed ? "false" : "true";
      }
      var label = toggle.querySelector("[data-collapse-label]");
      if (label) {
        label.textContent = state.collapsed ? "Expand menu" : "Collapse menu";
      }
    });

    sideButtons.forEach(function (button) {
      var side = normalizeSide(button.dataset.menuSide);
      var isActive = side === state.side;
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive) {
        button.classList.add("sidebar__preference-button--active");
      } else {
        button.classList.remove("sidebar__preference-button--active");
      }
    });

    if (sideInput) {
      sideInput.value = state.side;
    }

    if (collapsedInput) {
      collapsedInput.value = state.collapsed ? "true" : "false";
    }

    writeLocal(SIDE_KEY, state.side);
    writeLocal(COLLAPSE_KEY, state.collapsed ? "true" : "false");
  }

  function persistState(state, preferenceUrl, isAuthenticated) {
    if (!isAuthenticated || !preferenceUrl) {
      return;
    }
    var formData = new URLSearchParams();
    formData.set("menu_side", state.side);
    formData.set("menu_collapsed", state.collapsed ? "true" : "false");
    fetch(preferenceUrl, {
      method: "POST",
      headers: {
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json",
        "X-CSRFToken": readCookie("csrftoken"),
      },
      body: formData,
    }).catch(function (error) {
      console.error("Failed to persist navigation preferences", error);
    });
  }

  function normalizeSide(side) {
    if (!side) {
      return "left";
    }
    var value = side.toString().toLowerCase();
    return value === "right" ? "right" : "left";
  }

  function parseBoolean(value) {
    return value === true || value === "true" || value === "1";
  }

  function readLocal(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      return null;
    }
  }

  function writeLocal(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      return;
    }
  }

  function readCookie(name) {
    var cookies = (document.cookie || "").split(";").map(function (entry) {
      return entry.trim().split("=");
    });
    for (var i = 0; i < cookies.length; i += 1) {
      var entry = cookies[i];
      if (entry[0] === name) {
        return decodeURIComponent(entry[1] || "");
      }
    }
    return "";
  }
})();
