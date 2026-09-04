// The per-run ship: where the pakjes are hidden, where Mr. Geil starts, the
// circuit he paces, and which lanterns are dead.
//
// The static grid in map.js is the hull — corridors, bulkheads, cargo stacks,
// the shrine — and never changes. Everything a player can learn and exploit is
// rolled here from the run's seed, so knowing the ship stops being the same as
// knowing the run.
//
// Every layout is checked against the rules below before it is handed back
// (see validateRunLayout). A generation that breaks them is retried, and if the
// rules are ever tightened past what the hull can support the authored layout
// is used instead, so the game always boots.

import { Rng } from './rng.js';

export const LAYOUT_RULES = {
  presentCount: 10,        // pakjes on the ship; five pillows finish a run
  presentSeparation: 13,   // metres between two pakjes, so none share a nook
  minStartDistance: 11,    // nothing within earshot of where you wake up
  minAltarDistance: 6,     // keep the shrine approach clear of loot
  perZoneMinimum: 2,       // every compartment is worth searching
  routeLength: 5,          // waypoints in his patrol circuit
  routeSeparation: 18,     // metres between waypoints: long legs, not loitering
  enemyMinStartDistance: 28,
  // A crew wakes up together but not on top of one another: far enough apart
  // to be four people in a corridor, near enough that the first thing anybody
  // does is find the others.
  crewSize: 4,
  crewSeparation: 3.4,
  crewRadius: 15,
  crewPresentClearance: 5,
  // Mr. Geil's collision radius (see updateMovement in enemy.js). Anywhere he
  // is placed has to fit a body this wide or he starts the run wedged.
  bodyRadius: 0.5,
  zones: ['fore', 'engine', 'cargo', 'bilge']
};

// A cell he can stand on rather than merely one the grid calls walkable: a
// prop's collider can encroach on a cell centre without the grid knowing.
function isStandable(map, tile) {
  return map.isWalkableCell(tile.r, tile.c) &&
    !map.checkCollision(tile.x, tile.z, LAYOUT_RULES.bodyRadius);
}

// Cells a pakje may never sit on, whatever the seed.
function isPresentCell(map, tile) {
  const val = map.grid[tile.r][tile.c];
  if (val === 1 || val === 2 || val === 'A' || val === 'S') return false;
  return map.zoneAtCell(tile.r, tile.c) !== 'shrine';
}

function wallNeighbours(map, r, c) {
  let count = 0;
  const around = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]];
  for (const [nr, nc] of around) {
    if (nr < 0 || nr >= map.rows || nc < 0 || nc >= map.cols) count++;
    else if (map.grid[nr][nc] === 1) count++;
  }
  return count;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

// Tiles that could hold a pakje. A cell with no bulkhead beside it is skipped:
// presents are nudged against a wall, and one stranded mid-junction reads as
// dropped rather than hidden.
export function eligiblePresentTiles(map) {
  const start = map.playerStart;
  const altar = map.altarLocation;

  return map.walkableTiles.filter(tile => {
    if (!isPresentCell(map, tile)) return false;
    if (wallNeighbours(map, tile.r, tile.c) === 0) return false;
    if (dist(tile, start) < LAYOUT_RULES.minStartDistance) return false;
    if (dist(tile, altar) < LAYOUT_RULES.minAltarDistance) return false;
    return true;
  });
}

// Greedy spread: draw tiles that sit at least `separation` from everything
// picked so far, favouring nooks (more bulkheads around the cell) so pakjes
// stay tucked into corners. Loosens the spacing rather than failing.
function drawSpread(rng, pool, count, separation, taken = []) {
  const chosen = [];
  let spacing = separation;

  while (chosen.length < count && spacing >= 0) {
    const free = pool.filter(tile =>
      !taken.some(t => t.r === tile.r && t.c === tile.c) &&
      !chosen.some(t => t.r === tile.r && t.c === tile.c));

    let progressed = false;
    while (chosen.length < count) {
      const candidates = free.filter(tile =>
        !chosen.some(t => t.r === tile.r && t.c === tile.c) &&
        chosen.every(t => dist(t, tile) >= spacing) &&
        taken.every(t => dist(t, tile) >= spacing));
      if (!candidates.length) break;

      chosen.push(rng.pickWeighted(candidates, t => 1 + t.nooks));
      progressed = true;
    }

    if (chosen.length >= count) break;
    // Loosen and go again. This terminates: spacing 0 accepts anything left.
    spacing -= progressed ? 3 : 5;
  }

  return chosen;
}

