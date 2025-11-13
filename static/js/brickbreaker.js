(function () {
  "use strict";

  var MAX_FEATURE_BUTTONS = 120;
  var BRICK_WIDTH = 88;
  var BRICK_HEIGHT = 31;
  var BRICK_GAP = 12;
  var BRICK_MARGIN = 30;
  var PADDLE_HEIGHT = 12;
  var BASE_BALL_SPEED = 360;
  var MAX_FEED_ENTRIES = 7;

  document.addEventListener("DOMContentLoaded", function () {
    var canvas = document.getElementById("art-deco-brick-breaker");
    if (!canvas || !canvas.getContext) {
      return;
    }

    var payload = [];
    var payloadNode = document.getElementById("feature-button-data");
    if (payloadNode) {
      try {
        payload = JSON.parse(payloadNode.textContent || "[]");
      } catch (err) {
        console.error("Failed to parse feature button payload", err);
      }
    }

    new DecoBreaker(canvas, payload.slice(0, MAX_FEATURE_BUTTONS));
  });

  function DecoBreaker(canvas, features) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.features = features || [];
    this.bricks = this.features.map(function (feature, index) {
      return {
        feature: feature,
        index: index,
        hitsRemaining: 2,
        destroyed: false,
        pulse: 0,
        x: 0,
        y: 0,
        width: BRICK_WIDTH,
        height: BRICK_HEIGHT,
      };
    });
    this.paddle = {
      width: 160,
      height: PADDLE_HEIGHT,
      x: 0,
      y: 0,
      speed: 480,
      direction: 0,
    };
    this.ball = {
      radius: 9,
      speed: BASE_BALL_SPEED,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      tethered: true,
    };
    this.keyState = { left: false, right: false };
    this.lastTime = null;
    this.animationFrame = null;
    this.shotsFired = 0;
    this.combo = 0;
    this.lastBreakLabel = "—";
    this.overlay = document.querySelector("[data-breaker-overlay]");
    this.overlayText = document.querySelector("[data-breaker-overlay-text]");
    this.feed = document.querySelector("[data-breaker-feed]");
    this.emptyNotice = document.querySelector("[data-breaker-empty]");
    this.stage = document.querySelector("[data-breaker-stage]");
    this.hud = {
      remaining: document.querySelector("[data-breaker-remaining]"),
      shots: document.querySelector("[data-breaker-shots]"),
      streak: document.querySelector("[data-breaker-streak]"),
      last: document.querySelector("[data-breaker-last]"),
    };
    this.sounds = new SoundStudio();

    this.loop = this.loop.bind(this);
    this.handleResize = this.handleResize.bind(this);
    this.onKeydown = this.onKeydown.bind(this);
    this.onKeyup = this.onKeyup.bind(this);

    window.addEventListener("resize", this.handleResize);
    document.addEventListener("keydown", this.onKeydown);
    document.addEventListener("keyup", this.onKeyup);

    this.handleResize();
    this.resetBall();
    this.updateHud();
    this.updateEmptyState();
    this.animationFrame = window.requestAnimationFrame(this.loop);
  }

  DecoBreaker.prototype.detach = function () {
    window.removeEventListener("resize", this.handleResize);
    document.removeEventListener("keydown", this.onKeydown);
    document.removeEventListener("keyup", this.onKeyup);
    if (this.animationFrame) {
      window.cancelAnimationFrame(this.animationFrame);
    }
  };

  DecoBreaker.prototype.handleResize = function () {
    var bounds = this.canvas.parentElement.getBoundingClientRect();
    var width = Math.min(960, Math.max(320, Math.round(bounds.width)));
    var height = Math.round(width * 0.55);
    this.canvas.width = width;
    this.canvas.height = height;

    this.paddle.width = Math.max(90, Math.min(220, width * 0.17));
    this.paddle.y = height - 48;
    if (this.paddle.x + this.paddle.width > width) {
      this.paddle.x = width - this.paddle.width - 10;
    }
    if (this.paddle.x < 10) {
      this.paddle.x = 10;
    }

    this.layoutBricks();
    if (this.ball.tethered) {
      this.resetBall();
    }
  };

  DecoBreaker.prototype.layoutBricks = function () {
    if (!this.bricks.length) {
      return;
    }
    var width = this.canvas.width;
    var perRow = Math.max(
      1,
      Math.floor((width - BRICK_MARGIN * 2 + BRICK_GAP) / (BRICK_WIDTH + BRICK_GAP))
    );
    for (var i = 0; i < this.bricks.length; i += 1) {
      var brick = this.bricks[i];
      var row = Math.floor(i / perRow);
      var col = i % perRow;
      brick.x = BRICK_MARGIN + col * (BRICK_WIDTH + BRICK_GAP);
      brick.y = BRICK_MARGIN + row * (BRICK_HEIGHT + BRICK_GAP);
    }
  };

  DecoBreaker.prototype.resetBall = function () {
    this.ball.tethered = true;
    this.ball.vx = 0;
    this.ball.vy = 0;
    this.ball.x = this.paddle.x + this.paddle.width / 2;
    this.ball.y = this.paddle.y - this.ball.radius - 4;
    this.combo = 0;
    this.showOverlay("Press space to launch the gilded sphere.");
    this.updateHud();
  };

  DecoBreaker.prototype.launchBall = function () {
    if (!this.bricks.length || !this.remainingBricks()) {
      this.showOverlay("All clear! Submit another feature to restock the wall.");
      return;
    }
    if (!this.ball.tethered) {
      return;
    }
    this.ball.tethered = false;
    var angle = (-75 + Math.random() * 150) * (Math.PI / 180);
    this.ball.vx = Math.cos(angle) * this.ball.speed;
    this.ball.vy = -Math.abs(Math.sin(angle) * this.ball.speed);
    this.shotsFired += 1;
    this.hideOverlay();
    this.updateHud();
    this.sounds.play("launch");
  };

  DecoBreaker.prototype.updateHud = function () {
    if (this.hud.remaining) {
      this.hud.remaining.textContent = this.remainingBricks();
    }
    if (this.hud.shots) {
      this.hud.shots.textContent = this.shotsFired;
    }
    if (this.hud.streak) {
      this.hud.streak.textContent = this.combo;
    }
    if (this.hud.last) {
      this.hud.last.textContent = this.lastBreakLabel || "—";
    }
  };

  DecoBreaker.prototype.remainingBricks = function () {
    var remaining = 0;
    for (var i = 0; i < this.bricks.length; i += 1) {
      if (!this.bricks[i].destroyed) {
        remaining += 1;
      }
    }
    return remaining;
  };

  DecoBreaker.prototype.updateEmptyState = function () {
    var remaining = this.remainingBricks();
    if (this.emptyNotice) {
      this.emptyNotice.hidden = remaining > 0;
    }
    if (this.stage) {
      if (remaining === 0) {
        this.stage.classList.add("breaker-stage--disabled");
      } else {
        this.stage.classList.remove("breaker-stage--disabled");
      }
    }
    if (!remaining) {
      this.showOverlay("All clear! Submit another feature to restock the wall.");
    }
  };

  DecoBreaker.prototype.loop = function (timestamp) {
    if (!this.lastTime) {
      this.lastTime = timestamp;
    }
    var delta = (timestamp - this.lastTime) / 1000;
    this.lastTime = timestamp;
    delta = Math.min(delta, 0.04);

    this.update(delta);
    this.draw();
    this.animationFrame = window.requestAnimationFrame(this.loop);
  };

  DecoBreaker.prototype.update = function (delta) {
    this.updatePaddle(delta);
    this.updateBall(delta);
    this.updateBricks(delta);
  };

  DecoBreaker.prototype.updatePaddle = function (delta) {
    if (this.keyState.left && !this.keyState.right) {
      this.paddle.direction = -1;
    } else if (this.keyState.right && !this.keyState.left) {
      this.paddle.direction = 1;
    } else {
      this.paddle.direction = 0;
    }

    this.paddle.x += this.paddle.direction * this.paddle.speed * delta;
    var maxX = this.canvas.width - this.paddle.width - 10;
    if (this.paddle.x < 10) {
      this.paddle.x = 10;
    } else if (this.paddle.x > maxX) {
      this.paddle.x = maxX;
    }
    if (this.ball.tethered) {
      this.ball.x = this.paddle.x + this.paddle.width / 2;
      this.ball.y = this.paddle.y - this.ball.radius - 4;
    }
  };

  DecoBreaker.prototype.updateBall = function (delta) {
    if (this.ball.tethered) {
      return;
    }

    this.ball.x += this.ball.vx * delta;
    this.ball.y += this.ball.vy * delta;

    var radius = this.ball.radius;
    if (this.ball.x - radius <= 0) {
      this.ball.x = radius;
      this.ball.vx = Math.abs(this.ball.vx);
      this.sounds.play("bounce");
    } else if (this.ball.x + radius >= this.canvas.width) {
      this.ball.x = this.canvas.width - radius;
      this.ball.vx = -Math.abs(this.ball.vx);
      this.sounds.play("bounce");
    }

    if (this.ball.y - radius <= 0) {
      this.ball.y = radius;
      this.ball.vy = Math.abs(this.ball.vy);
      this.sounds.play("bounce");
    }

    if (this.ball.y + radius >= this.canvas.height) {
      this.handleMiss();
      return;
    }

    this.checkPaddleCollision();
    this.checkBrickCollisions();
  };

  DecoBreaker.prototype.updateBricks = function (delta) {
    for (var i = 0; i < this.bricks.length; i += 1) {
      var brick = this.bricks[i];
      if (brick.pulse > 0) {
        brick.pulse = Math.max(0, brick.pulse - delta * 1.5);
      }
    }
  };

  DecoBreaker.prototype.handleMiss = function () {
    this.sounds.play("bounce");
    this.combo = 0;
    this.showOverlay("Resetting alignment... press space to relaunch.");
    this.resetBall();
    this.updateHud();
  };

  DecoBreaker.prototype.checkPaddleCollision = function () {
    if (this.ball.vy >= 0) {
      var paddle = this.paddle;
      var radius = this.ball.radius;
      if (
        this.ball.x + radius >= paddle.x &&
        this.ball.x - radius <= paddle.x + paddle.width &&
        this.ball.y + radius >= paddle.y &&
        this.ball.y - radius <= paddle.y + paddle.height
      ) {
        this.ball.y = paddle.y - radius - 0.5;
        var relative = (this.ball.x - (paddle.x + paddle.width / 2)) / (paddle.width / 2);
        this.ball.vx = relative * this.ball.speed;
        this.ball.vy = -Math.abs(this.ball.vy || this.ball.speed * 0.8);
        normalizeVelocity(this.ball, this.ball.speed);
        this.sounds.play("bounce");
      }
    }
  };

  DecoBreaker.prototype.checkBrickCollisions = function () {
    var radius = this.ball.radius;
    for (var i = 0; i < this.bricks.length; i += 1) {
      var brick = this.bricks[i];
      if (brick.destroyed) {
        continue;
      }
      if (
        this.ball.x + radius >= brick.x &&
        this.ball.x - radius <= brick.x + brick.width &&
        this.ball.y + radius >= brick.y &&
        this.ball.y - radius <= brick.y + brick.height
      ) {
        var overlapX = Math.min(
          this.ball.x + radius - brick.x,
          brick.x + brick.width - (this.ball.x - radius)
        );
        var overlapY = Math.min(
          this.ball.y + radius - brick.y,
          brick.y + brick.height - (this.ball.y - radius)
        );
        if (overlapX < overlapY) {
          var hitFromLeft = this.ball.x < brick.x + brick.width / 2;
          this.ball.vx = hitFromLeft ? -Math.abs(this.ball.vx) : Math.abs(this.ball.vx);
        } else {
          var hitFromTop = this.ball.y < brick.y + brick.height / 2;
          this.ball.vy = hitFromTop ? -Math.abs(this.ball.vy) : Math.abs(this.ball.vy);
        }
        this.resolveBrickHit(brick);
        normalizeVelocity(this.ball, this.ball.speed);
        break;
      }
    }
  };

  DecoBreaker.prototype.resolveBrickHit = function (brick) {
    brick.hitsRemaining -= 1;
    brick.pulse = 1;
    if (brick.hitsRemaining <= 0) {
      brick.destroyed = true;
      this.combo += 1;
      this.lastBreakLabel = brick.feature.title || "Mystery feature";
      this.logEvent("Shattered “" + truncate(brick.feature.title, 32) + "”.");
      this.updateHud();
      this.sounds.play("break");
      this.updateEmptyState();
    } else {
      this.sounds.play("hit");
    }

    if (this.remainingBricks() === 0) {
      this.showOverlay("Wall cleared! Submit more features to keep playing.");
    }
  };

  DecoBreaker.prototype.draw = function () {
    var ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawBackdrop(ctx);
    this.drawBricks(ctx);
    this.drawPaddle(ctx);
    this.drawBall(ctx);
  };

  DecoBreaker.prototype.drawBackdrop = function (ctx) {
    var gradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
    gradient.addColorStop(0, "rgba(16, 32, 40, 0.95)");
    gradient.addColorStop(1, "rgba(8, 16, 20, 0.95)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    ctx.strokeStyle = "rgba(243, 201, 105, 0.08)";
    ctx.lineWidth = 1;
    var spacing = 32;
    for (var x = BRICK_MARGIN; x < this.canvas.width; x += spacing) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, this.canvas.height);
      ctx.stroke();
    }
    for (var y = BRICK_MARGIN; y < this.canvas.height; y += spacing) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(this.canvas.width, y);
      ctx.stroke();
    }
  };

  DecoBreaker.prototype.drawBricks = function (ctx) {
    for (var i = 0; i < this.bricks.length; i += 1) {
      var brick = this.bricks[i];
      if (brick.destroyed) {
        continue;
      }
      var gradient = ctx.createLinearGradient(brick.x, brick.y, brick.x, brick.y + brick.height);
      gradient.addColorStop(0, brick.hitsRemaining === 2 ? "#f3c969" : "#f45b69");
      gradient.addColorStop(1, "#47240b");
      ctx.fillStyle = gradient;
      ctx.fillRect(brick.x, brick.y, brick.width, brick.height);

      ctx.strokeStyle = "rgba(5, 5, 5, 0.45)";
      ctx.lineWidth = 2;
      ctx.strokeRect(brick.x + 1, brick.y + 1, brick.width - 2, brick.height - 2);

      if (brick.pulse > 0) {
        ctx.fillStyle = "rgba(255, 255, 255, " + (0.25 * brick.pulse).toFixed(3) + ")";
        ctx.fillRect(brick.x, brick.y, brick.width, brick.height);
      }

      ctx.fillStyle = "rgba(12, 8, 2, 0.85)";
      ctx.font = "700 11px 'Josefin Sans', sans-serif";
      ctx.textBaseline = "middle";
      ctx.save();
      ctx.beginPath();
      ctx.rect(brick.x + 4, brick.y + 4, brick.width - 8, brick.height - 8);
      ctx.clip();
      ctx.fillText(truncate(brick.feature.title || "Untitled", 16), brick.x + 6, brick.y + brick.height / 2);
      ctx.restore();
    }
  };

  DecoBreaker.prototype.drawPaddle = function (ctx) {
    ctx.fillStyle = "#2bb3af";
    ctx.fillRect(this.paddle.x, this.paddle.y, this.paddle.width, this.paddle.height);

    ctx.strokeStyle = "rgba(243, 201, 105, 0.6)";
    ctx.lineWidth = 2;
    ctx.strokeRect(this.paddle.x + 0.5, this.paddle.y + 0.5, this.paddle.width - 1, this.paddle.height - 1);
  };

  DecoBreaker.prototype.drawBall = function (ctx) {
    var radial = ctx.createRadialGradient(
      this.ball.x - 2,
      this.ball.y - 2,
      2,
      this.ball.x,
      this.ball.y,
      this.ball.radius * 1.2
    );
    radial.addColorStop(0, "#ffffff");
    radial.addColorStop(0.5, "#f3c969");
    radial.addColorStop(1, "#2bb3af");
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(this.ball.x, this.ball.y, this.ball.radius, 0, Math.PI * 2);
    ctx.fill();
  };

  DecoBreaker.prototype.showOverlay = function (text) {
    if (!this.overlay) {
      return;
    }
    if (this.overlayText && text) {
      this.overlayText.textContent = text;
    }
    this.overlay.hidden = false;
  };

  DecoBreaker.prototype.hideOverlay = function () {
    if (this.overlay) {
      this.overlay.hidden = true;
    }
  };

  DecoBreaker.prototype.logEvent = function (message) {
    if (!this.feed) {
      return;
    }
    var entry = document.createElement("li");
    entry.textContent = message;
    this.feed.prepend(entry);
    while (this.feed.children.length > MAX_FEED_ENTRIES) {
      this.feed.lastElementChild.remove();
    }
  };

  DecoBreaker.prototype.onKeydown = function (event) {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (event.code === "ArrowLeft") {
      this.keyState.left = true;
    } else if (event.code === "ArrowRight") {
      this.keyState.right = true;
    } else if (event.code === "Space") {
      event.preventDefault();
      this.launchBall();
    }
  };

  DecoBreaker.prototype.onKeyup = function (event) {
    if (isTypingTarget(event.target)) {
      return;
    }
    if (event.code === "ArrowLeft") {
      this.keyState.left = false;
    } else if (event.code === "ArrowRight") {
      this.keyState.right = false;
    }
  };

  function normalizeVelocity(ball, targetSpeed) {
    var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    if (!speed) {
      ball.vy = -targetSpeed;
      ball.vx = 0;
      return;
    }
    var scale = targetSpeed / speed;
    ball.vx *= scale;
    ball.vy *= scale;
  }

  function truncate(value, limit) {
    if (!value) {
      return "";
    }
    if (value.length <= limit) {
      return value;
    }
    return value.slice(0, limit - 1) + "…";
  }

  function isTypingTarget(target) {
    if (!target || !target.tagName) {
      return false;
    }
    var tag = target.tagName.toLowerCase();
    return (
      tag === "input" ||
      tag === "textarea" ||
      target.isContentEditable ||
      tag === "select"
    );
  }

  function SoundStudio() {
    this.supported = Boolean(window.AudioContext || window.webkitAudioContext);
    this.ctx = null;
  }

  SoundStudio.prototype.ensureContext = function () {
    if (!this.supported) {
      return null;
    }
    if (!this.ctx) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) {
        this.supported = false;
        return null;
      }
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }
    return this.ctx;
  };

  SoundStudio.prototype.play = function (type) {
    var ctx = this.ensureContext();
    if (!ctx) {
      return;
    }
    var now = ctx.currentTime;
    var duration = 0.18;
    var frequencies = {
      launch: [420, 640],
      bounce: [320, 260],
      hit: [520, 360],
      break: [180, 90, 420],
    };
    var tones = frequencies[type];
    if (!tones) {
      tones = [320];
    }
    for (var i = 0; i < tones.length; i += 1) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = type === "break" ? "triangle" : "square";
      osc.frequency.value = tones[i];
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + i * 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.02);
      osc.stop(now + duration + i * 0.06);
    }
  };
})();
