(function () {
  "use strict";

  var STORAGE_KEY = "theboard:theme";
  var AUTO = "auto";
  var THEMES = ["spring", "summer", "fall", "winter"];
  var SOUTHERN_TIMEZONE_HINTS = [
    "Australia/",
    "Pacific/Auckland",
    "Pacific/Chatham",
    "Pacific/Easter",
    "Pacific/Fiji",
    "Pacific/Tongatapu",
    "Pacific/Apia",
    "Pacific/Kiritimati",
    "Pacific/Noumea",
    "Pacific/Tahiti",
    "America/Argentina",
    "America/Asuncion",
    "America/Santiago",
    "America/Montevideo",
    "America/Sao_Paulo",
    "America/Bahia",
    "America/Fortaleza",
    "America/Recife",
    "Africa/Johannesburg",
    "Africa/Windhoek",
    "Africa/Maputo",
    "Africa/Harare",
    "Indian/Mauritius",
    "Indian/Reunion",
    "Indian/Antananarivo",
  ];
  var themeSelect = null;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function init() {
    themeSelect = document.querySelector("[data-theme-select]");
    var storedPreference = readStoredPreference();
    var resolvedTheme = resolveTheme(storedPreference);
    applyTheme(resolvedTheme, storedPreference, { skipPersist: true });
    if (themeSelect) {
      themeSelect.addEventListener("change", handleSelectChange);
      updateSelectValue(storedPreference === AUTO ? AUTO : resolvedTheme);
    }
  }

  function handleSelectChange(event) {
    var selected = event.target.value || AUTO;
    var resolved = resolveTheme(selected);
    applyTheme(resolved, selected);
  }

  function applyTheme(theme, preference, options) {
    var body = document.body;
    if (!body) {
      return;
    }
    var preferredValue = preference === AUTO ? AUTO : normalizeTheme(preference);
    if (!preferredValue) {
      preferredValue = AUTO;
    }
    THEMES.forEach(function (t) {
      body.classList.remove("theme-" + t);
    });
    body.classList.remove("theme-lava");
    body.classList.add("theme-" + theme);
    body.dataset.theme = theme;
    body.dataset.themeSource = preferredValue === AUTO ? "seasonal" : "manual";

    if (!options || !options.skipPersist) {
      persistPreference(preferredValue);
    }
    if (themeSelect) {
      updateSelectValue(preferredValue === AUTO ? AUTO : theme);
    }
    dispatchThemeChange(theme, preferredValue);
  }

  function dispatchThemeChange(theme, preference) {
    try {
      var detail = {
        theme: theme,
        preference: preference,
        seasonalDefault: resolveSeasonalTheme(),
      };
      document.dispatchEvent(
        new CustomEvent("theme:change", {
          detail: detail,
        })
      );
    } catch (err) {}
  }

  function persistPreference(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (err) {}
  }

  function readStoredPreference() {
    try {
      var stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === AUTO || normalizeTheme(stored)) {
        return stored;
      }
    } catch (err) {}
    return AUTO;
  }

  function resolveTheme(preference) {
    if (preference !== AUTO && normalizeTheme(preference)) {
      return normalizeTheme(preference);
    }
    return resolveSeasonalTheme();
  }

  function resolveSeasonalTheme() {
    var hemisphere = inferHemisphere();
    var month = new Date().getMonth();
    if (hemisphere === "south") {
      if (month >= 2 && month <= 4) {
        return "fall";
      }
      if (month >= 5 && month <= 7) {
        return "winter";
      }
      if (month >= 8 && month <= 10) {
        return "spring";
      }
      return "summer";
    }
    if (month >= 2 && month <= 4) {
      return "spring";
    }
    if (month >= 5 && month <= 7) {
      return "summer";
    }
    if (month >= 8 && month <= 10) {
      return "fall";
    }
    return "winter";
  }

  function inferHemisphere() {
    var tz = resolveTimezone();
    if (!tz) {
      return "north";
    }
    for (var i = 0; i < SOUTHERN_TIMEZONE_HINTS.length; i += 1) {
      if (tz.indexOf(SOUTHERN_TIMEZONE_HINTS[i]) === 0) {
        return "south";
      }
    }
    return "north";
  }

  function resolveTimezone() {
    try {
      var options = Intl.DateTimeFormat().resolvedOptions();
      return options.timeZone || "";
    } catch (err) {
      return "";
    }
  }

  function normalizeTheme(theme) {
    if (!theme || typeof theme !== "string") {
      return null;
    }
    var value = theme.toLowerCase();
    return THEMES.indexOf(value) !== -1 ? value : null;
  }

  function updateSelectValue(value) {
    if (!themeSelect) {
      return;
    }
    var normalized = value || AUTO;
    themeSelect.value = normalized;
  }
})();