function annotate(map, tiles) {
  return tiles.map(tile => ({
    r: tile.r,
    c: tile.c,
    x: tile.x,
    z: tile.z,
    zone: map.zoneAtCell(tile.r, tile.c),
    nooks: wallNeighbours(map, tile.r, tile.c)
  }));
}

function placePresents(map, rng) {
  const pool = annotate(map, eligiblePresentTiles(map));
  const chosen = [];

  // Every compartment gets its minimum first, so no quarter of the ship is
  // dead space and no quarter holds the whole run.
  for (const zone of LAYOUT_RULES.zones) {
    const zonePool = pool.filter(t => t.zone === zone);
    chosen.push(...drawSpread(
      rng, zonePool, LAYOUT_RULES.perZoneMinimum,
      LAYOUT_RULES.presentSeparation, chosen
    ));
  }

  // Then fill the rest from the whole ship.
  const remaining = LAYOUT_RULES.presentCount - chosen.length;
  if (remaining > 0) {
    chosen.push(...drawSpread(rng, pool, remaining, LAYOUT_RULES.presentSeparation, chosen));
  }

  return chosen.slice(0, LAYOUT_RULES.presentCount);
}

function placeEnemySpawn(map, rng) {
  const start = map.playerStart;

  // Standability is the floor under all three tiers, not a nicety of the first
  // one: relaxing the distance or the sight line to find him a berth must
  // never relax it into a crate. He is dropped straight onto this cell without
  // a collision pass, so an unstandable one is a monster that never patrols.
  const standable = map.walkableTiles.filter(tile =>
    map.grid[tile.r][tile.c] !== 2 && isStandable(map, tile));

  const distant = standable.filter(tile =>
    dist(tile, start) >= LAYOUT_RULES.enemyMinStartDistance);

  // Far away, and not down a straight corridor from where you wake up: the
  // opening seconds should be quiet, not a coin flip.
  const far = distant.filter(tile =>
    !map.hasLineOfSight(start.x, start.z, tile.x, tile.z));

  const pool = far.length ? far : (distant.length ? distant : standable);
  const tile = rng.pick(pool);
  return { r: tile.r, c: tile.c, x: tile.x, z: tile.z };
}

// A circuit rather than a random walk: one waypoint per compartment plus a
// spare, ordered nearest-first from where he starts. He becomes learnable
// within a run without being learnable across runs.
function buildPatrolRoute(map, rng, spawn) {
  const pool = annotate(map, map.walkableTiles.filter(t => map.grid[t.r][t.c] !== 2));
  const waypoints = [];

  for (const zone of LAYOUT_RULES.zones) {
    const zonePool = pool.filter(t => t.zone === zone);
    waypoints.push(...drawSpread(rng, zonePool, 1, LAYOUT_RULES.routeSeparation, waypoints));
  }
  const spare = LAYOUT_RULES.routeLength - waypoints.length;
  if (spare > 0) {
    waypoints.push(...drawSpread(rng, pool, spare, LAYOUT_RULES.routeSeparation, waypoints));
  }

  // Nearest-neighbour ordering from his spawn, so the circuit loops around the
  // ship instead of zigzagging across it.
  const ordered = [];
  const left = [...waypoints];
  let from = spawn;
  while (left.length) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < left.length; i++) {
      const d = dist(from, left[i]);
      if (d < bestDist) { bestDist = d; best = i; }
    }
    from = left[best];
    ordered.push({ r: from.r, c: from.c, x: from.x, z: from.z });
    left.splice(best, 1);
  }
  return ordered;
}

