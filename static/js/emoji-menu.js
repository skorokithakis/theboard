(() => {
  const TEXT_FIELD_SELECTOR = [
    "textarea",
    'input[type="text"]',
    'input[type="search"]',
    'input[type="email"]',
    'input[type="url"]',
    'input[type="tel"]',
    'input[type="number"]',
    "input:not([type])",
  ].join(",");

  const BOARDMOJIS = [
    { label: "Boardwave", glyph: "~(o^_^o)~" },
    { label: "Victory stack", glyph: "[+1][+1][+1]" },
    { label: "Ship it", glyph: "🚀✨" },
    { label: "Spark scribble", glyph: "<>=={::}=>" },
    { label: "Coffee run", glyph: "c[_]" },
    { label: "Glitch hop", glyph: "(* /‾‾/ )" },
    { label: "Cat courier", glyph: "/\\_/\\  (=^.^=)" },
    { label: "Bug zapper", glyph: "(x_x)🔨" },
  ];

  const processedForms = new WeakSet();

  const closePanels = (activeToggle) => {
    document.querySelectorAll("[data-emoji-panel]").forEach((panel) => {
      const toggleId = panel.id;
      const toggle =
        typeof toggleId === "string" ? document.querySelector(`[aria-controls="${toggleId}"]`) : null;
      if (toggle instanceof HTMLElement && toggle !== activeToggle) {
        toggle.setAttribute("aria-expanded", "false");
      }
      panel.setAttribute("hidden", "true");
    });
  };

  const insertBoardmoji = (field, glyph) => {
    if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
    const cursorStart = field.selectionStart ?? field.value.length;
    const cursorEnd = field.selectionEnd ?? field.value.length;
    const nextValue = `${field.value.slice(0, cursorStart)}${glyph}${field.value.slice(cursorEnd)}`;
    field.value = nextValue;
    const position = cursorStart + glyph.length;
    field.setSelectionRange(position, position);
    field.focus();
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const buildMenu = (form, textFields) => {
    const wrapper = document.createElement("div");
    wrapper.className = "emoji-menu";
    wrapper.setAttribute("data-emoji-menu", "true");

    const header = document.createElement("div");
    header.className = "emoji-menu__header";
    const label = document.createElement("p");
    label.className = "emoji-menu__label";
    label.textContent = "Boardmojis";

    const helper = document.createElement("p");
    helper.className = "emoji-menu__helper";
    helper.textContent = "Drop a reaction into the focused field.";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "emoji-menu__toggle";
    toggle.textContent = "Open emoji menu";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", `emoji-panel-${Math.random().toString(16).slice(2)}`);

    header.appendChild(label);
    header.appendChild(helper);
    header.appendChild(toggle);

    const panel = document.createElement("div");
    panel.className = "emoji-menu__panel";
    panel.id = toggle.getAttribute("aria-controls");
    panel.setAttribute("data-emoji-panel", "true");
    panel.setAttribute("hidden", "true");
    panel.setAttribute("role", "menu");

    let focusedField = textFields[0];

    textFields.forEach((field) => {
      field.addEventListener("focus", () => {
        focusedField = field;
      });
    });

    BOARDMOJIS.forEach((item) => {
      const emojiButton = document.createElement("button");
      emojiButton.type = "button";
      emojiButton.className = "emoji-menu__emoji";
      emojiButton.setAttribute("role", "menuitem");
      emojiButton.title = `${item.label} ${item.glyph}`;
      emojiButton.textContent = item.glyph;
      emojiButton.addEventListener("click", () => {
        insertBoardmoji(focusedField ?? textFields[0], item.glyph);
      });
      panel.appendChild(emojiButton);
    });

    toggle.addEventListener("click", () => {
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      closePanels(toggle);
      if (!isOpen) {
        panel.removeAttribute("hidden");
        toggle.setAttribute("aria-expanded", "true");
      } else {
        panel.setAttribute("hidden", "true");
        toggle.setAttribute("aria-expanded", "false");
      }
    });

    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        panel.setAttribute("hidden", "true");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });

    wrapper.appendChild(header);
    wrapper.appendChild(panel);

    const actionCluster = form.querySelector(".feature-form__actions, .form-actions, .web5-form__submit, .feature-card__vote-form");
    if (actionCluster && actionCluster.parentElement) {
      actionCluster.parentElement.insertBefore(wrapper, actionCluster);
    } else {
      form.appendChild(wrapper);
    }
  };

  const decorateForm = (form) => {
    if (!(form instanceof HTMLFormElement) || processedForms.has(form)) return;
    const textFields = Array.from(form.querySelectorAll(TEXT_FIELD_SELECTOR)).filter(
      (field) => field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
    );
    if (!textFields.length) return;
    processedForms.add(form);
    buildMenu(form, textFields);
  };

  const scanForms = () => {
    document.querySelectorAll("form").forEach(decorateForm);
  };

  const setupObserver = () => {
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLFormElement) {
            decorateForm(node);
          } else if (node instanceof HTMLElement) {
            node.querySelectorAll?.("form").forEach(decorateForm);
          }
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  };

  const handleDocumentClick = (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.closest("[data-emoji-menu]")) {
      return;
    }
    closePanels();
  };

  const init = () => {
    scanForms();
    setupObserver();
    document.addEventListener("click", handleDocumentClick);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
