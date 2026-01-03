(function () {
  "use strict";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeSiteNav, { once: true });
  } else {
    initializeSiteNav();
  }

  function initializeSiteNav() {
    var nav = document.getElementById("primary-navigation");
    if (!nav) {
      return;
    }

    var toggle = nav.querySelector(".site-nav__toggle");
    var sectionToggles = nav.querySelectorAll(".site-nav__section-toggle");

    if (toggle) {
      toggle.addEventListener("click", function () {
        var isOpen = nav.classList.toggle("site-nav--open");
        toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (!isOpen) {
          closeSections(sectionToggles);
        }
      });
    }

    sectionToggles.forEach(function (button) {
      button.addEventListener("click", function (event) {
        event.preventDefault();
        var section = button.closest(".site-nav__section");
        if (!section) {
          return;
        }
        var isOpen = section.classList.toggle("site-nav__section--open");
        button.setAttribute("aria-expanded", isOpen ? "true" : "false");
        if (isOpen) {
          closeSiblingSections(sectionToggles, button);
        }
      });
    });

    document.addEventListener("keyup", function (event) {
      if (event.key === "Escape") {
        nav.classList.remove("site-nav--open");
        if (toggle) {
          toggle.setAttribute("aria-expanded", "false");
        }
        closeSections(sectionToggles);
      }
    });
  }

  function closeSections(buttons) {
    buttons.forEach(function (button) {
      var section = button.closest(".site-nav__section");
      if (section) {
        section.classList.remove("site-nav__section--open");
      }
      button.setAttribute("aria-expanded", "false");
    });
  }

  function closeSiblingSections(buttons, activeButton) {
    buttons.forEach(function (button) {
      if (button === activeButton) {
        return;
      }
      var section = button.closest(".site-nav__section");
      if (section) {
        section.classList.remove("site-nav__section--open");
      }
      button.setAttribute("aria-expanded", "false");
    });
  }
})();
