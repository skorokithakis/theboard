(() => {
  // Decorate every text-friendly field with a tiny ASCII horse placeholder.
  const HORSE_ASCII = String.raw`/)\-^^-/`;
  const selectorList = [
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="url"]',
    'input[type="tel"]',
    'input:not([type])',
    "textarea",
  ];

  const ensureHorse = (field) => {
    if (!(field instanceof HTMLElement)) return;
    const horseyPlaceholder = field.getAttribute("placeholder") || "";
    if (horseyPlaceholder.includes(HORSE_ASCII)) {
      return;
    }
    const trimmed = horseyPlaceholder.trim();
    const appended = trimmed ? `${trimmed} ${HORSE_ASCII}` : HORSE_ASCII;
    field.setAttribute("placeholder", appended);
  };

  const decorateAllFields = () => {
    document.querySelectorAll(selectorList.join(",")).forEach(ensureHorse);
  };

  const decorateNode = (node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(selectorList.join(","))) {
      ensureHorse(node);
    }
    node.querySelectorAll?.(selectorList.join(",")).forEach(ensureHorse);
  };

  const setupObserver = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(decorateNode);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      decorateAllFields();
      setupObserver();
    });
  } else {
    decorateAllFields();
    setupObserver();
  }
})();
