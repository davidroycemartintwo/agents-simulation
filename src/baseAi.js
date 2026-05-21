(() => {
  const { DEFAULTS, DIRECTIONS } = window.PixelAgents;

  function baseAiController(agent, sim) {
    const mateRequest = sim.pendingMateRequestFor(agent);
    if (mateRequest) {
      return {
        type: "mate",
        dir: mateRequest.dir,
      };
    }

    const neighbors = sim.neighborsOf(agent.x, agent.y);
    const adjacentAgents = neighbors.filter((cell) => cell.agent);

    if (adjacentAgents.length > 0) {
      return {
        type: "attack",
        dir: sim.random.choice(adjacentAgents).dir,
      };
    }

    const adjacentFood = neighbors.filter((cell) => cell.block?.kind === "food");

    if (adjacentFood.length > 0 && agent.food < DEFAULTS.eatIfBelowFood) {
      return {
        type: "eat",
        dir: sim.random.choice(adjacentFood).dir,
      };
    }

    if (adjacentFood.length > 0) {
      return { type: "wait" };
    }

    return {
      type: "move",
      dir: sim.random.choice(Object.keys(DIRECTIONS)),
    };
  }

  window.PixelAgents = {
    ...window.PixelAgents,
    baseAiController,
  };
})();
