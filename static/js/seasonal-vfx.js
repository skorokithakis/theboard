(function () {
  "use strict";

  var ACTIVE = null;
  var SUPPORTED_THEMES = ["winter", "winter-red", "spring", "summer", "fall", "neon"];
  var REDUCED_MOTION = prefersReducedMotion();

  var THEME_BUILDERS = {
    winter: function () {
      return createLayer("winter", [
        {
          type: "seasonal-vfx__sprite--frost-shard",
          count: 14,
          options: {
            sizeRange: [36, 56],
            floatDuration: [16, 26],
            lift: [46, 92],
            opacity: [0.6, 0.96],
            driftX: [-28, 28],
            driftY: [-18, 12],
          },
        },
        {
          type: "seasonal-vfx__sprite--winter-ember",
          count: 9,
          options: {
            sizeRange: [22, 34],
            driftX: [-22, 22],
            driftY: [-6, 12],
            lift: [32, 68],
            opacity: [0.55, 0.82],
            floatDuration: [16, 22],
            floatDelay: [-10, 4],
            rotationSpan: [40, 120],
          },
        },
      ]);
    },
    "winter-red": function () {
      return createLayer("winter-red", [
        {
          type: "seasonal-vfx__sprite--reindeer-charm",
          count: 10,
          options: {
            sizeRange: [44, 58],
            driftX: [-26, 26],
            driftY: [-12, 16],
            floatDuration: [18, 26],
            lift: [36, 74],
            opacity: [0.62, 0.9],
          },
        },
        {
          type: "seasonal-vfx__sprite--snow-buddy",
          count: 7,
          options: {
            sizeRange: [40, 54],
            driftX: [-18, 18],
            driftY: [-6, 12],
            floatDuration: [18, 26],
            lift: [28, 56],
            opacity: [0.56, 0.8],
            rotationSpan: [-20, 42],
          },
        },
      ]);
    },
    spring: function () {
      return createLayer("spring", [
        {
          type: "seasonal-vfx__sprite--spring-leaf",
          count: 12,
          options: {
            sizeRange: [36, 52],
            driftX: [-26, 26],
            driftY: [-12, 12],
            floatDuration: [16, 24],
            lift: [42, 72],
            opacity: [0.62, 0.88],
            rotationSpan: [-60, 120],
          },
        },
        {
          type: "seasonal-vfx__sprite--spring-helix",
          count: 8,
          options: {
            sizeRange: [20, 28],
            driftX: [-14, 14],
            driftY: [-10, 10],
            floatDuration: [18, 26],
            lift: [52, 82],
            opacity: [0.64, 0.82],
            rotationSpan: [-24, 32],
          },
        },
      ]);
    },
    summer: function () {
      return createLayer("summer", [
        {
          type: "seasonal-vfx__sprite--summer-sun",
          count: 10,
          options: {
            sizeRange: [46, 62],
            driftX: [-18, 18],
            driftY: [-10, 12],
            floatDuration: [18, 26],
            lift: [42, 70],
            opacity: [0.64, 0.92],
            rotationSpan: [10, 90],
          },
        },
        {
          type: "seasonal-vfx__sprite--summer-floaty",
          count: 8,
          options: {
            sizeRange: [36, 52],
            driftX: [-24, 24],
            driftY: [-8, 14],
            floatDuration: [18, 26],
            lift: [32, 62],
            opacity: [0.58, 0.84],
            rotationSpan: [-70, 110],
          },
        },
      ]);
    },
    fall: function () {
      return createLayer("fall", [
        {
          type: "seasonal-vfx__sprite--fall-leaf",
          count: 12,
          options: {
            sizeRange: [38, 54],
            driftX: [-32, 32],
            driftY: [-14, 18],
            floatDuration: [18, 28],
            lift: [46, 82],
            opacity: [0.62, 0.9],
            rotationSpan: [-90, 140],
          },
        },
        {
          type: "seasonal-vfx__sprite--fall-mote",
          count: 10,
          options: {
            sizeRange: [20, 28],
            driftX: [-18, 18],
            driftY: [-10, 12],
            floatDuration: [16, 24],
            lift: [26, 52],
            opacity: [0.54, 0.76],
            rotationSpan: [-24, 34],
          },
        },
      ]);
    },
    neon: function () {
      return createLayer("neon", [
        {
          type: "seasonal-vfx__sprite--neon-pulse",
          count: 11,
          options: {
            sizeRange: [40, 56],
            driftX: [-20, 20],
            driftY: [-10, 14],
            floatDuration: [18, 26],
            lift: [44, 72],
            opacity: [0.74, 0.94],
            rotationSpan: [-60, 120],
          },
        },
        {
          type: "seasonal-vfx__sprite--neon-beam",
          count: 8,
          options: {
            sizeRange: [12, 20],
            driftX: [-18, 18],
            driftY: [-12, 10],
            floatDuration: [18, 26],
            lift: [42, 70],
            opacity: [0.62, 0.82],
            rotationSpan: [-40, 60],
            extraProps: {
              "--beam-length": [140, 260, "px"],
            },
          },
        },
      ]);
    },
  };

  ready(initialize);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initialize() {
    if (REDUCED_MOTION) {
      return;
    }
    applyTheme(resolveActiveTheme());
    document.addEventListener("theme:change", function (event) {
      var nextTheme = resolveActiveTheme();
      if (event && event.detail && event.detail.theme) {
        nextTheme = event.detail.theme;
      }
      applyTheme(nextTheme);
    });
  }

  function applyTheme(theme) {
    var normalized = normalizeTheme(theme);
    if (!normalized) {
      teardown();
      return;
    }
    if (ACTIVE && ACTIVE.theme === normalized) {
      return;
    }
    teardown();
    var builder = THEME_BUILDERS[normalized];
    if (builder) {
      ACTIVE = {
        theme: normalized,
        nodes: builder(),
      };
    }
  }

  function teardown() {
    if (!ACTIVE || !ACTIVE.nodes) {
      ACTIVE = null;
      return;
    }
    ACTIVE.nodes.forEach(function (node) {
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });
    ACTIVE = null;
  }

  function createLayer(theme, parts) {
    if (!document.body) {
      return [];
    }
    var layer = document.createElement("div");
    layer.className = "seasonal-vfx seasonal-vfx--" + theme;
    (parts || []).forEach(function (part) {
      addSprites(layer, part.type, part.count, part.options || {});
    });
    if (document.body.firstChild) {
      document.body.insertBefore(layer, document.body.firstChild);
    } else {
      document.body.appendChild(layer);
    }
    return [layer];
  }

  function addSprites(layer, type, count, options) {
    if (!layer || !type || !count) {
      return;
    }
    for (var i = 0; i < count; i += 1) {
      var sprite = createSprite(type, options);
      layer.appendChild(sprite);
    }
  }

  function createSprite(type, options) {
    var sprite = document.createElement("span");
    sprite.className = "seasonal-vfx__sprite " + type;
    sprite.style.left = randomBetween(4, 96).toFixed(2) + "%";
    sprite.style.top = randomBetween(6, 94).toFixed(2) + "%";
    setVar(sprite, "--sprite-size", formatPx(maybeRange(options.sizeRange, [34, 52])));
    setVar(sprite, "--sprite-opacity", clampRange(options.opacity, 0.55, 0.92).toFixed(2));
    setVar(sprite, "--sprite-scale", clampRange(options.scale, 0.88, 1.18).toFixed(2));
    setVar(sprite, "--float-duration", formatSeconds(maybeRange(options.floatDuration, [16, 26])));
    setVar(sprite, "--float-delay", formatSeconds(maybeRange(options.floatDelay, [-12, 6])));
    setVar(sprite, "--drift-x", formatPx(maybeRange(options.driftX, [-32, 32])));
    setVar(sprite, "--drift-y-start", formatPx(maybeRange(options.driftY, [-16, 16])));
    setVar(sprite, "--lift", formatPx(maybeRange(options.lift, [32, 72])));
    setVar(sprite, "--rotation-start", formatDeg(randomBetween(0, 360)));
    setVar(sprite, "--rotation-span", formatDeg(maybeRange(options.rotationSpan, [-80, 140])));
    applyExtraProps(sprite, options.extraProps);
    return sprite;
  }

  function applyExtraProps(sprite, props) {
    if (!sprite || !props) {
      return;
    }
    Object.keys(props).forEach(function (key) {
      var value = props[key];
      if (Array.isArray(value)) {
        var unit = value[2] || "";
        var resolved = randomBetween(value[0], value[1]);
        if (unit === "px") {
          setVar(sprite, key, formatPx(resolved));
        } else if (unit === "deg") {
          setVar(sprite, key, formatDeg(resolved));
        } else if (unit === "s") {
          setVar(sprite, key, formatSeconds(resolved));
        } else {
          setVar(sprite, key, resolved.toFixed(2) + unit);
        }
        return;
      }
      if (typeof value === "number") {
        setVar(sprite, key, value.toFixed(2));
      } else if (typeof value === "string") {
        setVar(sprite, key, value);
      }
    });
  }

  function normalizeTheme(theme) {
    if (!theme || typeof theme !== "string") {
      return "";
    }
    var value = theme.toLowerCase();
    return SUPPORTED_THEMES.indexOf(value) === -1 ? "" : value;
  }

  function resolveActiveTheme() {
    var body = document.body;
    if (!body) {
      return "";
    }
    if (body.dataset && body.dataset.theme) {
      return body.dataset.theme;
    }
    var className = body.className || "";
    var classes = className.split(/\s+/);
    for (var i = 0; i < classes.length; i += 1) {
      if (classes[i].indexOf("theme-") === 0) {
        return classes[i].replace("theme-", "");
      }
    }
    return "";
  }

  function prefersReducedMotion() {
    if (!window.matchMedia) {
      return false;
    }
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (err) {
      return false;
    }
  }

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }

  function maybeRange(range, fallback) {
    if (Array.isArray(range) && range.length >= 2) {
      return randomBetween(range[0], range[1]);
    }
    if (typeof fallback === "number") {
      return fallback;
    }
    if (Array.isArray(fallback) && fallback.length >= 2) {
      return randomBetween(fallback[0], fallback[1]);
    }
    return 0;
  }

  function clampRange(range, min, max) {
    var value = maybeRange(range, [min, max]);
    if (value < min) {
      return min;
    }
    if (value > max) {
      return max;
    }
    return value;
  }

  function setVar(el, name, value) {
    if (!el || !name || typeof value === "undefined" || value === null) {
      return;
    }
    el.style.setProperty(name, String(value));
  }

  function formatPx(value) {
    return value.toFixed(2) + "px";
  }

  function formatDeg(value) {
    return value.toFixed(2) + "deg";
  }

  function formatSeconds(value) {
    return value.toFixed(2) + "s";
  }
})();
