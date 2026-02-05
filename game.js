(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });

  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const comboEl = document.getElementById("combo");
  const restartBtn = document.getElementById("btn-restart");

  // -------------------- World / HiDPI --------------------
  const world = {
    w: 0,
    h: 0,
    t: 0,
    lastTs: 0,
    running: false,
    gameOver: false,

    score: 0,
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
    livesEl.textContent = String(world.lives);
    comboEl.textContent = String(world.combo);
  }

  // -------------------- Player --------------------
  const player = {
    x: 0,
    y: 0,
    w: 72,
    h: 84,
    targetX: 0,
    vx: 0,
    maxSpeed: 1400,
    invuln: 0
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

    player.w = Math.max(62, Math.min(90, Math.floor(world.w * 0.16)));
    player.h = Math.floor(player.w * 1.18);

    player.x = (world.w - player.w) / 2;
    player.y = world.h - player.h - Math.max(28, Math.floor(world.h * 0.06));
    player.targetX = player.x;
    player.vx = 0;
    player.invuln = 0;

    syncHud();
    restartBtn.classList.add("hidden");
  }

  function endGame() {
    world.gameOver = true;
    world.running = false;
    restartBtn.classList.remove("hidden");
  }

  function hurtPlayer() {
    if (player.invuln > 0) return;
    world.lives -= 1;
    world.combo = 0;
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

    const base = Math.max(34, Math.min(62, Math.floor(world.w * 0.12)));
    const size = type === TYPES.BUCKET ? base : Math.floor(base * 0.92);

    const x = Math.random() * (world.w - size);
    const y = -size - 10;
    const vy = world.speed * (0.9 + Math.random() * 0.55);

    let value = 0, damage = 0, kind = null, drawFn = null;

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
      damage = 1;
      kind = pickHazardKind();
      drawFn = (ctx, e, t) => drawHazard(ctx, e, t);
    }

    entities.push({ type, x, y, w: size, h: size, vy, value, damage, kind, drawFn });
  }

  // -------------------- Update --------------------
  function update(dt) {
    world.t += dt;
    world.difficultyTimer += dt;

    if (world.difficultyTimer >= 1.0) {
      world.difficultyTimer = 0;
      world.speed = Math.min(720, world.speed + 8);
      world.spawnBase = Math.max(0.38, world.spawnBase - 0.01);
    }

    const keySpeed = Math.max(420, world.w * 1.2);
    if (input.left) player.targetX -= keySpeed * dt;
    if (input.right) player.targetX += keySpeed * dt;
    player.targetX = clamp(player.targetX, 0, world.w - player.w);

    const dx = player.targetX - player.x;
    player.vx = clamp(dx * 18, -player.maxSpeed, player.maxSpeed);
    player.x = clamp(player.x + player.vx * dt, 0, world.w - player.w);

    player.y = world.h - player.h - Math.max(28, Math.floor(world.h * 0.06));
    player.invuln = Math.max(0, player.invuln - dt);

    world.spawnTimer -= dt;
    if (world.spawnTimer <= 0) {
      spawnEntity();
      world.spawnTimer = world.spawnBase * (0.70 + Math.random() * 0.70);
    }

    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      e.y += e.vy * dt;

      if (aabb(player.x, player.y, player.w, player.h, e.x, e.y, e.w, e.h)) {
        if (e.type === TYPES.HAZARD) {
          hurtPlayer();
        } else {
          world.score += e.value + Math.min(25, world.combo * 2);
          world.combo += 1;
          syncHud();
        }
        entities.splice(i, 1);
        continue;
      }

      if (e.y > world.h + 120) {
        if (e.type !== TYPES.HAZARD) {
          world.combo = 0;
          syncHud();
        }
        entities.splice(i, 1);
      }
    }
  }

  // -------------------- Render --------------------
  function drawBackground() {
    ctx.fillStyle = "#0b0f14";
    ctx.fillRect(0, 0, world.w, world.h);

    const count = 60;
    for (let i = 0; i < count; i++) {
      const x = (i * 97) % world.w;
      const y = ((i * 173) + (world.t * 30)) % world.h;
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#dfe8ff";
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPlayer() {
    const bodyX = player.x;
    const bodyY = player.y;
    const w = player.w;
    const h = player.h;

    const flashing = player.invuln > 0 && Math.floor(world.t * 14) % 2 === 0;

    ctx.save();
    ctx.globalAlpha = flashing ? 0.45 : 1;

    ctx.fillStyle = "#1f2a3a";
    roundRectPath(bodyX, bodyY, w, h, Math.min(18, Math.floor(w * 0.25)));
    ctx.fill();

    const facePad = Math.floor(w * 0.12);
    const faceSize = Math.floor(w - facePad * 2);
    const fx = bodyX + facePad;
    const fy = bodyY + facePad;

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#0b0f14";
    roundRectPath(fx - 3, fy - 3, faceSize + 6, faceSize + 6, 14);
    ctx.fill();

    ctx.save();
    roundRectPath(fx, fy, faceSize, faceSize, 12);
    ctx.clip();
    ctx.drawImage(IMG.face, fx, fy, faceSize, faceSize);
    ctx.restore();

    ctx.fillStyle = "#111823";
    const legW = Math.floor(w * 0.18);
    const legH = Math.floor(h * 0.18);
    const step = Math.sin(world.t * 14) * 6;
    ctx.fillRect(bodyX + Math.floor(w * 0.28), bodyY + h - legH, legW, legH + step);
    ctx.fillRect(bodyX + Math.floor(w * 0.58), bodyY + h - legH, legW, legH - step);

    ctx.restore();
  }

  function drawEntities() {
    for (const e of entities) {
      if (e.drawFn) e.drawFn(ctx, e, world.t);
    }
  }

  function drawGameOverOverlay() {
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, world.w, world.h);
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.fillStyle = "#e9eef5";
    ctx.font = "800 34px system-ui";
    ctx.fillText("GAME OVER", world.w / 2, world.h * 0.45);

    ctx.font = "500 16px system-ui";
    ctx.globalAlpha = 0.85;
    ctx.fillText(`Счёт: ${world.score}`, world.w / 2, world.h * 0.45 + 34);
    ctx.fillText("Нажми Enter или «Заново»", world.w / 2, world.h * 0.45 + 60);

    ctx.restore();
  }

  // -------------------- Procedural Art (bucket, money, hazards) --------------------
  function drawHazard(ctx, e, t) {
    switch (e.kind) {
      case "spikes": return drawSpikes(ctx, e);
      case "saw":    return drawSaw(ctx, e, t);
      case "bomb":   return drawBomb(ctx, e, t);
      case "bolt":   return drawBolt(ctx, e, t);
      default:       return drawSpikes(ctx, e);
    }
  }

  // --- KFC bucket with wings + "kfc" text (процедурно, без брендинговых логотипов) ---
  // Важное: я рисую ведро с надписью "kfc" как текст, не копируя фирменный логотип/шрифт.
  function drawBucket(ctx, e, t) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const wobble = Math.sin(t * 6 + x * 0.02) * (w * 0.03);

    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(wobble * 0.02);
    ctx.translate(-w / 2, -h / 2);

    // тень
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#000";
    roundRectLocal(ctx, w * 0.12, h * 0.10, w * 0.76, h * 0.82, Math.max(10, w * 0.18));
    ctx.fill();
    ctx.globalAlpha = 1;

    // ведро (красно-белые полосы)
    const bucketX = w * 0.16, bucketY = h * 0.18, bucketW = w * 0.68, bucketH = h * 0.72;
    roundRectLocal(ctx, bucketX, bucketY, bucketW, bucketH, Math.max(12, w * 0.18));
    ctx.save();
    ctx.clip();

    // фон ведра
    ctx.fillStyle = "#f6f7fb";
    ctx.fillRect(bucketX, bucketY, bucketW, bucketH);

    // красные полосы
    const stripes = 4;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#d0322f" : "#f6f7fb";
      const sx = bucketX + (i * bucketW) / stripes;
      ctx.fillRect(sx, bucketY, bucketW / stripes, bucketH);
    }

    // верхняя кромка
    ctx.fillStyle = "#e9eaf1";
    ctx.fillRect(bucketX, bucketY, bucketW, bucketH * 0.12);

    ctx.restore();

    // обводка ведра
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(2, w * 0.04);
    roundRectLocal(ctx, bucketX, bucketY, bucketW, bucketH, Math.max(12, w * 0.18));
    ctx.stroke();

    // надпись "kfc"
    ctx.fillStyle = "#111823";
    ctx.font = `800 ${Math.floor(w * 0.22)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("kfc", w * 0.50, h * 0.62);

    // крылышки сверху (кучка)
    drawWingsPile(ctx, w, h);

    ctx.restore();
  }

  function drawWingsPile(ctx, w, h) {
    // стилизованные крылышки: овалы/капли тёплого цвета
    const topAreaY = h * 0.06;
    const centerX = w * 0.5;

    const count = 5;
    for (let i = 0; i < count; i++) {
      const px = centerX + (i - 2) * (w * 0.11);
      const py = topAreaY + (i % 2) * (h * 0.06);
      const rw = w * 0.18;
      const rh = h * 0.12;

      // “жареная” текстура простая
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate((i - 2) * 0.08);

      ctx.fillStyle = "#c7772b";
      ctx.beginPath();
      ctx.ellipse(0, 0, rw * 0.55, rh * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#8b4a16";
      ctx.beginPath();
      ctx.ellipse(-rw * 0.10, -rh * 0.05, rw * 0.28, rh * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // блик
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.ellipse(rw * 0.10, -rh * 0.10, rw * 0.22, rh * 0.18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();
    }
  }

  // --- Green dollar bill with "$" (процедурно) ---
  function drawMoney(ctx, e, t) {
    const x = e.x, y = e.y, w = e.w, h = e.h;
    const tilt = Math.sin(t * 7 + x * 0.03) * 0.06;

    ctx.save();
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(tilt);
    ctx.translate(-w / 2, -h / 2);

    // тень
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#000";
    roundRectLocal(ctx, w * 0.08, h * 0.20, w * 0.84, h * 0.60, Math.max(10, w * 0.12));
    ctx.fill();
    ctx.globalAlpha = 1;

    const billX = w * 0.06, billY = h * 0.22, billW = w * 0.88, billH = h * 0.56;

    // купюра
    ctx.fillStyle = "#39b36a";
    roundRectLocal(ctx, billX, billY, billW, billH, Math.max(10, w * 0.12));
    ctx.fill();

    // рамка
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = Math.max(2, w * 0.035);
    roundRectLocal(ctx, billX, billY, billW, billH, Math.max(10, w * 0.12));
    ctx.stroke();

    // внутренние линии “орнамент”
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = "#0b5a2f";
    ctx.lineWidth = Math.max(1, w * 0.015);
    ctx.beginPath();
    for (let i = 1; i <= 4; i++) {
      const yy = billY + (i * billH) / 5;
      ctx.moveTo(billX + billW * 0.10, yy);
      ctx.lineTo(billX + billW * 0.90, yy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // круги по углам
    ctx.fillStyle = "rgba(11,90,47,0.35)";
    const r = Math.min(billW, billH) * 0.12;
    drawCircle(ctx, billX + billW * 0.16, billY + billH * 0.30, r);
    drawCircle(ctx, billX + billW * 0.84, billY + billH * 0.30, r);
    drawCircle(ctx, billX + billW * 0.16, billY + billH * 0.70, r);
    drawCircle(ctx, billX + billW * 0.84, billY + billH * 0.70, r);

    // большой "$" по центру
    ctx.fillStyle = "#083a1f";
    ctx.font = `900 ${Math.floor(w * 0.34)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", w * 0.50, h * 0.50);

    // небольшой блик
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#fff";
    roundRectLocal(ctx, billX + billW * 0.08, billY + billH * 0.12, billW * 0.45, billH * 0.22, 10);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.restore();
  }

  function drawCircle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // --- Hazards ---
  function roundRectLocal(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawSpikes(ctx, e) {
    ctx.save();
    ctx.translate(e.x, e.y);

    ctx.fillStyle = "#2a2f3a";
    roundRectLocal(ctx, 0, e.h * 0.55, e.w, e.h * 0.45, 10);
    ctx.fill();

    const n = 5;
    const top = e.h * 0.55;
    ctx.fillStyle = "#cfd6e6";
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x0 = (i * e.w) / n;
      const x1 = ((i + 1) * e.w) / n;
      const mid = (x0 + x1) / 2;
      ctx.moveTo(x0, top);
      ctx.lineTo(mid, 0);
      ctx.lineTo(x1, top);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  function drawSaw(ctx, e, t) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const r = Math.min(e.w, e.h) * 0.45;
    const teeth = 12;
    const angle = t * 8;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.fillStyle = "#d7deef";
    ctx.beginPath();
    for (let i = 0; i < teeth; i++) {
      const a0 = (i * Math.PI * 2) / teeth;
      const a1 = ((i + 0.5) * Math.PI * 2) / teeth;
      const a2 = ((i + 1) * Math.PI * 2) / teeth;
      ctx.lineTo(Math.cos(a0) * r, Math.sin(a0) * r);
      ctx.lineTo(Math.cos(a1) * (r * 1.15), Math.sin(a1) * (r * 1.15));
      ctx.lineTo(Math.cos(a2) * r, Math.sin(a2) * r);
    }
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#8b93a8";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#0b0f14";
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBomb(ctx, e, t) {
    const cx = e.x + e.w / 2;
    const cy = e.y + e.h / 2;
    const r = Math.min(e.w, e.h) * 0.42;

    ctx.save();

    ctx.fillStyle = "#1b1f28";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.25;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx - r * 0.25, cy - r * 0.25, r * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = "#3a4152";
    roundRectLocal(ctx, cx - r * 0.35, cy - r * 0.95, r * 0.7, r * 0.3, 6);
    ctx.fill();

    ctx.strokeStyle = "#caa24a";
    ctx.lineWidth = Math.max(3, r * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r * 0.95);
    ctx.quadraticCurveTo(cx + r * 0.7, cy - r * 1.2, cx + r * 0.9, cy - r * 0.65);
    ctx.stroke();

    const spark = 0.6 + 0.4 * Math.sin(t * 16);
    ctx.fillStyle = `rgba(255, 200, 60, ${0.9 * spark})`;
    ctx.beginPath();
    ctx.arc(cx + r * 0.9, cy - r * 0.65, r * 0.18 * spark, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawBolt(ctx, e, t) {
    const pulse = 0.75 + 0.25 * Math.sin(t * 10);

    ctx.save();
    ctx.translate(e.x, e.y);

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = `rgba(160, 220, 255, ${pulse})`;

    ctx.beginPath();
    ctx.moveTo(e.w * 0.55, 0);
    ctx.lineTo(e.w * 0.25, e.h * 0.55);
    ctx.lineTo(e.w * 0.52, e.h * 0.55);
    ctx.lineTo(e.w * 0.35, e.h);
    ctx.lineTo(e.w * 0.78, e.h * 0.42);
    ctx.lineTo(e.w * 0.52, e.h * 0.42);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.20;
    ctx.fillRect(e.w * 0.15, e.h * 0.1, e.w * 0.7, e.h * 0.8);

    ctx.restore();
  }

  // -------------------- Loop --------------------
  function loop(ts) {
    if (!world.lastTs) world.lastTs = ts;
    const dt = Math.min(0.033, (ts - world.lastTs) / 1000);
    world.lastTs = ts;

    if (world.running) update(dt);

    drawBackground();
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
      player.w = Math.max(62, Math.min(90, Math.floor(world.w * 0.16)));
      player.h = Math.floor(player.w * 1.18);
      player.x = clamp(player.x, 0, world.w - player.w);
      player.targetX = clamp(player.targetX, 0, world.w - player.w);
    }
  });

  // -------------------- Start --------------------
  resizeCanvas();

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
