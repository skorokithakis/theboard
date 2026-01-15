(function () {
  const lab = document.querySelector("[data-gremlin-lab]");
  if (!lab) return;

  const parseJSON = (id, fallback) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    try {
      return JSON.parse(el.textContent || "") || fallback;
    } catch (err) {
      console.warn("Unable to parse", id, err);
      return fallback;
    }
  };

  const fragments = parseJSON("gremlin-fragments", {
    openers: [],
    closers: [],
    joiners: [" + "],
  });
  const omens = parseJSON("gremlin-omens", {
    sums: {},
    doubles: [],
    fallback: [],
  });
  const targets = parseJSON("gremlin-targets", []);

  const rollButton = lab.querySelector("[data-gremlin-roll]");
  const shipButton = lab.querySelector("[data-gremlin-ship]");
  const resetButton = lab.querySelector("[data-gremlin-reset]");
  const dice = lab.querySelectorAll("[data-gremlin-die]");
  const headline = lab.querySelector("[data-gremlin-headline]");
  const status = lab.querySelector("[data-gremlin-status]");
  const interestFill = lab.querySelector("[data-gremlin-interest]");
  const interestLabel = lab.querySelector("[data-gremlin-interest-label]");
  const logList = lab.querySelector("[data-gremlin-log]");
  const logCount = lab.querySelector("[data-gremlin-log-count]");
  const omenText = lab.querySelector("[data-gremlin-omen-text]");
  const omenNote = lab.querySelector("[data-gremlin-omen-note]");
  const omenFlair = lab.querySelector("[data-gremlin-omen-flair]");

  let lastRoll = null;
  let interest = 72;
  let decayTimer = null;
  let shippedCount = 0;

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
  const sample = (items) =>
    items[Math.floor(Math.random() * items.length)] || null;
  const formatHeadline = (first, second) => {
    const opener =
      (fragments.openers && fragments.openers[first - 1]) ||
      `Die ${first} sparks`;
    const closer =
      (fragments.closers && fragments.closers[second - 1]) ||
      `die ${second} delivers`;
    const joiner = sample(fragments.joiners || [" + "]) || " + ";
    return `${opener}${joiner}${closer}`;
  };

  const pickOmen = (first, second) => {
    const sum = first + second;
    const sumKey = String(sum);
    const isDouble = first === second;
    const pool =
      (isDouble && Array.isArray(omens.doubles) && omens.doubles.length
        ? omens.doubles
        : null) ||
      (omens.sums &&
        ((Array.isArray(omens.sums[sumKey]) && omens.sums[sumKey].length
          ? omens.sums[sumKey]
          : null) ||
          (Array.isArray(omens.sums[sum]) && omens.sums[sum].length
            ? omens.sums[sum]
            : null))) ||
      (Array.isArray(omens.fallback) && omens.fallback.length
        ? omens.fallback
        : null);

    const vibe = isDouble
      ? "double"
      : sum >= 9
      ? "surge"
      : sum <= 4
      ? "sleepy"
      : "steady";
    return {
      text: (pool && sample(pool)) || "The gremlin blinks at the dice.",
      sum,
      double: isDouble,
      vibe,
    };
  };

  const setStatus = (message) => {
    if (status) status.textContent = message;
  };

  const renderInterest = () => {
    const bounded = clamp(Math.round(interest), 5, 100);
    if (interestFill) {
      interestFill.style.width = `${bounded}%`;
      interestFill.style.opacity = bounded < 18 ? "0.65" : "1";
    }
    if (interestLabel) {
      const tone =
        bounded >= 80
          ? "The gremlin is thrilled—ship something wild."
          : bounded >= 50
          ? "Interest steady. Keep rolling headlines."
          : "Interest fading. Ship before the gremlin wanders off.";
      interestLabel.textContent = tone;
    }
  };

  const adjustInterest = (delta) => {
    interest = clamp(interest + delta, 6, 100);
    renderInterest();
  };

  const startDecay = () => {
    if (decayTimer) clearInterval(decayTimer);
    decayTimer = setInterval(() => adjustInterest(-1.5), 4500);
  };

  const animateDice = () => {
    dice.forEach((die) => {
      die.classList.add("is-rolling");
      setTimeout(() => die.classList.remove("is-rolling"), 240);
    });
  };

  const updateDice = (first, second) => {
    const faces = [first, second];
    dice.forEach((die, index) => {
      die.textContent = faces[index];
    });
  };

  const bumpLogCount = () => {
    if (logCount) {
      const label = shippedCount === 1 ? "1 shipped" : `${shippedCount} shipped`;
      logCount.textContent = label;
    }
  };

  const removePlaceholder = () => {
    if (!logList) return;
    const placeholder = logList.querySelector("[data-gremlin-placeholder]");
    if (placeholder) {
      placeholder.remove();
    }
  };

  const renderOmen = (omen) => {
    if (!omen) return;
    if (omenText) {
      omenText.textContent = omen.text;
    }
    if (omenNote) {
      const tone =
        omen.double && omen.vibe === "double"
          ? "Double roll: interest spikes while the gremlin scribbles."
          : omen.vibe === "surge"
          ? `Sum ${omen.sum} makes the gremlin bold. Ship quickly.`
          : omen.vibe === "sleepy"
          ? `Sum ${omen.sum} barely wakes the gremlin—roll or ship soon.`
          : `Sum ${omen.sum} keeps the gremlin curious.`;
      omenNote.textContent = tone;
    }
    if (omenFlair) {
      const flair =
        omen.double && omen.vibe === "double"
          ? "Double trouble"
          : omen.vibe === "surge"
          ? "Hyped"
          : omen.vibe === "sleepy"
          ? "Sleepy spark"
          : "Curious";
      omenFlair.textContent = flair;
    }
    lab.classList.toggle("gremlin--double", Boolean(omen.double));
  };

  const resetOmen = () => {
    if (omenText) {
      omenText.textContent =
        "Awaiting the first omen. Roll both dice to wake the gremlin.";
    }
    if (omenNote) {
      omenNote.textContent = "Both dice fuel the headline mashup.";
    }
    if (omenFlair) {
      omenFlair.textContent = "Waiting";
    }
    lab.classList.remove("gremlin--double");
  };

  const rollDice = () => {
    const first = Math.floor(Math.random() * 6) + 1;
    const second = Math.floor(Math.random() * 6) + 1;
    animateDice();
    updateDice(first, second);
    const generated = formatHeadline(first, second);
    if (headline) {
      headline.textContent = generated;
    }
    lastRoll = { first, second, generated };
    if (shipButton) {
      shipButton.disabled = false;
    }
    const omen = pickOmen(first, second);
    renderOmen(omen);
    const interestBonus =
      omen && omen.double
        ? 8
        : omen && omen.vibe === "surge"
        ? 3
        : omen && omen.vibe === "sleepy"
        ? 1
        : 2;
    adjustInterest(6 + interestBonus);
    setStatus(
      `Rolled ${first} and ${second}. Headline primed${
        omen && omen.double ? " with double chaos." : "."
      }`
    );
  };

  const pickTarget = () => {
    if (!targets || !targets.length) return null;
    return sample(targets);
  };

  const shipHeadline = () => {
    if (!lastRoll || !logList) {
      return;
    }
    removePlaceholder();
    shippedCount += 1;
    const entry = document.createElement("li");
    entry.className = "gremlin-log__entry";

    const title = document.createElement("div");
    title.textContent = lastRoll.generated;
    entry.appendChild(title);

    const stamp = document.createElement("time");
    stamp.dateTime = new Date().toISOString();
    stamp.textContent = `Shipped with ${lastRoll.first} + ${lastRoll.second}`;
    entry.appendChild(stamp);

    const target = pickTarget();
    const detail = document.createElement("p");
    detail.className = "gremlin-log__detail";
    if (target) {
      detail.textContent = `Handed to ${target.title} (${target.votes} votes) while ${target.creator} watched the chaos.`;
    } else {
      detail.textContent = "Filed under backup chaos queue. No live features were harmed.";
    }
    entry.appendChild(detail);

    logList.insertBefore(entry, logList.firstChild);
    bumpLogCount();
    adjustInterest(4);
    if (shipButton) {
      shipButton.disabled = true;
    }
    setStatus("Headline shipped. Roll again before the gremlin loses focus.");
    lastRoll = null;
  };

  const resetLab = () => {
    lastRoll = null;
    if (shipButton) shipButton.disabled = true;
    updateDice("-", "-");
    if (headline) {
      headline.textContent = "Roll to see what the gremlin demands.";
    }
    setStatus("Gremlin is stretching. Roll to wake it back up.");
    adjustInterest(-6);
    resetOmen();
  };

  if (rollButton) {
    rollButton.addEventListener("click", rollDice);
  }

  if (shipButton) {
    shipButton.addEventListener("click", shipHeadline);
  }

  if (resetButton) {
    resetButton.addEventListener("click", resetLab);
  }

  renderInterest();
  startDecay();
  resetOmen();
})();
