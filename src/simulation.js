(() => {
const { baseAiController, DEFAULTS, DIRECTIONS, Random } = window.PixelAgents;

const CONTROLLERS = {
  base: baseAiController,
};

const DIRECTION_KEYS = Object.keys(DIRECTIONS);
const DIRECTED_ACTIONS = ["move", "attack", "mate", "eat", "pickup", "drop", "destroyFood"];
const ACTION_FEATURE_KEYS = [
  "wait",
  ...DIRECTED_ACTIONS.flatMap((type) => DIRECTION_KEYS.map((dir) => `${type}_${dir}`)),
];
const FOOD_ACTIONS = new Set(["eat", "destroyFood"]);
const GENOME_LAYER_SHAPES = [
  { rows: DEFAULTS.aiInputSize, cols: DEFAULTS.neuralLayerSizes[0] },
  { rows: DEFAULTS.neuralLayerSizes[0], cols: DEFAULTS.neuralLayerSizes[1] },
  { rows: DEFAULTS.neuralLayerSizes[1], cols: DEFAULTS.neuralLayerSizes[2] },
];

class Simulation {
  constructor(options = {}) {
    this.width = options.width ?? DEFAULTS.width;
    this.height = options.height ?? DEFAULTS.height;
    this.random = new Random(options.seed ?? Date.now());
    this.blocks = new Array(this.width * this.height).fill(null);
    this.agentGrid = new Array(this.width * this.height).fill(null);
    this.agents = new Map();
    this.nextAgentId = 1;
    this.turn = 0;
    this.events = [];
    this.actionLog = [];
  }

  static createDefault(seed = Date.now()) {
    const sim = new Simulation({ seed });
    sim.populate(DEFAULTS);
    return sim;
  }

  populate(settings) {
    for (let i = 0; i < settings.initialFoodBlocks; i += 1) {
      const cell = this.randomEmptyCell();
      if (cell) this.addBlock(cell.x, cell.y, { kind: "food", amount: settings.startingFoodPerBlock });
    }

    for (let i = 0; i < settings.initialWalls; i += 1) {
      const cell = this.randomEmptyCell();
      if (cell) this.addBlock(cell.x, cell.y, { kind: "wall" });
    }

    for (let i = 0; i < settings.initialAgents; i += 1) {
      const cell = this.randomEmptyCell();
      if (cell) this.addAgent(cell.x, cell.y);
    }
  }

  index(x, y) {
    return y * this.width + x;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  getAgentAt(x, y) {
    if (!this.inBounds(x, y)) return null;
    const id = this.agentGrid[this.index(x, y)];
    return id ? this.agents.get(id) ?? null : null;
  }

  getBlockAt(x, y) {
    if (!this.inBounds(x, y)) return null;
    return this.blocks[this.index(x, y)];
  }

  isEmptyGround(x, y) {
    return this.inBounds(x, y) && !this.getAgentAt(x, y) && !this.getBlockAt(x, y);
  }

  randomEmptyCell() {
    for (let tries = 0; tries < 4000; tries += 1) {
      const x = this.random.int(this.width);
      const y = this.random.int(this.height);
      if (this.isEmptyGround(x, y)) return { x, y };
    }

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 1) {
        if (this.isEmptyGround(x, y)) return { x, y };
      }
    }

    return null;
  }

  normalizeGenetics(genetics = {}) {
    return {
      controller: genetics.controller ?? "base",
      hue: genetics.hue ?? this.random.int(360),
      generation: genetics.generation ?? 0,
      mutationRate: genetics.mutationRate ?? 0.04,
      weightMutationRate: genetics.weightMutationRate ?? DEFAULTS.weightMutationRate,
      diploidGenomes: this.normalizeDiploidGenomes(genetics.diploidGenomes),
    };
  }

  normalizeDiploidGenomes(diploidGenomes) {
    if (!Array.isArray(diploidGenomes) || diploidGenomes.length !== 2) {
      return [this.randomGenome(), this.randomGenome()];
    }
    return diploidGenomes.map((genome) => this.copyGenome(genome));
  }

  randomGenome() {
    return {
      layers: GENOME_LAYER_SHAPES.map((shape) => (
        Array.from({ length: shape.rows }, () => (
          Array.from({ length: shape.cols }, () => this.randomWeight())
        ))
      )),
    };
  }

  copyGenome(genome) {
    return {
      layers: GENOME_LAYER_SHAPES.map((shape, layerIndex) => (
        Array.from({ length: shape.rows }, (_, rowIndex) => (
          Array.from({ length: shape.cols }, (_, colIndex) => {
            const weight = genome?.layers?.[layerIndex]?.[rowIndex]?.[colIndex];
            return Number.isFinite(weight) ? weight : this.randomWeight();
          })
        ))
      )),
    };
  }

  randomWeight() {
    return this.random.normal(DEFAULTS.initialWeightMean, DEFAULTS.initialWeightSd);
  }

  addAgent(x, y, overrides = {}) {
    if (!this.isEmptyGround(x, y)) return null;
    const id = this.nextAgentId++;
    const genetics = this.normalizeGenetics(overrides.genetics);
    const agent = {
      id,
      x,
      y,
      age: overrides.age ?? 0,
      health: overrides.health ?? DEFAULTS.adultHealth,
      maxHealth: overrides.maxHealth ?? DEFAULTS.adultHealth,
      food: overrides.food ?? DEFAULTS.adultFood,
      maxFood: overrides.maxFood ?? DEFAULTS.adultFood,
      attackDamage: overrides.attackDamage ?? DEFAULTS.attackDamage,
      heldBlock: overrides.heldBlock ?? null,
      lastAction: "wait",
      lastActionRecord: { type: "wait", agentId: id, from: { x, y } },
      births: overrides.births ?? 0,
      kills: overrides.kills ?? 0,
      genetics,
    };

    this.agents.set(id, agent);
    this.agentGrid[this.index(x, y)] = id;
    return agent;
  }

  addBlock(x, y, block) {
    if (!this.inBounds(x, y) || this.getBlockAt(x, y) || this.getAgentAt(x, y)) return false;
    this.blocks[this.index(x, y)] = this.normalizeBlock(block);
    return true;
  }

  normalizeBlock(block) {
    if (block?.kind === "food") {
      return {
        kind: "food",
        amount: this.clampFoodAmount(block.amount ?? DEFAULTS.startingFoodPerBlock),
      };
    }
    return { ...block };
  }

  clampFoodAmount(amount) {
    return Math.max(0, Math.min(DEFAULTS.maxFoodPerBlock, Math.floor(amount ?? 0)));
  }

  allowedFoodAmounts(maxPossible) {
    const max = this.clampFoodAmount(maxPossible);
    if (max <= 0) return [];
    const amounts = [];
    for (let amount = 1; amount <= max; amount *= 2) {
      amounts.push(amount);
    }
    if (!amounts.includes(max)) amounts.push(max);
    return amounts;
  }

  legalFoodActionAmount(maxPossible, requestedAmount) {
    const max = this.clampFoodAmount(maxPossible);
    if (max <= 0) return null;
    if (requestedAmount === undefined || requestedAmount === null) return max;
    const amount = Math.floor(Number(requestedAmount));
    if (!Number.isFinite(amount) || amount < 1 || amount > max) return null;
    if (amount === max || this.isPowerOfTwo(amount)) return amount;
    return null;
  }

  isPowerOfTwo(amount) {
    return Number.isInteger(amount) && amount > 0 && (amount & (amount - 1)) === 0;
  }

  removeBlock(x, y) {
    if (!this.inBounds(x, y)) return null;
    const idx = this.index(x, y);
    const block = this.blocks[idx];
    this.blocks[idx] = null;
    return block;
  }

  removeAgent(agent, cause = "death") {
    if (!this.agents.has(agent.id)) return;
    if (agent.heldBlock && !this.getBlockAt(agent.x, agent.y)) {
      this.blocks[this.index(agent.x, agent.y)] = agent.heldBlock;
    }
    this.agentGrid[this.index(agent.x, agent.y)] = null;
    this.agents.delete(agent.id);
    this.events.push({ type: cause, agentId: agent.id, x: agent.x, y: agent.y });
  }

  neighborsOf(x, y) {
    return Object.entries(DIRECTIONS)
      .map(([dir, delta]) => {
        const nx = x + delta.dx;
        const ny = y + delta.dy;
        return {
          dir,
          x: nx,
          y: ny,
          agent: this.getAgentAt(nx, ny),
          block: this.getBlockAt(nx, ny),
        };
      })
      .filter((cell) => this.inBounds(cell.x, cell.y));
  }

  tick(manualActions = new Map()) {
    this.turn += 1;
    this.events = [];
    this.actionLog = [];
    this.pendingMateRequests = new Map();
    this.actedThisTurn = new Set();

    const agentsAtStart = Array.from(this.agents.values());
    const previousActions = new Map(agentsAtStart.map((agent) => [agent.id, agent.lastAction]));
    const order = this.initiativeOrder(agentsAtStart, previousActions);

    for (const id of order) {
      const agent = this.agents.get(id);
      if (!agent) continue;
      const action = this.actionForAgent(agent, manualActions);
      this.resolveAction(agent, action);
      this.actedThisTurn.add(id);
    }

    this.finalizePendingMateRequests();
    this.applyMetabolism();
    this.growGroundFood();
    this.pendingMateRequests = new Map();
    this.actedThisTurn = new Set();
  }

  initiativeOrder(agents, previousActions) {
    return agents
      .map((agent) => ({
        id: agent.id,
        waited: previousActions.get(agent.id) === "wait" ? 1 : 0,
        health: agent.health,
        satiety: agent.maxFood > 0 ? agent.food / agent.maxFood : 0,
        tieBreak: this.random.next(),
      }))
      .sort((a, b) => {
        if (b.waited !== a.waited) return b.waited - a.waited;
        if (b.health !== a.health) return b.health - a.health;
        if (b.satiety !== a.satiety) return b.satiety - a.satiety;
        return b.tieBreak - a.tieBreak;
      })
      .map((entry) => entry.id);
  }

  controllerFor(agent) {
    return CONTROLLERS[agent.genetics.controller] ?? baseAiController;
  }

  actionForAgent(agent, manualActions) {
    const rawAction = manualActions.has(agent.id)
      ? manualActions.get(agent.id)
      : this.controllerFor(agent)(agent, this);
    const action = typeof rawAction === "function" ? rawAction(agent, this) : rawAction;
    const normalized = this.normalizeAction(action);
    return this.isActionLegal(agent, normalized) ? normalized : { type: "wait" };
  }

  normalizeAction(action) {
    if (!action || typeof action.type !== "string") return { type: "wait" };
    const normalized = { ...action };
    if (normalized.type !== "wait" && !DIRECTIONS[normalized.dir]) {
      return { type: "wait" };
    }
    return normalized;
  }

  legalActionMask(agent) {
    return Object.fromEntries(ACTION_FEATURE_KEYS.map((key) => [key, this.isActionLegal(agent, this.actionFromFeatureKey(key)) ? 1 : 0]));
  }

  actionFromFeatureKey(key) {
    if (key === "wait") return { type: "wait" };
    const [type, dir] = key.split("_");
    return { type, dir };
  }

  isActionLegal(agent, action) {
    if (!agent || !this.agents.has(agent.id)) return false;
    const normalized = this.normalizeAction(action);
    if (normalized.type === "wait") return true;
    if (agent.heldBlock && !["move", "drop"].includes(normalized.type)) return false;

    const cell = normalized.dir ? this.offset(agent, normalized.dir) : null;
    const targetAgent = cell ? this.getAgentAt(cell.x, cell.y) : null;
    const targetBlock = cell ? this.getBlockAt(cell.x, cell.y) : null;

    switch (normalized.type) {
      case "move":
        return Boolean(cell && this.isEmptyGround(cell.x, cell.y));
      case "attack":
        return Boolean(targetAgent);
      case "mate":
        return this.isMateLegal(agent, normalized, targetAgent);
      case "eat":
        return Boolean(
          targetBlock?.kind === "food"
            && agent.food < agent.maxFood
            && this.legalFoodActionAmount(Math.min(agent.maxFood - agent.food, targetBlock.amount), normalized.amount) !== null,
        );
      case "destroyFood":
        return Boolean(targetBlock?.kind === "food" && this.legalFoodActionAmount(targetBlock.amount, normalized.amount) !== null);
      case "pickup":
        return Boolean(
          !agent.heldBlock
            && targetBlock
            && (targetBlock.kind !== "food" || this.legalFoodActionAmount(targetBlock.amount, normalized.amount) !== null),
        );
      case "drop":
        return Boolean(
          agent.heldBlock
            && cell
            && this.isEmptyGround(cell.x, cell.y)
            && (agent.heldBlock.kind !== "food" || this.legalFoodActionAmount(agent.heldBlock.amount, normalized.amount) !== null),
        );
      default:
        return false;
    }
  }

  isMateLegal(agent, action, targetAgent = null) {
    const target = targetAgent ?? this.adjacentAgent(agent, action.dir);
    if (!target || agent.heldBlock || target.heldBlock) return false;
    if (agent.food < DEFAULTS.birthFoodCost || target.food < DEFAULTS.birthFoodCost) return false;
    if (!this.findBirthCell(agent, target)) return false;

    const pendingRequest = this.pendingMateRequestFor(agent);
    if (pendingRequest?.requester.id === target.id && this.isReciprocalMate(agent, target, action)) return true;
    return !this.actedThisTurn?.has(target.id);
  }

  observationFor(agent) {
    return {
      actionIndicators: this.actionIndicatorsFor(agent.lastActionRecord ?? { type: "wait" }),
      spatial: this.spatialObservationFor(agent),
      self: {
        food: this.scaleFood(agent.food, agent.maxFood),
      },
      adjacentMateRequests: this.adjacentMateRequestsFor(agent),
    };
  }

  actionIndicatorsFor(action) {
    const indicators = Object.fromEntries(ACTION_FEATURE_KEYS.map((key) => [key, 0]));
    const key = this.actionFeatureKey(action);
    if (!key || !(key in indicators)) return indicators;
    indicators[key] = this.actionFeatureValue(action);
    return indicators;
  }

  actionFeatureKey(action) {
    if (!action || action.type === "wait") return "wait";
    const type = action.type === "mateRequest" ? "mate" : action.type;
    const dir = action.dir ?? this.directionForAction(action);
    if (!dir || !DIRECTED_ACTIONS.includes(type)) return "wait";
    return `${type}_${dir}`;
  }

  actionFeatureValue(action) {
    const type = action.type === "mateRequest" ? "mate" : action.type;
    if (FOOD_ACTIONS.has(type) || (type === "pickup" && action.blockKind === "food") || (type === "drop" && action.blockKind === "food")) {
      return this.scaleFood(action.amount ?? DEFAULTS.maxFoodPerBlock);
    }
    return 1;
  }

  scaleFood(amount, max = DEFAULTS.maxFoodPerBlock) {
    const denominator = Math.max(1, max);
    return Math.max(0, Math.min(1, Number(amount ?? 0) / denominator));
  }

  scaleHealth(amount, max = DEFAULTS.adultHealth) {
    const denominator = Math.max(1, max);
    return Math.max(0, Math.min(1, Number(amount ?? 0) / denominator));
  }

  directionForAction(action) {
    const target = action.target ?? action.to ?? action.partnerFrom;
    if (!action.from || !target) return null;
    return this.directionFromTo(action.from, target);
  }

  spatialObservationFor(agent) {
    const size = 9;
    const center = Math.floor(size / 2);
    const createMatrix = () => Array.from({ length: size }, () => Array(size).fill(0));
    const wall = createMatrix();
    const agentHealth = createMatrix();
    const food = createMatrix();
    const outOfBounds = createMatrix();
    const actedThisTurn = createMatrix();

    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const x = agent.x + col - center;
        const y = agent.y + row - center;
        if (!this.inBounds(x, y)) {
          outOfBounds[row][col] = 1;
          continue;
        }

        const block = this.getBlockAt(x, y);
        if (block?.kind === "wall") wall[row][col] = 1;
        if (block?.kind === "food") food[row][col] = this.scaleFood(block.amount);

        const occupyingAgent = this.getAgentAt(x, y);
        if (occupyingAgent) {
          agentHealth[row][col] = this.scaleHealth(occupyingAgent.health, occupyingAgent.maxHealth);
          if (this.actedThisTurn?.has(occupyingAgent.id)) actedThisTurn[row][col] = 1;
          if (occupyingAgent.heldBlock?.kind === "wall") wall[row][col] = 1;
          if (occupyingAgent.heldBlock?.kind === "food") {
            food[row][col] = this.scaleFood(occupyingAgent.heldBlock.amount);
          }
        }
      }
    }

    return {
      wall,
      agentHealth,
      food,
      outOfBounds,
      actedThisTurn,
    };
  }

  adjacentMateRequestsFor(agent) {
    const indicators = Object.fromEntries(DIRECTION_KEYS.map((dir) => [dir, 0]));
    if (!this.pendingMateRequests) return indicators;
    for (const request of this.pendingMateRequests.get(agent.id) ?? []) {
      const requester = this.agents.get(request.agentId);
      if (!requester) continue;
      const dir = this.directionFromTo(agent, requester);
      if (dir) indicators[dir] = 1;
    }
    return indicators;
  }

  isReciprocalMate(agent, target, reciprocal) {
    if (!reciprocal || reciprocal.type !== "mate") return false;
    const delta = DIRECTIONS[reciprocal.dir];
    return agent.x + delta.dx === target.x && agent.y + delta.dy === target.y;
  }

  directionFromTo(from, to) {
    return Object.entries(DIRECTIONS).find(([, delta]) => from.x + delta.dx === to.x && from.y + delta.dy === to.y)?.[0] ?? null;
  }

  findBirthCell(parentA, parentB) {
    const candidates = [
      ...this.neighborsOf(parentA.x, parentA.y),
      ...this.neighborsOf(parentB.x, parentB.y),
    ].filter((cell) => this.isEmptyGround(cell.x, cell.y));
    return candidates.length > 0 ? this.random.choice(candidates) : null;
  }

  mixGenetics(parentA, parentB) {
    const mutationRate = (parentA.genetics.mutationRate + parentB.genetics.mutationRate) / 2;
    const weightMutationRate = (parentA.genetics.weightMutationRate + parentB.genetics.weightMutationRate) / 2;
    const inheritedHue = this.random.next() < 0.5 ? parentA.genetics.hue : parentB.genetics.hue;
    const mutation = this.random.next() < mutationRate ? this.random.float(-18, 18) : 0;
    return {
      controller: parentA.genetics.controller === parentB.genetics.controller ? parentA.genetics.controller : "base",
      hue: Math.round((inheritedHue + mutation + 360) % 360),
      generation: Math.max(parentA.genetics.generation, parentB.genetics.generation) + 1,
      mutationRate,
      weightMutationRate,
      diploidGenomes: this.crossoverDiploidGenomes(parentA.genetics, parentB.genetics, weightMutationRate),
    };
  }

  crossoverDiploidGenomes(parentAGenetics, parentBGenetics, mutationRate) {
    const parentAGamete = this.recombinedGamete(parentAGenetics.diploidGenomes);
    const parentBGamete = this.recombinedGamete(parentBGenetics.diploidGenomes);
    return this.complementaryCrossover(parentAGamete, parentBGamete, mutationRate);
  }

  recombinedGamete(diploidGenomes) {
    const left = this.copyGenome(diploidGenomes?.[0]);
    const right = this.copyGenome(diploidGenomes?.[1]);
    return {
      layers: GENOME_LAYER_SHAPES.map((shape, layerIndex) => {
        const cutoff = this.random.int(shape.rows + 1);
        return Array.from({ length: shape.rows }, (_, rowIndex) => (
          rowIndex < cutoff
            ? [...left.layers[layerIndex][rowIndex]]
            : [...right.layers[layerIndex][rowIndex]]
        ));
      }),
    };
  }

  complementaryCrossover(parentAGenome, parentBGenome, mutationRate) {
    const childLeft = { layers: [] };
    const childRight = { layers: [] };
    for (let layerIndex = 0; layerIndex < GENOME_LAYER_SHAPES.length; layerIndex += 1) {
      const shape = GENOME_LAYER_SHAPES[layerIndex];
      const cutoff = this.random.int(shape.rows + 1);
      const leftLayer = [];
      const rightLayer = [];
      for (let rowIndex = 0; rowIndex < shape.rows; rowIndex += 1) {
        const leftSource = rowIndex < cutoff ? parentAGenome : parentBGenome;
        const rightSource = rowIndex < cutoff ? parentBGenome : parentAGenome;
        leftLayer.push(this.inheritGenomeRow(leftSource, layerIndex, rowIndex, mutationRate));
        rightLayer.push(this.inheritGenomeRow(rightSource, layerIndex, rowIndex, mutationRate));
      }
      childLeft.layers.push(leftLayer);
      childRight.layers.push(rightLayer);
    }
    return [childLeft, childRight];
  }

  inheritGenomeRow(sourceGenome, layerIndex, rowIndex, mutationRate) {
    return sourceGenome.layers[layerIndex][rowIndex].map((weight) => (
      this.random.next() < mutationRate ? this.randomWeight() : weight
    ));
  }

  scoreAgentGenome(agent, inputs) {
    return this.scoreDiploidGenomes(agent.genetics.diploidGenomes, inputs);
  }

  scoreDiploidGenomes(diploidGenomes, inputs) {
    if (!Array.isArray(diploidGenomes) || diploidGenomes.length !== 2) return 0;
    return (this.scoreGenome(diploidGenomes[0], inputs) + this.scoreGenome(diploidGenomes[1], inputs)) / 2;
  }

  scoreGenome(genome, inputs) {
    if (!Array.isArray(inputs) || inputs.length !== DEFAULTS.aiInputSize) {
      throw new Error(`Expected ${DEFAULTS.aiInputSize} neural inputs.`);
    }
    let values = inputs;
    for (let layerIndex = 0; layerIndex < GENOME_LAYER_SHAPES.length; layerIndex += 1) {
      const shape = GENOME_LAYER_SHAPES[layerIndex];
      const nextValues = Array(shape.cols).fill(0);
      for (let rowIndex = 0; rowIndex < shape.rows; rowIndex += 1) {
        const input = values[rowIndex] ?? 0;
        if (input === 0) continue;
        for (let colIndex = 0; colIndex < shape.cols; colIndex += 1) {
          nextValues[colIndex] += input * genome.layers[layerIndex][rowIndex][colIndex];
        }
      }
      values = layerIndex === GENOME_LAYER_SHAPES.length - 1
        ? nextValues
        : nextValues.map((value) => Math.tanh(value));
    }
    return values[0] ?? 0;
  }

  resolveAction(agent, action) {
    if (agent.heldBlock && !["move", "drop", "wait"].includes(action.type)) {
      this.recordWait(agent);
      return false;
    }

    switch (action.type) {
      case "move":
        return this.moveAgent(agent, action.dir);
      case "eat":
        return this.eatFromBlock(agent, action.dir, action.amount);
      case "destroyFood":
        return this.destroyFoodBlock(agent, action.dir, action.amount);
      case "pickup":
        return this.pickUpBlock(agent, action.dir, action.amount);
      case "drop":
        return this.dropHeldBlock(agent, action.dir, action.amount);
      case "attack":
        return this.attackAgent(agent, action.dir);
      case "mate":
        return this.resolveMateAction(agent, action);
      default:
        this.recordAction({ type: "wait", agentId: agent.id, from: { x: agent.x, y: agent.y } });
        agent.lastAction = "wait";
        if (agent.health < agent.maxHealth) agent.health = Math.min(agent.maxHealth, agent.health + 1);
        return true;
    }
  }

  blockCarriedAction(agent, action) {
    const cell = action?.dir ? this.offset(agent, action.dir) : null;
    this.recordAction({
      type: "blocked",
      agentId: agent.id,
      from: { x: agent.x, y: agent.y },
      to: cell ?? { x: agent.x, y: agent.y },
    });
    agent.lastAction = "blocked";
    return false;
  }

  resolveMateAction(agent, action) {
    const target = this.adjacentAgent(agent, action.dir);
    if (!target || target.heldBlock) {
      this.recordWait(agent);
      return false;
    }

    const pendingRequest = this.pendingMateRequestFor(agent);
    if (pendingRequest?.requester.id === target.id && this.isReciprocalMate(agent, target, action)) {
      return this.completeMating(target, agent, pendingRequest.request);
    }

    if (this.actedThisTurn.has(target.id) || agent.food < DEFAULTS.birthFoodCost || target.food < DEFAULTS.birthFoodCost) {
      this.recordWait(agent);
      return false;
    }

    this.recordAction({
      type: "mateRequest",
      agentId: agent.id,
      targetId: target.id,
      dir: action.dir,
      from: { x: agent.x, y: agent.y },
      target: { x: target.x, y: target.y },
    });
    agent.lastAction = "mateRequest";
    const requests = this.pendingMateRequests.get(target.id) ?? [];
    const request = { agentId: agent.id, targetId: target.id };
    requests.push(request);
    this.pendingMateRequests.set(target.id, requests);
    return true;
  }

  completeMating(requester, responder, request) {
    if (!this.agents.has(requester.id) || !this.agents.has(responder.id)) return false;
    if (requester.heldBlock || responder.heldBlock) {
      this.failMating(requester, responder);
      return false;
    }
    if (!this.directionFromTo(requester, responder)) {
      this.failMating(requester, responder);
      return false;
    }
    if (requester.food < DEFAULTS.birthFoodCost || responder.food < DEFAULTS.birthFoodCost) {
      this.failMating(requester, responder);
      return false;
    }

    const birthCell = this.findBirthCell(requester, responder);
    if (!birthCell) {
      this.failMating(requester, responder);
      return false;
    }

    requester.food -= DEFAULTS.birthFoodCost;
    responder.food -= DEFAULTS.birthFoodCost;
    requester.births += 1;
    responder.births += 1;
    const child = this.addAgent(birthCell.x, birthCell.y, {
      health: DEFAULTS.newbornHealth,
      food: DEFAULTS.newbornFood,
      genetics: this.mixGenetics(requester, responder),
    });
    this.recordAction({
      type: "mate",
      agentId: requester.id,
      partnerId: responder.id,
      dir: this.directionFromTo(requester, responder),
      from: { x: requester.x, y: requester.y },
      partnerFrom: { x: responder.x, y: responder.y },
      birth: { x: birthCell.x, y: birthCell.y, agentId: child?.id ?? null },
    });
    responder.lastActionRecord = {
      type: "mate",
      agentId: responder.id,
      partnerId: requester.id,
      dir: this.directionFromTo(responder, requester),
      from: { x: responder.x, y: responder.y },
      partnerFrom: { x: requester.x, y: requester.y },
      birth: { x: birthCell.x, y: birthCell.y, agentId: child?.id ?? null },
    };
    requester.lastAction = "mate";
    responder.lastAction = "mate";
    this.events.push({ type: "birth", x: birthCell.x, y: birthCell.y });
    this.removePendingMateRequest(request);
    return true;
  }

  failMating(requester, responder) {
    if (requester?.lastAction === "mateRequest") requester.lastAction = "wait";
    if (responder) {
      this.recordWait(responder);
    }
  }

  pendingMateRequestFor(agent) {
    if (!this.pendingMateRequests || agent.heldBlock) return null;
    const requests = this.pendingMateRequests.get(agent.id) ?? [];
    for (const request of requests) {
      const requester = this.agents.get(request.agentId);
      if (!requester || requester.heldBlock) continue;
      const dir = this.directionFromTo(agent, requester);
      if (dir) return { requester, dir, request };
    }
    return null;
  }

  removePendingMateRequest(requestToRemove) {
    const requests = this.pendingMateRequests.get(requestToRemove.targetId) ?? [];
    const filtered = requests.filter((request) => request !== requestToRemove);
    if (filtered.length > 0) this.pendingMateRequests.set(requestToRemove.targetId, filtered);
    else this.pendingMateRequests.delete(requestToRemove.targetId);
  }

  finalizePendingMateRequests() {
    for (const requests of this.pendingMateRequests.values()) {
      for (const request of requests) {
        const requester = this.agents.get(request.agentId);
        if (requester?.lastAction === "mateRequest") requester.lastAction = "wait";
      }
    }
  }

  recordWait(agent) {
    this.recordAction({ type: "wait", agentId: agent.id, from: { x: agent.x, y: agent.y } });
    agent.lastAction = "wait";
  }

  moveAgent(agent, dir) {
    const cell = this.offset(agent, dir);
    if (!cell || !this.isEmptyGround(cell.x, cell.y)) {
      this.recordAction({
        type: "blocked",
        agentId: agent.id,
        from: { x: agent.x, y: agent.y },
        to: cell ?? { x: agent.x, y: agent.y },
      });
      agent.lastAction = "blocked";
      return false;
    }

    const from = { x: agent.x, y: agent.y };
    this.agentGrid[this.index(agent.x, agent.y)] = null;
    agent.x = cell.x;
    agent.y = cell.y;
    this.agentGrid[this.index(agent.x, agent.y)] = agent.id;
    this.recordAction({ type: "move", agentId: agent.id, dir, from, to: { x: agent.x, y: agent.y } });
    agent.lastAction = "move";
    return true;
  }

  eatFromBlock(agent, dir, requestedAmount) {
    const cell = this.offset(agent, dir);
    const block = cell ? this.getBlockAt(cell.x, cell.y) : null;
    if (!block || block.kind !== "food") {
      this.recordAction({
        type: "blocked",
        agentId: agent.id,
        from: { x: agent.x, y: agent.y },
        to: cell ?? { x: agent.x, y: agent.y },
      });
      agent.lastAction = "blocked";
      return false;
    }

    const needed = agent.maxFood - agent.food;
    const amount = this.legalFoodActionAmount(Math.min(needed, block.amount), requestedAmount);
    if (amount === null) {
      this.recordAction({ type: "wait", agentId: agent.id, from: { x: agent.x, y: agent.y } });
      agent.lastAction = "wait";
      return false;
    }

    const blockBefore = block.amount;
    block.amount -= amount;
    agent.food += amount;
    if (block.amount <= 0) this.removeBlock(cell.x, cell.y);
    this.recordAction({
      type: "eat",
      agentId: agent.id,
      dir,
      from: { x: agent.x, y: agent.y },
      target: { x: cell.x, y: cell.y },
      amount,
      blockBefore,
    });
    agent.lastAction = "eat";
    return true;
  }

  destroyFoodBlock(agent, dir, requestedAmount) {
    const cell = this.offset(agent, dir);
    const block = cell ? this.getBlockAt(cell.x, cell.y) : null;
    if (!block || block.kind !== "food") {
      this.recordAction({
        type: "blocked",
        agentId: agent.id,
        from: { x: agent.x, y: agent.y },
        to: cell ?? { x: agent.x, y: agent.y },
      });
      agent.lastAction = "blocked";
      return false;
    }

    const blockBefore = block.amount;
    const amount = this.legalFoodActionAmount(block.amount, requestedAmount);
    if (amount === null) {
      this.recordWait(agent);
      return false;
    }
    block.amount -= amount;
    if (block.amount <= 0) this.removeBlock(cell.x, cell.y);
    this.recordAction({
      type: "destroyFood",
      agentId: agent.id,
      dir,
      from: { x: agent.x, y: agent.y },
      target: { x: cell.x, y: cell.y },
      amount,
      blockBefore,
    });
    agent.lastAction = "destroyFood";
    return true;
  }

  pickUpBlock(agent, dir, requestedAmount) {
    if (agent.heldBlock) {
      this.recordAction({ type: "blocked", agentId: agent.id, from: { x: agent.x, y: agent.y } });
      agent.lastAction = "blocked";
      return false;
    }

    const cell = this.offset(agent, dir);
    const block = cell ? this.getBlockAt(cell.x, cell.y) : null;
    if (!block) {
      this.recordAction({
        type: "blocked",
        agentId: agent.id,
        from: { x: agent.x, y: agent.y },
        to: cell ?? { x: agent.x, y: agent.y },
      });
      agent.lastAction = "blocked";
      return false;
    }

    let amount = null;
    if (block.kind === "food") {
      amount = this.legalFoodActionAmount(block.amount, requestedAmount);
      if (amount === null) {
        this.recordWait(agent);
        return false;
      }
      agent.heldBlock = { kind: "food", amount };
      block.amount -= amount;
      if (block.amount <= 0) this.removeBlock(cell.x, cell.y);
    } else {
      agent.heldBlock = this.removeBlock(cell.x, cell.y);
    }

    this.recordAction({
      type: "pickup",
      agentId: agent.id,
      dir,
      from: { x: agent.x, y: agent.y },
      target: { x: cell.x, y: cell.y },
      blockKind: agent.heldBlock?.kind ?? block.kind,
      amount,
    });
    agent.lastAction = "pickup";
    return true;
  }

  dropHeldBlock(agent, dir, requestedAmount) {
    if (!agent.heldBlock) {
      this.recordAction({ type: "blocked", agentId: agent.id, from: { x: agent.x, y: agent.y } });
      agent.lastAction = "blocked";
      return false;
    }

    const cell = this.offset(agent, dir);
    if (!cell || !this.isEmptyGround(cell.x, cell.y)) {
      this.recordAction({
        type: "blocked",
        agentId: agent.id,
        from: { x: agent.x, y: agent.y },
        to: cell ?? { x: agent.x, y: agent.y },
      });
      agent.lastAction = "blocked";
      return false;
    }

    const blockKind = agent.heldBlock.kind;
    let amount = null;
    if (agent.heldBlock.kind === "food") {
      amount = this.legalFoodActionAmount(agent.heldBlock.amount, requestedAmount);
      if (amount === null) {
        this.recordWait(agent);
        return false;
      }
      this.addBlock(cell.x, cell.y, { kind: "food", amount });
      agent.heldBlock.amount -= amount;
      if (agent.heldBlock.amount <= 0) agent.heldBlock = null;
    } else {
      this.addBlock(cell.x, cell.y, agent.heldBlock);
      agent.heldBlock = null;
    }

    this.recordAction({
      type: "drop",
      agentId: agent.id,
      dir,
      from: { x: agent.x, y: agent.y },
      target: { x: cell.x, y: cell.y },
      blockKind,
      amount,
    });
    agent.lastAction = "drop";
    return true;
  }

  attackAgent(agent, dir) {
    const target = this.adjacentAgent(agent, dir);
    if (!target) {
      const cell = this.offset(agent, dir);
      this.recordAction({
        type: "blocked",
        agentId: agent.id,
        from: { x: agent.x, y: agent.y },
        to: cell ?? { x: agent.x, y: agent.y },
      });
      agent.lastAction = "blocked";
      return false;
    }

    const targetHealthBefore = target.health;
    const damage = target.heldBlock ? agent.attackDamage * 2 : agent.attackDamage;
    target.health -= damage;
    const killed = target.health <= 0;
    this.recordAction({
      type: "attack",
      agentId: agent.id,
      targetId: target.id,
      dir,
      from: { x: agent.x, y: agent.y },
      target: { x: target.x, y: target.y },
      damage,
      targetHealthBefore,
      killed,
    });
    if (target.health <= 0) {
      agent.kills += 1;
      this.removeAgent(target, "killed");
    }
    agent.lastAction = "attack";
    return true;
  }

  recordAction(action) {
    const recorded = { order: this.actionLog.length, ...action };
    this.actionLog.push(recorded);
    const agent = this.agents.get(recorded.agentId);
    if (agent) agent.lastActionRecord = { ...recorded };
  }

  adjacentAgent(agent, dir) {
    const cell = this.offset(agent, dir);
    return cell ? this.getAgentAt(cell.x, cell.y) : null;
  }

  offset(agent, dir) {
    const delta = DIRECTIONS[dir];
    if (!delta) return null;
    const x = agent.x + delta.dx;
    const y = agent.y + delta.dy;
    return this.inBounds(x, y) ? { x, y } : null;
  }

  applyMetabolism() {
    for (const agent of Array.from(this.agents.values())) {
      if (agent.food > 0) {
        agent.food = Math.max(0, agent.food - DEFAULTS.foodBurnPerTurn);
      } else {
        const damage =
          agent.lastAction === "wait"
            ? DEFAULTS.starvationDamageWaiting
            : DEFAULTS.starvationDamageMoving;
        agent.health -= damage;
      }

      agent.age += 1;
      if (agent.health <= 0) this.removeAgent(agent, "starved");
    }
  }

  growGroundFood() {
    for (const block of this.blocks) {
      if (block?.kind === "food") {
        block.amount = Math.min(DEFAULTS.maxFoodPerBlock, block.amount + DEFAULTS.foodGrowthPerTurn);
      }
    }
  }

  countBlocks(kind) {
    return this.blocks.reduce((count, block) => count + (block?.kind === kind ? 1 : 0), 0);
  }
}

window.PixelAgents = {
  ...window.PixelAgents,
  GENOME_LAYER_SHAPES,
  Simulation,
};
})();
