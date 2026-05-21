const { DEFAULTS, DIRECTIONS, Simulation } = window.PixelAgents;

const SPRITE_SOURCE_SIZE = 256;
const VIEW_SIZE = 9;
let SPRITE_DRAW_SIZE = 88;
let BAR_HEIGHT = 6;
let BAR_GAP = 5;
let TILE_SIZE = SPRITE_DRAW_SIZE + BAR_HEIGHT + BAR_GAP;

const canvas = document.querySelector("#worldCanvas");
const ctx = canvas.getContext("2d", { alpha: false });
const effectCanvas = document.querySelector("#effectCanvas");
const effectCtx = effectCanvas.getContext("2d");
const swordDom = document.createElement("div");
swordDom.className = "sword-dom";
swordDom.hidden = true;
document.querySelector(".canvas-wrap").append(swordDom);
const spriteImages = createSprites();

const ui = {
  statusLine: document.querySelector("#statusLine"),
  resetWorld: document.querySelector("#resetWorld"),
  brushSelect: document.querySelector("#brushSelect"),
  turnStat: document.querySelector("#turnStat"),
  agentStat: document.querySelector("#agentStat"),
  foodStat: document.querySelector("#foodStat"),
  wallStat: document.querySelector("#wallStat"),
  selectionPanel: document.querySelector("#selectionPanel"),
  aiPanel: document.querySelector("#aiPanel"),
  waitOrder: document.querySelector("#waitOrder"),
  amountDialog: document.querySelector("#amountDialog"),
  amountForm: document.querySelector("#amountForm"),
  amountTitle: document.querySelector("#amountTitle"),
  amountMessage: document.querySelector("#amountMessage"),
  amountInput: document.querySelector("#amountInput"),
  amountOptions: document.querySelector("#amountOptions"),
  amountMax: document.querySelector("#amountMax"),
  amountCancel: document.querySelector("#amountCancel"),
};

let sim = Simulation.createDefault();
let playerId = null;
let inspected = null;
let hoverCell = null;
let viewport = { x: 0, y: 0, cols: 1, rows: 1 };
let isAnimating = false;
let activeOverlayAction = null;
let amountRequest = null;
let mateKeyHeld = false;
let latestPlayerObservation = null;

function choosePlayer() {
  const first = sim.agents.values().next().value ?? null;
  playerId = first?.id ?? null;
  inspected = playerId ? { type: "agent", id: playerId } : null;
  if (first) {
    first.genetics.hue = 198;
    setupPlayerStart(first);
  }
}

function setupPlayerStart(controlled) {
  const center = nearestEmptyCell(Math.floor(sim.width / 2), Math.floor(sim.height / 2));
  if (!center) return;
  moveAgentTo(controlled, center.x, center.y);

  clearCell(controlled.x - 1, controlled.y, { keepPlayer: true });
  clearCell(controlled.x + 1, controlled.y, { keepPlayer: true });
  sim.addAgent(controlled.x - 1, controlled.y);
  sim.addBlock(controlled.x + 1, controlled.y, { kind: "food", amount: DEFAULTS.startingFoodPerBlock });
}

function clearCell(x, y, options = {}) {
  if (!sim.inBounds(x, y)) return;
  const agent = sim.getAgentAt(x, y);
  if (agent && (!options.keepPlayer || agent.id !== playerId)) sim.removeAgent(agent, "setup");
  sim.removeBlock(x, y);
}

function nearestEmptyCell(originX, originY) {
  for (let radius = 0; radius < 8; radius += 1) {
    for (let y = originY - radius; y <= originY + radius; y += 1) {
      for (let x = originX - radius; x <= originX + radius; x += 1) {
        if (sim.isEmptyGround(x, y)) return { x, y };
      }
    }
  }
  return sim.randomEmptyCell();
}

function moveAgentTo(agent, x, y) {
  if (!sim.isEmptyGround(x, y)) return false;
  sim.agentGrid[sim.index(agent.x, agent.y)] = null;
  agent.x = x;
  agent.y = y;
  sim.agentGrid[sim.index(agent.x, agent.y)] = agent.id;
  return true;
}

function player() {
  return playerId ? sim.agents.get(playerId) ?? null : null;
}

function resizeCanvasForDisplay() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * dpr));
  const height = Math.max(1, Math.floor(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  if (effectCanvas.width !== width || effectCanvas.height !== height) {
    effectCanvas.width = width;
    effectCanvas.height = height;
  }
  TILE_SIZE = Math.max(1, Math.min(canvas.width, canvas.height) / VIEW_SIZE);
  BAR_HEIGHT = Math.max(4, TILE_SIZE * 0.06);
  BAR_GAP = Math.max(3, TILE_SIZE * 0.05);
  SPRITE_DRAW_SIZE = Math.max(1, TILE_SIZE - BAR_HEIGHT - BAR_GAP);
}

function updateViewport() {
  const controlled = player();
  viewport.cols = VIEW_SIZE;
  viewport.rows = VIEW_SIZE;
  const centerX = controlled?.x ?? Math.floor(sim.width / 2);
  const centerY = controlled?.y ?? Math.floor(sim.height / 2);
  viewport.x = centerX - Math.floor(viewport.cols / 2);
  viewport.y = centerY - Math.floor(viewport.rows / 2);
}

function draw() {
  resizeCanvasForDisplay();
  updateViewport();

  ctx.fillStyle = "#10130f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  drawGridFloor(viewport);

  for (let y = viewport.y; y < viewport.y + viewport.rows && y < sim.height; y += 1) {
    for (let x = viewport.x; x < viewport.x + viewport.cols && x < sim.width; x += 1) {
      const block = sim.getBlockAt(x, y);
      if (!block) continue;
      const sx = (x - viewport.x) * TILE_SIZE;
      const sy = (y - viewport.y) * TILE_SIZE;
      if (block.kind === "food") drawFoodBar(block, sx, sy);
      drawSprite(block.kind === "food" ? spriteImages.food : spriteImages.wall, sx, sy);
    }
  }

  for (const agent of sim.agents.values()) {
    if (!isVisible(agent.x, agent.y)) continue;
    const sx = (agent.x - viewport.x) * TILE_SIZE;
    const sy = (agent.y - viewport.y) * TILE_SIZE;
    drawEnemyHealthBar(agent, sx, sy);
    drawSprite(agent.id === playerId ? spriteImages.player : spriteImages.enemy, sx, sy);
    if (agent.id === playerId) drawHeldBlockIcon(agent.heldBlock, sx, sy);
    if (agent.id === playerId) drawSelectionBox(sx, sy, "#ffffff", 2);
  }

  const inspectedEntity = resolveInspection();
  if (inspectedEntity?.x !== undefined && isVisible(inspectedEntity.x, inspectedEntity.y)) {
    const sx = (inspectedEntity.x - viewport.x) * TILE_SIZE;
    const sy = (inspectedEntity.y - viewport.y) * TILE_SIZE;
    drawSelectionBox(sx, sy, "#71d08a", 1);
  }

  if (hoverCell && isVisible(hoverCell.x, hoverCell.y)) {
    drawSelectionBox((hoverCell.x - viewport.x) * TILE_SIZE, (hoverCell.y - viewport.y) * TILE_SIZE, "#efc94c", 1);
  }

  if (activeOverlayAction?.type === "attack") drawActionEffect({ viewport }, activeOverlayAction, activeOverlayAction.progress ?? 0);
}

function drawGridFloor(view) {
  ctx.fillStyle = "#182019";
  for (let y = 0; y < view.rows; y += 1) {
    for (let x = 0; x < view.cols; x += 1) {
      const worldX = view.x + x;
      const worldY = view.y + y;
      if (!sim.inBounds(worldX, worldY)) {
        drawOutOfBoundsCell(x * TILE_SIZE, y * TILE_SIZE);
      } else if ((x + y + view.x + view.y) % 2 === 0) {
        ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
      }
    }
  }
}

function drawOutOfBoundsCell(x, y) {
  ctx.fillStyle = "#24292e";
  ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
  ctx.lineWidth = 1;
  for (let offset = -TILE_SIZE; offset < TILE_SIZE; offset += Math.max(8, TILE_SIZE / 5)) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + TILE_SIZE);
    ctx.lineTo(x + offset + TILE_SIZE, y);
    ctx.stroke();
  }
}

