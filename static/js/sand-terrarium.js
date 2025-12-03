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

  var ambientProfile = {
    thriving: { mist: 0.02, seeds: 0.016, embers: 0.001 },
    growing: { mist: 0.012, seeds: 0.012, embers: 0.0009 },
    parched: { mist: 0.006, seeds: 0.01, embers: 0.0016 },
    dormant: { mist: 0.004, seeds: 0.008, embers: 0.0007 },
  };

  initializePalette();
  initializeBrushToggles();
  initializeActions();
  updateStatus();
  seedGlass();
  draw();
  requestAnimationFrame(tick);

  function seedGlass() {
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

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function idx(x, y) {
    return y * width + x;
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

  function setCell(cellIndex, type, options) {
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
        } else if (cell === PLANT) {
          updatePlant(x, y, index);
        } else if (cell === WOOD) {
          updateWood(x, y, index);
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
    if (cell === WOOD || cell === BACTERIA || cell === PLANT) {
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
