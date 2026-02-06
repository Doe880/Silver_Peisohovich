(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const highScoreEl = document.getElementById("highscore");
  const livesEl = document.getElementById("lives");
  const comboEl = document.getElementById("combo");
  const restartBtn = document.getElementById("btn-restart");

  const STORAGE_KEY_HS = "silver_peisohovich_highscore";
  const TELEGRAPH_TIME = 0.30;

  const world = {
    w: 0, h: 0,
    t: 0, lastTs: 0,
    running: false,
    gameOver: false,

    score: 0,
    highScore: 0,
    lives: 3,
    combo: 0,

    speed: 240,
    spawnBase: 0.85,
    spawnTimer: 0,
    difficultyTimer: 0
  };

  function resizeCanvas() {
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const w = Math.floor(window.innerWidth);
    const h = Math.floor(window.innerHeight);

    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    world.w = w;
    world.h = h;
  }

  // --- assets: only face ---
  const IMG = {};
  const assets = { face: "assets/face.png" };

  function loadImages(map) {
    const entries = Object.entries(map);
    let loaded = 0;
    return new Promise((resolve, reject) => {
      for (const [key, src] of entries) {
        const im = new Image();
        im.onload = () => {
          IMG[key] = im;
          loaded++;
          if (loaded === entries.length) resolve();
        };
        im.onerror = () => reject(new Error("Не удалось загрузить: " + src));
        im.src = src;
      }
    });
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function syncHud() {
    scoreEl.textContent = String(world.score);
    highScoreEl.textContent = String(world.highScore);
    livesEl.textContent = String(world.lives);
    comboEl.textContent = String(world.combo);
  }

  function loadHighScore() {
    const raw = localStorage.getItem(STORAGE_KEY_HS);
    const n = raw ? Number(raw) : 0;
    world.highScore = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }

  function saveHighScoreIfNeeded() {
    if (world.score > world.highScore) {
      world.highScore = world.score;
      localStorage.setItem(STORAGE_KEY_HS, String(world.highScore));
    }
  }

  function vibrate(ms) {
    try {
      if (navigator && typeof navigator.vibrate === "function") navigator.vibrate(ms);
    } catch (_) {}
  }

  // --- Player ---
  const player = {
    x: 0, y: 0,
    w: 72, h: 96,

    targetX: 0,
    targetY: 0,

    vx: 0,
    vy: 0,

    maxSpeed: 1400,
    invuln: 0,

    slowTimer: 0,
    slowFactor: 0.55,
  };

  function movementBounds() {
    const bottomPad = Math.max(20, world.h * 0.05);
    const topLimit = Math.max(70, world.h * 0.42);
    const yMax = world.h - player.h - bottomPad;
    const yMin = yMax - topLimit;
    return { yMin, yMax };
  }

  function getPlayerHitbox() {
    const padX = player.w * 0.18;
    const padY = player.h * 0.12;
    return {
      x: player.x + padX,
      y: player.y + padY,
      w: player.w - padX * 2,
      h: player.h - padY * 1.2
    };
  }

  // --- Entities ---
  const entities = [];
  const TYPES = { BUCKET: "bucket", MONEY: "money", HAZARD: "hazard" };

  // --- Input ---
  const input = { left: false, right: false, up: false, down: false, dragging: false };

  function setTargetFromClientXY(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    player.targetX = clamp(x - player.w / 2, 0, world.w - player.w);

    const b = movementBounds();
    player.targetY = clamp(y - player.h / 2, b.yMin, b.yMax);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    input.dragging = true;
    setTargetFromClientXY(e.clientX, e.clientY);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!input.dragging) return;
    setTargetFromClientXY(e.clientX, e.clientY);
  });

  canvas.addEventListener("pointerup", () => { input.dragging = false; });
  canvas.addEventListener("pointercancel", () => { input.dragging = false; });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") input.left = true;
    if (e.key === "ArrowRight") input.right = true;
    if (e.key === "ArrowUp") input.up = true;
    if (e.key === "ArrowDown") input.down = true;
    if (e.key === "Enter" && world.gameOver) resetGame();
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") input.left = false;
    if (e.key === "ArrowRight") input.right = false;
    if (e.key === "ArrowUp") input.up = false;
    if (e.key === "ArrowDown") input.down = false;
  });

  restartBtn?.addEventListener("click", () => resetGame());

  // --- Game flow ---
  function resetGame() {
    entities.length = 0;

    world.t = 0;
    world.lastTs = 0;
    world.running = true;
    world.gameOver = false;

    world.score = 0;
    world.lives = 3;
    world.combo = 0;

    world.speed = 240;
    world.spawnBase = 0.85;
    world.spawnTimer = 0;
    world.difficultyTimer = 0;

    player.w = Math.max(70, Math.min(100, Math.floor(world.w * 0.18)));
    player.h = Math.floor(player.w * 1.30);

    player.x = (world.w - player.w) / 2;

    const b = movementBounds();
    player.y = b.yMax;

    player.targetX = player.x;
    player.targetY = player.y;

    player.vx = 0;
    player.vy = 0;
    player.invuln = 0;
    player.slowTimer = 0;

    syncHud();
    restartBtn?.classList?.add("hidden");
  }

  function endGame() {
    saveHighScoreIfNeeded();
    syncHud();
    world.gameOver = true;
    world.running = false;
    restartBtn?.classList?.remove("hidden");
  }

  // --- Hazards effects ---
  function applyHazardEffect(kind) {
    world.combo = 0;

    if (kind === "bolt") {
      player.slowTimer = Math.max(player.slowTimer, 2.5);
      damagePlayer(1, 40);
      return;
    }

    if (kind === "bomb") {
      world.score = Math.max(0, world.score - 30);
      damagePlayer(1, 70);
      saveHighScoreIfNeeded();
      syncHud();
      return;
    }

    if (kind === "saw") {
      damagePlayer(2, 120);
      return;
    }

    damagePlayer(1, 60);
  }

  function damagePlayer(amount, vibMs) {
    if (player.invuln > 0) {
      syncHud();
      return;
    }
    world.lives -= amount;
    player.invuln = 0.9;
    vibrate(vibMs);
    syncHud();
    if (world.lives <= 0) endGame();
  }

  // --- Spawning ---
  function pickHazardKind() {
    const kinds = ["spikes", "saw", "bomb", "bolt"];
    return kinds[Math.floor(Math.random() * kinds.length)];
  }

  function spawnEntity() {
    const hazardChance = clamp(0.25 + world.t * 0.02, 0.25, 0.55);
    const moneyChance = 0.35;
    const r = Math.random();

    let type;
    if (r < hazardChance) type = TYPES.HAZARD;
    else if (r < hazardChance + moneyChance) type = TYPES.MONEY;
    else type = TYPES.BUCKET;

    const base = Math.max(38, Math.min(70, Math.floor(world.w * 0.13)));
    const size = type === TYPES.BUCKET ? base : Math.floor(base * 0.92);

    const x = Math.random() * (world.w - size);
    const y = -size - 10;
    const vy = world.speed * (0.9 + Math.random() * 0.55);

    let value = 0, kind = null, drawFn = null;
    let telegraph = false;

    if (type === TYPES.BUCKET) {
      value = 20;
      kind = "kfc_bucket";
      drawFn = (c, e, t) => drawBucket(c, e, t);
    } else if (type === TYPES.MONEY) {
      value = 10;
      kind = "dollar_bill";
      drawFn = (c, e, t) => drawMoney(c, e, t);
    } else {
      kind = pickHazardKind();
      drawFn = (c, e, t) => drawHazard(c, e, t);
      telegraph = (kind === "bolt" || kind === "bomb");
    }

    entities.push({ type, x, y, w: size, h: size, vy, value, kind, drawFn, telegraph, age: 0 });
  }

  // --- Hitboxes ---
  function collidesPlayerWithEntity(e) {
    const p = getPlayerHitbox();

    if (e.type !== TYPES.HAZARD) {
      return aabb(p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h);
    }

    if (e.kind === "saw") {
      const cx = e.x + e.w / 2;
      const cy = e.y + e.h / 2;
      const r = Math.min(e.w, e.h) * 0.34;

      const closestX = clamp(cx, p.x, p.x + p.w);
      const closestY = clamp(cy, p.y, p.y + p.h);

      const dx = cx - closestX;
      const dy = cy - closestY;
      return (dx * dx + dy * dy) <= (r * r);
    }

    if (e.kind === "bolt") {
      const bx = e.x + e.w * 0.33;
      const bw = e.w * 0.34;
      const by = e.y + e.h * 0.05;
      const bh = e.h * 0.90;
      return aabb(p.x, p.y, p.w, p.h, bx, by, bw, bh);
    }

    return aabb(p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h);
  }

  // --- Update ---
  function update(dt) {
    world.t += dt;
    world.difficultyTimer += dt;

    if (world.difficultyTimer >= 1.0) {
      world.difficultyTimer = 0;
      world.speed = Math.min(780, world.speed + 9);
      world.spawnBase = Math.max(0.35, world.spawnBase - 0.012);
    }

    player.slowTimer = Math.max(0, player.slowTimer - dt);
    const slowMul = player.slowTimer > 0 ? player.slowFactor : 1.0;

    const baseSpeed = Math.max(430, world.w * 1.25);
    const keySpeed = baseSpeed * slowMul;

    if (input.left) player.targetX -= keySpeed * dt;
    if (input.right) player.targetX += keySpeed * dt;
    if (input.up) player.targetY -= keySpeed * dt * 0.65;
    if (input.down) player.targetY += keySpeed * dt * 0.65;

    const b = movementBounds();
    player.targetX = clamp(player.targetX, 0, world.w - player.w);
    player.targetY = clamp(player.targetY, b.yMin, b.yMax);

    const dx = player.targetX - player.x;
    const dy = player.targetY - player.y;

    player.vx = clamp(dx * 18, -player.maxSpeed, player.maxSpeed);
    player.vy = clamp(dy * 18, -player.maxSpeed, player.maxSpeed);

    player.x = clamp(player.x + player.vx * dt * slowMul, 0, world.w - player.w);
    player.y = clamp(player.y + player.vy * dt * slowMul, b.yMin, b.yMax);

    player.invuln = Math.max(0, player.invuln - dt);

    world.spawnTimer -= dt;
    if (world.spawnTimer <= 0) {
      spawnEntity();
      world.spawnTimer = world.spawnBase * (0.70 + Math.random() * 0.70);
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      e.age += dt;

      const isTelegraphing = e.telegraph && e.age < TELEGRAPH_TIME;
      e.y += e.vy * dt;

      if (!isTelegraphing && collidesPlayerWithEntity(e)) {
        if (e.type === TYPES.HAZARD) {
          applyHazardEffect(e.kind);
        } else {
          world.score += e.value + Math.min(30, world.combo * 2);
          world.combo += 1;
          saveHighScoreIfNeeded();
          syncHud();
        }
        entities.splice(i, 1);
        continue;
      }

      if (e.y > world.h + 140) {
        if (e.type !== TYPES.HAZARD) {
          world.combo = 0;
          syncHud();
        }
        entities.splice(i, 1);
      }
    }
  }

  // -------------------- Background: Pharmacy --------------------
  function drawPharmacyBackground() {
    ctx.fillStyle = "#0e1218";
    ctx.fillRect(0, 0, world.w, world.h);

    const wallH = world.h * 0.52;
    const floorY = wallH;

    // wall gradient
    const wg = ctx.createLinearGradient(0, 0, 0, wallH);
    wg.addColorStop(0, "#dff2eb");
    wg.addColorStop(0.55, "#e8f7f2");
    wg.addColorStop(1, "#d8efe6");
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, world.w, wallH);

    // subtle band to help sign pop
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, wallH * 0.02, world.w, wallH * 0.18);
    ctx.globalAlpha = 1;

    // sign "АПТЕКА"
    const signW = Math.min(world.w * 0.62, 560);
    const signH = Math.max(58, wallH * 0.13);
    const signX = world.w * 0.50 - signW / 2;
    const signY = wallH * 0.035;

    // glow
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#1fbf6a";
    roundRectAbs(signX - 18, signY - 14, signW + 36, signH + 28, 26);
    ctx.fill();
    ctx.globalAlpha = 1;

    // sign plate
    ctx.fillStyle = "#0f8f50";
    roundRectAbs(signX, signY, signW, signH, 20);
    ctx.fill();

    // inner shine
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#ffffff";
    roundRectAbs(signX + 10, signY + 8, signW - 20, signH * 0.42, 16);
    ctx.fill();
    ctx.globalAlpha = 1;

    // border
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(255,255,255,0.65)";
    roundRectAbs(signX, signY, signW, signH, 20);
    ctx.stroke();

    // sign text
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const fz = Math.max(26, Math.floor(signH * 0.58));
    ctx.font = `900 ${fz}px system-ui`;

    ctx.lineWidth = 10;
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeText("АПТЕКА", signX + signW / 2, signY + signH / 2);

    ctx.fillStyle = "#ffffff";
    ctx.fillText("АПТЕКА", signX + signW / 2, signY + signH / 2);

    // small left cross (простая неонка)
    const crossX = world.w * 0.12;
    const crossY = wallH * 0.22;
    const crossS = Math.max(52, Math.min(92, world.w * 0.10));
    drawNeonCrossSimple(crossX, crossY, crossS, 0.65);

    // big LED cross (ВАУ аптечно)
    const bigS = Math.max(150, Math.min(260, world.w * 0.30));
    const bigX = world.w * 0.78;
    const bigY = wallH * 0.30;
    drawLedCross(bigX, bigY, bigS, 1.0);

    // counter
    const deskH = wallH * 0.18;
    const deskY = wallH - deskH;

    ctx.fillStyle = "#cfe1da";
    ctx.fillRect(0, deskY, world.w, deskH);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, deskY, world.w, 6);
    ctx.globalAlpha = 1;

    drawPharmacistSilhouette(world.w * 0.54, deskY - deskH * 0.05, deskH * 1.05);
    drawCashAndTerminal(world.w * 0.78, deskY + deskH * 0.18, deskH * 0.70);

    // ticker
    const tickerH = Math.max(30, wallH * 0.07);
    const tickerY = Math.max(10, deskY - tickerH - 10);

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#1fbf6a";
    roundRectAbs(world.w * 0.08, tickerY, world.w * 0.84, tickerH, 14);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    roundRectAbs(world.w * 0.08, tickerY, world.w * 0.84, tickerH, 14);
    ctx.clip();

    const text = "Скидки • Иммуномодуляторы • ";
    ctx.font = `900 ${Math.floor(tickerH * 0.58)}px system-ui`;
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    const speed = 140;
    const trackW = world.w * 0.84;
    const offset = (world.t * speed) % trackW;

    ctx.fillText(text + text + text + text, world.w * 0.08 + 14 - offset, tickerY + tickerH / 2);
    ctx.restore();
    ctx.globalAlpha = 1;

    // floor tiles
    ctx.fillStyle = "#dfe7ee";
    ctx.fillRect(0, floorY, world.w, world.h - floorY);

    const tile = Math.max(36, Math.floor(world.w * 0.08));
    const scroll = (world.t * 90) % tile;

    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 2;

    for (let y = floorY - tile; y < world.h + tile; y += tile) {
      const yy = y + scroll;
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(world.w, yy);
      ctx.stroke();
    }
    for (let x = 0; x < world.w + tile; x += tile) {
      ctx.beginPath();
      ctx.moveTo(x, floorY);
      ctx.lineTo(x, world.h);
      ctx.stroke();
    }

    // vignette
    const g = ctx.createRadialGradient(
      world.w / 2, world.h * 0.65, world.w * 0.1,
      world.w / 2, world.h * 0.65, world.w * 0.9
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.18)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, world.w, world.h);
  }

  // Простая неонка для маленького креста
  function drawNeonCrossSimple(cx, cy, size, intensity) {
    const s = size;
    const arm = s * 0.22;
    const thick = s * 0.16;
    const pulse = 0.75 + 0.25 * Math.sin(world.t * 3.4 + cx * 0.01);
    const glowA = 0.16 + 0.14 * pulse * intensity;

    ctx.save();
    ctx.translate(cx, cy);

    ctx.globalAlpha = glowA;
    ctx.fillStyle = "#1fbf6a";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.22 * pulse * intensity;
    ctx.fillStyle = "#1fbf6a";
    roundRectAbsLocal(-thick / 2, -arm - thick / 2, thick, arm * 2 + thick, thick * 0.60);
    ctx.fill();
    roundRectAbsLocal(-arm - thick / 2, -thick / 2, arm * 2 + thick, thick, thick * 0.60);
    ctx.fill();

    ctx.globalAlpha = 0.90;
    ctx.fillStyle = "#19b35f";
    roundRectAbsLocal(-thick / 2, -arm - thick / 2, thick, arm * 2 + thick, thick * 0.60);
    ctx.fill();
    roundRectAbsLocal(-arm - thick / 2, -thick / 2, arm * 2 + thick, thick, thick * 0.60);
    ctx.fill();

    ctx.globalAlpha = 0.50 + 0.25 * pulse;
    ctx.fillStyle = "#d8fff0";
    roundRectAbsLocal(-thick * 0.28, -arm - thick * 0.28, thick * 0.56, arm * 2 + thick * 0.56, thick * 0.45);
    ctx.fill();
    roundRectAbsLocal(-arm - thick * 0.28, -thick * 0.28, arm * 2 + thick * 0.56, thick * 0.56, thick * 0.45);
    ctx.fill();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // LED-крест: пиксели + сканирующая полоса
  function drawLedCross(cx, cy, size, intensity) {
    const s = size;
    const arm = s * 0.24;
    const thick = s * 0.18;

    const pulse = 0.70 + 0.30 * Math.sin(world.t * 2.2 + cx * 0.01);
    const glow = 0.16 + 0.22 * pulse * intensity;

    const grid = Math.max(8, Math.floor(s / 14)); // плотность пикселей
    const dot = Math.max(2.2, s / (grid * 4.2));
    const gap = dot * 0.65;

    // области креста в локальных координатах
    const vRect = { x: -thick / 2, y: -arm - thick / 2, w: thick, h: arm * 2 + thick };
    const hRect = { x: -arm - thick / 2, y: -thick / 2, w: arm * 2 + thick, h: thick };

    // helper: точка внутри креста
    function insideCross(x, y) {
      const inV = x >= vRect.x && x <= vRect.x + vRect.w && y >= vRect.y && y <= vRect.y + vRect.h;
      const inH = x >= hRect.x && x <= hRect.x + hRect.w && y >= hRect.y && y <= hRect.y + hRect.h;
      return inV || inH;
    }

    // helper: расстояние до центра (для мягкого градиента яркости)
    function normDist(x, y) {
      const d = Math.sqrt(x * x + y * y);
      return clamp(d / (s * 0.75), 0, 1);
    }

    ctx.save();
    ctx.translate(cx, cy);

    // общий неоновый ореол
    ctx.globalAlpha = glow * 0.75;
    ctx.fillStyle = "#1fbf6a";
    ctx.beginPath();
    ctx.arc(0, 0, s * 0.82, 0, Math.PI * 2);
    ctx.fill();

    // подложка панели (темнее, чтобы пиксели читались)
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "rgba(10, 22, 16, 0.95)";
    roundRectAbsLocal(vRect.x - 10, vRect.y - 10, vRect.w + 20, vRect.h + 20, 22);
    ctx.fill();
    roundRectAbsLocal(hRect.x - 10, hRect.y - 10, hRect.w + 20, hRect.h + 20, 22);
    ctx.fill();

    // клип по форме креста, чтобы пиксели не лезли наружу
    ctx.globalAlpha = 1;
    ctx.beginPath();
    roundRectAbsLocal(vRect.x, vRect.y, vRect.w, vRect.h, thick * 0.55);
    roundRectAbsLocal(hRect.x, hRect.y, hRect.w, hRect.h, thick * 0.55);
    ctx.clip("evenodd");

    // сканирующая полоса (движется сверху вниз)
    const scanH = s * 0.16;
    const scanY = ((world.t * 0.55) % 1) * (s * 1.20) - (s * 0.60);
    const scanTop = scanY - scanH / 2;
    const scanBot = scanY + scanH / 2;

    // рисуем пиксели
    const span = s * 0.85;
    const min = -span;
    const max = span;
    const step = dot + gap;

    for (let y = min; y <= max; y += step) {
      for (let x = min; x <= max; x += step) {
        if (!insideCross(x, y)) continue;

        const d = normDist(x, y);
        let a = (0.55 + 0.35 * pulse) * (1 - d * 0.75);

        // усиление яркости внутри скан-полосы
        if (y >= scanTop && y <= scanBot) a *= 1.65;

        // небольшое мерцание “LED”
        a *= 0.85 + 0.15 * Math.sin(world.t * 12 + (x + y) * 0.08);

        // цвет пикселя: зелёный LED + белая сердцевина
        ctx.globalAlpha = clamp(a, 0, 1) * 0.95;
        ctx.fillStyle = "#19b35f";
        ctx.beginPath();
        ctx.arc(x, y, dot, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = clamp(a, 0, 1) * 0.45;
        ctx.fillStyle = "#d8fff0";
        ctx.beginPath();
        ctx.arc(x - dot * 0.18, y - dot * 0.18, dot * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // контур креста
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(3, s * 0.018);
    roundRectAbsLocal(vRect.x, vRect.y, vRect.w, vRect.h, thick * 0.55);
    ctx.stroke();
    roundRectAbsLocal(hRect.x, hRect.y, hRect.w, hRect.h, thick * 0.55);
    ctx.stroke();

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPharmacistSilhouette(centerX, headY, scale) {
    const s = Math.max(60, Math.min(scale, 160));
    const headR = s * 0.18;
    const neckW = s * 0.20;
    const neckH = s * 0.10;
    const bodyW = s * 0.70;
    const bodyH = s * 0.55;

    const x = centerX;
    const y = headY;

    ctx.save();
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = "#0b0f14";

    ctx.beginPath();
    ctx.arc(x, y, headR, 0, Math.PI * 2);
    ctx.fill();

    roundRectAbs(x - neckW / 2, y + headR * 0.65, neckW, neckH, 10);
    ctx.fill();

    roundRectAbs(x - bodyW / 2, y + headR + neckH * 0.5, bodyW, bodyH, 28);
    ctx.fill();

    ctx.globalAlpha = 0.10;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x - headR * 0.35, y - headR * 0.15, headR * 0.55, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCashAndTerminal(x, y, scale) {
    const s = Math.max(52, Math.min(scale, 150));

    const baseW = s * 0.85;
    const baseH = s * 0.38;
    const baseX = x - baseW / 2;
    const baseY = y + s * 0.30;

    ctx.save();

    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    roundRectAbs(baseX + 4, baseY + 6, baseW, baseH, 14);
    ctx.fill();

    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#1a2330";
    roundRectAbs(baseX, baseY, baseW, baseH, 14);
    ctx.fill();

    const topW = s * 0.62;
    const topH = s * 0.28;
    const topX = x - topW * 0.62;
    const topY = y + s * 0.10;

    ctx.fillStyle = "#2a3445";
    roundRectAbs(topX, topY, topW, topH, 14);
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = "#9cc9ff";
    roundRectAbs(topX + topW * 0.16, topY + topH * 0.18, topW * 0.68, topH * 0.46, 10);
    ctx.fill();
    ctx.globalAlpha = 0.95;

    const termW = s * 0.28;
    const termH = s * 0.32;
    const termX = x + baseW * 0.18;
    const termY = y + s * 0.06;

    ctx.fillStyle = "#2a3445";
    roundRectAbs(termX, termY, termW, termH, 12);
    ctx.fill();

    ctx.globalAlpha = 0.70;
    ctx.fillStyle = "#bfe3ff";
    roundRectAbs(termX + termW * 0.14, termY + termH * 0.12, termW * 0.72, termH * 0.38, 10);
    ctx.fill();

    ctx.globalAlpha = 0.55;
    ctx.fillStyle = "#ffffff";
    const dots = 3;
    for (let r = 0; r < dots; r++) {
      for (let c = 0; c < dots; c++) {
        const dx = termX + termW * 0.22 + c * (termW * 0.22);
        const dy = termY + termH * 0.62 + r * (termH * 0.10);
        ctx.beginPath();
        ctx.arc(dx, dy, Math.max(1.5, s * 0.012), 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  // --- Rounded rect helpers ---
  function roundRectAbs(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function roundRectAbsLocal(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function roundRectLocal(ctx2, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx2.beginPath();
    ctx2.moveTo(x + rr, y);
    ctx2.arcTo(x + w, y, x + w, y + h, rr);
    ctx2.arcTo(x + w, y + h, x, y + h, rr);
    ctx2.arcTo(x, y + h, x, y, rr);
    ctx2.arcTo(x, y, x + w, y, rr);
    ctx2.closePath();
  }

  // -------------------- Player render --------------------
  function drawPlayer() {
    const x = player.x, y = player.y, w = player.w, h = player.h;
    const flashing = player.invuln > 0 && Math.floor(world.t * 14) % 2 === 0;
    const slowed = player.slowTimer > 0;

    ctx.save();
    ctx.globalAlpha = flashing ? 0.50 : 1;

    const bodyX = x + w * 0.18;
    const bodyY = y + h * 0.35;
    const bodyW = w * 0.64;
    const bodyH = h * 0.56;

    ctx.globalAlpha *= 0.95;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    roundRectAbs(bodyX + 3, bodyY + 6, bodyW, bodyH, 18);
    ctx.fill();

    ctx.globalAlpha = flashing ? 0.55 : 1;
    ctx.fillStyle = "#ffffff";
    roundRectAbs(bodyX, bodyY, bodyW, bodyH, 18);
    ctx.fill();

    ctx.fillStyle = "#d9dbe6";
    roundRectAbs(bodyX + bodyW * 0.30, bodyY + bodyH * 0.05, bodyW * 0.40, bodyH * 0.12, 12);
    ctx.fill();

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const shirtFont = Math.max(16, Math.floor(w * 0.26));
    ctx.font = `900 ${shirtFont}px system-ui`;
    ctx.lineWidth = Math.max(3, Math.floor(w * 0.06));
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeText("РМ", x + w * 0.5, bodyY + bodyH * 0.52);
    ctx.fillStyle = "#111823";
    ctx.fillText("РМ", x + w * 0.5, bodyY + bodyH * 0.52);

    const faceR = Math.floor(w * 0.28);
    const fx = x + w * 0.5;
    const fy = y + h * 0.22;

    ctx.globalAlpha = flashing ? 0.55 : 1;
    ctx.fillStyle = "#0b0f14";
    ctx.beginPath();
    ctx.arc(fx, fy, faceR + 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.arc(fx, fy, faceR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(IMG.face, fx - faceR, fy - faceR, faceR * 2, faceR * 2);
    ctx.restore();

    if (slowed && !flashing) {
      const pulse = 0.35 + 0.25 * Math.sin(world.t * 12);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(160, 220, 255, 1)";
      ctx.lineWidth = Math.max(3, Math.floor(w * 0.05));
      ctx.beginPath();
      ctx.arc(fx, fy, faceR + 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.globalAlpha = flashing ? 0.55 : 1;
    ctx.fillStyle = "#111823";
    const legW = Math.floor(w * 0.16);
    const legH = Math.floor(h * 0.16);
    const step = Math.sin(world.t * 14) * 6 * (slowed ? 0.6 : 1);
    ctx.fillRect(x + Math.floor(w * 0.30), y + h - legH, legW, legH + step);
    ctx.fillRect(x + Math.floor(w * 0.58), y + h - legH, legW, legH - step);

    ctx.restore();
  }

  function drawEntities() {
    for (const e of entities) if (e.drawFn) e.drawFn(ctx, e, world.t);
  }

  function drawGameOverOverlay() {
    ctx.save();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.fillStyle = "#e9eef5";
    ctx.font = "800 34px system-ui";
    ctx.fillText("GAME OVER", world.w / 2, world.h * 0.45);

    ctx.font = "600 16px system-ui";
    ctx.globalAlpha = 0.90;
    ctx.fillText(`Счёт: ${world.score}   •   Рекорд: ${world.highScore}`, world.w / 2, world.h * 0.45 + 34);
    ctx.fillText("Нажми Enter или «Заново»", world.w / 2, world.h * 0.45 + 60);

    ctx.restore();
  }

  // -------------------- Items --------------------
  function drawBucket(ctx2, e, t) {
    const w = e.w, h = e.h;
    const wobble = Math.sin(t * 6 + e.x * 0.02) * (w * 0.02);

    ctx2.save();
    ctx2.translate(e.x + w / 2, e.y + h / 2);
    ctx2.rotate(wobble * 0.02);
    ctx2.translate(-w / 2, -h / 2);

    ctx2.globalAlpha = 0.22;
    ctx2.fillStyle = "#000";
    roundRectLocal(ctx2, w * 0.12, h * 0.12, w * 0.76, h * 0.80, Math.max(10, w * 0.18));
    ctx2.fill();
    ctx2.globalAlpha = 1;

    drawWingsPile(ctx2, w, h);

    const bucketX = w * 0.14, bucketY = h * 0.22, bucketW = w * 0.72, bucketH = h * 0.70;

    roundRectLocal(ctx2, bucketX, bucketY, bucketW, bucketH, Math.max(12, w * 0.18));
    ctx2.save();
    ctx2.clip();

    ctx2.fillStyle = "#fbfbff";
    ctx2.fillRect(bucketX, bucketY, bucketW, bucketH);

    const stripes = 4;
    for (let i = 0; i < stripes; i++) {
      ctx2.fillStyle = i % 2 === 0 ? "#cf1f22" : "#fbfbff";
      const sx = bucketX + (i * bucketW) / stripes;
      ctx2.fillRect(sx, bucketY, bucketW / stripes, bucketH);
    }

    ctx2.fillStyle = "#e8e9f2";
    ctx2.fillRect(bucketX, bucketY, bucketW, bucketH * 0.14);
    ctx2.restore();

    ctx2.strokeStyle = "rgba(0,0,0,0.45)";
    ctx2.lineWidth = Math.max(2, w * 0.045);
    roundRectLocal(ctx2, bucketX, bucketY, bucketW, bucketH, Math.max(12, w * 0.18));
    ctx2.stroke();

    const fontSize = Math.max(14, Math.floor(w * 0.28));
    ctx2.font = `900 ${fontSize}px system-ui`;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";

    const tx = w * 0.50;
    const ty = h * 0.62;

    ctx2.lineWidth = Math.max(3, Math.floor(w * 0.06));
    ctx2.strokeStyle = "rgba(0,0,0,0.35)";
    ctx2.strokeText("KFC", tx, ty);
    ctx2.fillStyle = "#111823";
    ctx2.fillText("KFC", tx, ty);

    ctx2.restore();
  }

  function drawWingsPile(ctx2, w, h) {
    const topY = h * 0.12;
    const centerX = w * 0.5;
    const count = 6;

    for (let i = 0; i < count; i++) {
      const px = centerX + (i - (count - 1) / 2) * (w * 0.10);
      const py = topY + (i % 2) * (h * 0.05);
      const rw = w * 0.20;
      const rh = h * 0.13;

      ctx2.save();
      ctx2.translate(px, py);
      ctx2.rotate((i - 2.5) * 0.08);

      ctx2.fillStyle = "#c7772b";
      ctx2.beginPath();
      ctx2.ellipse(0, 0, rw * 0.55, rh * 0.55, 0, 0, Math.PI * 2);
      ctx2.fill();

      ctx2.globalAlpha = 0.45;
      ctx2.fillStyle = "#7f3f10";
      ctx2.beginPath();
      ctx2.ellipse(-rw * 0.08, -rh * 0.05, rw * 0.30, rh * 0.22, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.globalAlpha = 1;

      ctx2.globalAlpha = 0.16;
      ctx2.fillStyle = "#fff";
      ctx2.beginPath();
      ctx2.ellipse(rw * 0.10, -rh * 0.10, rw * 0.22, rh * 0.18, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.globalAlpha = 1;

      ctx2.restore();
    }
  }

  function drawMoney(ctx2, e, t) {
    const w = e.w, h = e.h;
    const tilt = Math.sin(t * 7 + e.x * 0.03) * 0.06;

    ctx2.save();
    ctx2.translate(e.x + w / 2, e.y + h / 2);
    ctx2.rotate(tilt);
    ctx2.translate(-w / 2, -h / 2);

    ctx2.globalAlpha = 0.22;
    ctx2.fillStyle = "#000";
    roundRectLocal(ctx2, w * 0.07, h * 0.22, w * 0.86, h * 0.58, Math.max(10, w * 0.12));
    ctx2.fill();
    ctx2.globalAlpha = 1;

    const bx = w * 0.06, by = h * 0.23, bw = w * 0.88, bh = h * 0.56;

    ctx2.fillStyle = "#2fbe69";
    roundRectLocal(ctx2, bx, by, bw, bh, Math.max(10, w * 0.12));
    ctx2.fill();

    ctx2.strokeStyle = "rgba(0,0,0,0.50)";
    ctx2.lineWidth = Math.max(2, w * 0.04);
    roundRectLocal(ctx2, bx, by, bw, bh, Math.max(10, w * 0.12));
    ctx2.stroke();

    ctx2.globalAlpha = 0.35;
    ctx2.strokeStyle = "#0a5a2f";
    ctx2.lineWidth = Math.max(1, w * 0.016);
    ctx2.beginPath();
    for (let i = 1; i <= 4; i++) {
      const yy = by + (i * bh) / 5;
      ctx2.moveTo(bx + bw * 0.10, yy);
      ctx2.lineTo(bx + bw * 0.90, yy);
    }
    ctx2.stroke();
    ctx2.globalAlpha = 1;

    const fontSize = Math.max(16, Math.floor(w * 0.40));
    ctx2.font = `900 ${fontSize}px system-ui`;
    ctx2.textAlign = "center";
    ctx2.textBaseline = "middle";

    const tx = w * 0.50;
    const ty = h * 0.51;

    ctx2.lineWidth = Math.max(3, Math.floor(w * 0.07));
    ctx2.strokeStyle = "rgba(255,255,255,0.55)";
    ctx2.strokeText("$", tx, ty);

    ctx2.fillStyle = "#063a1f";
    ctx2.fillText("$", tx, ty);

    ctx2.globalAlpha = 0.12;
    ctx2.fillStyle = "#fff";
    roundRectLocal(ctx2, bx + bw * 0.08, by + bh * 0.10, bw * 0.46, bh * 0.22, 10);
    ctx2.fill();
    ctx2.globalAlpha = 1;

    ctx2.restore();
  }

  // -------------------- Hazards --------------------
  function drawHazard(ctx2, e, t) {
    const isTelegraphing = e.telegraph && e.age < TELEGRAPH_TIME;
    if (e.kind === "spikes") return drawSpikes(ctx2, e);
    if (e.kind === "saw") return drawSaw(ctx2, e, t);
    if (e.kind === "bomb") return drawBomb(ctx2, e, t, isTelegraphing);
    if (e.kind === "bolt") return drawBoltGold(ctx2, e, t, isTelegraphing);
    return drawSpikes(ctx2, e);
  }

  function drawSpikes(ctx2, e) {
    ctx2.save();
    ctx2.translate(e.x, e.y);

    ctx2.fillStyle = "#2a2f3a";
    roundRectLocal(ctx2, 0, e.h * 0.55, e.w, e.h * 0.45, 10);
    ctx2.fill();

    const n = 5;
    const top = e.h * 0.55;
    ctx2.fillStyle = "#cfd6e6";
    ctx2.beginPath();
    for (let i = 0; i < n; i++) {
      const x0 = (i * e.w) / n;
      const x1 = ((i + 1) * e.w) / n;
      const mid = (x0 + x1) / 2;
      ctx2.moveTo(x0, top);
      ctx2.lineTo(mid, 0);
      ctx2.lineTo(x1, top);
    }
    ctx2.closePath();
    ctx2.fill();

    ctx2.restore();
  }

  function drawSaw(ctx2, e, t) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const r = Math.min(e.w, e.h) * 0.45;
    const teeth = 12;
    const angle = t * 8;

    ctx2.save();
    ctx2.translate(cx, cy);
    ctx2.rotate(angle);

    ctx2.fillStyle = "#d7deef";
    ctx2.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i * Math.PI * 2) / teeth;
      const a1 = ((i + 0.5) * Math.PI * 2) / teeth;
      const a2 = ((i + 1) * Math.PI * 2) / teeth;
      ctx2.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
      ctx2.lineTo(Math.cos(a1) * (r * 1.15), Math.sin(a1) * (r * 1.15));
      ctx2.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
    }
    ctx2.closePath();
    ctx2.fill();

    ctx2.fillStyle = "#8b93a8";
    ctx2.beginPath();
    ctx2.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.fillStyle = "#0b0f14";
    ctx2.beginPath();
    ctx2.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.restore();
  }

  function drawBomb(ctx2, e, t, telegraphing) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const r = Math.min(e.w, e.h) * 0.42;

    ctx2.save();

    if (telegraphing) {
      const pulse = 0.35 + 0.35 * Math.sin(t * 18);
      ctx2.globalAlpha = pulse;
      ctx2.fillStyle = "rgba(255, 120, 70, 1)";
      ctx2.beginPath();
      ctx2.arc(cx, cy, r * 1.35, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.globalAlpha = 1;
    }

    ctx2.fillStyle = "#1b1f28";
    ctx2.beginPath();
    ctx2.arc(cx, cy, r, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.globalAlpha = 0.25;
    ctx2.fillStyle = "#ffffff";
    ctx2.beginPath();
    ctx2.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx2.fill();
    ctx2.globalAlpha = 1;

    ctx2.fillStyle = "#3a4152";
    roundRectLocal(ctx2, cx - r * 0.35, cy - r * 0.95, r * 0.7, r * 0.3, 6);
    ctx2.fill();

    ctx2.strokeStyle = "#caa24a";
    ctx2.lineWidth = Math.max(3, r * 0.12);
    ctx2.lineCap = "round";
    ctx2.beginPath();
    ctx2.moveTo(cx, cy - r * 0.95);
    ctx2.quadraticCurveTo(cx + r * 0.7, cy - r * 1.2, cx + r * 0.9, cy - r * 0.65);
    ctx2.stroke();

    const spark = 0.6 + 0.4 * Math.sin(t * 16);
    ctx2.fillStyle = `rgba(255, 200, 60, ${0.9 * spark})`;
    ctx2.beginPath();
    ctx2.arc(cx + r * 0.9, cy - r * 0.65, r * 0.18 * spark, 0, Math.PI * 2);
    ctx2.fill();

    ctx2.restore();
  }

  function drawBoltGold(ctx2, e, t, telegraphing) {
    const pulse = 0.70 + 0.30 * Math.sin(t * 10);

    ctx2.save();
    ctx2.translate(e.x, e.y);

    if (telegraphing) {
      const glow = 0.30 + 0.35 * Math.sin(t * 20);
      ctx2.globalAlpha = glow;
      ctx2.fillStyle = "rgba(246, 211, 107, 1)";
      ctx2.fillRect(e.w * 0.10, e.h * 0.05, e.w * 0.80, e.h * 0.90);
      ctx2.globalAlpha = 1;
    }

    ctx2.globalAlpha = 0.95;
    ctx2.fillStyle = `rgba(246, 211, 107, ${pulse})`;

    ctx2.beginPath();
    ctx2.moveTo(e.w * 0.55, 0);
    ctx2.lineTo(e.w * 0.25, e.h * 0.55);
    ctx2.lineTo(e.w * 0.52, e.h * 0.55);
    ctx2.lineTo(e.w * 0.35, e.h);
    ctx2.lineTo(e.w * 0.78, e.h * 0.42);
    ctx2.lineTo(e.w * 0.52, e.h * 0.42);
    ctx2.closePath();
    ctx2.fill();

    ctx2.globalAlpha = 0.80;
    ctx2.strokeStyle = "rgba(0,0,0,0.35)";
    ctx2.lineWidth = Math.max(2, e.w * 0.05);
    ctx2.stroke();

    ctx2.globalAlpha = 0.16;
    ctx2.fillStyle = "#fff";
    ctx2.fillRect(e.w * 0.18, e.h * 0.12, e.w * 0.64, e.h * 0.20);

    ctx2.restore();
  }

  // -------------------- Loop --------------------
  function loop(ts) {
    if (!world.lastTs) world.lastTs = ts;
    const dt = Math.min(0.033, (ts - world.lastTs) / 1000);
    world.lastTs = ts;

    if (world.running) update(dt);

    drawPharmacyBackground();
    drawEntities();
    drawPlayer();
    if (world.gameOver) drawGameOverOverlay();

    requestAnimationFrame(loop);
  }

  document.addEventListener("gesturestart", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    resizeCanvas();
    if (!world.gameOver) {
      player.w = Math.max(70, Math.min(100, Math.floor(world.w * 0.18)));
      player.h = Math.floor(player.w * 1.30);
      player.x = clamp(player.x, 0, world.w - player.w);

      const b = movementBounds();
      player.y = clamp(player.y, b.yMin, b.yMax);
      player.targetX = clamp(player.targetX, 0, world.w - player.w);
      player.targetY = clamp(player.targetY, b.yMin, b.yMax);
    }
  });

  // --- Start ---
  resizeCanvas();
  loadHighScore();
  syncHud();

  loadImages(assets)
    .then(() => {
      resetGame();
      requestAnimationFrame(loop);
    })
    .catch((err) => {
      console.error(err);
      ctx.fillStyle = "#0b0f14";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#fff";
      ctx.font = "16px system-ui";
      ctx.fillText("Ошибка загрузки ассетов. Проверь assets/face.png", 20, 40);
    });
})();