function drawSprite(sprite, x, y) {
  const spriteY = y + BAR_HEIGHT + BAR_GAP;
  ctx.drawImage(sprite, x, spriteY, SPRITE_DRAW_SIZE, SPRITE_DRAW_SIZE);
}

function drawHeldBlockIcon(block, x, y) {
  if (!block) return;
  const size = Math.round(SPRITE_DRAW_SIZE / 2);
  const spriteY = y + BAR_HEIGHT + BAR_GAP;
  const iconX = x + Math.round((SPRITE_DRAW_SIZE - size) / 2);
  const iconY = spriteY + 1;
  ctx.save();
  if (block.kind === "food") drawMiniBurger(iconX, iconY, size);
  else drawMiniBrick(iconX, iconY, size);
  ctx.restore();
}

function drawMiniBurger(x, y, size) {
  ctx.fillStyle = "#5b2e1a";
  roundedRect(ctx, x + 1, y + size * 0.54, size - 2, size * 0.2, size * 0.08);
  ctx.fill();
  ctx.fillStyle = "#69bd45";
  ctx.fillRect(x + 2, y + size * 0.43, size - 4, size * 0.12);
  ctx.fillStyle = "#f0c84d";
  ctx.fillRect(x + 3, y + size * 0.64, size - 6, size * 0.12);
  const bun = ctx.createLinearGradient(0, y, 0, y + size);
  bun.addColorStop(0, "#ffe19a");
  bun.addColorStop(1, "#c1782f");
  ctx.fillStyle = bun;
  roundedRect(ctx, x, y + size * 0.18, size, size * 0.28, size * 0.18);
  ctx.fill();
  roundedRect(ctx, x + 1, y + size * 0.74, size - 2, size * 0.18, size * 0.08);
  ctx.fill();
  ctx.strokeStyle = "#5a3218";
  ctx.lineWidth = 1;
  roundedRect(ctx, x, y + size * 0.18, size, size * 0.74, size * 0.12);
  ctx.stroke();
}

function drawMiniBrick(x, y, size) {
  ctx.fillStyle = "#6a211e";
  roundedRect(ctx, x, y, size, size, 3);
  ctx.fill();
  ctx.strokeStyle = "#37110f";
  ctx.lineWidth = 2;
  roundedRect(ctx, x, y, size, size, 3);
  ctx.stroke();
  ctx.strokeStyle = "#e0826b";
  ctx.lineWidth = 1;
  for (let row = 1; row < 4; row += 1) {
    const rowY = y + (size * row) / 4;
    ctx.beginPath();
    ctx.moveTo(x + 2, rowY);
    ctx.lineTo(x + size - 2, rowY);
    ctx.stroke();
  }
  for (let row = 0; row < 4; row += 1) {
    const splitX = x + (row % 2 === 0 ? size * 0.5 : size * 0.28);
    const top = y + (size * row) / 4 + 2;
    const bottom = y + (size * (row + 1)) / 4 - 2;
    ctx.beginPath();
    ctx.moveTo(splitX, top);
    ctx.lineTo(splitX, bottom);
    ctx.stroke();
  }
}

function drawSelectionBox(x, y, color, width) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(x + 0.5, y + BAR_HEIGHT + BAR_GAP + 0.5, SPRITE_DRAW_SIZE - 1, SPRITE_DRAW_SIZE - 1);
}

function drawEnemyHealthBar(agent, x, y) {
  drawBar(x, y, agent.health / agent.maxHealth, "#e35d52", "#441c1a");
}

function drawFoodBar(block, x, y) {
  drawBar(x, y, block.amount / DEFAULTS.startingFoodPerBlock, "#efc94c", "#3d3219");
}

function drawBar(x, y, ratio, fill, track) {
  const width = SPRITE_DRAW_SIZE;
  const clamped = clamp(ratio, 0, 1);
  ctx.fillStyle = track;
  ctx.fillRect(x, y, width, BAR_HEIGHT);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, Math.round(width * clamped), BAR_HEIGHT);
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.fillRect(x, y, width, 1);
}

function createSprites() {
  return {
    player: makeSprite(drawPlayerFace),
    enemy: makeSprite(drawEnemyFace),
    food: makeSprite(drawBurger),
    wall: makeSprite(drawBrickWall),
  };
}

function makeSprite(drawer) {
  const sprite = document.createElement("canvas");
  sprite.width = SPRITE_SOURCE_SIZE;
  sprite.height = SPRITE_SOURCE_SIZE;
  const spriteCtx = sprite.getContext("2d");
  drawer(spriteCtx);
  return sprite;
}