// Where a crew wakes up. The first berth is always the authored start, so a
// run played alone is the run that was always there and the rest of the ship's
// rules — pakjes at least 11 m from where you wake, Mr. Geil at least 28 —
// still measure from the same cell. The other three are dealt around it.
function placeCrewSpawns(map, rng, presents) {
  const start = map.playerStart;
  const first = map.worldToCell(start.x, start.z);
  const spawns = [{ r: first.r, c: first.c, x: start.x, z: start.z }];

  const pool = map.walkableTiles.filter(tile => {
    if (map.grid[tile.r][tile.c] === 2) return false;
    if (map.zoneAtCell(tile.r, tile.c) === 'shrine') return false;
    if (!isStandable(map, tile)) return false;
    if (dist(tile, start) > LAYOUT_RULES.crewRadius) return false;
    // Waking up on top of a pakje would hand the run to whoever spawned there.
    return presents.every(p => dist(tile, p) >= LAYOUT_RULES.crewPresentClearance);
  });

  const shuffled = rng.shuffle(pool);
  let spacing = LAYOUT_RULES.crewSeparation;
  while (spawns.length < LAYOUT_RULES.crewSize && spacing > 0) {
    for (const tile of shuffled) {
      if (spawns.length >= LAYOUT_RULES.crewSize) break;
      if (spawns.some(s => s.r === tile.r && s.c === tile.c)) continue;
      if (!spawns.every(s => dist(s, tile) >= spacing)) continue;
      spawns.push({ r: tile.r, c: tile.c, x: tile.x, z: tile.z });
    }
    // A tight hull is allowed to stand people closer rather than stack them
    // all on the one authored cell.
    spacing -= 1.2;
  }
  return spawns;
}

// Which lantern fixtures are dead this run. Roughly a fifth, as before — but a
// different fifth, so the dark stretches move.
function rollLanterns(map, rng) {
  return map.lanternSpots.map(() => rng.next() > 0.22);
}

export function generateRunLayout(map, rng, attempts = 8) {
  let worst = null;

  for (let i = 0; i < attempts; i++) {
    const enemySpawn = placeEnemySpawn(map, rng);
    const presents = placePresents(map, rng);
    const layout = {
      presents,
      enemySpawn,
      crewSpawns: placeCrewSpawns(map, rng, presents),
      patrolRoute: buildPatrolRoute(map, rng, enemySpawn),
      lanternsAlive: rollLanterns(map, rng),
      authored: false
    };

    const problems = validateRunLayout(map, layout);
    if (!problems.length) return layout;
    if (!worst) worst = problems;
  }

  // The hull can no longer satisfy the rules — someone tightened them, or
  // edited the grid. Ship the authored layout rather than a broken one.
  console.warn('GEIL: falling back to the authored layout —', worst.join('; '));
  return authoredLayout(map);
}

// The hand-placed layout read straight off the grid, used as the safety net.
export function authoredLayout(map) {
  const presents = map.authoredPresentSpawns.map(t => ({ r: t.r, c: t.c, x: t.x, z: t.z }));
  // The hand-placed berth, with a search rather than walkableTiles[0] behind
  // it — that first tile is the player's own start cell.
  const spawn = map.walkableTiles.find(t => t.r === 17 && t.c === 9) ||
    map.walkableTiles.find(t => isStandable(map, t) &&
      dist(t, map.playerStart) >= LAYOUT_RULES.enemyMinStartDistance) ||
    map.walkableTiles[0];
  return {
    presents,
    enemySpawn: { r: spawn.r, c: spawn.c, x: spawn.x, z: spawn.z },
    crewSpawns: placeCrewSpawns(map, new Rng(0x5747), presents),
    patrolRoute: [],
    lanternsAlive: map.lanternSpots.map(spot => spot.alive),
    authored: true
  };
}

// --- Rules -------------------------------------------------------------

