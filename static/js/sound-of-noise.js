(function () {
  "use strict";

  var audioCtx = null;
  var squeakHandler = null;
  var squeakLastPlayed = 0;
  var bayhemTimer = null;
  var graveyardTimer = null;
  var graveyardAudio = null;
  var graveyardPrimed = false;
  var metronomeInterval = null;
  var metronomeToggle = null;
  var metronomeMenu = null;
  var metronomeStatus = null;
  var metronomeTempoInput = null;
  var metronomeTempoValue = null;
  var metronomePatternButtons = {};
  var metronomeCurrentPattern = null;
  var metronomeStep = 0;
  var boardStepsInput = null;
  var boardPulsesInput = null;
  var metronomeStopButton = null;
  var METRONOME_LIBRARY = buildMetronomeLibrary();
  var DRONE_LIBRARY = buildDroneLibrary();
  var droneMasterGain = null;
  var droneNodes = [];
  var dronePresetButtons = {};
  var droneActivePreset = null;
  var droneRootSelect = null;
  var droneStopButton = null;
  var droneStatus = null;
  var droneNoiseBuffers = {};
  var reduceMotion = prefersReducedMotion();
  var zeroDecibelMode = false;

  ready(initialize);

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  function initialize() {
    zeroDecibelMode = isZeroDecibelEnabled();
    bindGlobalSqueaks();
    bindFormBayhem();
    armGraveyardSounds();
    installRecordsMetronome();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("zero-decibel:change", handleZeroDecibelChange);
  }

  function prefersReducedMotion() {
    var query = window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)")
      : null;
    if (query && typeof query.addEventListener === "function") {
      query.addEventListener("change", function (event) {
        reduceMotion = !!(event && event.matches);
      });
    }
    return query ? query.matches : false;
  }

  function ensureAudioContext() {
    if (zeroDecibelMode) {
      return null;
    }
    if (audioCtx) {
      return audioCtx;
    }
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    try {
      audioCtx = new Ctor();
    } catch (err) {
      audioCtx = null;
    }
    return audioCtx;
  }

  function resumeContext(ctx) {
    if (!ctx) {
      return Promise.reject(new Error("No audio context"));
    }
    if (typeof ctx.resume !== "function") {
      return Promise.resolve(ctx);
    }
    if (ctx.state === "running") {
      return Promise.resolve(ctx);
    }
    try {
      return ctx.resume().then(function () {
        return ctx;
      });
    } catch (err) {
      return Promise.reject(err);
    }
  }

  function bindGlobalSqueaks() {
    if (zeroDecibelMode) {
      return;
    }
    if (squeakHandler) {
      return;
    }
    squeakHandler = function (event) {
      if (event.button && event.button > 1) {
        return;
      }
      var ctx = ensureAudioContext();
      if (!ctx) {
        disableSqueaks();
        return;
      }
      resumeContext(ctx)
        .then(function (runningCtx) {
          playSqueak(runningCtx);
        })
        .catch(disableSqueaks);
    };
    document.addEventListener("pointerdown", squeakHandler, { capture: true });
  }

  function disableSqueaks() {
    if (!squeakHandler) {
      return;
    }
    document.removeEventListener("pointerdown", squeakHandler, {
      capture: true,
    });
    squeakHandler = null;
  }

  function playSqueak(ctx) {
    var now = ctx.currentTime;
    if (squeakLastPlayed && now - squeakLastPlayed < 0.08) {
      return;
    }
    squeakLastPlayed = now;

    var oscillator = ctx.createOscillator();
    var gain = ctx.createGain();
    var filter =
      typeof ctx.createBiquadFilter === "function"
        ? ctx.createBiquadFilter()
        : null;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(1500, now);
    oscillator.frequency.exponentialRampToValueAtTime(720, now + 0.2);
    if (oscillator.detune && typeof oscillator.detune.setValueAtTime === "function") {
      oscillator.detune.setValueAtTime((Math.random() - 0.5) * 160, now);
    }

    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.2, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    oscillator.connect(gain);
    if (filter) {
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1200, now);
      filter.Q.value = 8;
      gain.connect(filter);
      filter.connect(ctx.destination);
    } else {
      gain.connect(ctx.destination);
    }

    oscillator.start(now);
    oscillator.stop(now + 0.26);
  }

  function bindFormBayhem() {
    document.addEventListener(
      "submit",
      function (event) {
        if (!(event.target instanceof HTMLFormElement)) {
          return;
        }
        triggerBayhem();
        playRumble();
      },
      true
    );
  }

  function triggerBayhem() {
    if (reduceMotion) {
      return;
    }
    clearTimeout(bayhemTimer);
    document.body.classList.add("bayhem-active");
    bayhemTimer = window.setTimeout(clearBayhem, 900);
  }

  function clearBayhem() {
    document.body.classList.remove("bayhem-active");
  }

  function playRumble() {
    if (zeroDecibelMode) {
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      return;
    }
    resumeContext(ctx)
      .then(function (runningCtx) {
        var now = runningCtx.currentTime;
        var osc = runningCtx.createOscillator();
        var gain = runningCtx.createGain();

        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(68, now);
        osc.frequency.exponentialRampToValueAtTime(22, now + 0.6);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.72);

        osc.connect(gain);
        gain.connect(runningCtx.destination);
        osc.start(now);
        osc.stop(now + 0.75);
      })
      .catch(function () {
        /* ignore rumble errors so submissions still work */
      });
  }

  function armGraveyardSounds() {
    if (zeroDecibelMode) {
      return;
    }
    var graveyard = document.querySelector(".graveyard-page");
    if (!graveyard) {
      return;
    }
    var spookySrc = graveyard.dataset.spookySound;
    if (!spookySrc) {
      return;
    }
    graveyardAudio = new Audio(spookySrc);
    graveyardAudio.preload = "auto";
    graveyardAudio.loop = false;
    graveyardAudio.volume = 0.55;

    var starter = function () {
      if (graveyardPrimed) {
        return;
      }
      graveyardPrimed = true;
      queueGraveyardTone();
    };

    document.addEventListener("pointermove", starter, { once: true });
    document.addEventListener("scroll", starter, { once: true });
  }

  function queueGraveyardTone() {
    clearTimeout(graveyardTimer);
    if (!graveyardAudio || document.hidden) {
      return;
    }
    var delay = randomBetween(5200, 11800);
    graveyardTimer = window.setTimeout(function () {
      graveyardAudio.currentTime = 0;
      graveyardAudio.play().catch(function () {});
      queueGraveyardTone();
    }, delay);
  }

  function installRecordsMetronome() {
    var section = document.querySelector('[data-nav-section="records"]');
    if (!section || section.querySelector(".records-metronome")) {
      return;
    }
    var toggle = section.querySelector(".site-nav__section-toggle");
    if (!toggle) {
      return;
    }

    metronomeToggle = document.createElement("button");
    metronomeToggle.type = "button";
    metronomeToggle.className = "records-metronome";
    metronomeToggle.setAttribute(
      "aria-label",
      "Open the Patterned Metronome menu"
    );
    metronomeToggle.setAttribute("aria-expanded", "false");
    metronomeToggle.setAttribute("aria-controls", "records-metronome-menu");
    metronomeToggle.title = "Records metronome";
    metronomeToggle.textContent = "⏱";

    toggle.insertAdjacentElement("afterend", metronomeToggle);
    metronomeMenu = buildMetronomeMenu(section);
    setActivePattern(METRONOME_LIBRARY[0], { announce: false });
    updateTempoDisplay();
    metronomeToggle.addEventListener("click", function (event) {
      event.preventDefault();
      toggleMetronomeMenu();
    });
    metronomeToggle.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMetronomeMenu();
      }
    });
    document.addEventListener(
      "click",
      function (event) {
        if (
          !metronomeMenu ||
          !metronomeMenu.classList.contains("records-metronome-menu--open")
        ) {
          return;
        }
        if (
          !metronomeMenu.contains(event.target) &&
          event.target !== metronomeToggle &&
          !metronomeToggle.contains(event.target)
        ) {
          closeMetronomeMenu();
        }
      },
      true
    );
    document.addEventListener("keyup", function (event) {
      if (event.key === "Escape") {
        closeMetronomeMenu();
      }
    });
  }

  function buildMetronomeMenu(section) {
    var menu = document.createElement("div");
    menu.id = "records-metronome-menu";
    menu.className = "records-metronome-menu";
    menu.setAttribute("role", "dialog");
    menu.setAttribute("aria-label", "Patterned Metronome");
    section.appendChild(menu);
    metronomePatternButtons = {};

    var header = document.createElement("div");
    header.className = "records-metronome__header";

    var headerCopy = document.createElement("div");
    var eyebrow = document.createElement("p");
    eyebrow.className = "records-metronome__eyebrow";
    eyebrow.textContent = "Records Lab";
    var title = document.createElement("h3");
    title.className = "records-metronome__title";
    title.textContent = "Patterned Metronome";
    metronomeStatus = document.createElement("p");
    metronomeStatus.className = "records-metronome__status";
    metronomeStatus.textContent = "Idle. Select a rhythm or go Board Mode.";
    headerCopy.appendChild(eyebrow);
    headerCopy.appendChild(title);
    headerCopy.appendChild(metronomeStatus);

    var close = document.createElement("button");
    close.type = "button";
    close.className = "records-metronome__close";
    close.setAttribute("aria-label", "Close metronome menu");
    close.innerHTML = "&times;";
    close.addEventListener("click", closeMetronomeMenu);

    header.appendChild(headerCopy);
    header.appendChild(close);
    menu.appendChild(header);

    var controls = document.createElement("div");
    controls.className = "records-metronome__controls";

    var tempoWrap = document.createElement("label");
    tempoWrap.className = "metronome-tempo";
    tempoWrap.textContent = "Tempo";
    metronomeTempoInput = document.createElement("input");
    metronomeTempoInput.type = "range";
    metronomeTempoInput.min = "60";
    metronomeTempoInput.max = "168";
    metronomeTempoInput.step = "1";
    metronomeTempoInput.value = "96";
    metronomeTempoInput.setAttribute("aria-label", "Metronome tempo");
    metronomeTempoInput.addEventListener("input", updateTempoDisplay);
    metronomeTempoInput.addEventListener("change", restartMetronome);
    metronomeTempoValue = document.createElement("span");
    metronomeTempoValue.className = "metronome-tempo__value";
    metronomeTempoValue.textContent = "96 BPM";
    tempoWrap.appendChild(metronomeTempoInput);
    tempoWrap.appendChild(metronomeTempoValue);

    metronomeStopButton = document.createElement("button");
    metronomeStopButton.type = "button";
    metronomeStopButton.className = "metronome-stop";
    metronomeStopButton.textContent = "Stop";
    metronomeStopButton.disabled = true;
    metronomeStopButton.addEventListener("click", stopMetronome);

    controls.appendChild(tempoWrap);
    controls.appendChild(metronomeStopButton);
    menu.appendChild(controls);

    buildDroneBox(menu);

    createPatternGroup(
      menu,
      "Anchor pulses",
      "Recenter with a clean downbeat before shifting into stranger terrain.",
      "anchor"
    );
    createPatternGroup(
      menu,
      "Odd time signatures",
      "Lean into asymmetry with long-short phrases and hiccuping tails.",
      "odd"
    );
    createPatternGroup(
      menu,
      "Polyrhythms",
      "Cross-rhythms that let different pulses argue over the same bar.",
      "polyrhythm"
    );
    createPatternGroup(
      menu,
      "Euclidean grids",
      "Evenly-spaced pulses mapped onto curious subdivisions.",
      "euclidean"
    );

    var board = document.createElement("div");
    board.className = "metronome-board";
    var boardTitle = document.createElement("div");
    boardTitle.className = "metronome-board__title";
    boardTitle.innerHTML =
      '<span class="metronome-board__pill">Board Mode</span><span>Conjure your own rhythmic creature.</span>';

    var boardInputs = document.createElement("div");
    boardInputs.className = "metronome-board__inputs";

    var stepsLabel = document.createElement("label");
    stepsLabel.className = "metronome-board__field";
    stepsLabel.textContent = "Steps";
    boardStepsInput = document.createElement("input");
    boardStepsInput.type = "number";
    boardStepsInput.min = "3";
    boardStepsInput.max = "16";
    boardStepsInput.value = "9";
    boardStepsInput.setAttribute("aria-label", "Board Mode steps");
    stepsLabel.appendChild(boardStepsInput);

    var pulsesLabel = document.createElement("label");
    pulsesLabel.className = "metronome-board__field";
    pulsesLabel.textContent = "Pulses";
    boardPulsesInput = document.createElement("input");
    boardPulsesInput.type = "number";
    boardPulsesInput.min = "1";
    boardPulsesInput.max = "16";
    boardPulsesInput.value = "5";
    boardPulsesInput.setAttribute("aria-label", "Board Mode pulses");
    pulsesLabel.appendChild(boardPulsesInput);

    var boardButton = document.createElement("button");
    boardButton.type = "button";
    boardButton.className = "metronome-board__launch";
    boardButton.textContent = "Launch Board Mode";
    boardButton.addEventListener("click", startBoardModePattern);

    boardInputs.appendChild(stepsLabel);
    boardInputs.appendChild(pulsesLabel);
    boardInputs.appendChild(boardButton);

    board.appendChild(boardTitle);
    board.appendChild(boardInputs);
    menu.appendChild(board);

    return menu;
  }

  function toggleMetronomeMenu() {
    if (!metronomeMenu) {
      return;
    }
    var isOpen = metronomeMenu.classList.toggle("records-metronome-menu--open");
    metronomeToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (isOpen && metronomeStatus) {
      metronomeStatus.textContent = "Pick a pulse or tap Board Mode to improvise.";
    }
  }

  function closeMetronomeMenu() {
    if (!metronomeMenu) {
      return;
    }
    metronomeMenu.classList.remove("records-metronome-menu--open");
    if (metronomeToggle) {
      metronomeToggle.setAttribute("aria-expanded", "false");
    }
  }

  function buildDroneBox(menu) {
    dronePresetButtons = {};
    var box = document.createElement("div");
    box.className = "metronome-drone";

    var heading = document.createElement("div");
    heading.className = "metronome-drone__heading";
    var eyebrow = document.createElement("p");
    eyebrow.className = "metronome-drone__eyebrow";
    eyebrow.textContent = "Drone Box";
    var title = document.createElement("h4");
    title.className = "metronome-drone__title";
    title.textContent = "Layer a tanpura, shruti box, or noise bed.";
    droneStatus = document.createElement("p");
    droneStatus.className = "metronome-drone__status";
    droneStatus.textContent = "Drone idle. Pick a preset to sit under the groove.";
    heading.appendChild(eyebrow);
    heading.appendChild(title);
    heading.appendChild(droneStatus);

    var controls = document.createElement("div");
    controls.className = "metronome-drone__controls";
    var rootLabel = document.createElement("label");
    rootLabel.className = "metronome-drone__field";
    rootLabel.textContent = "Tonic";
    droneRootSelect = document.createElement("select");
    droneRootSelect.className = "metronome-drone__select";
    droneRootSelect.setAttribute("aria-label", "Drone tonic");
    [
      { label: "C#3 (Sa)", value: "138.59" },
      { label: "D3 (Sa)", value: "146.83" },
      { label: "G3 (Sa)", value: "196.00" },
    ].forEach(function (optionConfig) {
      var option = document.createElement("option");
      option.value = optionConfig.value;
      option.textContent = optionConfig.label;
      droneRootSelect.appendChild(option);
    });
    droneRootSelect.value = "146.83";
    rootLabel.appendChild(droneRootSelect);

    droneStopButton = document.createElement("button");
    droneStopButton.type = "button";
    droneStopButton.className = "metronome-drone__stop";
    droneStopButton.textContent = "Mute drone";
    droneStopButton.disabled = true;
    droneStopButton.addEventListener("click", stopDrone);

    controls.appendChild(rootLabel);
    controls.appendChild(droneStopButton);

    var presets = document.createElement("div");
    presets.className = "metronome-drone__presets";
    DRONE_LIBRARY.forEach(function (preset) {
      var button = createDroneButton(preset);
      presets.appendChild(button);
    });

    box.appendChild(heading);
    box.appendChild(controls);
    box.appendChild(presets);
    menu.appendChild(box);
  }

  function createDroneButton(preset) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "drone-button";
    button.dataset.droneId = preset.id;

    var eyebrow = document.createElement("span");
    eyebrow.className = "drone-button__eyebrow";
    eyebrow.textContent = preset.tag || preset.type;

    var title = document.createElement("span");
    title.className = "drone-button__title";
    title.textContent = preset.label;

    var note = document.createElement("span");
    note.className = "drone-button__note";
    note.textContent = preset.description;

    button.appendChild(eyebrow);
    button.appendChild(title);
    button.appendChild(note);

    button.addEventListener("click", function () {
      startDroneWithPreset(preset);
    });

    dronePresetButtons[preset.id] = button;
    return button;
  }

  function startDroneWithPreset(preset) {
    if (!preset) {
      return;
    }
    if (zeroDecibelMode) {
      updateDroneStatus("Zero-decibel mode is on, so drones are muted.");
      stopDrone();
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      updateDroneStatus("Audio unavailable in this browser.");
      return;
    }
    stopDrone({ silent: true });
    resumeContext(ctx)
      .then(function (runningCtx) {
        setActiveDronePreset(preset);
        playDronePreset(runningCtx, preset);
      })
      .catch(function () {
        stopDrone();
      });
  }

  function setActiveDronePreset(preset) {
    droneActivePreset = preset || null;
    Object.keys(dronePresetButtons).forEach(function (key) {
      var button = dronePresetButtons[key];
      if (button) {
        button.classList.toggle("drone-button--active", !!preset && key === preset.id);
      }
    });
    if (droneStopButton) {
      droneStopButton.disabled = !preset;
    }
    if (!preset) {
      return;
    }
    var tonic = getDroneRootLabel();
    updateDroneStatus("Armed " + preset.label + " at " + tonic + ".");
    updateStatusText("Drone box loaded " + preset.label + ".");
  }

  function stopDrone(options) {
    var nodesToStop = droneNodes.slice();
    var master = droneMasterGain;
    droneNodes = [];
    droneMasterGain = null;
    if (master && master.context) {
      var now = master.context.currentTime;
      try {
        master.gain.cancelScheduledValues(now);
        master.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
      } catch (err) {}
      window.setTimeout(function () {
        stopDroneNodes(nodesToStop.concat([master]));
      }, 180);
    } else {
      stopDroneNodes(nodesToStop.concat(master ? [master] : []));
    }
    setActiveDronePreset(null);
    if (!(options && options.silent)) {
      updateDroneStatus("Drone muted. Ready when you are.");
    }
  }

  function stopDroneNodes(nodes) {
    var list = nodes || [];
    list.forEach(function (node) {
      try {
        if (typeof node.stop === "function") {
          node.stop();
        }
      } catch (err) {}
      try {
        if (typeof node.disconnect === "function") {
          node.disconnect();
        }
      } catch (err) {}
    });
  }

  function playDronePreset(ctx, preset) {
    if (!ctx || !preset) {
      return;
    }
    var now = ctx.currentTime;
    var root = getDroneRootFrequency();

    droneMasterGain = ctx.createGain();
    droneMasterGain.gain.setValueAtTime(0.0001, now);
    droneMasterGain.gain.exponentialRampToValueAtTime(0.18, now + 0.6);
    droneMasterGain.connect(ctx.destination);
    droneNodes.push(droneMasterGain);

    if (preset.type === "noise") {
      var noise = createNoiseSource(ctx, preset.color);
      var noiseGain = ctx.createGain();
      var target = preset.color === "brown" ? 0.22 : 0.18;
      noiseGain.gain.setValueAtTime(0.0001, now);
      noiseGain.gain.exponentialRampToValueAtTime(target, now + 0.4);
      noise.connect(noiseGain);
      noiseGain.connect(droneMasterGain);
      noise.start(now);
      droneNodes.push(noise, noiseGain);
      updateDroneStatus(preset.label + " humming under the mix.");
      return;
    }

    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(preset.type === "texture" ? 2400 : 1800, now);
    filter.Q.value = 0.8;
    filter.connect(droneMasterGain);
    droneNodes.push(filter);

    var intervals = preset.intervals && preset.intervals.length ? preset.intervals : [0, 7, 0, 12];
    intervals.forEach(function (semitones, index) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var lfo = ctx.createOscillator();
      var lfoGain = ctx.createGain();
      var freq = root * Math.pow(2, semitones / 12);
      var voiceGain = preset.type === "texture" ? 0.06 : 0.05;
      voiceGain = Math.max(0.02, voiceGain - index * 0.007);

      osc.type = preset.type === "tanpura" ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(freq, now);

      lfo.frequency.setValueAtTime(0.18 + index * 0.05, now);
      lfoGain.gain.setValueAtTime(freq * 0.0016, now);
      lfo.connect(lfoGain);
      lfoGain.connect(osc.frequency);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(voiceGain, now + 0.55);

      osc.connect(gain);
      gain.connect(filter);
      lfo.start(now);
      osc.start(now);

      droneNodes.push(osc, gain, lfo, lfoGain);
    });

    if (preset.type === "texture") {
      var shimmer = createNoiseSource(ctx, "pink");
      var shimmerGain = ctx.createGain();
      shimmerGain.gain.setValueAtTime(0.0001, now);
      shimmerGain.gain.exponentialRampToValueAtTime(0.06, now + 0.5);
      shimmer.connect(shimmerGain);
      shimmerGain.connect(droneMasterGain);
      shimmer.start(now);
      droneNodes.push(shimmer, shimmerGain);
    }

    updateDroneStatus(preset.label + " drone sustaining at " + getDroneRootLabel() + ".");
  }

  function createPatternGroup(menu, heading, copy, category) {
    var patterns = METRONOME_LIBRARY.filter(function (pattern) {
      return pattern.category === category;
    });
    if (!patterns.length) {
      return;
    }
    var group = document.createElement("div");
    group.className = "metronome-group";
    var h = document.createElement("div");
    h.className = "metronome-group__heading";
    var title = document.createElement("h4");
    title.textContent = heading;
    var note = document.createElement("p");
    note.textContent = copy;
    h.appendChild(title);
    h.appendChild(note);
    group.appendChild(h);

    var list = document.createElement("div");
    list.className = "metronome-patterns";

    patterns.forEach(function (pattern) {
      var button = createPatternButton(pattern);
      list.appendChild(button);
    });

    group.appendChild(list);
    menu.appendChild(group);
  }

  function createPatternButton(pattern) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "metronome-pattern";
    button.dataset.patternId = pattern.id;

    var eyebrow = document.createElement("span");
    eyebrow.className = "metronome-pattern__eyebrow";
    eyebrow.textContent = pattern.pulseLabel || "pulse";

    var title = document.createElement("span");
    title.className = "metronome-pattern__title";
    title.textContent = pattern.label;

    var note = document.createElement("span");
    note.className = "metronome-pattern__note";
    note.textContent = pattern.description;

    button.appendChild(eyebrow);
    button.appendChild(title);
    button.appendChild(note);

    button.addEventListener("click", function () {
      startMetronomeWithPattern(pattern);
    });

    metronomePatternButtons[pattern.id] = button;
    return button;
  }

  function startMetronomeWithPattern(pattern) {
    setActivePattern(pattern);
    closeMetronomeMenu();
    if (zeroDecibelMode) {
      stopMetronome();
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      updateStatusText("Audio unavailable in this browser.");
      return;
    }
    resumeContext(ctx)
      .then(function (runningCtx) {
        startMetronome(runningCtx);
      })
      .catch(stopMetronome);
  }

  function setActivePattern(pattern, options) {
    if (!pattern) {
      return;
    }
    var clone = {
      id: pattern.id,
      label: pattern.label,
      description: pattern.description,
      sequence: (pattern.sequence || []).slice(),
      stepsPerBeat: pattern.stepsPerBeat || 1,
      tempo: pattern.tempo || 96,
      pulseLabel: pattern.pulseLabel || "pulse",
      category: pattern.category || "custom",
    };
    metronomeCurrentPattern = clone;
    if (metronomeTempoInput && !(options && options.preserveTempo)) {
      metronomeTempoInput.value = String(clone.tempo || 96);
    }
    updateTempoDisplay();
    Object.keys(metronomePatternButtons).forEach(function (key) {
      var button = metronomePatternButtons[key];
      if (button) {
        button.classList.toggle("metronome-pattern--active", key === clone.id);
      }
    });
    if (options && options.announce === false) {
      return;
    }
    updateStatusText("Armed " + clone.label + ". Tap play to hear it.");
  }

  function startMetronome(ctx) {
    if (!metronomeCurrentPattern) {
      setActivePattern(METRONOME_LIBRARY[0]);
    }
    if (!metronomeCurrentPattern) {
      return;
    }
    if (!metronomeCurrentPattern.sequence.length) {
      updateStatusText("Pattern has no steps. Try a different groove.");
      return;
    }
    clearInterval(metronomeInterval);
    metronomeStep = 0;
    var interval = getPatternInterval(metronomeCurrentPattern);
    metronomeInterval = window.setInterval(function () {
      playMetronomeTick(ctx, metronomeCurrentPattern.sequence[metronomeStep]);
      metronomeStep = (metronomeStep + 1) % metronomeCurrentPattern.sequence.length;
    }, interval);
    if (metronomeToggle) {
      metronomeToggle.classList.add("records-metronome--on");
    }
    if (metronomeStopButton) {
      metronomeStopButton.disabled = false;
    }
    updateStatusText(
      "Playing " +
        metronomeCurrentPattern.label +
        " at " +
        getTempo() +
        " BPM (" +
        metronomeCurrentPattern.pulseLabel +
        ")."
    );
  }

  function restartMetronome() {
    updateTempoDisplay();
    if (!metronomeInterval) {
      return;
    }
    if (zeroDecibelMode) {
      stopMetronome();
      return;
    }
    var ctx = ensureAudioContext();
    if (!ctx) {
      return;
    }
    resumeContext(ctx)
      .then(function (runningCtx) {
        startMetronome(runningCtx);
      })
      .catch(stopMetronome);
  }

  function stopMetronome() {
    clearInterval(metronomeInterval);
    metronomeInterval = null;
    if (metronomeToggle) {
      metronomeToggle.classList.remove("records-metronome--on");
    }
    if (metronomeStopButton) {
      metronomeStopButton.disabled = true;
    }
    updateStatusText("Metronome muted. Ready for the next groove.");
  }

  function playMetronomeTick(ctx, accent) {
    if (!ctx || zeroDecibelMode) {
      return;
    }
    var intensity = typeof accent === "number" ? accent : accent ? 2 : 1;
    var now = ctx.currentTime;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();

    osc.type = "triangle";
    var baseFrequency = 820;
    if (intensity >= 3) {
      baseFrequency = 1260;
    } else if (intensity === 2) {
      baseFrequency = 1020;
    } else if (intensity <= 0) {
      baseFrequency = 680;
    }
    osc.frequency.setValueAtTime(baseFrequency, now);

    var peak = 0.12;
    if (intensity >= 3) {
      peak = 0.24;
    } else if (intensity === 2) {
      peak = 0.18;
    } else if (intensity <= 0) {
      peak = 0.05;
    }

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.21);
  }

  function updateStatusText(copy) {
    if (!metronomeStatus || !copy) {
      return;
    }
    metronomeStatus.textContent = copy;
  }

  function getPatternInterval(pattern) {
    var tempo = getTempo();
    var division = Math.max(1, pattern.stepsPerBeat || 1);
    return 60000 / (tempo * division);
  }

  function getTempo() {
    var tempo = metronomeTempoInput ? parseInt(metronomeTempoInput.value, 10) : 96;
    if (!tempo || Number.isNaN(tempo)) {
      tempo = 96;
    }
    return clamp(tempo, 50, 200);
  }

  function updateTempoDisplay() {
    if (!metronomeTempoInput || !metronomeTempoValue) {
      return;
    }
    var tempo = getTempo();
    metronomeTempoInput.value = String(tempo);
    metronomeTempoInput.setAttribute("aria-valuenow", tempo);
    var pulseLabel = metronomeCurrentPattern
      ? metronomeCurrentPattern.pulseLabel || "pulse"
      : "pulse";
    metronomeTempoValue.textContent = tempo + " BPM · " + pulseLabel;
  }

  function getDroneRootFrequency() {
    var fallback = 146.83;
    if (!droneRootSelect) {
      return fallback;
    }
    var value = parseFloat(droneRootSelect.value);
    if (!value || Number.isNaN(value)) {
      return fallback;
    }
    return value;
  }

  function getDroneRootLabel() {
    if (!droneRootSelect) {
      return "mid Sa";
    }
    var option = droneRootSelect.options[droneRootSelect.selectedIndex];
    return option ? option.textContent : "mid Sa";
  }

  function updateDroneStatus(copy) {
    if (!droneStatus || !copy) {
      return;
    }
    droneStatus.textContent = copy;
  }

  function createNoiseSource(ctx, color) {
    var buffer = createNoiseBuffer(ctx, color);
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    return source;
  }

  function createNoiseBuffer(ctx, color) {
    var key = color || "white";
    var cached = droneNoiseBuffers[key];
    if (cached && cached.sampleRate === ctx.sampleRate) {
      return cached.buffer;
    }
    var length = ctx.sampleRate * 2;
    var buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = buffer.getChannelData(0);

    if (key === "pink") {
      var b0 = 0;
      var b1 = 0;
      var b2 = 0;
      var b3 = 0;
      var b4 = 0;
      var b5 = 0;
      var b6 = 0;
      for (var i = 0; i < length; i++) {
        var white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        data[i] *= 0.11;
        b6 = white * 0.115926;
      }
    } else if (key === "brown") {
      var lastOut = 0;
      for (var j = 0; j < length; j++) {
        var whiteNoise = Math.random() * 2 - 1;
        data[j] = (lastOut + 0.02 * whiteNoise) / 1.02;
        lastOut = data[j];
        data[j] *= 3.5;
      }
    } else {
      for (var k = 0; k < length; k++) {
        data[k] = Math.random() * 2 - 1;
      }
    }
    droneNoiseBuffers[key] = { buffer: buffer, sampleRate: ctx.sampleRate };
    return buffer;
  }

  function startBoardModePattern() {
    var pattern = buildBoardModePattern();
    setActivePattern(pattern, { preserveTempo: true });
    startMetronomeWithPattern(pattern);
  }

  function buildBoardModePattern() {
    var steps = clamp(parseInt(boardStepsInput.value, 10) || 9, 3, 16);
    var pulses = clamp(parseInt(boardPulsesInput.value, 10) || Math.ceil(steps / 2), 1, 16);
    pulses = Math.min(pulses, steps);
    boardStepsInput.value = String(steps);
    boardPulsesInput.value = String(pulses);

    var base = buildEuclideanSequence(pulses, steps);
    var overlay = buildPolyrhythmSequence([Math.max(2, Math.min(steps, pulses + 1)), Math.max(2, Math.round(steps / 2))]);
    var sequence = [];
    for (var i = 0; i < steps; i++) {
      var level = base.sequence[i % base.sequence.length];
      var overlayLevel = overlay.sequence[i % overlay.sequence.length] >= 2 ? 1 : 0;
      level = Math.min(3, level + overlayLevel);
      sequence.push(level);
    }
    sequence[0] = 3;

    return {
      id: "board-mode-" + Date.now(),
      label: "Board Mode " + pulses + "/" + steps,
      description: "Chaotic custom groove forged by The Board.",
      sequence: sequence,
      stepsPerBeat: Math.max(1, Math.round(steps / 4)),
      tempo: getTempo(),
      pulseLabel: steps + "-step board grid",
      category: "board",
    };
  }

  function buildDroneLibrary() {
    return [
      {
        id: "tanpura-yaman",
        label: "Tanpura · Yaman",
        description: "Sa–Pa–Sa–Ni glow tuned for late-night Yaman.",
        type: "tanpura",
        intervals: [0, 7, 12, 11],
        tag: "Tanpura",
      },
      {
        id: "tanpura-bhairav",
        label: "Shruti · Bhairav",
        description: "Sa with komal Re and Pa to anchor dawn Bhairav.",
        type: "shruti",
        intervals: [0, 1, 7, 12],
        tag: "Shruti",
      },
      {
        id: "tanpura-kafi",
        label: "Shruti · Kafi",
        description: "Sa–Pa bed with soft Ga and Ni for all-day calm.",
        type: "shruti",
        intervals: [0, 3, 7, 10],
        tag: "Shruti",
      },
      {
        id: "noise-white",
        label: "White noise wash",
        description: "Flat wideband hiss for masking and focus.",
        type: "noise",
        color: "white",
        tag: "Noise",
      },
      {
        id: "noise-pink",
        label: "Pink noise bloom",
        description: "Natural-feeling noise with warmer low mids.",
        type: "noise",
        color: "pink",
        tag: "Noise",
      },
      {
        id: "noise-brown",
        label: "Brown noise rumble",
        description: "Deep rolling floor when you want to disappear.",
        type: "noise",
        color: "brown",
        tag: "Noise",
      },
      {
        id: "board-aurora",
        label: "The Board · Aurora Gate",
        description: "Stacked fifths with a mist bed chosen by The Board.",
        type: "texture",
        intervals: [0, 7, 14, 19],
        tag: "Board",
      },
    ];
  }

  function buildMetronomeLibrary() {
    var patterns = [];
    patterns.push(
      createPattern({
        id: "anchor-44",
        label: "Anchor 4/4",
        description: "Bright downbeat with three soft follow-ups.",
        category: "anchor",
        sequence: [3, 1, 1, 2],
        tempo: 96,
        stepsPerBeat: 1,
        pulseLabel: "quarter pulse",
      })
    );
    patterns.push(
      createPattern({
        id: "anchor-half",
        label: "Half-time Drift",
        description: "Two-point lighthouse click for slow focus.",
        category: "anchor",
        sequence: [3, 1],
        tempo: 82,
        stepsPerBeat: 1,
        pulseLabel: "half pulse",
      })
    );
    patterns.push(
      createPattern({
        id: "odd-54",
        label: "5/4 Lantern Walk",
        description: "3+2 lilt with a warm lift on four.",
        category: "odd",
        sequence: [3, 1, 2, 1, 2],
        tempo: 104,
        stepsPerBeat: 1,
        pulseLabel: "quarter pulse",
      })
    );
    patterns.push(
      createPattern({
        id: "odd-78",
        label: "7/8 Staircase",
        description: "2-2-3 skip with a kick at the landing.",
        category: "odd",
        sequence: [3, 1, 2, 1, 2, 1, 2],
        tempo: 122,
        stepsPerBeat: 2,
        pulseLabel: "eighth pulse",
      })
    );
    patterns.push(
      createPattern({
        id: "odd-98",
        label: "9/8 Carousel",
        description: "Rolling 3-3-3 ride with softer middles.",
        category: "odd",
        sequence: [3, 1, 2, 2, 1, 2, 2, 1, 2],
        tempo: 116,
        stepsPerBeat: 3,
        pulseLabel: "eighth pulse",
      })
    );

    var polyThreeTwo = buildPolyrhythmSequence([3, 2]);
    patterns.push(
      createPattern({
        id: "poly-32",
        label: "3:2 Crosswalk",
        description: "Classic cross-rhythm with a strong one.",
        category: "polyrhythm",
        sequence: polyThreeTwo.sequence,
        stepsPerBeat: polyThreeTwo.stepsPerBeat,
        tempo: 100,
        pulseLabel: polyThreeTwo.pulseLabel,
      })
    );

    var polyFiveFour = buildPolyrhythmSequence([5, 4]);
    patterns.push(
      createPattern({
        id: "poly-54",
        label: "5:4 Cascade",
        description: "Tangled waterfall that still resolves on one.",
        category: "polyrhythm",
        sequence: polyFiveFour.sequence,
        stepsPerBeat: polyFiveFour.stepsPerBeat,
        tempo: 92,
        pulseLabel: polyFiveFour.pulseLabel,
      })
    );

    var euclidFiveEight = buildEuclideanSequence(5, 8);
    patterns.push(
      createPattern({
        id: "euclid-5-8",
        label: "Euclid 5 over 8",
        description: "Evenly-spaced blips stretched across eight slots.",
        category: "euclidean",
        sequence: euclidFiveEight.sequence,
        stepsPerBeat: euclidFiveEight.stepsPerBeat,
        tempo: 110,
        pulseLabel: euclidFiveEight.pulseLabel,
      })
    );

    var euclidSevenTwelve = buildEuclideanSequence(7, 12);
    patterns.push(
      createPattern({
        id: "euclid-7-12",
        label: "Euclid 7 over 12",
        description: "Dense club grid with seven hits on a dozen steps.",
        category: "euclidean",
        sequence: euclidSevenTwelve.sequence,
        stepsPerBeat: euclidSevenTwelve.stepsPerBeat,
        tempo: 118,
        pulseLabel: euclidSevenTwelve.pulseLabel,
      })
    );

    return patterns;
  }

  function createPattern(config) {
    return {
      id: config.id,
      label: config.label,
      description: config.description,
      category: config.category,
      sequence: (config.sequence || []).slice(),
      tempo: config.tempo || 96,
      stepsPerBeat: config.stepsPerBeat || 1,
      pulseLabel: config.pulseLabel || "pulse",
    };
  }

  function buildPolyrhythmSequence(pulses) {
    var usablePulses = (pulses || []).map(function (count) {
      return clamp(Math.round(count), 2, 12);
    });
    if (!usablePulses.length) {
      usablePulses = [3, 2];
    }
    var grid = usablePulses.reduce(function (product, count) {
      return lcm(product, count);
    }, 1);
    grid = Math.max(grid, 2);
    var sequence = new Array(grid).fill(0);
    usablePulses.forEach(function (count, index) {
      var stride = grid / count;
      for (var i = 0; i < grid; i += stride) {
        var level = index === 0 ? 3 : 2;
        sequence[i] = Math.max(sequence[i], level);
      }
    });
    if (sequence.length) {
      sequence[0] = 3;
    }
    return {
      sequence: sequence,
      stepsPerBeat: Math.max(1, grid / Math.max.apply(null, usablePulses)),
      pulseLabel: grid + "-step cycle",
    };
  }

  function buildEuclideanSequence(pulses, steps) {
    var stepCount = clamp(Math.round(steps), 3, 16);
    var pulseCount = clamp(Math.round(pulses), 1, stepCount);
    var sequence = [];
    var bucket = 0;
    for (var i = 0; i < stepCount; i++) {
      bucket += pulseCount;
      if (bucket >= stepCount) {
        bucket -= stepCount;
        sequence.push(2);
      } else {
        sequence.push(0);
      }
    }
    if (sequence.length) {
      sequence[0] = 3;
    }
    return {
      sequence: sequence,
      stepsPerBeat: Math.max(1, Math.round(stepCount / 4)),
      pulseLabel: pulseCount + " in " + stepCount,
    };
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function gcd(a, b) {
    if (!b) {
      return a;
    }
    return gcd(b, a % b);
  }

  function lcm(a, b) {
    return Math.abs(a * b) / gcd(a, b || 1);
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      clearTimeout(graveyardTimer);
      if (graveyardAudio) {
        graveyardAudio.pause();
      }
      if (metronomeInterval) {
        stopMetronome();
      }
      stopDrone({ silent: true });
      return;
    }
    if (graveyardPrimed && !zeroDecibelMode) {
      queueGraveyardTone();
    }
  }

  function handleZeroDecibelChange(event) {
    zeroDecibelMode = !!(event && event.detail && event.detail.enabled);
    if (zeroDecibelMode) {
      disableSqueaks();
      stopMetronome();
      clearTimeout(graveyardTimer);
      if (graveyardAudio) {
        graveyardAudio.pause();
      }
      stopDrone({ silent: true });
    } else {
      bindGlobalSqueaks();
      installRecordsMetronome();
      if (graveyardPrimed) {
        queueGraveyardTone();
      }
    }
  }

  function isZeroDecibelEnabled() {
    var body = document.body;
    return body && body.dataset.zeroDecibel === "true";
  }

  function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
  }
})();