function drawPlayerFace(spriteCtx) {
  spriteCtx.clearRect(0, 0, SPRITE_SOURCE_SIZE, SPRITE_SOURCE_SIZE);
  drawSoftShadow(spriteCtx, 54, 214, 148, 22);

  const face = spriteCtx.createRadialGradient(94, 82, 22, 126, 124, 112);
  face.addColorStop(0, "#d9fbff");
  face.addColorStop(0.68, "#8fe8ff");
  face.addColorStop(1, "#4fb9df");
  spriteCtx.fillStyle = face;
  spriteCtx.beginPath();
  spriteCtx.arc(128, 122, 96, 0, Math.PI * 2);
  spriteCtx.fill();

  spriteCtx.strokeStyle = "#1e7ea2";
  spriteCtx.lineWidth = 9;
  spriteCtx.stroke();

  spriteCtx.fillStyle = "rgba(255, 255, 255, 0.58)";
  spriteCtx.beginPath();
  spriteCtx.ellipse(91, 74, 26, 14, -0.45, 0, Math.PI * 2);
  spriteCtx.fill();

  drawEye(spriteCtx, 92, 108, "#103a52");
  drawEye(spriteCtx, 164, 108, "#103a52");

  spriteCtx.strokeStyle = "#174764";
  spriteCtx.lineWidth = 12;
  spriteCtx.lineCap = "round";
  spriteCtx.beginPath();
  spriteCtx.arc(128, 132, 46, 0.22 * Math.PI, 0.78 * Math.PI);
  spriteCtx.stroke();

  spriteCtx.fillStyle = "rgba(255, 124, 166, 0.35)";
  spriteCtx.beginPath();
  spriteCtx.ellipse(71, 139, 18, 10, 0, 0, Math.PI * 2);
  spriteCtx.ellipse(185, 139, 18, 10, 0, 0, Math.PI * 2);
  spriteCtx.fill();
}

function drawEnemyFace(spriteCtx) {
  spriteCtx.clearRect(0, 0, SPRITE_SOURCE_SIZE, SPRITE_SOURCE_SIZE);
  drawSoftShadow(spriteCtx, 52, 214, 152, 23);

  const face = spriteCtx.createRadialGradient(92, 76, 18, 126, 124, 114);
  face.addColorStop(0, "#ff8b76");
  face.addColorStop(0.62, "#e6382f");
  face.addColorStop(1, "#8e1717");
  spriteCtx.fillStyle = face;
  spriteCtx.beginPath();
  spriteCtx.arc(128, 122, 96, 0, Math.PI * 2);
  spriteCtx.fill();

  spriteCtx.strokeStyle = "#641111";
  spriteCtx.lineWidth = 9;
  spriteCtx.stroke();

  spriteCtx.fillStyle = "rgba(255, 220, 195, 0.24)";
  spriteCtx.beginPath();
  spriteCtx.ellipse(90, 74, 24, 12, -0.45, 0, Math.PI * 2);
  spriteCtx.fill();

  spriteCtx.strokeStyle = "#3b0707";
  spriteCtx.lineWidth = 13;
  spriteCtx.lineCap = "round";
  spriteCtx.beginPath();
  spriteCtx.moveTo(70, 82);
  spriteCtx.lineTo(111, 101);
  spriteCtx.moveTo(186, 82);
  spriteCtx.lineTo(145, 101);
  spriteCtx.stroke();

  drawEye(spriteCtx, 91, 115, "#210303");
  drawEye(spriteCtx, 165, 115, "#210303");

  spriteCtx.strokeStyle = "#3b0707";
  spriteCtx.lineWidth = 12;
  spriteCtx.beginPath();
  spriteCtx.arc(128, 178, 40, 1.18 * Math.PI, 1.82 * Math.PI);
  spriteCtx.stroke();
}

function drawEye(spriteCtx, x, y, color) {
  spriteCtx.fillStyle = color;
  spriteCtx.beginPath();
  spriteCtx.ellipse(x, y, 15, 20, 0, 0, Math.PI * 2);
  spriteCtx.fill();
  spriteCtx.fillStyle = "rgba(255,255,255,0.82)";
  spriteCtx.beginPath();
  spriteCtx.arc(x - 5, y - 7, 4, 0, Math.PI * 2);
  spriteCtx.fill();
}

function drawBurger(spriteCtx) {
  spriteCtx.clearRect(0, 0, SPRITE_SOURCE_SIZE, SPRITE_SOURCE_SIZE);
  drawSoftShadow(spriteCtx, 26, 214, 204, 24);

  const bunTop = spriteCtx.createLinearGradient(0, 32, 0, 122);
  bunTop.addColorStop(0, "#ffe39c");
  bunTop.addColorStop(0.55, "#d99035");
  bunTop.addColorStop(1, "#9d5823");
  spriteCtx.fillStyle = bunTop;
  roundedRect(spriteCtx, 34, 38, 188, 88, 48);
  spriteCtx.fill();

  spriteCtx.fillStyle = "#fff4c7";
  for (const [x, y, r] of [
    [74, 69, 5],
    [104, 56, 4],
    [133, 76, 5],
    [162, 57, 4],
    [190, 82, 4],
  ]) {
    spriteCtx.beginPath();
    spriteCtx.ellipse(x, y, r + 3, r, -0.35, 0, Math.PI * 2);
    spriteCtx.fill();
  }

  drawLayer(spriteCtx, 24, 114, 208, 28, "#63b847", "#267836", true);
  drawLayer(spriteCtx, 32, 137, 192, 34, "#f4d250", "#cf9f24", false);
  drawLayer(spriteCtx, 28, 159, 200, 36, "#6b361f", "#32180f", false);

  const bunBottom = spriteCtx.createLinearGradient(0, 184, 0, 226);
  bunBottom.addColorStop(0, "#f3bd64");
  bunBottom.addColorStop(1, "#b96f2c");
  spriteCtx.fillStyle = bunBottom;
  roundedRect(spriteCtx, 36, 188, 184, 42, 22);
  spriteCtx.fill();

  spriteCtx.strokeStyle = "rgba(80, 39, 15, 0.45)";
  spriteCtx.lineWidth = 5;
  spriteCtx.stroke();
}

