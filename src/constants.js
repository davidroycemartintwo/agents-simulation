(() => {
  const DIRECTIONS = {
    N: { dx: 0, dy: -1 },
    E: { dx: 1, dy: 0 },
    S: { dx: 0, dy: 1 },
    W: { dx: -1, dy: 0 },
  };

  const DEFAULTS = {
    width: 100,
    height: 100,
    initialAgents: 36,
    initialFoodBlocks: 64,
    initialWalls: 360,
    startingFoodPerBlock: 1000,
    maxFoodPerBlock: 1000,
    adultHealth: 100,
    adultFood: 1000,
    attackDamage: 10,
    birthFoodCost: 500,
    newbornFood: 100,
    newbornHealth: 10,
    eatIfBelowFood: 900,
    foodGrowthPerTurn: 1,
    foodBurnPerTurn: 1,
    starvationDamageMoving: 2,
    starvationDamageWaiting: 1,
    aiInputSize: 439,
    neuralLayerSizes: [32, 32, 1],
    initialWeightMean: 0,
    initialWeightSd: 0.01,
    weightMutationRate: 0.001,
  };

  window.PixelAgents = {
    ...(window.PixelAgents ?? {}),
    DIRECTIONS,
    DEFAULTS,
  };
})();
