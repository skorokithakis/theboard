(function () {
  "use strict";

  var container = document.querySelector("[data-sand-terrarium]");
  if (!container) {
    return;
  }

  var canvas = container.querySelector("[data-sand-canvas]");
  if (!canvas || !canvas.getContext) {
    return;
  }

  var ctx = canvas.getContext("2d", { alpha: false });
  var width = canvas.width;
  var height = canvas.height;
  var size = width * height;

  var EMPTY = 0;
  var SAND = 1;
  var STONE = 2;
  var WOOD = 3;
  var WATER = 4;
  var FIRE = 5;
  var BACTERIA = 6;
  var PLANT = 7;
  var GLASS = 8;
  var STEAM = 9;
  var INVADER = 10;
  var COSMIC_RAY = 11;
  var MUTATED_BACTERIA = 12;

  var MATERIALS = {
    sand: { id: SAND },
    stone: { id: STONE },
    wood: { id: WOOD },
    water: { id: WATER },
    fire: { id: FIRE },
    bacteria: { id: BACTERIA },
    plant: { id: PLANT },
    glass: { id: GLASS },
    steam: { id: STEAM },
  };

  var COLORS = {};
  COLORS[EMPTY] = [10, 19, 24];
  COLORS[SAND] = [230, 190, 130];
  COLORS[STONE] = [143, 167, 188];
  COLORS[WOOD] = [192, 127, 79];
  COLORS[WATER] = [95, 184, 255];
  COLORS[FIRE] = [255, 112, 68];
  COLORS[BACTERIA] = [182, 255, 108];
  COLORS[PLANT] = [98, 241, 175];
  COLORS[GLASS] = [192, 226, 255];
  COLORS[STEAM] = [205, 217, 222];
  COLORS[INVADER] = [144, 232, 255];
  COLORS[COSMIC_RAY] = [255, 242, 164];
  COLORS[MUTATED_BACTERIA] = [178, 142, 255];

  var grid = new Uint8Array(size);
  var energy = new Uint8Array(size);
  var pigment = new Uint8Array(size);
  var processed = new Uint32Array(size);
  var frameId = 0;

  var imageData = ctx.createImageData(width, height);
  var buffer = imageData.data;

  var brushSize = 2;
  var currentMaterial = SAND;
  var isPainting = false;
  var plantState = container.dataset.plantState || "growing";
  var statusLabel = container.querySelector("[data-sand-status]");
  var invaderStatusLabel = container.querySelector("[data-sand-invaders-status]");
  var invaderToggle = container.querySelector("[data-sand-invaders-toggle]");
  var invaderSpawnButton = container.querySelector("[data-sand-invaders-spawn]");
  var invaderModeEnabled = false;
  var invaders = {};
  var invaderAtCell = {};
  var invaderId = 1;
  var cosmicRayTargets = [SAND, STONE, WOOD, WATER, FIRE, BACTERIA, PLANT, GLASS, STEAM, MUTATED_BACTERIA];

  var ambientProfile = {
    thriving: { mist: 0.02, seeds: 0.016, embers: 0.001 },
    growing: { mist: 0.012, seeds: 0.012, embers: 0.0009 },
    parched: { mist: 0.006, seeds: 0.01, embers: 0.0016 },
    dormant: { mist: 0.004, seeds: 0.008, embers: 0.0007 },
  };

  initializePalette();
  initializeBrushToggles();
  initializeActions();
  initializeInvaders();
  updateStatus();
  seedGlass();
  draw();
  requestAnimationFrame(tick);

  function seedGlass() {
    clearInvaderData();

    for (var i = 0; i < size; i += 1) {
      grid[i] = EMPTY;
      energy[i] = 0;
      pigment[i] = Math.floor(Math.random() * 18);
    }

    for (var x = 0; x < width; x += 1) {
      var idx = (height - 1) * width + x;
      grid[idx] = STONE;
      pigment[idx] = 6 + (Math.random() * 6) | 0;
    }

    for (var y = height - 6; y < height - 1; y += 1) {
      for (var cx = 0; cx < width; cx += 1) {
        if (Math.random() < 0.65) {
          grid[y * width + cx] = SAND;
        }
      }
    }

    mist(1);

    if (invaderModeEnabled) {
      spawnInvaderWave(2);
    }

    updateInvaderStatus();
  }

  function initializePalette() {
    var paletteButtons = container.querySelectorAll("[data-sand-material]");
    paletteButtons.forEach(function (button, index) {
      var color = button.dataset.color;
      if (color) {
        button.style.setProperty("--chip-color", color);
      }
      if (index === 0) {
        button.setAttribute("aria-pressed", "true");
      }
      button.addEventListener("click", function () {
        var materialName = button.dataset.sandMaterial;
        setMaterial(materialName);
        paletteButtons.forEach(function (other) {
          other.setAttribute(
            "aria-pressed",
            other === button ? "true" : "false"
          );
        });
      });
    });
  }

  function initializeBrushToggles() {
    var toggles = container.querySelectorAll("[data-sand-brush]");
    toggles.forEach(function (toggle) {
      toggle.addEventListener("click", function () {
        brushSize = parseInt(toggle.dataset.sandBrush, 10) || 2;
        toggles.forEach(function (other) {
          other.setAttribute(
            "aria-pressed",
            other === toggle ? "true" : "false"
          );
        });
        updateStatus();
      });
    });
  }

  function initializeActions() {
    var actions = container.querySelectorAll("[data-sand-action]");
    actions.forEach(function (action) {
      action.addEventListener("click", function () {
        var actionType = action.dataset.sandAction;
        if (actionType === "mist") {
          mist(2);
        } else if (actionType === "seed") {
          scatterSand(50);
        } else if (actionType === "burn") {
          spark();
        } else if (actionType === "clear") {
          seedGlass();
        }
      });
    });

    canvas.addEventListener("pointerdown", function (event) {
      isPainting = true;
      paint(event);
    });
    canvas.addEventListener("pointermove", function (event) {
      if (isPainting) {
        paint(event);
      }
    });
    window.addEventListener("pointerup", function () {
      isPainting = false;
    });
  }

  function initializeInvaders() {
    if (invaderToggle) {
      invaderToggle.addEventListener("click", function () {
        if (invaderModeEnabled) {
          disableInvaderMode();
        } else {
          enableInvaderMode();
        }
      });
    }

    if (invaderSpawnButton) {
      invaderSpawnButton.addEventListener("click", function () {
        if (!invaderModeEnabled) {
          return;
        }
        spawnInvaderWave(2 + ((Math.random() * 2) | 0));
      });
    }

    updateInvaderStatus();
  }

  function setMaterial(name) {
    currentMaterial = MATERIALS[name] ? MATERIALS[name].id : SAND;
    updateStatus();
  }

  function updateStatus() {
    if (!statusLabel) {
      return;
    }
    var materialName = Object.keys(MATERIALS).find(function (key) {
      return MATERIALS[key].id === currentMaterial;
    });
    var brushDescriptor = brushSize === 1 ? "fine" : brushSize === 2 ? "medium" : "flood";
    statusLabel.textContent = "Painting with " + materialName + " · " + brushDescriptor + " brush";
  }

  function updateInvaderStatus() {
    if (invaderToggle) {
      invaderToggle.setAttribute("aria-pressed", invaderModeEnabled ? "true" : "false");
      invaderToggle.textContent = invaderModeEnabled ? "Disable" : "Enable";
    }
    if (invaderSpawnButton) {
      invaderSpawnButton.disabled = !invaderModeEnabled;
    }
    if (!invaderStatusLabel) {
      return;
    }
    var activeCount = Object.keys(invaders).length;
    var statusText = "Cosmic steel is dormant. Enable the mode to invite geometric visitors.";
    if (invaderModeEnabled && activeCount === 0) {
      statusText = "Invaders are enabled. Calling a wave will drop cosmic steel into the glass.";
    } else if (invaderModeEnabled && activeCount > 0) {
      statusText =
        activeCount +
        " invader" +
        (activeCount === 1 ? "" : "s") +
        " weaving geometric loops; watch for cosmic rays.";
    }
    invaderStatusLabel.textContent = statusText;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function idx(x, y) {
    return y * width + x;
  }

  function randomInRange(min, max) {
    return min + Math.random() * (max - min);
  }

  function nowTime() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function paint(event) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = width / rect.width;
    var scaleY = height / rect.height;
    var x = Math.floor((event.clientX - rect.left) * scaleX);
    var y = Math.floor((event.clientY - rect.top) * scaleY);
    applyBrush(x, y);
  }

  function applyBrush(x, y) {
    var radius = brushSize;
    for (var dy = -radius; dy <= radius; dy += 1) {
      for (var dx = -radius; dx <= radius; dx += 1) {
        var distance = dx * dx + dy * dy;
        if (distance > radius * radius) {
          continue;
        }
        var cx = x + dx;
        var cy = y + dy;
        if (cx < 0 || cx >= width || cy < 0 || cy >= height) {
          continue;
        }
        setCell(idx(cx, cy), currentMaterial);
      }
    }
  }

  function enableInvaderMode() {
    invaderModeEnabled = true;
    spawnInvaderWave(3);
    updateInvaderStatus();
  }

  function disableInvaderMode() {
    invaderModeEnabled = false;
    clearInvaderData();
    clearCosmicRays();
    updateInvaderStatus();
  }

  function clearInvaderData() {
    Object.keys(invaderAtCell).forEach(function (cellIndex) {
      var numericIndex = parseInt(cellIndex, 10);
      if (!Number.isNaN(numericIndex) && grid[numericIndex] === INVADER) {
        setCell(numericIndex, EMPTY);
      }
    });
    invaders = {};
    invaderAtCell = {};
    invaderId = 1;
  }

  function clearCosmicRays() {
    for (var i = 0; i < size; i += 1) {
      if (grid[i] === COSMIC_RAY) {
        grid[i] = EMPTY;
        energy[i] = 0;
        pigment[i] = 0;
      }
    }
  }

  function spawnInvaderWave(count) {
    if (!invaderModeEnabled) {
      return;
    }
    for (var i = 0; i < count; i += 1) {
      var attempts = 0;
      var placed = false;
      while (!placed && attempts < 10) {
        var x = clamp((Math.random() * width) | 0, 2, width - 3);
        var y = clamp((Math.random() * (height / 3)) | 0, 2, (height / 2) | 0);
        var idxValue = idx(x, y);
        if (grid[idxValue] === EMPTY || grid[idxValue] === STEAM || grid[idxValue] === WATER) {
          createInvader(x, y, 1 + ((Math.random() * 2) | 0));
          placed = true;
        }
        attempts += 1;
      }
    }
    updateInvaderStatus();
  }

  function createInvader(x, y, tier) {
    var cellIndex = idx(x, y);
    if (grid[cellIndex] !== EMPTY && grid[cellIndex] !== WATER && grid[cellIndex] !== STEAM) {
      return null;
    }
    var id = invaderId++;
    var meta = {
      id: id,
      x: x,
      y: y,
      anchorX: clamp(x, 3, width - 4),
      anchorY: clamp(y, 4, height - 6),
      tier: tier || 1,
      angle: Math.random() * Math.PI * 2,
      arc: 0.5 + Math.random() * 0.65,
      radius: 4 + Math.random() * 5,
      nextRay: nowTime() + randomInRange(200, 700),
    };
    invaders[id] = meta;
    invaderAtCell[cellIndex] = id;
    setCell(cellIndex, INVADER, { energy: 10 + meta.tier * 4 });
    pigment[cellIndex] = 10 + meta.tier * 3;
    processed[cellIndex] = frameId;
    return meta;
  }

  function setCell(cellIndex, type, options) {
    if (grid[cellIndex] === INVADER && type !== INVADER) {
      removeInvaderAt(cellIndex);
    }

    grid[cellIndex] = type;
    pigment[cellIndex] = (Math.random() * 18) | 0;

    var defaultEnergy = 0;
    if (type === FIRE) {
      defaultEnergy = 10 + ((Math.random() * 10) | 0);
    } else if (type === STEAM) {
      defaultEnergy = 8 + ((Math.random() * 8) | 0);
    }

    var providedEnergy =
      options && typeof options.energy === "number"
        ? options.energy
        : defaultEnergy;
    energy[cellIndex] = clamp(providedEnergy, 0, 255);
    processed[cellIndex] = frameId;
  }

  function swapCells(a, b) {
    var temp = grid[a];
    grid[a] = grid[b];
    grid[b] = temp;

    var tempEnergy = energy[a];
    energy[a] = energy[b];
    energy[b] = tempEnergy;

    var tempPigment = pigment[a];
    pigment[a] = pigment[b];
    pigment[b] = tempPigment;

    processed[a] = frameId;
    processed[b] = frameId;
  }

  function removeInvaderAt(cellIndex) {
    var invaderKey = invaderAtCell[cellIndex];
    if (invaderKey) {
      delete invaders[invaderKey];
      delete invaderAtCell[cellIndex];
    }
  }

  function defeatInvaderAt(cellIndex) {
    removeInvaderAt(cellIndex);
    setCell(cellIndex, MUTATED_BACTERIA);
    pigment[cellIndex] = 14 + ((Math.random() * 3) | 0);
    processed[cellIndex] = frameId;
    updateInvaderStatus();
  }

  function mutateCell(cellIndex) {
    var original = grid[cellIndex];
    if (original === INVADER) {
      var invaderKey = invaderAtCell[cellIndex];
      var invaderMeta = invaderKey ? invaders[invaderKey] : null;
      if (invaderMeta) {
        invaderMeta.tier = Math.min(3, invaderMeta.tier + 0.25);
        invaderMeta.radius = Math.min(invaderMeta.radius + 0.3, 10);
        invaderMeta.nextRay = nowTime() + 200;
      }
      return;
    }

    if (original === BACTERIA) {
      setCell(cellIndex, MUTATED_BACTERIA);
      pigment[cellIndex] = 14 + ((Math.random() * 4) | 0);
      processed[cellIndex] = frameId;
      return;
    }

    var replacement = cosmicRayTargets[(Math.random() * cosmicRayTargets.length) | 0];
    setCell(cellIndex, replacement);
    processed[cellIndex] = frameId;
  }

  function updateInvader(x, y, index) {
    var invaderKey = invaderAtCell[index];
    var meta = invaderKey ? invaders[invaderKey] : null;
    if (!meta) {
      meta = createInvader(x, y, 1);
    }
    if (!meta) {
      return;
    }

    var orbit = meta.radius + Math.sin(meta.angle * meta.arc) * (1.2 + meta.tier * 0.35);
    meta.angle += 0.2 + meta.tier * 0.05;

    var targetX = clamp(
      Math.round(meta.anchorX + Math.cos(meta.angle) * orbit),
      1,
      width - 2
    );
    var targetY = clamp(
      Math.round(meta.anchorY + Math.sin(meta.angle * (0.8 + meta.arc * 0.6)) * orbit * 0.6),
      1,
      height - 3
    );

    // Adjust anchors slightly to keep geometric drift inside the glass.
    if (targetX <= 2 || targetX >= width - 3) {
      meta.anchorX = clamp(meta.anchorX * 0.9 + width / 2 * 0.1, 3, width - 4);
    }
    if (targetY <= 2 || targetY >= height - 3) {
      meta.anchorY = clamp(meta.anchorY * 0.9 + height / 3 * 0.1, 4, height - 6);
    }

    attemptInvaderMove(meta, targetX, targetY, index);
    dropCosmicRayIfReady(meta);
    processed[index] = frameId;
  }

  function attemptInvaderMove(meta, targetX, targetY, currentIndex) {
    if (targetX === meta.x && targetY === meta.y) {
      return;
    }

    var targetIdx = idx(targetX, targetY);
    var targetCell = grid[targetIdx];

    if (targetCell === INVADER) {
      mergeInvaders(currentIndex, targetIdx);
      return;
    }

    if (targetCell === EMPTY || targetCell === STEAM || targetCell === WATER || targetCell === COSMIC_RAY) {
      moveInvaderTo(meta, currentIndex, targetIdx);
      return;
    }

    var fallbackOptions = [
      idx(targetX, meta.y),
      idx(meta.x, targetY),
      idx(clamp(targetX + (targetX > meta.x ? -1 : 1), 1, width - 2), targetY),
    ];

    for (var i = 0; i < fallbackOptions.length; i += 1) {
      var optionIdx = fallbackOptions[i];
      var optionCell = grid[optionIdx];
      if (optionCell === EMPTY || optionCell === STEAM) {
        moveInvaderTo(meta, currentIndex, optionIdx);
        return;
      }
      if (optionCell === INVADER) {
        mergeInvaders(currentIndex, optionIdx);
        return;
      }
    }
  }

  function moveInvaderTo(meta, fromIndex, toIndex) {
    grid[fromIndex] = EMPTY;
    energy[fromIndex] = 0;
    pigment[fromIndex] = 0;
    delete invaderAtCell[fromIndex];

    invaderAtCell[toIndex] = meta.id;
    setCell(toIndex, INVADER, { energy: 12 + meta.tier * 5 });
    pigment[toIndex] = 10 + meta.tier * 4 + ((Math.random() * 2) | 0);
    meta.x = toIndex % width;
    meta.y = (toIndex / width) | 0;
    processed[toIndex] = frameId;
  }

  function mergeInvaders(sourceIdx, targetIdx) {
    var sourceKey = invaderAtCell[sourceIdx];
    var targetKey = invaderAtCell[targetIdx];
    var sourceMeta = sourceKey ? invaders[sourceKey] : null;
    var targetMeta = targetKey ? invaders[targetKey] : null;

    var keeperMeta = targetMeta || sourceMeta;
    if (!keeperMeta) {
      keeperMeta = createInvader(targetIdx % width, (targetIdx / width) | 0, 1);
    }
    if (!keeperMeta) {
      return;
    }

    var mergedTier =
      Math.min(3, (sourceMeta ? sourceMeta.tier : 1) + (targetMeta ? targetMeta.tier : 1));

    var anchorSumX = 0;
    var anchorSumY = 0;
    var anchorCount = 0;
    if (sourceMeta) {
      anchorSumX += sourceMeta.anchorX;
      anchorSumY += sourceMeta.anchorY;
      anchorCount += 1;
    }
    if (targetMeta) {
      anchorSumX += targetMeta.anchorX;
      anchorSumY += targetMeta.anchorY;
      anchorCount += 1;
    }
    if (anchorCount === 0) {
      anchorSumX = keeperMeta.anchorX;
      anchorSumY = keeperMeta.anchorY;
      anchorCount = 1;
    }

    keeperMeta.tier = mergedTier;
    keeperMeta.anchorX = clamp(anchorSumX / anchorCount, 3, width - 4);
    keeperMeta.anchorY = clamp(anchorSumY / anchorCount, 4, height - 6);
    keeperMeta.radius = Math.min(keeperMeta.radius + 1.2, 10);
    keeperMeta.angle += 0.35;
    keeperMeta.x = targetIdx % width;
    keeperMeta.y = (targetIdx / width) | 0;
    keeperMeta.nextRay = nowTime() + randomInRange(200, 500);

    if (sourceMeta && sourceMeta.id !== keeperMeta.id) {
      delete invaders[sourceMeta.id];
    }
    if (targetMeta && targetMeta.id !== keeperMeta.id) {
      delete invaders[targetMeta.id];
    }

    delete invaderAtCell[sourceIdx];
    invaderAtCell[targetIdx] = keeperMeta.id;
    invaders[keeperMeta.id] = keeperMeta;
    setCell(targetIdx, INVADER, { energy: 12 + keeperMeta.tier * 5 });
    pigment[targetIdx] = 12 + keeperMeta.tier * 4;
    grid[sourceIdx] = EMPTY;
    energy[sourceIdx] = 0;
    pigment[sourceIdx] = 0;
    processed[targetIdx] = frameId;
    updateInvaderStatus();
  }

  function dropCosmicRayIfReady(meta) {
    if (!invaderModeEnabled) {
      return;
    }
    var now = nowTime();
    if (now < meta.nextRay) {
      return;
    }
    meta.nextRay = now + randomInRange(200, 700);
    var startY = meta.y + 1;
    var startX = meta.x;
    if (startY >= height) {
      return;
    }

    var dropIdx = idx(startX, startY);
    if (grid[dropIdx] === INVADER && startY + 1 < height) {
      startY += 1;
      dropIdx = idx(startX, startY);
    }

    if (grid[dropIdx] !== EMPTY && grid[dropIdx] !== COSMIC_RAY) {
      mutateCell(dropIdx);
      return;
    }

    setCell(dropIdx, COSMIC_RAY, { energy: 14 });
    pigment[dropIdx] = 14 + ((Math.random() * 3) | 0);
    processed[dropIdx] = frameId;
  }

  function updateCosmicRay(x, y, index) {
    var remaining = energy[index] || 0;
    var steps = 2;

    for (var i = 0; i < steps; i += 1) {
      var nextY = y + 1;
      if (nextY >= height) {
        grid[index] = EMPTY;
        energy[index] = 0;
        pigment[index] = 0;
        processed[index] = frameId;
        return;
      }

      var nextIdx = idx(x, nextY);
      var nextCell = grid[nextIdx];
      if (nextCell === EMPTY || nextCell === COSMIC_RAY) {
        grid[nextIdx] = COSMIC_RAY;
        pigment[nextIdx] = pigment[index];
        energy[nextIdx] = Math.max(remaining - 1, 0);
        grid[index] = EMPTY;
        energy[index] = 0;
        pigment[index] = 0;
        processed[nextIdx] = frameId;
        index = nextIdx;
        y = nextY;
        continue;
      }

      if (nextCell === INVADER) {
        var invaderKey = invaderAtCell[nextIdx];
        if (invaderKey && invaders[invaderKey]) {
          invaders[invaderKey].nextRay = nowTime() + 180;
        }
        grid[index] = EMPTY;
        energy[index] = 0;
        pigment[index] = 0;
        processed[index] = frameId;
        return;
      }

      mutateCell(nextIdx);
      grid[index] = EMPTY;
      energy[index] = 0;
      pigment[index] = 0;
      processed[index] = frameId;
      return;
    }

    if (remaining <= 1) {
      grid[index] = EMPTY;
      energy[index] = 0;
      pigment[index] = 0;
    } else {
      energy[index] = remaining - 1;
    }
    processed[index] = frameId;
  }

  function updateMutatedBacteria(x, y, index) {
    touchFire(x, y, index);

    var invaderNeighbors = neighborIndicesOfType(x, y, INVADER);
    if (invaderNeighbors.length) {
      var target = invaderNeighbors[(Math.random() * invaderNeighbors.length) | 0];
      defeatInvaderAt(target);
      return;
    }

    if (Math.random() < 0.16) {
      var dirs = randomNeighbor();
      var targetX = x + dirs[0];
      var targetY = y + dirs[1];
      if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
        var targetIdx = idx(targetX, targetY);
        var targetCell = grid[targetIdx];
        if (
          targetCell === EMPTY ||
          targetCell === WATER ||
          targetCell === PLANT ||
          targetCell === BACTERIA ||
          targetCell === STEAM
        ) {
          setCell(targetIdx, MUTATED_BACTERIA);
          pigment[targetIdx] = 14 + ((Math.random() * 3) | 0);
        } else if (targetCell === INVADER) {
          defeatInvaderAt(targetIdx);
        }
      }
    }

    if (!invaderNeighbors.length && Math.random() < 0.02) {
      setCell(index, BACTERIA);
    }
  }

  function tick() {
    frameId += 1;
    stepSimulation();
    handleAmbient();
    draw();
    requestAnimationFrame(tick);
  }

  function stepSimulation() {
    var direction = frameId % 2 === 0 ? 1 : -1;
    for (var y = height - 1; y >= 0; y -= 1) {
      var startX = direction > 0 ? 0 : width - 1;
      var endX = direction > 0 ? width : -1;
      for (var x = startX; x !== endX; x += direction) {
        var index = idx(x, y);
        if (processed[index] === frameId) {
          continue;
        }
        var cell = grid[index];
        if (cell === EMPTY) {
          continue;
        }

        if (cell === SAND) {
          updateSand(x, y, index);
        } else if (cell === WATER) {
          updateWater(x, y, index);
        } else if (cell === FIRE) {
          updateFire(x, y, index);
        } else if (cell === STEAM) {
          updateSteam(x, y, index);
        } else if (cell === BACTERIA) {
          updateBacteria(x, y, index);
        } else if (cell === MUTATED_BACTERIA) {
          updateMutatedBacteria(x, y, index);
        } else if (cell === PLANT) {
          updatePlant(x, y, index);
        } else if (cell === WOOD) {
          updateWood(x, y, index);
        } else if (cell === INVADER) {
          updateInvader(x, y, index);
        } else if (cell === COSMIC_RAY) {
          updateCosmicRay(x, y, index);
        }
      }
    }
  }

  function updateSand(x, y, index) {
    var below = y + 1 < height ? idx(x, y + 1) : -1;
    if (below !== -1 && canFallInto(grid[below])) {
      swapCells(index, below);
      return;
    }

    var dir = Math.random() < 0.5 ? -1 : 1;
    var diagOne = y + 1 < height && x + dir >= 0 && x + dir < width ? idx(x + dir, y + 1) : -1;
    var diagTwo = y + 1 < height && x - dir >= 0 && x - dir < width ? idx(x - dir, y + 1) : -1;

    if (diagOne !== -1 && canFallInto(grid[diagOne])) {
      swapCells(index, diagOne);
    } else if (diagTwo !== -1 && canFallInto(grid[diagTwo])) {
      swapCells(index, diagTwo);
    }
  }

  function updateWater(x, y, index) {
    if (evaporateIntoSteam(x, y, index)) {
      return;
    }

    erodeStone(x, y);

    var moved = false;
    var below = y + 1 < height ? idx(x, y + 1) : -1;
    if (below !== -1 && (grid[below] === EMPTY || grid[below] === STEAM)) {
      swapCells(index, below);
      moved = true;
    }

    if (!moved) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      var diag = y + 1 < height && x + dir >= 0 && x + dir < width ? idx(x + dir, y + 1) : -1;
      if (diag !== -1 && (grid[diag] === EMPTY || grid[diag] === STEAM)) {
        swapCells(index, diag);
        moved = true;
      }
    }

    if (!moved) {
      var sideways = Math.random() < 0.5 ? -1 : 1;
      var sideIdx = x + sideways >= 0 && x + sideways < width ? idx(x + sideways, y) : -1;
      if (sideIdx !== -1 && (grid[sideIdx] === EMPTY || grid[sideIdx] === STEAM)) {
        swapCells(index, sideIdx);
      }
    }
  }

  function evaporateIntoSteam(x, y, index) {
    var fireNeighbors = neighborIndicesOfType(x, y, FIRE);
    if (!fireNeighbors.length) {
      return false;
    }
    setCell(index, STEAM, { energy: 12 + ((Math.random() * 6) | 0) });
    var targetFire = fireNeighbors[(Math.random() * fireNeighbors.length) | 0];
    setCell(targetFire, STEAM, { energy: 10 + ((Math.random() * 6) | 0) });
    return true;
  }

  function erodeStone(x, y) {
    var stoneNeighbors = neighborIndicesOfType(x, y, STONE);
    if (stoneNeighbors.length && Math.random() < 0.03) {
      var target = stoneNeighbors[(Math.random() * stoneNeighbors.length) | 0];
      setCell(target, SAND);
    }
  }

  function updateFire(x, y, index) {
    var currentEnergy = energy[index];
    bakeSand(x, y);
    igniteNeighbors(x, y);

    if (quenchWithSteam(x, y, index)) {
      return;
    }

    if (currentEnergy > 0) {
      energy[index] = currentEnergy - 1;
    }

    if (energy[index] === 0) {
      grid[index] = EMPTY;
      energy[index] = 0;
      pigment[index] = (Math.random() * 6) | 0;
      processed[index] = frameId;
      return;
    }

    var dir = Math.random() < 0.5 ? -1 : 1;
    var targetY = y - 1 >= 0 ? y - 1 : y + 1 < height ? y + 1 : y;
    var targetX = x + dir;
    if (targetX >= 0 && targetX < width) {
      var swapIndex = idx(targetX, targetY);
      if (
        grid[swapIndex] === EMPTY ||
        grid[swapIndex] === WATER ||
        grid[swapIndex] === STEAM
      ) {
        swapCells(index, swapIndex);
      }
    }
  }

  function bakeSand(x, y) {
    for (var dy = -1; dy <= 1; dy += 1) {
      for (var dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        var nx = x + dx;
        var ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        var neighborIdx = idx(nx, ny);
        if (grid[neighborIdx] === SAND && Math.random() < 0.22) {
          setCell(neighborIdx, GLASS);
        }
      }
    }
  }

  function quenchWithSteam(x, y, index) {
    var waterNeighbors = neighborIndicesOfType(x, y, WATER);
    if (!waterNeighbors.length) {
      return false;
    }
    setCell(index, STEAM, { energy: 12 + ((Math.random() * 6) | 0) });
    var targetWater = waterNeighbors[(Math.random() * waterNeighbors.length) | 0];
    setCell(targetWater, STEAM, { energy: 10 + ((Math.random() * 6) | 0) });
    return true;
  }

  function updateSteam(x, y, index) {
    if (energy[index] > 0) {
      energy[index] = energy[index] - 1;
    }

    var moved = false;
    var above = y - 1 >= 0 ? idx(x, y - 1) : -1;
    if (above !== -1 && grid[above] === EMPTY) {
      swapCells(index, above);
      moved = true;
    }

    if (!moved) {
      var dir = Math.random() < 0.5 ? -1 : 1;
      var diag = y - 1 >= 0 && x + dir >= 0 && x + dir < width ? idx(x + dir, y - 1) : -1;
      if (diag !== -1 && grid[diag] === EMPTY) {
        swapCells(index, diag);
        moved = true;
      }
    }

    if (!moved) {
      var sideways = Math.random() < 0.5 ? -1 : 1;
      var sideIdx = x + sideways >= 0 && x + sideways < width ? idx(x + sideways, y) : -1;
      if (sideIdx !== -1 && grid[sideIdx] === EMPTY) {
        swapCells(index, sideIdx);
      }
    }

    if (energy[index] === 0 && Math.random() < 0.45) {
      grid[index] = EMPTY;
      energy[index] = 0;
      processed[index] = frameId;
    }
  }

  function updateBacteria(x, y, index) {
    touchFire(x, y, index);
    var nourished =
      hasNeighborOfType(x, y, PLANT) || hasNeighborOfType(x, y, WOOD);

    if (!nourished) {
      if (Math.random() < 0.05) {
        grid[index] = EMPTY;
        processed[index] = frameId;
      }
      return;
    }

    if (Math.random() < 0.12) {
      var dirs = randomNeighbor();
      var targetX = x + dirs[0];
      var targetY = y + dirs[1];
      if (targetX >= 0 && targetX < width && targetY >= 0 && targetY < height) {
        var targetIdx = idx(targetX, targetY);
        if (
          grid[targetIdx] === EMPTY ||
          grid[targetIdx] === WATER ||
          grid[targetIdx] === PLANT ||
          grid[targetIdx] === WOOD
        ) {
          setCell(targetIdx, BACTERIA);
        }
      }
    }
  }

  function updatePlant(x, y, index) {
    if (touchFire(x, y, index)) {
      return;
    }
    var above = y - 1 >= 0 ? idx(x, y - 1) : -1;
    var below = y + 1 < height ? idx(x, y + 1) : -1;
    var hydrated = hasNeighborOfType(x, y, WATER);
    var growthBoost = hydrated ? 1.5 : 1;

    if (above !== -1 && grid[above] === EMPTY && Math.random() < 0.12 * growthBoost) {
      setCell(above, PLANT);
    }

    if (below !== -1 && grid[below] === WATER && Math.random() < 0.2 * growthBoost) {
      setCell(below, PLANT);
    }

    if (hydrated) {
      var sideways = Math.random() < 0.5 ? -1 : 1;
      var sideIdx = x + sideways >= 0 && x + sideways < width ? idx(x + sideways, y) : -1;
      if (sideIdx !== -1 && grid[sideIdx] === EMPTY && Math.random() < 0.08) {
        setCell(sideIdx, PLANT);
      }
    }
  }

  function updateWood(x, y, index) {
    if (touchFire(x, y, index)) {
      return;
    }
    if (!hasNeighborOfType(x, y, WATER)) {
      return;
    }

    var above = y - 1 >= 0 ? idx(x, y - 1) : -1;
    if (above !== -1 && grid[above] === EMPTY && Math.random() < 0.12) {
      setCell(above, PLANT);
    }

    var sideways = Math.random() < 0.5 ? -1 : 1;
    var sideIdx = x + sideways >= 0 && x + sideways < width ? idx(x + sideways, y) : -1;
    if (sideIdx !== -1 && grid[sideIdx] === EMPTY && Math.random() < 0.05) {
      setCell(sideIdx, WOOD);
    }
  }

  function canFallInto(cell) {
    return cell === EMPTY || cell === WATER || cell === STEAM;
  }

  function igniteNeighbors(x, y) {
    for (var dy = -1; dy <= 1; dy += 1) {
      for (var dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        var nx = x + dx;
        var ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        var neighborIdx = idx(nx, ny);
        touchFire(nx, ny, neighborIdx);
      }
    }
  }

  function touchFire(x, y, cellIndex) {
    var index = cellIndex || idx(x, y);
    var cell = grid[index];
    if (cell === WOOD || cell === BACTERIA || cell === PLANT || cell === MUTATED_BACTERIA) {
      if (hasNeighborOfType(x, y, FIRE)) {
        setCell(index, FIRE, { energy: 6 + ((Math.random() * 6) | 0) });
        return true;
      }
    }
    return false;
  }

  function touchWater(x, y) {
    return hasNeighborOfType(x, y, WATER);
  }

  function neighborIndicesOfType(x, y, type) {
    var matches = [];
    for (var dy = -1; dy <= 1; dy += 1) {
      for (var dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        var nx = x + dx;
        var ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        var neighborIdx = idx(nx, ny);
        if (grid[neighborIdx] === type) {
          matches.push(neighborIdx);
        }
      }
    }
    return matches;
  }

  function hasNeighborOfType(x, y, type) {
    for (var dy = -1; dy <= 1; dy += 1) {
      for (var dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) {
          continue;
        }
        var nx = x + dx;
        var ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          continue;
        }
        if (grid[idx(nx, ny)] === type) {
          return true;
        }
      }
    }
    return false;
  }

  function randomNeighbor() {
    var options = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ];
    return options[(Math.random() * options.length) | 0];
  }

  function handleAmbient() {
    var profile = ambientProfile[plantState] || ambientProfile.growing;
    if (Math.random() < profile.mist) {
      mist(1);
    }
    if (Math.random() < profile.seeds) {
      scatterSand(12);
    }
    if (Math.random() < profile.embers) {
      spark();
    }
  }

  function mist(intensity) {
    for (var i = 0; i < 8 * intensity; i += 1) {
      var x = (Math.random() * width) | 0;
      setCell(idx(x, 0), WATER);
    }
  }

  function scatterSand(count) {
    for (var i = 0; i < count; i += 1) {
      var x = (Math.random() * width) | 0;
      var y = ((Math.random() * Math.min(26, height / 2)) | 0);
      setCell(idx(x, y), SAND);
    }
  }

  function spark() {
    var centerX = width / 2 + (Math.random() * (width / 4) - width / 8);
    var centerY = Math.max(2, (Math.random() * (height / 3)) | 0);
    for (var i = -2; i <= 2; i += 1) {
      var x = clamp(Math.round(centerX + i), 0, width - 1);
      var targetIdx = idx(x, centerY);
      setCell(targetIdx, FIRE);
    }
  }

  function draw() {
    for (var i = 0, p = 0; i < size; i += 1, p += 4) {
      var color = COLORS[grid[i]] || COLORS[EMPTY];
      var tint = pigment[i] - 8;
      buffer[p] = clamp(color[0] + tint, 0, 255);
      buffer[p + 1] = clamp(color[1] + tint, 0, 255);
      buffer[p + 2] = clamp(color[2] + tint, 0, 255);
      buffer[p + 3] = 255;
    }
    ctx.putImageData(imageData, 0, 0);
  }
})();
