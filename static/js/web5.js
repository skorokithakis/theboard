(function () {
  "use strict";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function init() {
    activateCarousels();
    activateInterviews();
    applyHeroTilt();
  }

  function activateCarousels() {
    var cards = Array.prototype.slice.call(
      document.querySelectorAll(".web5-carousel .carousel-card")
    );
    if (!cards.length) {
      return;
    }
    var index = 0;
    highlight(cards, index, "is-active");
    setInterval(function () {
      cards[index].classList.remove("is-active");
      index = (index + 1) % cards.length;
      highlight(cards, index, "is-active");
    }, 3200);
  }

  function activateInterviews() {
    var cards = Array.prototype.slice.call(
      document.querySelectorAll(".interview-carousel .interview-card")
    );
    if (!cards.length) {
      return;
    }
    var index = 0;
    highlight(cards, index, "is-active");
    setInterval(function () {
      cards[index].classList.remove("is-active");
      index = (index + 1) % cards.length;
      highlight(cards, index, "is-active");
    }, 3600);
  }

  function highlight(list, index, className) {
    if (!list[index]) {
      return;
    }
    list[index].classList.add(className);
  }

  function applyHeroTilt() {
    var hero = document.querySelector(".hero-web5");
    if (!hero) {
      return;
    }
    window.addEventListener(
      "scroll",
      function () {
        var offset = Math.max(window.scrollY, 0);
        var tilt = Math.min(offset * 0.01, 6);
        hero.style.setProperty("--web5-tilt", tilt + "deg");
      },
      { passive: true }
    );
  }
})();
