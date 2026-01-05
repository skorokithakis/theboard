(function () {
  const lab = document.querySelector("[data-performance-lab]");
  if (!lab) return;

  const benchmarkScript = document.getElementById("performance-benchmarks");
  const benchmarkData = JSON.parse(
    (benchmarkScript && benchmarkScript.textContent) || "[]"
  );
  const benchButton = document.querySelector("[data-benchmark-button]");
  const energyButton = document.querySelector("[data-energy-button]");
  const bragButton = document.querySelector("[data-brag-button]");
  const clearButton = document.querySelector("[data-clear-log]");
  const logList = document.querySelector("[data-benchmark-log]");
  const bragTarget = document.querySelector("[data-brag-target]");
  const bragBoard = document.querySelector("[data-brag-board]");
  const bragPlaceholder = document.querySelector("[data-brag-placeholder]");
  const energyFill = document.querySelector("[data-energy-fill]");
  const energyNote = document.querySelector("[data-energy-note]");

  const pick = (items) =>
    items[Math.floor(Math.random() * items.length)] ||
    { name: "Unlabeled bench", note: "Default benchmark subject." };

  const randomBetween = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const nanoseconds = (ms) => Math.max(1, Math.round(ms * 1_000_000));

  let boostLevel = 28;

  const formatTime = (value) =>
    value >= 100 ? `${Math.round(value)} ms` : `${value.toFixed(1)} ms`;

  const updateMeter = (delta) => {
    boostLevel = clamp(boostLevel + delta, 12, 100);
    if (energyFill) {
      energyFill.style.width = `${boostLevel}%`;
    }
    if (energyNote) {
      const label =
        boostLevel >= 80
          ? "Turbocharged — bragging rights unlocked."
          : boostLevel >= 50
          ? "Running hot — keep the benchmarks coming."
          : "Idle: waiting for the ritual.";
      energyNote.textContent = label;
    }
  };

  const appendLog = (title, detail) => {
    if (!logList) return;
    const entry = document.createElement("li");
    entry.className = "performance-log__item";
    const heading = document.createElement("div");
    heading.className = "performance-log__title";
    heading.textContent = title;
    const note = document.createElement("p");
    note.className = "performance-log__note";
    note.textContent = detail;
    entry.appendChild(heading);
    entry.appendChild(note);
    logList.insertBefore(entry, logList.firstChild);

    const maxEntries = 6;
    while (logList.children.length > maxEntries) {
      logList.removeChild(logList.lastChild);
    }
  };

  const brag = (message) => {
    if (bragTarget) {
      bragTarget.textContent = message;
    }
  };

  const addBrag = (headline, detail) => {
    if (!bragBoard) return;

    if (bragPlaceholder && bragPlaceholder.parentElement) {
      bragPlaceholder.parentElement.removeChild(bragPlaceholder);
    }

    const entry = document.createElement("li");
    entry.className = "performance-bragboard__item";

    const title = document.createElement("div");
    title.className = "performance-bragboard__title";
    title.textContent = headline;

    const note = document.createElement("p");
    note.className = "performance-bragboard__note";
    note.textContent = detail;

    entry.appendChild(title);
    entry.appendChild(note);
    bragBoard.insertBefore(entry, bragBoard.firstChild);

    const maxBrags = 4;
    while (bragBoard.children.length > maxBrags) {
      bragBoard.removeChild(bragBoard.lastChild);
    }
  };

  const runBenchmark = () => {
    const subject = pick(benchmarkData);
    const baseline = randomBetween(42, 320);
    const factor = randomBetween(1.8, 2.6);
    const improved = baseline / factor;
    const saved = baseline - improved;
    const entryNote = `${formatTime(baseline)} → ${formatTime(
      improved
    )} (${factor.toFixed(1)}x faster). Saved ${formatTime(saved)}. ${
      subject.note
    }`;

    appendLog(`${subject.name} sprinted`, entryNote);
    brag(`Claimed ${factor.toFixed(1)}x on ${subject.name}. ${subject.note}`);
    updateMeter(6);
  };

  const shoutBrag = () => {
    const subject = pick(benchmarkData);
    const factor = randomBetween(1.9, 2.9);
    const savedMs = randomBetween(3, 28);
    const headline = `${subject.name} now ${factor.toFixed(1)}x faster`;
    const detail = `Logged ${nanoseconds(savedMs).toLocaleString()} ns saved after ${formatTime(
      savedMs
    )} of tinkering. ${subject.note}`;

    addBrag(headline, detail);
    appendLog("Brag broadcast", detail);
    brag(`${headline}. ${subject.note}`);
    updateMeter(4);
  };

  if (benchButton) {
    benchButton.addEventListener("click", runBenchmark);
  }

  if (energyButton) {
    energyButton.addEventListener("click", () => {
      const bump = randomBetween(8, 18);
      updateMeter(bump);
      const message = `Energy drink consumed. Bench throughput +${bump.toFixed(
        0
      )}% and morale doubled.`;
      appendLog("Energy boost", message);
      brag(message);
    });
  }

  if (bragButton) {
    bragButton.addEventListener("click", shoutBrag);
  }

  if (clearButton) {
    clearButton.addEventListener("click", () => {
      if (logList) {
        logList.innerHTML = "";
      }
      brag("Log cleared—ready to chase the next 2x win.");
      updateMeter(-12);
    });
  }
})();
