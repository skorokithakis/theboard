(function () {
  "use strict";

  var COMMAND_LIMIT = 4000;
  var DEFAULT_COLOR = "#f3c969";
  var DEFAULT_WIDTH = 3;
  var PRESETS = {
    starburst: [
      "PENCOLOR #f3c969",
      "PENWIDTH 3",
      "REPEAT 5 [",
      "  FD 170",
      "  RT 144",
      "]",
      "RT 18",
      "REPEAT 5 [",
      "  FD 130",
      "  RT 144",
      "]",
    ].join("\n"),
    rosette: [
      "PENCOLOR 43 179 175",
      "PENWIDTH 2",
      "REPEAT 12 [",
      "  REPEAT 6 [",
      "    FD 50",
      "    RT 60",
      "  ]",
      "  RT 30",
      "]",
      "PENCOLOR 244 91 105",
      "REPEAT 6 [",
      "  FD 100",
      "  LT 60",
      "]",
    ].join("\n"),
    spiral: [
      "PENCOLOR 120 255 210",
      "PENWIDTH 2",
      "REPEAT 36 [",
      "  FD 6",
      "  RT 10",
      "  FD 6",
      "]",
      "PENCOLOR 243 201 105",
      "PENWIDTH 3",
      "REPEAT 24 [",
      "  FD 10",
      "  LT 20",
      "]",
    ].join("\n"),
  };

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(initializeLogoLab);

  function initializeLogoLab() {
    var lab = document.querySelector("[data-logo-lab]");
    if (!lab) {
      return;
    }

    var canvas = lab.querySelector("[data-logo-canvas]");
    var turtle = lab.querySelector("[data-logo-turtle]");
    var programInput = lab.querySelector("[data-logo-program]");
    var runButton = lab.querySelector("[data-logo-run]");
    var clearButton = lab.querySelector("[data-logo-clear]");
    var homeButton = lab.querySelector("[data-logo-home]");
    var overlay = lab.querySelector("[data-logo-overlay]");
    var statusEl = lab.querySelector("[data-logo-status]");

    if (!canvas || !canvas.getContext) {
      return;
    }

    var ctx = canvas.getContext("2d");
    var state = createInitialState();
    var activeRunToken = null;

    paintBackdrop(ctx, canvas);
    updateTurtlePosition(canvas, turtle, state);
    setStatus(statusEl, "Ready. Pen down with a metallic gold ink. The turtle faces north.");
    loadPreset(programInput, "starburst");

    runButton.addEventListener("click", function () {
      startRun(canvas, ctx, state, programInput, overlay, statusEl, turtle);
    });

    clearButton.addEventListener("click", function () {
      cancelActiveRun();
      resetStage(ctx, canvas, state, turtle, statusEl);
      setStatus(statusEl, "Canvas cleared. Turtle centered and pen reset.");
      showOverlay(overlay, "Canvas cleared. Write or load a program.");
    });

    homeButton.addEventListener("click", function () {
      cancelActiveRun();
      moveHome(state);
      updateTurtlePosition(canvas, turtle, state);
      setStatus(statusEl, "Turtle centered at origin. Heading reset to 0\u00b0 north.");
    });

    programInput.addEventListener("keydown", function (event) {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        startRun(canvas, ctx, state, programInput, overlay, statusEl, turtle);
      }
    });

    lab.querySelectorAll("[data-logo-preset]").forEach(function (button) {
      button.addEventListener("click", function () {
        var presetKey = button.getAttribute("data-logo-preset");
        if (!presetKey) {
          return;
        }
        loadPreset(programInput, presetKey);
        showOverlay(overlay, "Loaded " + button.textContent + ". Press Run or hit Ctrl+Enter.");
        setStatus(statusEl, "Preset \"" + button.textContent + "\" loaded.");
      });
    });

    window.addEventListener("resize", function () {
      updateTurtlePosition(canvas, turtle, state);
    });

    function cancelActiveRun() {
      if (activeRunToken) {
        activeRunToken.cancelled = true;
        activeRunToken = null;
      }
    }

    function startRun(canvasEl, context, drawState, input, overlayEl, statusElement, turtleEl) {
      var parsed = parseProgram(input.value);
      cancelActiveRun();
      if (parsed.error) {
        setStatus(statusElement, parsed.error, true);
        return;
      }
      hideOverlay(overlayEl);
      paintBackdrop(context, canvasEl);
      moveHome(drawState);
      updateTurtlePosition(canvasEl, turtleEl, drawState);
      setPenDefaults(drawState, DEFAULT_COLOR, DEFAULT_WIDTH);
      activeRunToken = { cancelled: false };
      setStatus(statusElement, "Drawing... your program expands to " + parsed.operationCount + " steps.");
      runButton.disabled = true;
      clearButton.disabled = true;
      homeButton.disabled = true;
      executeCommands(parsed.commands, context, canvasEl, drawState, turtleEl, activeRunToken, function (wasCancelled) {
        runButton.disabled = false;
        clearButton.disabled = false;
        homeButton.disabled = false;
        if (wasCancelled) {
          setStatus(statusElement, "Run cancelled.", true);
          return;
        }
        setStatus(statusElement, "Finished drawing. Adjust the script and run again.");
      });
    }
  }

  function createInitialState() {
    return {
      x: 0,
      y: 0,
      heading: 0,
      penDown: true,
      penColor: DEFAULT_COLOR,
      penWidth: DEFAULT_WIDTH,
    };
  }

  function setPenDefaults(state, color, width) {
    state.penColor = color;
    state.penWidth = width;
    state.penDown = true;
    state.heading = 0;
    state.x = 0;
    state.y = 0;
  }

  function moveHome(state) {
    state.x = 0;
    state.y = 0;
    state.heading = 0;
  }

  function paintBackdrop(ctx, canvas) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0b1820";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(243, 201, 105, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    var grid = 60;
    for (var x = grid; x < canvas.width; x += grid) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    for (var y = grid; y < canvas.height; y += grid) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(43, 179, 175, 0.55)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    ctx.restore();
  }

  function resetStage(ctx, canvas, state, turtle, statusEl) {
    paintBackdrop(ctx, canvas);
    setPenDefaults(state, DEFAULT_COLOR, DEFAULT_WIDTH);
    updateTurtlePosition(canvas, turtle, state);
    setStatus(statusEl, "Canvas cleared. Turtle centered and pen reset.");
  }

  function updateTurtlePosition(canvas, turtle, state) {
    if (!turtle) {
      return;
    }
    var projected = projectToCanvas(state.x, state.y, canvas);
    var rect = canvas.getBoundingClientRect();
    var scaleX = rect.width / canvas.width;
    var scaleY = rect.height / canvas.height;
    turtle.style.left = projected.x * scaleX + "px";
    turtle.style.top = projected.y * scaleY + "px";
    turtle.style.transform = "translate(-50%, -50%) rotate(" + state.heading + "deg)";
  }

  function projectToCanvas(x, y, canvas) {
    return {
      x: canvas.width / 2 + x,
      y: canvas.height / 2 - y,
    };
  }

  function setStatus(el, message, isError) {
    if (!el) {
      return;
    }
    el.textContent = message;
    if (isError) {
      el.classList.add("logo-console__status--error");
    } else {
      el.classList.remove("logo-console__status--error");
    }
  }

  function hideOverlay(el) {
    if (el) {
      el.hidden = true;
    }
  }

  function showOverlay(el, message) {
    if (!el) {
      return;
    }
    if (message) {
      el.textContent = "";
      el.appendChild(document.createTextNode(message));
    }
    el.hidden = false;
  }

  function loadPreset(input, key) {
    if (!input || !PRESETS[key]) {
      return;
    }
    input.value = PRESETS[key];
  }

  function parseProgram(source) {
    var sanitized = source.replace(/;.*$/gm, "").trim();
    if (!sanitized) {
      return { commands: [], operationCount: 0, error: "Nothing to run. Add some LOGO commands first." };
    }
    var tokens = tokenize(sanitized);
    if (!tokens.length) {
      return { commands: [], operationCount: 0, error: "No commands found." };
    }
    var parsed = buildCommands(tokens, 0);
    if (parsed.error) {
      return { commands: [], operationCount: 0, error: parsed.error };
    }
    var opCount = countOperations(parsed.commands);
    if (opCount > COMMAND_LIMIT) {
      return {
        commands: [],
        operationCount: opCount,
        error: "Program expands to " + opCount + " steps. Try a smaller loop.",
      };
    }
    return { commands: parsed.commands, operationCount: opCount };
  }

  function tokenize(source) {
    return source
      .replace(/\[/g, " [ ")
      .replace(/\]/g, " ] ")
      .trim()
      .split(/\s+/);
  }

  function buildCommands(tokens, startIndex) {
    var commands = [];
    var idx = startIndex;

    while (idx < tokens.length) {
      var token = tokens[idx].toUpperCase();
      if (token === "]") {
        return { commands: commands, idx: idx + 1 };
      }
      if (token === "[") {
        return { error: "Unexpected '[' without a REPEAT." };
      }
      if (token === "REPEAT") {
        var repeatCount = parseNumber(tokens[idx + 1]);
        if (repeatCount === null) {
          return { error: "REPEAT needs a count: REPEAT 6 [ FD 60 RT 60 ]" };
        }
        if (tokens[idx + 2] !== "[") {
          return { error: "REPEAT requires a bracketed block: REPEAT n [ ... ]" };
        }
        var nested = buildCommands(tokens, idx + 3);
        if (nested.error) {
          return nested;
        }
        commands.push({
          type: "REPEAT",
          count: Math.max(0, Math.floor(repeatCount)),
          body: nested.commands,
        });
        idx = nested.idx;
        continue;
      }
      if (token === "FD" || token === "FORWARD") {
        var forwardDistance = parseNumber(tokens[idx + 1]);
        if (forwardDistance === null) {
          return { error: "FD expects a distance." };
        }
        commands.push({ type: "MOVE", distance: forwardDistance });
        idx += 2;
        continue;
      }
      if (token === "BK" || token === "BACK" || token === "BACKWARD") {
        var backwardDistance = parseNumber(tokens[idx + 1]);
        if (backwardDistance === null) {
          return { error: "BK expects a distance." };
        }
        commands.push({ type: "MOVE", distance: -backwardDistance });
        idx += 2;
        continue;
      }
      if (token === "RT" || token === "RIGHT") {
        var rightTurn = parseNumber(tokens[idx + 1]);
        if (rightTurn === null) {
          return { error: "RT expects an angle." };
        }
        commands.push({ type: "TURN", degrees: rightTurn });
        idx += 2;
        continue;
      }
      if (token === "LT" || token === "LEFT") {
        var leftTurn = parseNumber(tokens[idx + 1]);
        if (leftTurn === null) {
          return { error: "LT expects an angle." };
        }
        commands.push({ type: "TURN", degrees: -leftTurn });
        idx += 2;
        continue;
      }
      if (token === "PU" || token === "PENUP") {
        commands.push({ type: "PEN", down: false });
        idx += 1;
        continue;
      }
      if (token === "PD" || token === "PENDOWN") {
        commands.push({ type: "PEN", down: true });
        idx += 1;
        continue;
      }
      if (token === "PENWIDTH" || token === "SETWIDTH") {
        var width = parseNumber(tokens[idx + 1]);
        if (width === null) {
          return { error: "PENWIDTH expects a number of pixels." };
        }
        commands.push({ type: "WIDTH", width: width });
        idx += 2;
        continue;
      }
      if (token === "PENCOLOR" || token === "COLOR") {
        var colorResult = parseColor(tokens, idx + 1);
        if (colorResult.error) {
          return { error: colorResult.error };
        }
        commands.push({ type: "COLOR", value: colorResult.color });
        idx += 1 + colorResult.consumed;
        continue;
      }
      if (token === "SETXY" || token === "SETPOS") {
        var targetX = parseNumber(tokens[idx + 1]);
        var targetY = parseNumber(tokens[idx + 2]);
        if (targetX === null || targetY === null) {
          return { error: "SETXY expects two numbers: SETXY 40 -20" };
        }
        commands.push({ type: "SETPOS", x: targetX, y: targetY });
        idx += 3;
        continue;
      }
      if (token === "SETHEADING" || token === "SETH") {
        var heading = parseNumber(tokens[idx + 1]);
        if (heading === null) {
          return { error: "SETHEADING expects an angle." };
        }
        commands.push({ type: "HEADING", heading: heading });
        idx += 2;
        continue;
      }
      if (token === "HOME") {
        commands.push({ type: "HOME" });
        idx += 1;
        continue;
      }
      if (token === "CLEAR" || token === "CS" || token === "CLEARSCREEN") {
        commands.push({ type: "CLEAR" });
        idx += 1;
        continue;
      }
      return { error: "Unknown command: " + tokens[idx] };
    }

    return { commands: commands, idx: idx };
  }

  function parseNumber(token) {
    if (token === undefined) {
      return null;
    }
    var value = parseFloat(token);
    if (Number.isNaN(value) || !isFinite(value)) {
      return null;
    }
    return value;
  }

  function parseColor(tokens, start) {
    var token = tokens[start];
    if (!token) {
      return { error: "PENCOLOR expects a hex value or three numbers." };
    }
    if (token.charAt(0) === "#") {
      return { color: normalizeHex(token), consumed: 1 };
    }
    var r = parseNumber(token);
    var g = parseNumber(tokens[start + 1]);
    var b = parseNumber(tokens[start + 2]);
    if (r === null || g === null || b === null) {
      return { error: "PENCOLOR expects #hex or RGB numbers: PENCOLOR 120 255 210" };
    }
    return {
      color: "rgb(" + clampColor(r) + ", " + clampColor(g) + ", " + clampColor(b) + ")",
      consumed: 3,
    };
  }

  function normalizeHex(value) {
    if (value.length === 4) {
      return (
        "#" +
        value[1] +
        value[1] +
        value[2] +
        value[2] +
        value[3] +
        value[3]
      );
    }
    return value;
  }

  function clampColor(value) {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function countOperations(commands) {
    var total = 0;
    for (var i = 0; i < commands.length; i += 1) {
      var command = commands[i];
      if (command.type === "REPEAT") {
        total += command.count * countOperations(command.body);
      } else {
        total += 1;
      }
    }
    return total;
  }

  function executeCommands(commands, ctx, canvas, state, turtle, runToken, onDone) {
    var queue = commands.slice();
    function next() {
      if (runToken.cancelled) {
        onDone(true);
        return;
      }
      if (!queue.length) {
        onDone(false);
        return;
      }
      var command = queue.shift();
      runCommand(command, ctx, canvas, state, turtle, runToken, function () {
        if (runToken.cancelled) {
          onDone(true);
          return;
        }
        requestAnimationFrame(next);
      });
    }
    next();
  }

  function runCommand(command, ctx, canvas, state, turtle, runToken, callback) {
    if (runToken.cancelled) {
      callback();
      return;
    }
    switch (command.type) {
      case "MOVE":
        animateMove(command.distance, ctx, canvas, state, turtle, runToken, callback);
        return;
      case "TURN":
        state.heading = normalizeDegrees(state.heading + command.degrees);
        updateTurtlePosition(canvas, turtle, state);
        callback();
        return;
      case "PEN":
        state.penDown = Boolean(command.down);
        callback();
        return;
      case "WIDTH":
        state.penWidth = clampWidth(command.width);
        callback();
        return;
      case "COLOR":
        state.penColor = command.value;
        callback();
        return;
      case "SETPOS":
        state.x = clampPosition(command.x, canvas.width / 2);
        state.y = clampPosition(command.y, canvas.height / 2);
        updateTurtlePosition(canvas, turtle, state);
        callback();
        return;
      case "HEADING":
        state.heading = normalizeDegrees(command.heading);
        updateTurtlePosition(canvas, turtle, state);
        callback();
        return;
      case "HOME":
        moveHome(state);
        updateTurtlePosition(canvas, turtle, state);
        callback();
        return;
      case "CLEAR":
        paintBackdrop(ctx, canvas);
        moveHome(state);
        updateTurtlePosition(canvas, turtle, state);
        callback();
        return;
      case "REPEAT": {
        var iteration = 0;
        var limit = command.count;
        function runLoop() {
          if (runToken.cancelled) {
            callback();
            return;
          }
          if (iteration >= limit) {
            callback();
            return;
          }
          iteration += 1;
          executeCommands(command.body, ctx, canvas, state, turtle, runToken, function (cancelled) {
            if (cancelled) {
              callback();
              return;
            }
            requestAnimationFrame(runLoop);
          });
        }
        runLoop();
        return;
      }
      default:
        callback();
    }
  }

  function animateMove(distance, ctx, canvas, state, turtle, runToken, done) {
    var steps = Math.max(1, Math.min(160, Math.round(Math.abs(distance) / 4)));
    var stepSize = distance / steps;
    var currentStep = 0;

    function step() {
      if (runToken.cancelled) {
        done();
        return;
      }
      if (currentStep >= steps) {
        done();
        return;
      }
      var start = { x: state.x, y: state.y };
      var angleRad = degToRad(90 - state.heading);
      state.x += Math.cos(angleRad) * stepSize;
      state.y += Math.sin(angleRad) * stepSize;

      state.x = clampPosition(state.x, canvas.width / 2 - 2);
      state.y = clampPosition(state.y, canvas.height / 2 - 2);

      if (state.penDown) {
        drawSegment(ctx, canvas, start, { x: state.x, y: state.y }, state);
      }
      updateTurtlePosition(canvas, turtle, state);
      currentStep += 1;
      requestAnimationFrame(step);
    }

    step();
  }

  function drawSegment(ctx, canvas, start, end, state) {
    ctx.save();
    ctx.lineWidth = clampWidth(state.penWidth);
    ctx.strokeStyle = state.penColor;
    ctx.lineCap = "round";
    ctx.beginPath();
    var projectedStart = projectToCanvas(start.x, start.y, canvas);
    var projectedEnd = projectToCanvas(end.x, end.y, canvas);
    ctx.moveTo(projectedStart.x, projectedStart.y);
    ctx.lineTo(projectedEnd.x, projectedEnd.y);
    ctx.stroke();
    ctx.restore();
  }

  function degToRad(deg) {
    return (deg * Math.PI) / 180;
  }

  function clampWidth(width) {
    if (width === undefined || width === null) {
      return DEFAULT_WIDTH;
    }
    return Math.max(1, Math.min(20, width));
  }

  function clampPosition(value, halfSize) {
    return Math.max(-halfSize, Math.min(halfSize, value));
  }

  function normalizeDegrees(value) {
    var normalized = value % 360;
    if (normalized < 0) {
      normalized += 360;
    }
    return normalized;
  }
})();