export function validateRunLayout(map, layout) {
  const problems = [];
  if (!layout) return ['no layout'];

  const reachable = map.floodFrom(map.playerStart.x, map.playerStart.z);
  const key = t => t.r * map.cols + t.c;
  const { presents, enemySpawn, patrolRoute } = layout;

  if (presents.length !== LAYOUT_RULES.presentCount) {
    problems.push(`${presents.length} pakjes, expected ${LAYOUT_RULES.presentCount}`);
  }

  const seen = new Set();
  for (const p of presents) {
    if (seen.has(key(p))) problems.push(`two pakjes on cell ${p.r},${p.c}`);
    seen.add(key(p));

    if (!isPresentCell(map, p)) problems.push(`pakje on an illegal cell ${p.r},${p.c}`);
    if (!reachable.has(key(p))) problems.push(`pakje at ${p.r},${p.c} is walled off`);
    if (dist(p, map.playerStart) < LAYOUT_RULES.minStartDistance) {
      problems.push(`pakje at ${p.r},${p.c} sits on the player start`);
    }
    if (dist(p, map.altarLocation) < LAYOUT_RULES.minAltarDistance) {
      problems.push(`pakje at ${p.r},${p.c} is inside the shrine`);
    }
  }

  for (let i = 0; i < presents.length; i++) {
    for (let j = i + 1; j < presents.length; j++) {
      const d = dist(presents[i], presents[j]);
      // Half the target spacing is the hard floor; the generator only relaxes
      // toward it when a compartment is tight.
      if (d < LAYOUT_RULES.presentSeparation / 2) {
        problems.push(`pakjes ${i} and ${j} are ${d.toFixed(1)} m apart`);
      }
    }
  }

  for (const zone of LAYOUT_RULES.zones) {
    const count = presents.filter(p => map.zoneAtCell(p.r, p.c) === zone).length;
    if (count < LAYOUT_RULES.perZoneMinimum) {
      problems.push(`${zone} holds only ${count} pakje(s)`);
    }
  }

  if (!enemySpawn) {
    problems.push('no spawn for Mr. Geil');
  } else {
    if (!map.isWalkableCell(enemySpawn.r, enemySpawn.c)) {
      problems.push('Mr. Geil spawns inside a bulkhead');
    }
    if (!reachable.has(key(enemySpawn))) {
      problems.push('Mr. Geil spawns in a sealed compartment');
    }
    if (dist(enemySpawn, map.playerStart) < LAYOUT_RULES.enemyMinStartDistance) {
      problems.push('Mr. Geil spawns on top of the player');
    }
    // Same rule as a patrol waypoint, for the same reason: he is placed on the
    // cell centre and pathfinds from it, so a prop over that centre wedges him
    // before he has taken a step.
    if (map.checkCollision(enemySpawn.x, enemySpawn.z, LAYOUT_RULES.bodyRadius)) {
      problems.push('Mr. Geil spawns wedged against a prop');
    }
  }

  if (patrolRoute.length) {
    if (patrolRoute.length !== LAYOUT_RULES.routeLength) {
      problems.push(`${patrolRoute.length} patrol waypoints, expected ${LAYOUT_RULES.routeLength}`);
    }
    const covered = new Set(patrolRoute.map(w => map.zoneAtCell(w.r, w.c)));
    for (const zone of LAYOUT_RULES.zones) {
      if (!covered.has(zone)) problems.push(`the patrol never enters ${zone}`);
    }
    for (const w of patrolRoute) {
      if (!reachable.has(key(w))) problems.push(`patrol waypoint ${w.r},${w.c} is walled off`);
      // Pathfinding walks cell centre to cell centre, so a waypoint whose
      // centre is not standable wedges him against a prop forever.
      if (map.checkCollision(w.x, w.z, LAYOUT_RULES.bodyRadius)) {
        problems.push(`patrol waypoint ${w.r},${w.c} is blocked by a prop`);
      }
    }
  }

  // A crew berth is walked from the moment the run starts, so it answers to
  // the same rule as a patrol waypoint. Coming up short is not a broken ship —
  // a run played alone never reads past the first one — so only the berths
  // that were dealt are checked.
  for (const berth of layout.crewSpawns || []) {
    if (!map.isWalkableCell(berth.r, berth.c)) {
      problems.push(`crew berth ${berth.r},${berth.c} is inside a bulkhead`);
    }
    if (!reachable.has(key(berth))) problems.push(`crew berth ${berth.r},${berth.c} is walled off`);
    if (map.checkCollision(berth.x, berth.z, LAYOUT_RULES.bodyRadius)) {
      problems.push(`crew berth ${berth.r},${berth.c} is blocked by a prop`);
    }
  }

  if (layout.lanternsAlive && layout.lanternsAlive.length !== map.lanternSpots.length) {
    problems.push('the lantern pattern does not match the fixtures');
  }

  return problems;
}