function drawLayer(spriteCtx, x, y, width, height, top, bottom, wavy) {
  const gradient = spriteCtx.createLinearGradient(0, y, 0, y + height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(1, bottom);
  spriteCtx.fillStyle = gradient;
  spriteCtx.beginPath();
  spriteCtx.moveTo(x + 10, y);
  for (let px = x + 10; px <= x + width - 10; px += 18) {
    const py = wavy ? y + (px % 36 === 0 ? 9 : 0) : y;
    spriteCtx.quadraticCurveTo(px + 9, py - 7, px + 18, y);
  }
  spriteCtx.lineTo(x + width, y + height);
  spriteCtx.lineTo(x, y + height);
  spriteCtx.closePath();
  spriteCtx.fill();
}

function drawBrickWall(spriteCtx) {
  spriteCtx.clearRect(0, 0, SPRITE_SOURCE_SIZE, SPRITE_SOURCE_SIZE);
  spriteCtx.fillStyle = "#5b201d";
  roundedRect(spriteCtx, 22, 24, 212, 208, 12);
  spriteCtx.fill();

  const rows = 6;
  const mortar = 8;
  const brickHeight = 30;
  for (let row = 0; row < rows; row += 1) {
    const y = 32 + row * (brickHeight + mortar);
    const offset = row % 2 === 0 ? 0 : -42;
    for (let x = 30 + offset; x < 232; x += 84) {
      const brick = spriteCtx.createLinearGradient(0, y, 0, y + brickHeight);
      brick.addColorStop(0, "#c24b3b");
      brick.addColorStop(1, "#7f261f");
      spriteCtx.fillStyle = brick;
      roundedRect(spriteCtx, x, y, 76, brickHeight, 5);
      spriteCtx.fill();
      spriteCtx.fillStyle = "rgba(255, 185, 150, 0.16)";
      spriteCtx.fillRect(x + 8, y + 6, 52, 4);
    }
  }

  spriteCtx.strokeStyle = "#3e1615";
  spriteCtx.lineWidth = 7;
  roundedRect(spriteCtx, 22, 24, 212, 208, 12);
  spriteCtx.stroke();
}

function drawSoftShadow(spriteCtx, x, y, width, height) {
  spriteCtx.fillStyle = "rgba(0, 0, 0, 0.28)";
  spriteCtx.beginPath();
  spriteCtx.ellipse(x + width / 2, y + height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
  spriteCtx.fill();
}

function roundedRect(spriteCtx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  spriteCtx.beginPath();
  spriteCtx.moveTo(x + r, y);
  spriteCtx.lineTo(x + width - r, y);
  spriteCtx.quadraticCurveTo(x + width, y, x + width, y + r);
  spriteCtx.lineTo(x + width, y + height - r);
  spriteCtx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  spriteCtx.lineTo(x + r, y + height);
  spriteCtx.quadraticCurveTo(x, y + height, x, y + height - r);
  spriteCtx.lineTo(x, y + r);
  spriteCtx.quadraticCurveTo(x, y, x + r, y);
  spriteCtx.closePath();
}

function isVisible(x, y) {
  return x >= viewport.x && y >= viewport.y && x < viewport.x + viewport.cols && y < viewport.y + viewport.rows;
}

function isVisibleInView(view, x, y) {
  return x >= view.x && y >= view.y && x < view.x + view.cols && y < view.y + view.rows;
}

function captureAnimationSnapshot() {
  resizeCanvasForDisplay();
  updateViewport();
  return {
    viewport: { ...viewport },
    playerId,
    agents: Array.from(sim.agents.values()).map((agent) => ({
      id: agent.id,
      x: agent.x,
      y: agent.y,
      health: agent.health,
      maxHealth: agent.maxHealth,
      food: agent.food,
      maxFood: agent.maxFood,
      heldBlock: agent.heldBlock ? { ...agent.heldBlock } : null,
    })),
    blocks: sim.blocks.map((block) => (block ? { ...block } : null)),
  };
}

function drawSnapshot(snapshot, activeAction = null, progress = 0) {
  const view = snapshot.viewport;
  resizeCanvasForDisplay();

  ctx.fillStyle = "#10130f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  drawGridFloor(view);

  for (let y = view.y; y < view.y + view.rows && y < sim.height; y += 1) {
    for (let x = view.x; x < view.x + view.cols && x < sim.width; x += 1) {
      const block = sim.inBounds(x, y) ? snapshot.blocks[sim.index(x, y)] : null;
      if (!block) continue;
      const sx = (x - view.x) * TILE_SIZE;
      const sy = (y - view.y) * TILE_SIZE;
      if (block.kind === "food") drawFoodBar(block, sx, sy);
      drawSprite(block.kind === "food" ? spriteImages.food : spriteImages.wall, sx, sy);
    }
  }

  for (const agent of snapshot.agents) {
    const animated = animatedAgentPosition(agent, activeAction, progress);
    if (!isVisibleInView(view, animated.x, animated.y)) continue;
    const sx = (animated.x - view.x) * TILE_SIZE;
    const sy = (animated.y - view.y) * TILE_SIZE;
    drawEnemyHealthBar(agent, sx, sy);
    drawSprite(agent.id === snapshot.playerId ? spriteImages.player : spriteImages.enemy, sx, sy);
    if (agent.id === snapshot.playerId) drawHeldBlockIcon(agent.heldBlock, sx, sy);
    if (agent.id === snapshot.playerId) drawSelectionBox(sx, sy, "#ffffff", 2);
  }

  drawActionEffect(snapshot, activeAction, progress);
}

function animatedAgentPosition(agent, action, progress) {
  if (!action || action.agentId !== agent.id) return { x: agent.x, y: agent.y };

  if (action.type === "move" && action.to) {
    return {
      x: lerp(action.from.x, action.to.x, smoothStep(progress)),
      y: lerp(action.from.y, action.to.y, smoothStep(progress)),
    };
  }

  if (action.type === "blocked" && (action.target || action.to)) {
    const target = action.target ?? action.to;
    const lunge = Math.sin(progress * Math.PI) * 0.28;
    return {
      x: action.from.x + (target.x - action.from.x) * lunge,
      y: action.from.y + (target.y - action.from.y) * lunge,
    };
  }

  if (action.type === "attack" || action.type === "eat" || action.type === "destroyFood" || action.type === "pickup" || action.type === "drop") {
    const target = action.target ?? action.from;
    const lean = Math.sin(progress * Math.PI) * 0.18;
    return {
      x: action.from.x + (target.x - action.from.x) * lean,
      y: action.from.y + (target.y - action.from.y) * lean,
    };
  }

  return { x: agent.x, y: agent.y - Math.sin(progress * Math.PI) * 0.08 };
}

function drawActionEffect(snapshot, action, progress) {
  if (!action) return;
  const view = snapshot.viewport;

  if ((action.type === "attack" || action.type === "eat" || action.type === "destroyFood" || action.type === "pickup") && action.target && isVisibleInView(view, action.target.x, action.target.y)) {
    const sx = (action.target.x - view.x) * TILE_SIZE + SPRITE_DRAW_SIZE / 2;
    const sy = (action.target.y - view.y) * TILE_SIZE + BAR_HEIGHT + BAR_GAP + SPRITE_DRAW_SIZE / 2;
    ctx.strokeStyle = action.type === "destroyFood" ? `rgba(255, 91, 75, ${1 - progress})` : `rgba(255, 222, 87, ${1 - progress})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(sx, sy, 16 + progress * 36, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }

  if (action.type === "wait" && action.from && isVisibleInView(view, action.from.x, action.from.y)) {
    const sx = (action.from.x - view.x) * TILE_SIZE;
    const sy = (action.from.y - view.y) * TILE_SIZE;
    drawSelectionBox(sx, sy, `rgba(113, 208, 138, ${0.35 + 0.5 * Math.sin(progress * Math.PI)})`, 3);
  }
}

function drawSwordSwing(snapshot, action, progress) {
  drawSwordSwingOn(ctx, snapshot, action, progress);
}

function drawSwordSwingOn(renderCtx, snapshot, action, progress) {
  const view = snapshot.viewport;
  const attacker = action.from;
  const target = action.target;
  const attackerCenter = tileCenter(view, attacker.x, attacker.y);
  const targetCenter = tileCenter(view, target.x, target.y);
  const towardTarget = Math.atan2(targetCenter.y - attackerCenter.y, targetCenter.x - attackerCenter.x);
  const swingProgress = smoothStep(progress);
  const startAngle = towardTarget + 1.75;
  const endAngle = towardTarget - 1.55;
  const swordAngle = startAngle + (endAngle - startAngle) * swingProgress;
  const reach = Math.min(50, Math.hypot(targetCenter.x - attackerCenter.x, targetCenter.y - attackerCenter.y) * 0.52);
  const pivot = {
    x: attackerCenter.x + Math.cos(towardTarget) * reach,
    y: attackerCenter.y + Math.sin(towardTarget) * reach,
  };
  const bladeLength = 96;
  const handleLength = 22;
  const tip = {
    x: pivot.x + Math.cos(swordAngle) * bladeLength,
    y: pivot.y + Math.sin(swordAngle) * bladeLength,
  };
  const pommel = {
    x: pivot.x - Math.cos(swordAngle) * handleLength,
    y: pivot.y - Math.sin(swordAngle) * handleLength,
  };

  renderCtx.save();
  renderCtx.strokeStyle = `rgba(255, 210, 72, ${0.58 + 0.24 * Math.sin(progress * Math.PI)})`;
  renderCtx.lineWidth = 22;
  renderCtx.lineCap = "round";
  renderCtx.beginPath();
  renderCtx.arc(pivot.x, pivot.y, bladeLength * 0.58, startAngle, swordAngle, true);
  renderCtx.stroke();

  renderCtx.strokeStyle = `rgba(255, 255, 255, ${0.5 + 0.25 * Math.sin(progress * Math.PI)})`;
  renderCtx.lineWidth = 10;
  renderCtx.beginPath();
  renderCtx.arc(pivot.x, pivot.y, bladeLength * 0.58, startAngle, swordAngle, true);
  renderCtx.stroke();

  renderCtx.shadowColor = "rgba(255, 244, 180, 0.85)";
  renderCtx.shadowBlur = 14;
  renderCtx.strokeStyle = "#f3f6ff";
  renderCtx.lineWidth = 12;
  renderCtx.lineCap = "round";
  renderCtx.beginPath();
  renderCtx.moveTo(pivot.x, pivot.y);
  renderCtx.lineTo(tip.x, tip.y);
  renderCtx.stroke();
  renderCtx.shadowBlur = 0;

  renderCtx.strokeStyle = "#7f8fa3";
  renderCtx.lineWidth = 4;
  renderCtx.beginPath();
  renderCtx.moveTo(pivot.x, pivot.y);
  renderCtx.lineTo(tip.x, tip.y);
  renderCtx.stroke();

  const guardAngle = swordAngle + Math.PI / 2;
  renderCtx.strokeStyle = "#d6a24a";
  renderCtx.lineWidth = 8;
  renderCtx.beginPath();
  renderCtx.moveTo(pivot.x + Math.cos(guardAngle) * 17, pivot.y + Math.sin(guardAngle) * 17);
  renderCtx.lineTo(pivot.x - Math.cos(guardAngle) * 17, pivot.y - Math.sin(guardAngle) * 17);
  renderCtx.stroke();

  renderCtx.strokeStyle = "#6b3f22";
  renderCtx.lineWidth = 10;
  renderCtx.beginPath();
  renderCtx.moveTo(pivot.x, pivot.y);
  renderCtx.lineTo(pommel.x, pommel.y);
  renderCtx.stroke();

  if (progress > 0.62) {
    const flash = (progress - 0.62) / 0.38;
    renderCtx.strokeStyle = `rgba(255, 245, 220, ${1 - flash})`;
    renderCtx.lineWidth = 7;
    renderCtx.beginPath();
    renderCtx.arc(targetCenter.x, targetCenter.y, 18 + flash * 30, 0, Math.PI * 2);
    renderCtx.stroke();
  }
  renderCtx.restore();
}

function tileCenter(view, x, y) {
  return {
    x: (x - view.x) * TILE_SIZE + SPRITE_DRAW_SIZE / 2,
    y: (y - view.y) * TILE_SIZE + BAR_HEIGHT + BAR_GAP + SPRITE_DRAW_SIZE / 2,
  };
}

function applyActionToSnapshot(snapshot, action) {
  const agent = snapshot.agents.find((entry) => entry.id === action.agentId);
  if (!agent) return;

  if (action.type === "move" && action.to) {
    agent.x = action.to.x;
    agent.y = action.to.y;
    return;
  }

  if (action.type === "attack" && action.targetId) {
    const target = snapshot.agents.find((entry) => entry.id === action.targetId);
    if (!target) return;
    target.health = Math.max(0, target.health - (action.damage ?? 0));
    if (action.killed) {
      snapshot.agents = snapshot.agents.filter((entry) => entry.id !== action.targetId);
    }
    return;
  }

  if (action.type === "eat" && action.target) {
    const block = snapshot.blocks[sim.index(action.target.x, action.target.y)];
    agent.food = Math.min(agent.maxFood, agent.food + (action.amount ?? 0));
    if (block) {
      block.amount -= action.amount ?? 0;
      if (block.amount <= 0) snapshot.blocks[sim.index(action.target.x, action.target.y)] = null;
    }
    return;
  }

  if (action.type === "pickup" && action.target) {
    const index = sim.index(action.target.x, action.target.y);
    const block = snapshot.blocks[index];
    if (block?.kind === "food" && action.amount) {
      block.amount -= action.amount;
      if (block.amount <= 0) snapshot.blocks[index] = null;
    } else {
      snapshot.blocks[index] = null;
    }
    return;
  }

  if (action.type === "destroyFood" && action.target) {
    const index = sim.index(action.target.x, action.target.y);
    const block = snapshot.blocks[index];
    if (block?.kind === "food" && action.amount) {
      block.amount -= action.amount;
      if (block.amount <= 0) snapshot.blocks[index] = null;
    } else {
      snapshot.blocks[index] = null;
    }
    return;
  }

  if (action.type === "drop" && action.target) {
    snapshot.blocks[sim.index(action.target.x, action.target.y)] = {
      kind: action.blockKind ?? "wall",
      amount: action.amount ?? DEFAULTS.startingFoodPerBlock,
    };
    return;
  }

  if (action.type === "mate" && action.birth) {
    snapshot.agents.push({
      id: action.birth.agentId ?? -1,
      x: action.birth.x,
      y: action.birth.y,
      health: DEFAULTS.newbornHealth,
      maxHealth: DEFAULTS.adultHealth,
      food: DEFAULTS.newbornFood,
      maxFood: DEFAULTS.adultFood,
      heldBlock: null,
    });
  }
}

function actionVisibleInSnapshot(snapshot, action) {
  if (!["move", "attack", "eat", "destroyFood", "pickup", "drop", "mate"].includes(action.type)) {
    return false;
  }
  const view = snapshot.viewport;
  return [action.from, action.to, action.target, action.partnerFrom, action.birth].some(
    (point) => point && isVisibleInView(view, point.x, point.y),
  );
}

function animateAction(snapshot, action) {
  return new Promise((resolve) => {
    const duration = animationDuration(action);
    const startedAt = performance.now();
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallbackTimer);
      if (action.type === "attack") {
        activeOverlayAction = null;
        swordDom.hidden = true;
        effectCtx.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
      }
      resolve();
    };

    const step = () => {
      if (finished) return;
      try {
        const now = performance.now();
        const progress = clamp((now - startedAt) / duration, 0, 1);
        activeOverlayAction = null;
        drawSnapshot(snapshot, action, progress);
        effectCtx.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
        swordDom.hidden = true;
        if (progress >= 1) finish();
        else setTimeout(step, 33);
      } catch (error) {
        console.error("Animation frame failed", error);
        finish();
      }
    };

    const fallbackTimer = setTimeout(finish, duration + 180);
    step();
  });
}

function animationDuration(action) {
  if (action.type === "attack") return 700;
  if (action.type === "move") return 620;
  if (action.type === "eat" || action.type === "destroyFood" || action.type === "pickup" || action.type === "drop") {
    return 700;
  }
  return 500;
}

async function animateTurn(snapshot, actionLog) {
  isAnimating = true;
  const unlockTimer = setTimeout(() => {
    console.error("Animation safety unlock fired");
    activeOverlayAction = null;
    swordDom.hidden = true;
    effectCtx.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
    isAnimating = false;
    refresh();
  }, 10000);
  const visibleActions = actionLog.filter((action) => actionVisibleInSnapshot(snapshot, action));
  document.body.dataset.animationActions = visibleActions.map((action) => `${action.order}:${action.type}:${action.agentId}`).join(",");
  if (visibleActions.length === 0) {
    clearTimeout(unlockTimer);
    isAnimating = false;
    refresh();
    return;
  }

  try {
    for (const action of visibleActions) {
      await animateAction(snapshot, action);
      applyActionToSnapshot(snapshot, action);
      drawSnapshot(snapshot);
    }
  } catch (error) {
    console.error("Animation failed", error);
  } finally {
    clearTimeout(unlockTimer);
    activeOverlayAction = null;
    swordDom.hidden = true;
    effectCtx.clearRect(0, 0, effectCanvas.width, effectCanvas.height);
    isAnimating = false;
    refresh();
  }
}

function placeSwordDom(snapshot, action, progress) {
  const view = snapshot.viewport;
  const attackerCenter = tileCenter(view, action.from.x, action.from.y);
  const targetCenter = tileCenter(view, action.target.x, action.target.y);
  const towardTarget = Math.atan2(targetCenter.y - attackerCenter.y, targetCenter.x - attackerCenter.x);
  const swingProgress = smoothStep(progress);
  const startAngle = towardTarget + 1.75;
  const endAngle = towardTarget - 1.55;
  const swordAngle = startAngle + (endAngle - startAngle) * swingProgress;
  const reach = Math.min(50, Math.hypot(targetCenter.x - attackerCenter.x, targetCenter.y - attackerCenter.y) * 0.52);
  const pivot = {
    x: attackerCenter.x + Math.cos(towardTarget) * reach,
    y: attackerCenter.y + Math.sin(towardTarget) * reach,
  };
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width / canvas.width;
  const scaleY = rect.height / canvas.height;
  swordDom.hidden = false;
  swordDom.style.left = `${pivot.x * scaleX}px`;
  swordDom.style.top = `${pivot.y * scaleY - 7}px`;
  swordDom.style.transform = `rotate(${swordAngle}rad)`;
  swordDom.style.opacity = `${0.68 + 0.32 * Math.sin(progress * Math.PI)}`;
}

function cellFromMouse(event) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const px = Math.floor(((event.clientX - rect.left) * dpr) / TILE_SIZE);
  const py = Math.floor(((event.clientY - rect.top) * dpr) / TILE_SIZE);
  const x = viewport.x + px;
  const y = viewport.y + py;
  return sim.inBounds(x, y) ? { x, y } : null;
}

function handleCanvasClick(event) {
  if (isAnimating || amountRequest) return;
  const cell = cellFromMouse(event);
  if (!cell) return;

  const brush = ui.brushSelect.value;
  if (brush === "agent") {
    const agent = sim.addAgent(cell.x, cell.y);
    if (agent) inspected = { type: "agent", id: agent.id };
    refresh();
    return;
  }
  if (brush === "food") {
    if (sim.addBlock(cell.x, cell.y, { kind: "food", amount: DEFAULTS.startingFoodPerBlock })) {
      inspected = { type: "block", x: cell.x, y: cell.y };
    }
    refresh();
    return;
  }
  if (brush === "wall") {
    if (sim.addBlock(cell.x, cell.y, { kind: "wall" })) inspected = { type: "block", x: cell.x, y: cell.y };
    refresh();
    return;
  }
  if (brush === "erase") {
    const agent = sim.getAgentAt(cell.x, cell.y);
    if (agent && agent.id !== playerId) sim.removeAgent(agent, "erased");
    sim.removeBlock(cell.x, cell.y);
    inspected = null;
    refresh();
    return;
  }

  const agent = sim.getAgentAt(cell.x, cell.y);
  const block = sim.getBlockAt(cell.x, cell.y);
  if (agent) inspected = { type: "agent", id: agent.id };
  else if (block) inspected = { type: "block", x: cell.x, y: cell.y };
  else inspected = { type: "cell", x: cell.x, y: cell.y };
  refresh();
}

async function actInDirection(dir, options = {}) {
  if (isAnimating || amountRequest) return;
  const controlled = player();
  if (!controlled) {
    ui.statusLine.textContent = "Your unit is gone. Reset to start again.";
    return;
  }

  const delta = DIRECTIONS[dir];
  const x = controlled.x + delta.dx;
  const y = controlled.y + delta.dy;
  let action = { type: "move", dir };
  const targetAgent = sim.getAgentAt(x, y);
  const targetBlock = sim.getBlockAt(x, y);

  if (options.mate) {
    action = { type: "mate", dir };
  } else if (options.transferBlock) {
    const transferAction = await blockTransferAction(controlled, dir, targetBlock);
    if (!transferAction) return;
    action = transferAction;
  } else if (controlled.heldBlock) {
    action = { type: "move", dir };
  } else if (targetAgent) {
    action = { type: "attack", dir };
  } else if (targetBlock?.kind === "food") {
    if (options.destroyFood) {
      const max = Math.floor(targetBlock.amount);
      const amount = await requestFoodAmount({
        title: "Destroy food",
        message: "Choose how much food to destroy from this block.",
        max,
        defaultAmount: max,
      });
      if (amount === null) return;
      action = { type: "destroyFood", dir, amount };
    } else {
      const max = Math.floor(Math.min(controlled.maxFood - controlled.food, targetBlock.amount));
      const amount = await requestFoodAmount({
        title: "Eat food",
        message: "Choose how much food to eat from this block.",
        max,
        defaultAmount: max,
      });
      if (amount === null) return;
      action = { type: "eat", dir, amount };
    }
  }

  takeTurn(action);
}

async function blockTransferAction(controlled, dir, targetBlock) {
  if (controlled.heldBlock) {
    const delta = DIRECTIONS[dir];
    const x = controlled.x + delta.dx;
    const y = controlled.y + delta.dy;
    const canDrop = sim.isEmptyGround(x, y);
    if (controlled.heldBlock.kind === "food" && canDrop) {
      const max = Math.floor(controlled.heldBlock.amount);
      const amount = await requestFoodAmount({
        title: "Set down food",
        message: "Choose how much of the held food block to set down.",
        max,
        defaultAmount: max,
      });
      return amount === null ? null : { type: "drop", dir, amount };
    }
    return { type: "drop", dir };
  }

  if (targetBlock?.kind === "food") {
    const max = Math.floor(targetBlock.amount);
    const amount = await requestFoodAmount({
      title: "Pick up food",
      message: "Choose how much food to lift from this block.",
      max,
      defaultAmount: max,
    });
    return amount === null ? null : { type: "pickup", dir, amount };
  }

  return { type: "pickup", dir };
}

function requestFoodAmount({ title, message, max, defaultAmount }) {
  const safeMax = Math.floor(max);
  if (safeMax < 1) {
    ui.statusLine.textContent = "No legal food amount is available for that action.";
    return Promise.resolve(null);
  }
  const allowedAmounts = sim.allowedFoodAmounts(safeMax);
  const defaultAllowed = allowedAmounts.includes(Math.floor(defaultAmount ?? safeMax)) ? Math.floor(defaultAmount ?? safeMax) : safeMax;
  return new Promise((resolve) => {
    amountRequest = { resolve, max: safeMax, allowedAmounts };
    ui.amountTitle.textContent = title;
    ui.amountMessage.textContent = message;
    ui.amountMax.textContent = `Allowed: ${allowedAmounts.map((amount) => amount.toLocaleString()).join(", ")}`;
    ui.amountInput.min = "1";
    ui.amountInput.max = String(safeMax);
    ui.amountInput.setAttribute("list", "amountOptions");
    ui.amountInput.value = String(defaultAllowed);
    ui.amountOptions.innerHTML = allowedAmounts.map((amount) => `<option value="${amount}"></option>`).join("");
    ui.amountDialog.hidden = false;
    ui.amountInput.focus();
    ui.amountInput.select();
  });
}

function closeAmountDialog(value) {
  if (!amountRequest) return;
  const request = amountRequest;
  amountRequest = null;
  ui.amountDialog.hidden = true;
  request.resolve(value);
}

function waitTurn() {
  if (isAnimating || amountRequest) return;
  takeTurn({ type: "wait" });
}

function takeTurn(action) {
  const controlled = player();
  if (!controlled || isAnimating) return;

  const animationSnapshot = captureAnimationSnapshot();
  sim.tick(new Map([[controlled.id, action]]));
  if (!sim.agents.has(controlled.id)) {
    latestPlayerObservation = null;
    inspected = null;
    ui.statusLine.textContent = `Turn ${sim.turn}: your unit died. Reset to try again.`;
  } else {
    const updatedPlayer = sim.agents.get(controlled.id);
    latestPlayerObservation = {
      ...sim.observationFor(updatedPlayer),
      legalActions: sim.legalActionMask(updatedPlayer),
    };
    inspected = { type: "agent", id: controlled.id };
    ui.statusLine.textContent = describePlayerAction(updatedPlayer, action);
  }
  updateHud();
  void animateTurn(animationSnapshot, sim.actionLog);
}

function describePlayerAction(controlled, requestedAction = null) {
  const action = controlled.lastAction;
  if (action === "move") return `Turn ${sim.turn}: moved.`;
  if (action === "attack") return `Turn ${sim.turn}: attacked.`;
  if (action === "eat") return `Turn ${sim.turn}: ate from the burger block.`;
  if (action === "destroyFood") return `Turn ${sim.turn}: destroyed the burger block.`;
  if (action === "pickup") return `Turn ${sim.turn}: picked up a block.`;
  if (action === "drop") return `Turn ${sim.turn}: set down a block.`;
  if (action === "mate") return `Turn ${sim.turn}: mated.`;
  if (requestedAction?.type === "mate" && action === "wait") {
    return `Turn ${sim.turn}: attempted to mate, but the other unit did not reciprocate.`;
  }
  if (action === "wait") return `Turn ${sim.turn}: waited.`;
  if (action === "blocked") return `Turn ${sim.turn}: blocked.`;
  return `Turn ${sim.turn}: ${action}.`;
}

function resolveInspection() {
  if (!inspected) return player();
  if (inspected.type === "agent") return sim.agents.get(inspected.id) ?? null;
  if (inspected.type === "block") {
    const block = sim.getBlockAt(inspected.x, inspected.y);
    return block ? { ...block, x: inspected.x, y: inspected.y } : null;
  }
  return inspected;
}

function updateHud() {
  ui.turnStat.textContent = sim.turn.toLocaleString();
  ui.agentStat.textContent = sim.agents.size.toLocaleString();
  ui.foodStat.textContent = sim.countBlocks("food").toLocaleString();
  ui.wallStat.textContent = sim.countBlocks("wall").toLocaleString();
  renderInspection();
  renderAiPanel();
}

function renderInspection() {
  const controlled = player();
  if (!controlled) {
    ui.selectionPanel.className = "selection-empty";
    ui.selectionPanel.textContent = "Your unit is dead. Reset to start again.";
    return;
  }

  const held = controlled.heldBlock
    ? `${controlled.heldBlock.kind}${controlled.heldBlock.amount ? ` (${Math.floor(controlled.heldBlock.amount)})` : ""}`
    : "None";
  ui.selectionPanel.className = "selection-card";
  ui.selectionPanel.innerHTML = `
    <strong>Unit ${controlled.id}</strong>
    <span>Position ${controlled.x}, ${controlled.y}</span>
    <span>Age ${controlled.age} turns</span>
    <span>Last action ${controlled.lastAction}</span>
    <span>Held ${held}</span>
    <span>Health ${Math.ceil(controlled.health)} / ${controlled.maxHealth}</span>
    <div class="meter health"><span style="width: ${(controlled.health / controlled.maxHealth) * 100}%"></span></div>
    <span>Food ${Math.ceil(controlled.food)} / ${controlled.maxFood}</span>
    <div class="meter food"><span style="width: ${(controlled.food / controlled.maxFood) * 100}%"></span></div>
  `;
}

function renderAiPanel() {
  const controlled = player();
  if (!controlled) {
    ui.aiPanel.textContent = "No player observation available.";
    return;
  }

  const observation = latestPlayerObservation ?? {
    ...sim.observationFor(controlled),
    legalActions: sim.legalActionMask(controlled),
  };
  ui.aiPanel.innerHTML = `
    <div>
      <h3>Action Features / Legal</h3>
      <div class="ai-action-grid">
        <span class="head name">Feature</span>
        <span class="head value">Prev</span>
        <span class="head value">Legal</span>
        ${Object.keys(observation.actionIndicators).map((key) => `
          <span class="name">${key}</span>
          <span class="value">${formatAiValue(observation.actionIndicators[key])}</span>
          <span class="value">${formatAiValue(observation.legalActions[key])}</span>
        `).join("")}
      </div>
    </div>
    <div>
      <h3>Self</h3>
      <pre class="ai-matrix">satiety: ${formatAiValue(observation.self.food)}
mate requests: ${JSON.stringify(observation.adjacentMateRequests)}</pre>
    </div>
    ${renderMatrixBlock("Walls", observation.spatial.wall)}
    ${renderMatrixBlock("Agent Health", observation.spatial.agentHealth)}
    ${renderMatrixBlock("Food", observation.spatial.food)}
    ${renderMatrixBlock("Out Of Bounds", observation.spatial.outOfBounds)}
    ${renderMatrixBlock("Acted This Turn", observation.spatial.actedThisTurn)}
  `;
}

function renderMatrixBlock(title, matrix) {
  return `
    <div>
      <h3>${title}</h3>
      <pre class="ai-matrix">${matrixText(matrix)}</pre>
    </div>
  `;
}

function matrixText(matrix) {
  return matrix
    .map((row) => row.map((value) => formatAiCell(value)).join(" "))
    .join("\n");
}

function formatAiValue(value) {
  if (!Number.isFinite(value)) return "0";
  if (value === 0 || value === 1) return String(value);
  return value.toFixed(3);
}

function formatAiCell(value) {
  if (!Number.isFinite(value) || value === 0) return "0.00";
  if (value === 1) return "1.00";
  return value.toFixed(2);
}

function refresh() {
  if (isAnimating) return;
  draw();
  updateHud();
}

function resetWorld() {
  if (isAnimating) return;
  sim = Simulation.createDefault();
  choosePlayer();
  latestPlayerObservation = null;
  ui.statusLine.textContent = "Arrow keys act. M+Arrow mates. Ctrl+Arrow picks up or sets down blocks. Shift+Arrow destroys food. Space waits and grants next-turn initiative.";
  refresh();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

canvas.addEventListener("click", handleCanvasClick);
canvas.addEventListener("mousemove", (event) => {
  hoverCell = cellFromMouse(event);
  if (!isAnimating) draw();
});
canvas.addEventListener("mouseleave", () => {
  hoverCell = null;
  if (!isAnimating) draw();
});

document.querySelectorAll("[data-dir]").forEach((button) => {
  button.addEventListener("click", (event) => actInDirection(button.dataset.dir, { transferBlock: event.ctrlKey }));
});

ui.amountForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!amountRequest) return;
  const amount = clamp(Math.floor(Number(ui.amountInput.value)), 1, amountRequest.max);
  if (!amountRequest.allowedAmounts.includes(amount)) {
    ui.amountMax.textContent = `Choose one of: ${amountRequest.allowedAmounts.map((option) => option.toLocaleString()).join(", ")}`;
    ui.amountInput.value = String(amountRequest.allowedAmounts.at(-1));
    ui.amountInput.focus();
    ui.amountInput.select();
    return;
  }
  closeAmountDialog(amount);
});

ui.amountCancel.addEventListener("click", () => closeAmountDialog(null));
ui.waitOrder.addEventListener("click", waitTurn);
ui.resetWorld.addEventListener("click", resetWorld);

window.addEventListener("keydown", (event) => {
  if (amountRequest) {
    if (event.key === "Escape") closeAmountDialog(null);
    return;
  }

  if (event.key.toLowerCase() === "m") {
    event.preventDefault();
    mateKeyHeld = true;
    return;
  }

  const keyToDir = {
    ArrowUp: "N",
    ArrowRight: "E",
    ArrowDown: "S",
    ArrowLeft: "W",
  };
  const dir = keyToDir[event.key];
  if (dir) {
    event.preventDefault();
    actInDirection(dir, { destroyFood: event.shiftKey, transferBlock: event.ctrlKey, mate: mateKeyHeld });
    return;
  }
  if (event.key === " ") {
    event.preventDefault();
    waitTurn();
  }
}, { capture: true });

window.addEventListener("keyup", (event) => {
  if (event.key.toLowerCase() === "m") mateKeyHeld = false;
}, { capture: true });

window.addEventListener("blur", () => {
  mateKeyHeld = false;
});

window.addEventListener("resize", refresh);

choosePlayer();
window.PixelAgentsDebug = {
  get isAnimating() {
    return isAnimating;
  },
  get lastActionLog() {
    return sim.actionLog;
  },
  get player() {
    return player();
  },
  get viewport() {
    return viewport;
  },
};
refresh();
