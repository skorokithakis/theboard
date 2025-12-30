(function () {
  const lab = document.querySelector("[data-performance-lab]");
  if (!lab) return;

  const benchmarkScript = document.getElementById("performance-benchmarks");
  const benchmarkData = JSON.parse(
    (benchmarkScript && benchmarkScript.textContent) || "[]"
  );
  const benchButton = lab.querySelector("[data-benchmark-button]");
  const energyButton = lab.querySelector("[data-energy-button]");
  const clearButton = lab.querySelector("[data-clear-log]");
  const logList = lab.querySelector("[data-benchmark-log]");
  const bragTarget = lab.querySelector("[data-brag-target]");
  const energyFill = lab.querySelector("[data-energy-fill]");
  const energyNote = lab.querySelector("[data-energy-note]");

  const pick = (items) =>
    items[Math.floor(Math.random() * items.length)] ||
    { name: "Unlabeled bench", note: "Default benchmark subject." };

  const randomBetween = (min, max) => Math.random() * (max - min) + min;
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

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
