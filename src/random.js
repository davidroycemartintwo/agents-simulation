(() => {
  class Random {
    constructor(seed = Date.now()) {
      this.seed = seed >>> 0;
    }

    next() {
      this.seed += 0x6d2b79f5;
      let t = this.seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    int(maxExclusive) {
      return Math.floor(this.next() * maxExclusive);
    }

    float(min, max) {
      return min + this.next() * (max - min);
    }

    normal(mean = 0, sd = 1) {
      const u1 = Math.max(this.next(), Number.EPSILON);
      const u2 = this.next();
      const magnitude = Math.sqrt(-2 * Math.log(u1));
      return mean + sd * magnitude * Math.cos(2 * Math.PI * u2);
    }

    choice(items) {
      return items[this.int(items.length)];
    }

    shuffle(items) {
      for (let i = items.length - 1; i > 0; i -= 1) {
        const j = this.int(i + 1);
        [items[i], items[j]] = [items[j], items[i]];
      }
      return items;
    }
  }

  window.PixelAgents = {
    ...(window.PixelAgents ?? {}),
    Random,
  };
})();
