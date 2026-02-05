(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const highScoreEl = document.getElementById("highscore");
  const livesEl = document.getElementById("lives");
  const comboEl = document.getElementById("combo");
  const restartBtn = document.getElementById("btn-restart");

  // -------------------- World / HiDPI --------------------
  const STORAGE_KEY_HS = "silver_peisohovich_highscore";

  const world = {
    w: 0,
    h: 0,
    t: 0,
    lastTs: 0,
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

  // -------------------- Assets (только лицо) --------------------
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

  // -------------------- Helpers --------------------
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

  // -------------------- Player --------------------
  const player = {
    x: 0,
    y: 0,
    w: 72,
    h: 96,
    targetX: 0,
    vx: 0,
    maxSpeed: 1400,
    invuln: 0,

    // статус-эффекты
    slowTimer: 0,     // сек
    slowFactor: 0.55, // скорость * factor
  };

  // -------------------- Entities --------------------
  const entities = []; // {type,x,y,w,h,vy,value,damage,kind,drawFn}
  const TYPES = {
    BUCKET: "bucket",
    MONEY: "money",
    HAZARD: "hazard",
  };

  // -------------------- Input --------------------
  const input = { left: false, right: false, dragging: false };

  function setTargetFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    player.targetX = clamp(x - player.w / 2, 0, world.w - player.w);
  }

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    input.dragging = true;
    setTargetFromClientX(e.clientX);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!input.dragging) return;
    setTargetFromClientX(e.clientX);
  });

  canvas.addEventListener("pointerup", () => { input.dragging = false; });
  canvas.addEventListener("pointercancel", () => { input.dragging = false; });

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") input.left = true;
    if (e.key === "ArrowRight") input.right = true;
    if (e.key === "Enter" && world.gameOver) resetGame();
  });

  window.addEventListener("keyup", (e) => {
    if (e.key === "ArrowLeft") input.left = false;
    if (e.key === "ArrowRight") input.right = false;
  });

  restartBtn.addEventListener("click", () => resetGame());

  // -------------------- Game Flow --------------------
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
    player.y = world.h - player.h - Math.max(28, Math.floor(world.h * 0.06));
    player.targetX = player.x;
    player.vx = 0;
    player.invuln = 0;

    player.slowTimer = 0;

    syncHud();
    restartBtn.classList.add("hidden");
  }

  function endGame() {
    saveHighScoreIfNeeded();
    syncHud();
    world.gameOver = true;
    world.running = false;
    restartBtn.classList.remove("hidden");
  }

  // -------------------- Effects (пункт 3) --------------------
  function applyHazardEffect(kind) {
    // при ударе сбрасываем комбо (всегда)
    world.combo = 0;

    if (kind === "bolt") {
      // замедление
      player.slowTimer = Math.max(player.slowTimer, 2.5);
      // урон как обычный (1)
      damagePlayer(1);
      return;
    }

    if (kind === "bomb") {
      // штраф по очкам
      world.score = Math.max(0, world.score - 30);
      // урон обычный (1)
      damagePlayer(1);
      saveHighScoreIfNeeded();
      syncHud();
      return;
    }

    if (kind === "saw") {
      // двойной урон
      damagePlayer(2);
      return;
    }

    // spikes и прочее
    damagePlayer(1);
  }

  function damagePlayer(amount) {
    if (player.invuln > 0) {
      syncHud();
      return;
    }

    world.lives -= amount;
    player.invuln = 0.9;

    syncHud();

    if (world.lives <= 0) endGame();
  }

  // -------------------- Spawning --------------------
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

    if (type === TYPES.BUCKET) {
      value = 20;
      kind = "kfc_bucket";
      drawFn = (ctx, e, t) => drawBucket(ctx, e, t);
    }

    if (type === TYPES.MONEY) {
      value = 10;
      kind = "dollar_bill";
      drawFn = (ctx, e, t) => drawMoney(ctx, e, t);
    }

    if (type === TYPES.HAZARD) {
      kind = pickHazardKind();
      drawFn = (ctx, e, t) => drawHazard(ctx, e, t);
    }

    entities.push({ type, x, y, w: size, h: size, vy, value, kind, drawFn });
  }

  // -------------------- Update --------------------
  function update(dt) {
    world.t += dt;
    world.difficultyTimer += dt;

    if (world.difficultyTimer >= 1.0) {
      world.difficultyTimer = 0;
      world.speed = Math.min(780, world.speed + 9);
      world.spawnBase = Math.max(0.35, world.spawnBase - 0.012);
    }

    // статус замедления
    player.slowTimer = Math.max(0, player.slowTimer - dt);
    const slowMul = player.slowTimer > 0 ? player.slowFactor : 1.0;

    // движение игрока
    const baseSpeed = Math.max(430, world.w * 1.25);
    const keySpeed = baseSpeed * slowMul;

    if (input.left) player.targetX -= keySpeed * dt;
    if (input.right) player.targetX += keySpeed * dt;
    player.targetX = clamp(player.targetX, 0, world.w - player.w);

    const dx = player.targetX - player.x;
    player.vx = clamp(dx * 18, -player.maxSpeed, player.maxSpeed);
    player.x = clamp(player.x + player.vx * dt * slowMul, 0, world.w - player.w);

    player.y = world.h - player.h - Math.max(28, Math.floor(world.h * 0.06));
    player.invuln = Math.max(0, player.invuln - dt);

    // спавн
    world.spawnTimer -= dt;
    if (world.spawnTimer <= 0) {
      spawnEntity();
      world.spawnTimer = world.spawnBase * (0.70 + Math.random() * 0.70);
    }

    // entities
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      e.y += e.vy * dt;

      if (aabb(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
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

  // -------------------- Background: спортзал --------------------
  function drawGymBackground() {
    // базовый градиент зала
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, world.w, world.h);

    // верхняя стена
    const wallH = world.h * 0.46;
    const floorY = wallH;

    // стена
    ctx.fillStyle = "#1a2330";
    ctx.fillRect(0, 0, world.w, wallH);

    // окна
    const winCount = Math.max(3, Math.floor(world.w / 140));
    const winW = world.w / winCount * 0.70;
    const winH = wallH * 0.30;
    const winY = wallH * 0.10;

    for (let i = 0; i < winCount; i++) {
      const slotW = world.w / winCount;
      const wx = i * slotW + (slotW - winW) / 2;

      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "#0f1622";
      roundRectAbs(wx, winY, winW, winH, 14);
      ctx.fill();

      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "#9cc9ff";
      roundRectAbs(wx + 6, winY + 6, winW - 12, winH - 12, 12);
      ctx.fill();

      // переплёты
      ctx.globalAlpha = 0.30;
      ctx.strokeStyle = "#0b0f14";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(wx + winW / 2, winY + 6);
      ctx.lineTo(wx + winW / 2, winY + winH - 6);
      ctx.stroke();

      ctx.globalAlpha = 1;
    }

    // баскетбольное кольцо (стилизованно) справа
    const hoopX = world.w * 0.82;
    const hoopY = wallH * 0.58;
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "#0f1622";
    roundRectAbs(hoopX - 70, hoopY - 55, 140, 90, 16);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#e9eef5";
    ctx.lineWidth = 3;
    ctx.strokeRect(hoopX - 38, hoopY - 35, 76, 55);

    ctx.strokeStyle = "#ff6b3d";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(hoopX, hoopY + 20, 22, 0, Math.PI * 2);
    ctx.stroke();

    // пол
    ctx.fillStyle = "#1a1410";
    ctx.fillRect(0, floorY, world.w, world.h - floorY);

    // “паркетные” полосы (скролл вниз)
    const plankH = Math.max(22, Math.floor(world.h * 0.045));
    const scroll = (world.t * 140) % plankH;
    for (let y = floorY - plankH; y < world.h + plankH; y += plankH) {
      const yy = y + scroll;
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = "#3a2a1f";
      ctx.fillRect(0, yy, world.w, 2);
    }
    ctx.globalAlpha = 1;

    // разметка площадки
    ctx.strokeStyle = "rgba(230, 230, 230, 0.35)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    // центральная линия
    ctx.moveTo(0, floorY + (world.h - floorY) * 0.25);
    ctx.lineTo(world.w, floorY + (world.h - floorY) * 0.25);

    // круг
    const cx = world.w * 0.5;
    const cy = floorY + (world.h - floorY) * 0.55;
    const r = Math.min(world.w, world.h) * 0.14;
    ctx.moveTo(cx + r, cy);
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }

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

  // -------------------- Player Render: круглое лицо + белая футболка "РМ" --------------------
  function drawPlayer() {
    const x = player.x;
    const y = player.y;
    const w = player.w;
    const h = player.h;

    const flashing = player.invuln > 0 && Math.floor(world.t * 14) % 2 === 0;
    const slowed = player.slowTimer > 0;

    ctx.save();
    ctx.globalAlpha = flashing ? 0.50 : 1;

    // тело (футболка)
    const bodyX = x + w * 0.18;
    const bodyY = y + h * 0.35;
    const bodyW = w * 0.64;
    const bodyH = h * 0.56;

    // тень
    ctx.globalAlpha *= 0.95;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    roundRectAbs(bodyX + 3, bodyY + 6, bodyW, bodyH, 18);
    ctx.fill();

    // белая футболка
    ctx.globalAlpha = flashing ? 0.55 : 1;
    ctx.fillStyle = "#f6f7fb";
    roundRectAbs(bodyX, bodyY, bodyW, bodyH, 18);
    ctx.fill();

    // ворот
    ctx.fillStyle = "#d9dbe6";
    roundRectAbs(bodyX + bodyW * 0.30, bodyY + bodyH * 0.05, bodyW * 0.40, bodyH * 0.12, 12);
    ctx.fill();

    // надпись "РМ"
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const shirtFont = Math.max(16, Math.floor(w * 0.26));
    ctx.font = `900 ${shirtFont}px system-ui`;
    // обводка, чтобы читаемо было всегда
    ctx.lineWidth = Math.max(3, Math.floor(w * 0.06));
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.strokeText("РМ", x + w * 0.5, bodyY + bodyH * 0.52);
    ctx.fillStyle = "#111823";
    ctx.fillText("РМ", x + w * 0.5, bodyY + bodyH * 0.52);

    // лицо (круг с фото)
    const faceR = Math.floor(w * 0.28);
    const fx = x + w * 0.5;
    const fy = y + h * 0.22;

    // рамка лица
    ctx.globalAlpha = flashing ? 0.55 : 1;
    ctx.fillStyle = "#0b0f14";
    ctx.beginPath();
    ctx.arc(fx, fy, faceR + 4, 0, Math.PI * 2);
    ctx.fill();

    // фото в круге
    ctx.save();
    ctx.beginPath();
    ctx.arc(fx, fy, faceR, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(IMG.face, fx - faceR, fy - faceR, faceR * 2, faceR * 2);
    ctx.restore();

    // если замедлен — лёгкий голубой “аурный” ободок
    if (slowed && !flashing) {
      const pulse = 0.35 + 0.25 * Math.sin(world.t * 12);
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = "rgba(160, 220, 255, 1)";
      ctx.lineWidth = Math.max(3, Math.floor(w * 0.05));
      ctx.beginPath();
      ctx.arc(fx, fy, faceR + 10, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ноги (анимация)
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
    for (const e of entities) {
      if (e.drawFn) e.drawFn(ctx, e, world.t);
    }
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

  // -------------------- Procedural Art (четкие bucket/money + hazards) --------------------
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

  // Ведро с крылышками + "KFC" (текст жирный+обводка для читаемости)
  function drawBucket(ctx2, e, t) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const wobble = Math.sin(t * 6 + x * 0.02) * (w * 0.02);

    ctx2.save();
    ctx2.translate(x + w / 2, y + h / 2);
    ctx2.rotate(wobble * 0.02);
    ctx2.translate(-w / 2, -h / 2);

    // тень
    ctx2.globalAlpha = 0.22;
    ctx2.fillStyle = "#000";
    roundRectLocal(ctx2, w * 0.12, h * 0.12, w * 0.76, h * 0.80, Math.max(10, w * 0.18));
    ctx2.fill();
    ctx2.globalAlpha = 1;

    // крылышки сверху (чуть больше и контрастнее)
    drawWingsPile(ctx2, w, h);

    // ведро
    const bucketX = w * 0.14, bucketY = h * 0.22, bucketW = w * 0.72, bucketH = h * 0.70;

    roundRectLocal(ctx2, bucketX, bucketY, bucketW, bucketH, Math.max(12, w * 0.18));
    ctx2.save();
    ctx2.clip();

    // белая база
    ctx2.fillStyle = "#fbfbff";
    ctx2.fillRect(bucketX, bucketY, bucketW, bucketH);

    // красные полосы (контрастнее)
    const stripes = 4;
    for (let i = 0; i < stripes; i++) {
      ctx2.fillStyle = i % 2 === 0 ? "#cf1f22" : "#fbfbff";
      const sx = bucketX + (i * bucketW) / stripes;
      ctx2.fillRect(sx, bucketY, bucketW / stripes, bucketH);
    }

    // верхняя кромка
    ctx2.fillStyle = "#e8e9f2";
    ctx2.fillRect(bucketX, bucketY, bucketW, bucketH * 0.14);

    ctx2.restore();

    // обводка ведра
    ctx2.strokeStyle = "rgba(0,0,0,0.45)";
    ctx2.lineWidth = Math.max(2, w * 0.045);
    roundRectLocal(ctx2, bucketX, bucketY, bucketW, bucketH, Math.max(12, w * 0.18));
    ctx2.stroke();

    // надпись "KFC" — крупно, жирно, с обводкой
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

      // основа
      ctx2.fillStyle = "#c7772b";
      ctx2.beginPath();
      ctx2.ellipse(0, 0, rw * 0.55, rh * 0.55, 0, 0, Math.PI * 2);
      ctx2.fill();

      // “корочка”
      ctx2.globalAlpha = 0.45;
      ctx2.fillStyle = "#7f3f10";
      ctx2.beginPath();
      ctx2.ellipse(-rw * 0.08, -rh * 0.05, rw * 0.30, rh * 0.22, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.globalAlpha = 1;

      // блик
      ctx2.globalAlpha = 0.16;
      ctx2.fillStyle = "#fff";
      ctx2.beginPath();
      ctx2.ellipse(rw * 0.10, -rh * 0.10, rw * 0.22, rh * 0.18, 0, 0, Math.PI * 2);
      ctx2.fill();
      ctx2.globalAlpha = 1;

      ctx2.restore();
    }
  }

  // Купюра с большим "$" (четко: жирный + stroke)
  function drawMoney(ctx2, e, t) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const tilt = Math.sin(t * 7 + x * 0.03) * 0.06;

    ctx2.save();
    ctx2.translate(x + w / 2, y + h / 2);
    ctx2.rotate(tilt);
    ctx2.translate(-w / 2, -h / 2);

    // тень
    ctx2.globalAlpha = 0.22;
    ctx2.fillStyle = "#000";
    roundRectLocal(ctx2, w * 0.07, h * 0.22, w * 0.86, h * 0.58, Math.max(10, w * 0.12));
    ctx2.fill();
    ctx2.globalAlpha = 1;

    const bx = w * 0.06, by = h * 0.23, bw = w * 0.88, bh = h * 0.56;

    // купюра
    ctx2.fillStyle = "#2fbe69";
    roundRectLocal(ctx2, bx, by, bw, bh, Math.max(10, w * 0.12));
    ctx2.fill();

    // рамка (контраст)
    ctx2.strokeStyle = "rgba(0,0,0,0.50)";
    ctx2.lineWidth = Math.max(2, w * 0.04);
    roundRectLocal(ctx2, bx, by, bw, bh, Math.max(10, w * 0.12));
    ctx2.stroke();

    // внутренний “орнамент” — линии
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

    // большой "$" — максимально читаемо
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

    // блик
    ctx2.globalAlpha = 0.12;
    ctx2.fillStyle = "#fff";
    roundRectLocal(ctx2, bx + bw * 0.08, by + bh * 0.10, bw * 0.46, bh * 0.22, 10);
    ctx2.fill();
    ctx2.globalAlpha = 1;

    ctx2.restore();
  }

  // Hazards
  function drawHazard(ctx2, e, t) {
    switch (e.kind) {
      case "spikes": return drawSpikes(ctx2, e);
      case "saw":    return drawSaw(ctx2, e, t);
      case "bomb":   return drawBomb(ctx2, e, t);
      case "bolt":   return drawBolt(ctx2, e, t);
      default:       return drawSpikes(ctx2, e);
    }
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

  function drawBomb(ctx2, e, t) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const r = Math.min(e.w, e.h) * 0.42;

    ctx2.save();

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

  function drawBolt(ctx2, e, t) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 10);

    ctx2.save();
    ctx2.translate(e.x, e.y);

    ctx2.globalAlpha = 0.9;
    ctx2.fillStyle = `rgba(160, 220, 255, ${pulse})`;

    ctx2.beginPath();
    ctx2.moveTo(e.w * 0.55, 0);
    ctx2.lineTo(e.w * 0.25, e.h * 0.55);
    ctx2.lineTo(e.w * 0.52, e.h * 0.55);
    ctx2.lineTo(e.w * 0.35, e.h);
    ctx2.lineTo(e.w * 0.78, e.h * 0.42);
    ctx2.lineTo(e.w * 0.52, e.h * 0.42);
    ctx2.closePath();
    ctx2.fill();

    ctx2.globalAlpha = 0.20;
    ctx2.fillRect(e.w * 0.15, e.h * 0.1, e.w * 0.7, e.h * 0.8);

    ctx2.restore();
  }

  // -------------------- Loop --------------------
  function loop(ts) {
    if (!world.lastTs) world.lastTs = ts;
    const dt = Math.min(0.033, (ts - world.lastTs) / 1000);
    world.lastTs = ts;

    if (world.running) update(dt);

    drawGymBackground();
    drawEntities();
    drawPlayer();
    if (world.gameOver) drawGameOverOverlay();

    requestAnimationFrame(loop);
  }

  // iOS: предотвращаем жесты масштаба
  document.addEventListener("gesturestart", (e) => e.preventDefault());

  window.addEventListener("resize", () => {
    resizeCanvas();
    if (!world.gameOver) {
      player.w = Math.max(70, Math.min(100, Math.floor(world.w * 0.18)));
      player.h = Math.floor(player.w * 1.30);
      player.x = clamp(player.x, 0, world.w - player.w);
      player.targetX = clamp(player.targetX, 0, world.w - player.w);
    }
  });

  // -------------------- Start --------------------
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
