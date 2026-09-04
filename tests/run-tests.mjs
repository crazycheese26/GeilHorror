// Headless harness: node tests/run-tests.mjs
//
// The simulation modules never touch the DOM, so with a stubbed Three.js and
// document they run straight in node. This covers the two things that break
// quietly — a generated ship that strands a pakje or wedges Mr. Geil against a
// crate, and the stealth arithmetic that the whole game rests on.

import { installStubs } from './stubs.mjs';

installStubs();

const { SteamboatMap } = await import('../src/map.js');
const { Player } = await import('../src/player.js');
const { GeilEnemy, STATE } = await import('../src/enemy.js');
const { ItemManager } = await import('../src/items.js');
const { TributeAltar } = await import('../src/tribute.js');
const { Rng, makeSeed, formatSeed, parseSeed } = await import('../src/rng.js');
const {
  LAYOUT_RULES, generateRunLayout, validateRunLayout,
  authoredLayout, eligiblePresentTiles
} = await import('../src/layout.js');
const { horrorAudio, TRACKS } = await import('../src/audio.js');
const { Lantern, LANTERN_RANGE, LANTERN_ALARM } = await import('../src/lantern.js');
const { NetSession, MODE, BLEED_SECONDS } = await import('../src/net/session.js');
const {
  makeRoomCode, normaliseCode, isValidCode, topicFor, makePeerId
} = await import('../src/net/signal.js');

const { existsSync, statSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const projectFile = rel => fileURLToPath(new URL(`../${rel}`, import.meta.url));

// --- Tiny test runner ---------------------------------------------------

let passed = 0;
const failures = [];
let group = '';

function section(name) {
  group = name;
}

function check(name, condition, detail = '') {
  if (condition) {
    passed++;
  } else {
    failures.push(`${group} › ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function near(a, b, tolerance = 1e-6) {
  return Math.abs(a - b) <= tolerance;
}

// --- Shared fixtures ----------------------------------------------------

const scene = new THREE.Scene();
const map = new SteamboatMap(scene);
const settings = { controlScheme: 'mouse', sensitivity: 1, brightness: 40, volume: 0 };

function newPlayer() {
  const camera = new THREE.PerspectiveCamera();
  return new Player(camera, map, document.createElement('canvas'), settings);
}

const cell = (r, c) => ({ x: c * map.cellSize, z: r * map.cellSize });

// Walk a body of Mr. Geil's radius from A to B the way the game does: ask for
// the next cell, step toward it, resolve collisions, repath on a wedge.
function walkTo(from, to, radius = 0.5) {
  let x = from.x;
  let z = from.z;
  let step = null;
  let sinceRepath = 99;
  const delta = 0.1;
  const speed = 2.4;

  for (let tick = 0; tick < 4000; tick++) {
    if (Math.hypot(to.x - x, to.z - z) < 1.8) return { arrived: true, tick };

    if (!step || sinceRepath >= 3) {
      step = map.findPathNextStep(x, z, to.x, to.z);
      sinceRepath = 0;
      if (!step) return { arrived: false, why: 'no path' };
    }
    sinceRepath++;

    const dx = step.x - x;
    const dz = step.z - z;
    const d = Math.hypot(dx, dz);
    if (d < 0.08) { step = null; continue; }

    const len = Math.min(speed * delta, d);
    const moved = map.resolveCollision(x, z, x + (dx / d) * len, z + (dz / d) * len, radius);
    const travelled = Math.hypot(moved.x - x, moved.z - z);
    x = moved.x;
    z = moved.z;
    if (travelled < len * 0.2) step = null;
  }
  return { arrived: false, why: 'never got there' };
}

// --- Seeds --------------------------------------------------------------

section('rng');
{
  const a = new Rng(12345);
  const b = new Rng(12345);
  const c = new Rng(12346);
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  const seqC = [c.next(), c.next(), c.next()];

  check('a seed replays exactly', seqA.every((v, i) => v === seqB[i]));
  check('a different seed diverges', seqA.some((v, i) => v !== seqC[i]));
  check('values stay in [0,1)', seqA.every(v => v >= 0 && v < 1));

  const source = [1, 2, 3, 4, 5, 6, 7, 8];
  const shuffled = new Rng(7).shuffle(source);
  check('shuffle keeps every element', [...shuffled].sort().join() === source.join());
  check('shuffle leaves the input alone', source.join() === '1,2,3,4,5,6,7,8');

  const weighted = new Rng(3).pickWeighted([{ w: 0 }, { w: 0 }], o => o.w);
  check('an all-zero weighting still returns something', weighted !== undefined);

  check('a formatted seed parses back', parseSeed(formatSeed(918273)) === 918273);
  check('an empty seed means "roll one"', parseSeed('') === null && parseSeed('   ') === null);
  check('punctuation alone means "roll one"', parseSeed('!!!') === null);
  check('a word is a valid seed', typeof parseSeed('stoomboot') === 'number');
  check('a word is stable', parseSeed('stoomboot') === parseSeed('STOOMBOOT'));
  check('makeSeed is a uint32', Number.isInteger(makeSeed()) && makeSeed() >= 0);
}

// --- Generated layouts --------------------------------------------------

section('layout');
{
  const pool = eligiblePresentTiles(map);
  check('the hull offers room for pakjes', pool.length > LAYOUT_RULES.presentCount * 4,
    `${pool.length} eligible tiles`);
  check('no eligible tile is a cargo stack', pool.every(t => map.grid[t.r][t.c] !== 2));
  check('no eligible tile is inside the shrine',
    pool.every(t => map.zoneAtCell(t.r, t.c) !== 'shrine'));

  const SEEDS = 200;
  const problems = [];
  const distinct = new Set();
  const spawnCells = new Set();
  let minSeparation = Infinity;
  let clippedPresents = 0;
  let usedFallback = 0;
  let wedgedSpawns = 0;

  for (let i = 0; i < SEEDS; i++) {
    const layout = generateRunLayout(map, new Rng(i * 2654435761 % 0xffffffff));
    const found = validateRunLayout(map, layout);
    if (found.length) problems.push(`seed ${i}: ${found.join('; ')}`);
    if (layout.authored) usedFallback++;

    distinct.add(layout.presents.map(p => `${p.r},${p.c}`).sort().join('|'));
    spawnCells.add(`${layout.enemySpawn.r},${layout.enemySpawn.c}`);
    const spawn = layout.enemySpawn;
    if (map.checkCollision(spawn.x, spawn.z, LAYOUT_RULES.bodyRadius)) wedgedSpawns++;

    for (let a = 0; a < layout.presents.length; a++) {
      // The present model is nudged 0.95 m toward a bulkhead; check the box it
      // actually occupies is clear of walls and crates rather than the cell.
      const p = layout.presents[a];
      const off = map.offsetTowardWall(p.r, p.c, 0.95);
      if (map.checkCollision(p.x + off.dx, p.z + off.dz, 0.55)) clippedPresents++;

      for (let b = a + 1; b < layout.presents.length; b++) {
        const q = layout.presents[b];
        minSeparation = Math.min(minSeparation, Math.hypot(p.x - q.x, p.z - q.z));
      }
    }
  }

  check(`${SEEDS} seeds all produce a legal ship`, problems.length === 0, problems[0]);
  check('none of them fall back to the authored layout', usedFallback === 0);
  check('no pakje clips a bulkhead or a crate', clippedPresents === 0,
    `${clippedPresents} clipped`);
  check('pakjes keep their spacing', minSeparation >= LAYOUT_RULES.presentSeparation / 2,
    `closest pair ${minSeparation.toFixed(1)} m`);
  check('seeds give different ships', distinct.size > SEEDS * 0.95,
    `${distinct.size} distinct layouts in ${SEEDS} seeds`);
  check('Mr. Geil does not always start in the same place', spawnCells.size > 8,
    `${spawnCells.size} distinct spawns`);
  check('and never starts wedged against something', wedgedSpawns === 0,
    `${wedgedSpawns} of ${SEEDS} spawns blocked`);

  const twice = [generateRunLayout(map, new Rng(4242)), generateRunLayout(map, new Rng(4242))];
  check('the same seed rebuilds the same ship',
    JSON.stringify(twice[0]) === JSON.stringify(twice[1]));

  const layout = generateRunLayout(map, new Rng(99));
  check('the pakjes are spread across every compartment',
    LAYOUT_RULES.zones.every(zone =>
      layout.presents.filter(p => map.zoneAtCell(p.r, p.c) === zone).length
        >= LAYOUT_RULES.perZoneMinimum));
  check('there are more pakjes than the run needs', layout.presents.length > 5);
  check('the lantern pattern covers every fixture',
    layout.lanternsAlive.length === map.lanternSpots.length);
  check('some lanterns are dead and some are not',
    layout.lanternsAlive.includes(true) && layout.lanternsAlive.includes(false));
  check('the patrol crosses the whole ship',
    new Set(layout.patrolRoute.map(w => map.zoneAtCell(w.r, w.c))).size >= 4);

  // The safety net has to be structurally sound even though it predates the
  // per-zone rule and would not pass it.
  const authored = authoredLayout(map);
  check('the authored fallback still has its pakjes',
    authored.presents.length === map.authoredPresentSpawns.length && authored.presents.length > 5);
  check('the authored fallback spawns him somewhere walkable',
    map.isWalkableCell(authored.enemySpawn.r, authored.enemySpawn.c));

  // A broken plan must be caught, not shipped.
  const sabotaged = {
    ...layout,
    presents: [...layout.presents.slice(1), { r: 0, c: 0, x: 0, z: 0 }]
  };
  check('validation rejects a pakje inside a bulkhead',
    validateRunLayout(map, sabotaged).length > 0);
  check('validation rejects a spawn on the player',
    validateRunLayout(map, { ...layout, enemySpawn: { r: 1, c: 1, x: 4, z: 4 } }).length > 0);

  // He is dropped straight onto his spawn cell with no collision pass, so an
  // unstandable one is a monster that never takes a step.
  const onTheAltar = { r: 11, c: 10, x: map.altarLocation.x, z: map.altarLocation.z };
  check('validation rejects a spawn wedged against a prop',
    validateRunLayout(map, { ...layout, enemySpawn: onTheAltar })
      .some(p => p.includes('wedged')));
}

// --- The hull's own invariants ------------------------------------------

section('map');
{
  const unstandable = map.walkableTiles.filter(t => map.checkCollision(t.x, t.z, 0.5));
  check('every walkable cell centre fits a body of radius 0.5',
    unstandable.length === 0,
    unstandable.map(t => `${t.r},${t.c}`).join(' '));

  check('the whole ship is reachable from the player start',
    map.floodFrom(map.playerStart.x, map.playerStart.z).size === map.walkableTiles.length);

  check('a bulkhead blocks sight',
    !map.hasLineOfSight(cell(1, 3).x, cell(1, 3).z, cell(1, 5).x, cell(1, 5).z));
  check('an open corridor does not',
    map.hasLineOfSight(cell(13, 1).x, cell(13, 1).z, cell(13, 5).x, cell(13, 5).z));
  check('a cargo stack is see-over when you are standing',
    map.hasLineOfSight(cell(5, 1).x, cell(5, 1).z, cell(5, 3).x, cell(5, 3).z));
  check('a cargo stack blocks sight when you are crouched',
    !map.hasLineOfSight(cell(5, 1).x, cell(5, 1).z, cell(5, 3).x, cell(5, 3).z, true));
  check('sight is symmetric',
    map.hasLineOfSight(cell(13, 1).x, cell(13, 1).z, cell(13, 9).x, cell(13, 9).z) ===
    map.hasLineOfSight(cell(13, 9).x, cell(13, 9).z, cell(13, 1).x, cell(13, 1).z));

  check('pathfinding refuses a target inside a bulkhead',
    map.findPathNextStep(map.playerStart.x, map.playerStart.z, 0, 0) === null);
  const step = map.findPathNextStep(map.playerStart.x, map.playerStart.z, cell(19, 19).x, cell(19, 19).z);
  check('pathfinding returns a neighbouring cell', step !== null &&
    Math.hypot(step.x - map.playerStart.x, step.z - map.playerStart.z) <= map.cellSize + 1e-6);

  check('getRandomTileFrom respects a minimum distance', (() => {
    for (let i = 0; i < 50; i++) {
      const t = map.getRandomTileFrom(map.playerStart.x, map.playerStart.z, 16);
      if (Math.hypot(t.x - map.playerStart.x, t.z - map.playerStart.z) <= 16) return false;
    }
    return true;
  })());
  check('getRandomTileFrom honours a filter', (() => {
    for (let i = 0; i < 50; i++) {
      const t = map.getRandomTileFrom(0, 0, 8, tile => map.zoneAtCell(tile.r, tile.c) === 'bilge');
      if (map.zoneAtCell(t.r, t.c) !== 'bilge') return false;
    }
    return true;
  })());
  check('an impossible filter still returns a tile',
    map.getRandomTileFrom(0, 0, 500, () => false) !== undefined);

  // The altar is stone. It also lies across the boundary between the two
  // shrine rows, so the grid alone would happily route a body straight through
  // it — the crossing has to be blocked as well as the volume.
  check('the altar is solid',
    map.checkCollision(map.altarLocation.x, map.altarLocation.z, 0.42));
  const shrineIn = cell(12, 10);
  const shrineFar = cell(11, 10);
  const round = map.findPathNextStep(shrineIn.x, shrineIn.z, shrineFar.x, shrineFar.z);
  check('and pathfinding goes round it rather than through it',
    round !== null && !(near(round.x, shrineFar.x) && near(round.z, shrineFar.z)),
    JSON.stringify(round));
  check('the far side of the shrine is still reachable',
    map.floodFrom(map.playerStart.x, map.playerStart.z).size === map.walkableTiles.length);
  check('nothing else on the ship has a blocked crossing',
    map.blockedEdges.reduce((n, bits) => n + (bits ? 1 : 0), 0) === 2);
}

// --- The offering -------------------------------------------------------

section('tribute');
{
  const altar = new TributeAltar(scene, map);
  const enemy = new GeilEnemy(scene, map);
  const items = new ItemManager(scene, map, new Rng(8));
  for (let i = 0; i < items.requiredCount; i++) {
    items.unwrap(items.presents.find(p => !p.isUnwrapped));
  }
  check('five pillows unlock the altar', items.isReadyForTribute());

  const at = { x: map.altarLocation.x, z: map.altarLocation.z + 2 };
  check('you have to be at the shrine to offer',
    altar.update(0.1, at, false, items).canOffer &&
    !altar.update(0.1, { x: 4, z: 4 }, false, items).canOffer);

  for (let i = 0; i < 40; i++) altar.update(0.1, at, true, items);
  check('holding E lays the offering out', altar.progress >= 1);

  altar.complete(enemy);
  check('the offering switches him off', enemy.state === 'PACIFIED' && !enemy.isDeadly);
  // He is teleported to collect it, and used to land inside the bulkhead that
  // closes het ruim off — invisible, halfway through the wall.
  const berth = map.worldToCell(enemy.x, enemy.z);
  check('he comes to collect from somewhere he can stand',
    map.isWalkableCell(berth.r, berth.c) && !map.checkCollision(enemy.x, enemy.z, 0.5),
    `${enemy.x},${enemy.z} = cell ${berth.r},${berth.c}`);
  check('and from inside the shrine', map.zoneAtCell(berth.r, berth.c) === 'shrine');

  altar.reset();
  check('a new run puts the altar back', !altar.isOffered && altar.placed.length === 0);
  altar.dispose();
  items.dispose();
  enemy.dispose();
}

// --- Nothing the generator places can strand him ------------------------

section('reachability');
{
  const stuck = [];
  for (let seed = 0; seed < 12; seed++) {
    const layout = generateRunLayout(map, new Rng(seed + 500));
    map.applyRunLayout(layout);

    // Round the circuit once, then out to every pakje: exactly what he and the
    // player have to be able to do.
    let from = layout.enemySpawn;
    for (const waypoint of layout.patrolRoute) {
      const result = walkTo(from, waypoint);
      if (!result.arrived) stuck.push(`seed ${seed}: patrol ${waypoint.r},${waypoint.c} (${result.why})`);
      from = waypoint;
    }
    for (const present of layout.presents) {
      const result = walkTo(map.playerStart, present, 0.42);
      if (!result.arrived) stuck.push(`seed ${seed}: pakje ${present.r},${present.c} (${result.why})`);
    }
    const toAltar = walkTo(map.playerStart, map.altarLocation, 0.42);
    if (!toAltar.arrived) stuck.push(`seed ${seed}: the altar (${toAltar.why})`);
  }
  check('12 ships can be walked end to end', stuck.length === 0, stuck.slice(0, 3).join(' | '));
}

// --- The stealth dial ---------------------------------------------------

section('player');
{
  const player = newPlayer();

  // The torch is a decision, not a starting condition: every run begins dark.
  const dark = newPlayer();
  check('a fresh player carries the torch off',
    dark.flashlightOn === false && dark.flashlight.intensity === 0);
  dark.setFlashlight(true);
  check('F lights it', dark.flashlightOn === true && dark.flashlight.intensity > 0);
  dark.reset();
  check('a new run puts the torch back out',
    dark.flashlightOn === false && dark.flashlight.intensity === 0);

  // Hiding a shadow-casting light takes it out of the renderer's lighting
  // state, which recompiles every shader in the scene — a hitch on a key the
  // player presses all run. The light stays; the shadow pass is what parks.
  check('a dark torch is still in the lighting state', dark.flashlight.visible === true);
  check('and costs no shadow pass', dark.flashlight.shadow.autoUpdate === false);
  dark.setFlashlight(true);
  check('lighting it brings the shadow pass back',
    dark.flashlight.visible === true && dark.flashlight.shadow.autoUpdate === true);
  dark.setFlashlight(false);

  player.gait = 'still';
  check('standing still is silent', player.getNoiseRadius() === 0);
  player.gait = 'sneak';
  check('sneaking carries 3.5 m', near(player.getNoiseRadius(), 3.5));
  player.gait = 'walk';
  check('walking carries 13 m', near(player.getNoiseRadius(), 13));
  player.gait = 'sprint';
  check('sprinting carries 26 m', near(player.getNoiseRadius(), 26));

  player.gait = 'still';
  player.emitNoise(30);
  check('a one-shot noise overrides the gait', player.getNoiseRadius() === 30);
  player.oneShotNoise = 0;

  player.flashlightOn = false;
  player.gait = 'walk';
  check('walking dark is the baseline', near(player.getVisibilityFactor(), 1));
  player.flashlightOn = true;
  check('the torch shows you from 1.85x as far', near(player.getVisibilityFactor(), 1.85));
  player.keys.sneak = true;
  player.gait = 'sneak';
  check('sneaking cuts visibility', near(player.getVisibilityFactor(), 1.85 * 0.55));
  // Crouching is a stance. Freezing behind a stack is the move the game asks
  // for, so it cannot be the moment concealment switches off.
  player.gait = 'still';
  check('and holding still crouched keeps it',
    near(player.getVisibilityFactor(), 1.85 * 0.55));
  player.keys.sneak = false;
  check('standing up out of a crouch gives it back', near(player.getVisibilityFactor(), 1.85));
  player.gait = 'sprint';
  check('sprinting raises it', near(player.getVisibilityFactor(), 1.85 * 1.25));

  player.gait = 'walk';
  player.enterHiding({ x: player.x, z: player.z });
  check('hiding is silent', player.getNoiseRadius() === 0);
  check('hiding is invisible', player.getVisibilityFactor() === 0);
  player.leaveHiding();

  // Sprinting has to run out, and running out has to mean something.
  player.keys.sprint = true;
  let gait = null;
  for (let i = 0; i < 200 && !player.exhausted; i++) gait = player.resolveGait(true, 0.05);
  check('sprinting drains the breath bar', player.exhausted && player.stamina === 0);
  check('four-ish seconds of sprint', gait === 'sprint');
  check('exhaustion drops you to a walk', player.resolveGait(true, 0.05) === 'walk');

  player.keys.sprint = false;
  for (let i = 0; i < 200 && player.exhausted; i++) player.recoverStamina(0.05);
  check('breath comes back', !player.exhausted && player.stamina > 35);

  check('sneak is not bound to Ctrl', (() => {
    const fresh = newPlayer();
    fresh.setEnabled(true);
    fresh.onKeyDown({ key: 'c', repeat: false, preventDefault() {} });
    return fresh.keys.sneak === true;
  })());

  check('a blur releases every key', (() => {
    const fresh = newPlayer();
    fresh.setEnabled(true);
    fresh.onKeyDown({ key: 'w', repeat: false, preventDefault() {} });
    fresh.onBlur();
    return Object.values(fresh.keys).every(v => v === false);
  })());

  check('walls stop the player, walking does not', (() => {
    const fresh = newPlayer();
    fresh.setEnabled(true);
    fresh.keys.forward = true;
    // Down column 1 from the start: open until the bulkhead at row 6 (z = 24).
    fresh.yaw = Math.PI;
    for (let i = 0; i < 120; i++) fresh.update(0.05);
    const travelled = fresh.z - map.playerStart.z;
    return travelled > 12 && fresh.z < 24 &&
      !map.checkCollision(fresh.x, fresh.z, fresh.collisionRadius);
  })());
}

// --- What Mr. Geil can work out -----------------------------------------

section('enemy');
{
  const player = newPlayer();
  const enemy = new GeilEnemy(scene, map);

  // Facing him straight down an open stretch of row 5.
  const spot = cell(5, 1);
  const seen = cell(5, 3);
  enemy.x = spot.x; enemy.z = spot.z;
  enemy.facing = Math.atan2(seen.x - spot.x, seen.z - spot.z);
  player.setPosition(seen.x, seen.z);
  player.flashlightOn = true;
  player.gait = 'walk';

  const dist = Math.hypot(seen.x - spot.x, seen.z - spot.z);
  check('he sees you down an open corridor', enemy.seeStrength(player, dist) > 0);

  player.keys.sneak = true;
  check('crouching behind the cargo breaks it', enemy.seeStrength(player, dist) === 0);
  player.keys.sneak = false;

  enemy.facing += Math.PI;
  check('he does not see behind himself', enemy.seeStrength(player, dist) === 0);
  enemy.facing -= Math.PI;

  player.setPosition(enemy.x + 1.2, enemy.z);
  check('anything on top of him is seen regardless of facing',
    enemy.seeStrength(player, 1.2) > 0);

  const wallA = cell(1, 3);
  const wallB = cell(1, 5);
  enemy.x = wallA.x; enemy.z = wallA.z;
  enemy.facing = Math.atan2(wallB.x - wallA.x, wallB.z - wallA.z);
  player.setPosition(wallB.x, wallB.z);
  check('a bulkhead hides you completely', enemy.seeStrength(player, 8) === 0);
  check('a bulkhead muffles a walk to nothing at 8 m', enemy.hearStrength(player, 8) === 0,
    'walking carries 13 m, roughly halved through a wall');
  player.gait = 'sprint';
  check('but sprinting is still heard through it', enemy.hearStrength(player, 8) > 0);
  player.gait = 'walk';
  check('and in the open a walk is heard at 8 m', (() => {
    const open = cell(13, 1);
    enemy.x = open.x; enemy.z = open.z;
    player.setPosition(open.x + 8, open.z);
    return enemy.hearStrength(player, 8) > 0;
  })());

  enemy.state = STATE.PATROL;
  enemy.awareness = 0;
  enemy.updateAwareness(0.5, player, 0.8, 0, 8);
  check('being seen builds awareness', enemy.awareness > 0);
  check('and pins your last known position',
    enemy.lastKnown !== null && near(enemy.lastKnown.x, player.x, 1e-6));

  const before = enemy.awareness;
  enemy.updateAwareness(3.0, player, 0, 0, 8);
  check('losing you bleeds it away again', enemy.awareness < before);

  enemy.awareness = 0.5;
  enemy.updateState(0.1, player, 0, 0, 8);
  check('a half-formed hunch makes him suspicious', enemy.state === STATE.SUSPICIOUS);

  enemy.awareness = 1;
  enemy.updateState(0.1, player, 1, 0, 8);
  check('a full ring makes him chase', enemy.state === STATE.CHASE);

  enemy.state = STATE.PATROL;
  enemy.awareness = 0;
  enemy.hearNoiseAt(player.x, player.z, 1);
  check('a torn pakje pulls him toward the noise',
    enemy.state === STATE.SUSPICIOUS && enemy.awareness >= 0.65);

  enemy.pacify();
  check('the tribute switches him off',
    enemy.state === STATE.PACIFIED && enemy.isDeadly === false);
  enemy.reset();
  check('and a reset arms him again',
    enemy.state === STATE.PATROL && enemy.isDeadly === true && enemy.tier === 0);
}

section('patrol');
{
  const enemy = new GeilEnemy(scene, map);
  const layout = generateRunLayout(map, new Rng(2024));
  enemy.applyRunLayout(layout);
  enemy.reset();

  check('he starts where the plan says',
    near(enemy.x, layout.enemySpawn.x) && near(enemy.z, layout.enemySpawn.z));
  check('he carries this run\'s circuit',
    enemy.patrolRoute.length === layout.patrolRoute.length);

  // Detours are a coin flip on Math.random; hold it down to read the circuit.
  const realRandom = Math.random;
  Math.random = () => 0.99;
  enemy.routeIndex = 0;
  const walkedRoute = enemy.patrolRoute.map(() => enemy.nextPatrolTile());
  Math.random = realRandom;
  check('he walks the circuit in order',
    walkedRoute.every((tile, i) => tile === enemy.patrolRoute[i]));
  check('and loops back to the top', enemy.routeIndex === 0);

  Math.random = () => 0.01;
  const detour = enemy.nextPatrolTile();
  Math.random = realRandom;
  check('but he does wander off it', !enemy.patrolRoute.includes(detour));

  // Dropped somewhere else after a search, he rejoins the loop nearby rather
  // than trudging back to where he left it.
  const third = enemy.patrolRoute[2];
  enemy.x = third.x;
  enemy.z = third.z;
  enemy.routeIndex = 0;
  enemy.resumeRouteNearby();
  check('he rejoins the circuit where he stands', enemy.routeIndex === 3);

  const bare = new GeilEnemy(scene, map);
  bare.applyRunLayout({ enemySpawn: null, patrolRoute: [] });
  check('no circuit still gives him somewhere to go', bare.nextPatrolTile() !== undefined);
}

// --- Pakjes -------------------------------------------------------------

section('items');
{
  const layout = generateRunLayout(map, new Rng(31337));
  map.applyRunLayout(layout);

  const items = new ItemManager(scene, map, new Rng(31337));
  check('a pakje sits on every planned spot', items.presents.length === layout.presents.length);
  check('five pillows finish a run', items.requiredCount === 5 && items.remaining() === 5);

  const twin = new ItemManager(scene, map, new Rng(31337));
  check('the same seed packs the same pillows',
    items.presents.map(p => p.pillowData.name).join() ===
    twin.presents.map(p => p.pillowData.name).join());
  const other = new ItemManager(scene, map, new Rng(31338));
  check('another seed packs them differently',
    items.presents.map(p => p.pillowData.name).join() !==
    other.presents.map(p => p.pillowData.name).join());

  const target = items.presents[0];
  const at = { x: target.worldPos.x, z: target.worldPos.z };
  check('a pakje is only reachable up close',
    items.getNearest(at) === target &&
    items.getNearest({ x: at.x + 40, z: at.z }) === null);

  let noise = 0;
  let toast = null;
  items.onUnwrapped = (pillow, x, z, radius) => { noise = radius; toast = pillow; };

  items.update(0.1, at, true, true);           // first frame only arms the target
  for (let i = 0; i < 25; i++) items.update(0.1, at, true, true);
  check('holding E opens it', target.isUnwrapped && items.collectedCount === 1);
  check('and it is loud', noise >= 30);
  check('and you are told what you found', toast !== null && typeof toast.name === 'string');
  check('the objective counts down', items.remaining() === 4);

  const spent = items.getNearest(at);
  check('an opened pakje cannot be opened twice', spent !== target);

  for (let i = 0; i < 4; i++) {
    const next = items.presents.find(p => !p.isUnwrapped);
    items.unwrap(next);
  }
  check('five pillows is the altar\'s price', items.isReadyForTribute());
}

// --- The soundtrack -----------------------------------------------------
//
// The recorded score is the only thing on disk, so the two ways it breaks are
// a file that is not where the table says it is, and a browser (or this
// harness) where it cannot start at all.

section('audio');
{
  const names = Object.keys(TRACKS);
  check('every state has a track', names.length === 6, names.join(', '));

  for (const [name, spec] of Object.entries(TRACKS)) {
    const path = projectFile(spec.src);
    const there = existsSync(path);
    check(`${name} is on disk`, there, spec.src);
    if (there) {
      check(`${name} is not a stub file`, statSync(path).size > 10000,
        `${statSync(path).size} bytes`);
    }
    check(`${name} has a sane level`, spec.gain > 0 && spec.gain <= 1, String(spec.gain));
  }

  // Beds loop under play; the cues are one-shots that must not.
  check('the beds loop', TRACKS.title.bed && TRACKS.explore.bed && TRACKS.stalk.bed);
  check('the cues do not', !TRACKS.stinger.bed && !TRACKS.gameover.bed && !TRACKS.victory.bed);

  // Nothing here has called init(), which is exactly the state a browser is in
  // before the player's first click, and the one this harness never leaves.
  check('nothing is routed before init', !horrorAudio.ready && horrorAudio.voices.size === 0);

  let threw = null;
  try {
    horrorAudio.setBed('stalk');
    horrorAudio.setBed(null);
    horrorAudio.playSightingStinger();
    horrorAudio.playGameOverTheme();
    horrorAudio.playVictoryTheme();
    horrorAudio.stopCues();
    horrorAudio.voice('title');
    horrorAudio.playLanternTick(1);
  } catch (err) {
    threw = err;
  }
  check('every music call is a no-op without a context', threw === null, String(threw));
  check('and none of them pretends a track is playing',
    horrorAudio.currentBed === null && !horrorAudio.soundtrackReady);
  check('so the synthesised music box keeps the scene',
    horrorAudio.musicEnabled !== false);
}

// --- Sint's lantaarntje --------------------------------------------------

section('lantern');
{
  // The rate is the entire readout, so counting ticks over a held distance is
  // the thing worth pinning down.
  const ticksAt = (dist, seconds = 10, quiet = false) => {
    const lamp = new Lantern();
    let ticks = 0;
    for (let i = 0; i < seconds * 60; i++) {
      lamp.update(1 / 60, dist, quiet);
      if (lamp.ticked) ticks++;
    }
    return ticks;
  };

  // Held at a distance long enough for the reading to stop chasing it.
  const settled = (dist, quiet = false, seconds = 3) => {
    const lamp = new Lantern();
    for (let i = 0; i < seconds * 60; i++) lamp.update(1 / 60, dist, quiet);
    return lamp;
  };

  const far = ticksAt(LANTERN_RANGE - 1);
  const mid = ticksAt(LANTERN_RANGE / 2);
  const near = ticksAt(1.5);

  check('beyond its range the flame is out', ticksAt(LANTERN_RANGE + 4) === 0);
  check('it ticks at the edge of its range', far > 0, `${far} in 10 s`);
  check('faster halfway in', mid > far, `${far} -> ${mid}`);
  check('and faster again on top of you', near > mid, `${mid} -> ${near}`);
  check('but never past ten a second', near <= 100, `${near} in 10 s`);

  // The interval has to fall the whole way in. A dial that plateaus is a dial
  // that stops answering the one question it is for.
  const intervals = [24, 18, 12, 6, 1].map(d => settled(d).interval);
  check('the interval falls the whole way in',
    intervals.every((v, i) => i === 0 || v < intervals[i - 1]),
    intervals.map(v => v.toFixed(2)).join(' > '));

  check('inside 11 m it goes to alarm', settled(LANTERN_ALARM - 2).alarm === true);
  check('and outside it does not', settled(LANTERN_ALARM + 3).alarm === false);

  // It reads straight-line distance and nothing else — no bearing, ever.
  const lamp = settled(4);
  check('it burns while he hunts', lamp.lit === true && lamp.proximity > 0);
  check('and says nothing about direction',
    !('bearing' in lamp) && !('x' in lamp) && !('z' in lamp));

  for (let i = 0; i < 180; i++) lamp.update(1 / 60, 4, true);
  check('the offering puts it out', lamp.lit === false && lamp.glow === 0);

  // A frame long enough to hold several ticks must not fire several.
  const stutter = new Lantern();
  for (let i = 0; i < 120; i++) stutter.update(1 / 60, 2);
  stutter.update(0.5, 2);
  check('one long frame is still one tick', stutter.ticked === true && stutter.phase < 1);

  // Whatever the sweep, the flame is something the stylesheet can use.
  let lowest = Infinity;
  let highest = -Infinity;
  const sweep = new Lantern();
  for (let i = 0; i < 900; i++) {
    sweep.update(1 / 60, 1 + (i % 300) / 10);
    lowest = Math.min(lowest, sweep.glow);
    highest = Math.max(highest, sweep.glow);
  }
  check('the flame stays inside 0..1', lowest >= 0 && highest <= 1,
    `${lowest.toFixed(3)} .. ${highest.toFixed(3)}`);

  const spent = settled(4);
  spent.reset();
  check('a new run starts it cold',
    spent.lit === false && spent.glow === 0 && spent.proximity === 0 && !spent.ticked);

  // The wiring main.js does every frame, with the real Mr. Geil on the other
  // end of it: his distance, straight into the lamp, and nothing else.
  const walker = newPlayer();
  const geil = new GeilEnemy(scene, map);
  const belt = new Lantern();
  const step = () => {
    geil.update(1 / 60, walker, () => {});
    belt.update(1 / 60, geil.distToPlayer, geil.state === STATE.PACIFIED);
  };

  const home = cell(5, 1);
  walker.setPosition(home.x, home.z);
  const berth = map.getRandomTileFrom(home.x, home.z, 34);
  geil.x = berth.x;
  geil.z = berth.z;
  for (let i = 0; i < 30; i++) step();
  check('with him across the ship the lamp is out', belt.lit === false,
    `${geil.distToPlayer.toFixed(1)} m`);

  geil.x = home.x + 5;
  geil.z = home.z;
  for (let i = 0; i < 120; i++) step();
  check('with him five metres off it is going hard',
    belt.lit === true && belt.alarm === true && belt.interval < 0.25,
    `${belt.interval.toFixed(3)} s a tick at ${geil.distToPlayer.toFixed(1)} m`);
}

// --- A run's worth of ticks ---------------------------------------------

section('soak');
{
  // The real update loop, two and a half minutes of it, on ships nobody has
  // hand-checked. A patrol waypoint the pathfinder cannot serve shows up here
  // as a monster standing still in a corridor.
  //
  // His timers and detours run on Math.random, so it is driven from a seed for
  // the duration — a soak that fails only sometimes is worth nothing.
  const problems = [];
  const distances = [];
  const realRandom = Math.random;

  try {
    for (let seed = 0; seed < 8; seed++) {
      const layout = generateRunLayout(map, new Rng(seed + 900));
      map.applyRunLayout(layout);

      const jitter = new Rng(seed * 7919 + 11);
      Math.random = () => jitter.next();

      const player = newPlayer();
      player.reset();
      player.setFlashlight(false);

      const enemy = new GeilEnemy(scene, map);
      enemy.applyRunLayout(layout);
      enemy.reset();

      // A catch ends a real run. Here it puts the player somewhere else so the
      // soak keeps testing the thing it is for: his patrolling.
      const onCatch = () => {
        const tile = map.getRandomTileFrom(enemy.x, enemy.z, 30);
        player.setPosition(tile.x, tile.z);
        enemy.awareness = 0;
        enemy.lastKnown = null;
        enemy.enterState(STATE.PATROL, player);
      };

      const zones = new Set();
      const legs = new Set();
      let travelled = 0;
      let stall = 0;
      let longestStall = 0;
      let previous = { x: enemy.x, z: enemy.z };

      for (let tick = 0; tick < 150 * 60; tick++) {
        enemy.update(1 / 60, player, onCatch);

        const moved = Math.hypot(enemy.x - previous.x, enemy.z - previous.z);
        travelled += moved;
        // He is allowed to stand and look around; half a minute of it is a wedge.
        stall = moved < 0.001 ? stall + 1 : 0;
        longestStall = Math.max(longestStall, stall);
        previous = { x: enemy.x, z: enemy.z };

        zones.add(map.zoneAt(enemy.x, enemy.z));
        if (enemy.poi) legs.add(`${enemy.poi.x},${enemy.poi.z}`);

        if (map.checkCollision(enemy.x, enemy.z, 0.5)) {
          problems.push(`seed ${seed}: he ended up inside a prop`);
          break;
        }
      }

      distances.push(travelled);
      if (travelled < 150) problems.push(`seed ${seed}: only ${travelled.toFixed(0)} m in 150 s`);
      if (legs.size < 4) problems.push(`seed ${seed}: finished only ${legs.size} legs`);
      if (zones.size < 2) problems.push(`seed ${seed}: never left ${[...zones].join('/')}`);
      if (longestStall > 60 * 30) {
        problems.push(`seed ${seed}: stood still for ${(longestStall / 60).toFixed(0)} s`);
      }
    }
  } finally {
    Math.random = realRandom;
  }

  check('he paces eight unseen ships without wedging', problems.length === 0,
    problems.slice(0, 3).join(' | '));
  check('and covers ground while he does it', Math.min(...distances) > 150,
    `shortest patrol ${Math.min(...distances).toFixed(0)} m`);
}


// --- Two browsers on one boat -------------------------------------------
//
// The networking is tested the way the rest of the simulation is: headlessly,
// with the real modules, and with nothing stubbed that decides anything. There
// is no WebRTC here — the transport is a pair of objects that hand each other
// JSON — but everything above it is the code that ships: two NetSessions, two
// SteamboatMaps, two GeilEnemys, two ItemManagers, and the same update loop
// main.js runs, stepped by hand.
//
// What that buys is the two things multiplayer can break quietly: two browsers
// dealing different ships from the same seed, and the host's word about the
// world failing to land on anybody else's.

section('room codes');
{
  const codes = Array.from({ length: 200 }, () => makeRoomCode());
  check('a code is five characters', codes.every(c => c.length === 5));
  check('and always one somebody can read out', codes.every(isValidCode));
  check('with no O, I, 0 or 1 in it', codes.every(c => !/[OI01]/.test(c)));
  check('and they are not all the same', new Set(codes).size > 150);

  check('typing it in lower case is fine', normaliseCode('a b-c d e') === 'ABCDE');
  check('and rubbish is not a code', !isValidCode('') && !isValidCode('ABC') && !isValidCode('ABCDI'));

  check('a code always hashes to the same topic', topicFor('ABCDE') === topicFor('abcde'));
  check('and two codes do not share one', topicFor('ABCDE') !== topicFor('ABCDF'));
  check('the topic is not the code', !topicFor('ABCDE').includes('ABCDE'));

  const ids = Array.from({ length: 200 }, () => makePeerId());
  check('peer ids do not collide', new Set(ids).size === 200);
}

// The transport, replaced. Two of these hand each other deep copies, so a bug
// where one browser holds a reference into another one's state shows up here
// as a test failure rather than as a run that only works on one machine.
class LoopRoom {
  constructor(isHost) {
    this.selfId = makePeerId();
    this.isHost = isHost;
    this.hostId = null;
    this.closed = false;
    this.locked = false;
    this.link = null;
    this.sent = 0;
    this.onjoin = null;
    this.onleave = null;
    this.onmessage = null;
    this.onstatus = null;
  }

  static pair() {
    const host = new LoopRoom(true);
    const guest = new LoopRoom(false);
    host.link = guest;
    guest.link = host;
    host.hostId = host.selfId;
    guest.hostId = host.selfId;
    return { host, guest };
  }

  connect(hostName, guestName) {
    if (this.onjoin) this.onjoin(this.link.selfId, this.isHost ? guestName : hostName);
  }

  send(kind, data, { to = null, reliable = true } = {}) {
    if (this.closed || !this.link || this.link.closed) return;
    if (to && to !== this.link.selfId) return;
    this.sent++;
    this.link.deliver(this.selfId, kind, JSON.parse(JSON.stringify(data ?? null)));
  }

  deliver(from, kind, data) {
    if (this.onmessage) this.onmessage(from, kind, data);
  }

  part() {
    const wasHost = !this.isHost && this.link && this.link.selfId === this.hostId;
    if (this.onleave && this.link) this.onleave(this.link.selfId, wasHost);
  }

  lock() { this.locked = true; }
  unlock() { this.locked = false; }
  close() { this.closed = true; }
}

// One browser: its own map, its own copy of everything, and the same wiring
// main.js does in beginNetRun.
function makeBrowser(room, name) {
  const map = new SteamboatMap(new THREE.Scene());
  const world = {
    map,
    player: new Player(new THREE.PerspectiveCamera(), map, document.createElement('canvas'), settings),
    enemy: new GeilEnemy(scene, map),
    items: null,
    altar: new TributeAltar(scene, map),
    layout: null
  };
  const log = { started: 0, events: [], ended: null, frames: 0, reuk: 0 };

  const game = {
    world: () => world,
    berthFor(session, player) {
      if (!world.layout) return null;
      return session.isHunter(player.id)
        ? world.layout.enemySpawn
        : world.layout.crewSpawns[(player.berth || 0) % world.layout.crewSpawns.length];
    },
    onCrewChanged() {},
    onCrewFrame() { log.frames++; },
    onCrewEvent(kind, player) { log.events.push(`${kind}:${player.name}`); },
    onReuk() { log.reuk++; },
    endNetRun(outcome, detail) { log.ended = { outcome, detail }; },

    // The same order as main.js: deal the ship from the seed, then place the
    // body, then decide what this copy of Mr. Geil is allowed to do.
    beginNetRun(session) {
      const rng = new Rng(session.seed);
      const layout = generateRunLayout(map, rng);
      map.applyRunLayout(layout);
      world.layout = layout;

      if (world.items) world.items.dispose();
      world.items = new ItemManager(scene, map, rng);
      world.items.announceOnly = true;
      world.items.onWantUnwrap = (present) => session.requestTear(present.id);
      world.items.onUnwrapped = (pillow, x, z, radius) => {
        if (session.isHost) world.enemy.hearNoiseAt(x, z, radius / 30);
        world.enemy.setTier(world.items.collectedCount);
      };
      world.altar.reset();

      const me = session.local();
      const hunter = session.isHunter(me.id);
      world.enemy.applyRunLayout(layout);
      world.enemy.reset();
      world.enemy.viewer = world.player;
      world.enemy.setControl({
        simulate: session.isHost && session.mode === MODE.COOP,
        authoritative: session.isHost
      });
      world.enemy.setEmbodied(hunter);

      world.player.setProfile(hunter ? 'geil' : 'survivor');
      world.player.reset(hunter
        ? layout.enemySpawn
        : layout.crewSpawns[(me.berth || 0) % layout.crewSpawns.length]);
      world.player.setEnabled(true);
      log.started++;
    }
  };

  const session = new NetSession({ room, game, name });
  return { room, session, world, log, name };
}

// main.js's update loop, with the DOM taken out of it.
function stepBrowser(browser, delta) {
  const { session, world } = browser;
  if (session.phase !== 'run') return;

  const me = session.local();
  const downed = !!(me && (me.down || me.dead));
  world.player.setFrozen(downed);
  world.player.update(delta);

  const pos = world.player.getPosition();
  const held = world.player.interactHeld && !downed;

  const altarState = world.altar.update(delta, pos, held, world.items, {
    remoteOffering: session.remoteOffering(),
    driven: !session.isHost
  });
  const canOpen = !world.player.isHidden && !altarState.canOffer && !downed &&
    !session.isHunter();
  world.items.update(delta, pos, held, canOpen);

  if (session.isHost && !world.altar.isOffered && world.altar.progress >= 1 &&
      world.items.isReadyForTribute()) {
    world.altar.complete(world.enemy);
    session.onOffered();
  }

  session.update(delta);

  world.enemy.viewer = world.player;
  const targets = session.isHost ? session.huntTargets(world) : [world.player];
  world.enemy.update(delta, targets,
    session.isHost ? (target) => session.onCatch(target, world) : null);
}

function runTicks(browsers, seconds, before = null) {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    if (before) before(i);
    for (const browser of browsers) stepBrowser(browser, 1 / 60);
  }
}

// Open a room, get both sides into a run, and hand back both browsers.
function boardTogether(mode = MODE.COOP, seed = 0xC0FFEE, hunterFirst = false) {
  const rooms = LoopRoom.pair();
  const host = makeBrowser(rooms.host, 'Sint');
  const guest = makeBrowser(rooms.guest, 'Piet');

  rooms.host.connect('Sint', 'Piet');
  rooms.guest.connect('Sint', 'Piet');

  host.session.setMode(mode);
  if (mode === MODE.HUNT && !hunterFirst) host.session.setHunter(rooms.guest.selfId);
  host.session.startRun(seed);
  return { host, guest, rooms };
}

section('crew: the lobby');
{
  const rooms = LoopRoom.pair();
  const host = makeBrowser(rooms.host, 'Sint');
  const guest = makeBrowser(rooms.guest, 'Piet');
  rooms.host.connect('Sint', 'Piet');
  rooms.guest.connect('Sint', 'Piet');

  check('the host sees both of them', host.session.playerCount() === 2);
  check('and so does the joiner, off the host’s roster', guest.session.playerCount() === 2);
  check('names travel', [...guest.session.players.values()].map(p => p.name).sort().join() === 'Piet,Sint');
  check('and colours agree on both machines', (() => {
    const a = [...host.session.players.entries()].sort().map(([, p]) => p.colour);
    const b = [...guest.session.players.entries()].sort().map(([, p]) => p.colour);
    return a.length === 2 && a.join() === b.join();
  })(), 'slots are ordered by id, not by who arrived first');

  host.session.setMode(MODE.HUNT);
  check('the mode the host picks is the mode everybody is in', guest.session.mode === MODE.HUNT);
  check('and somebody is wearing the mask', !!guest.session.hunterId);

  host.session.setHunter(rooms.guest.selfId);
  check('the host can hand the mask over',
    guest.session.isHunter(guest.session.localId) &&
    host.session.isHunter(rooms.guest.selfId) &&
    !host.session.isHunter(host.session.localId));

  host.session.setMode(MODE.COOP);
  check('and co-op takes it off everyone',
    guest.session.hunterId === null && !guest.session.isHunter());
}

section('crew: one seed, one ship');
{
  const { host, guest } = boardTogether(MODE.COOP, 0xBEEF11);

  check('both browsers dealt a ship', host.log.started === 1 && guest.log.started === 1);

  const a = host.world.layout;
  const b = guest.world.layout;
  check('the pakjes are in the same places',
    JSON.stringify(a.presents) === JSON.stringify(b.presents));
  check('he starts in the same berth',
    JSON.stringify(a.enemySpawn) === JSON.stringify(b.enemySpawn));
  check('the circuit he paces is the same',
    JSON.stringify(a.patrolRoute) === JSON.stringify(b.patrolRoute));
  check('the same lanterns are dead',
    JSON.stringify(a.lanternsAlive) === JSON.stringify(b.lanternsAlive));
  check('and the crew berths match',
    JSON.stringify(a.crewSpawns) === JSON.stringify(b.crewSpawns));

  check('the same pillow is in the same pakje',
    host.world.items.presents.map(p => p.pillowData.name).join('|') ===
    guest.world.items.presents.map(p => p.pillowData.name).join('|'),
    'this is why no part of the layout is ever sent');

  check('nobody woke up on top of anybody else',
    Math.hypot(host.world.player.x - guest.world.player.x,
               host.world.player.z - guest.world.player.z) > 1.5);
  check('and both berths are standable', [host, guest].every(b2 =>
    !b2.world.map.checkCollision(b2.world.player.x, b2.world.player.z, 0.5)));
}

section('crew: bodies on the wire');
{
  const { host, guest } = boardTogether(MODE.COOP, 0x515151);
  const guestId = guest.session.localId;

  // Before a single packet has been sent, everybody is already in the right
  // place, because the berths came out of the seed rather than off the wire.
  check('the roster starts where the run does, not at the origin', (() => {
    const mirrored = host.session.players.get(guestId);
    return Math.hypot(mirrored.x - guest.world.player.x,
                      mirrored.z - guest.world.player.z) < 0.01 &&
      (mirrored.x !== 0 || mirrored.z !== 0);
  })(), 'the origin is a real cell on this ship; a phantom there would be hunted');

  const from = { x: guest.world.player.x, z: guest.world.player.z };
  guest.world.player.keys.forward = true;
  runTicks([host, guest], 1.5);
  const gaitOnTheWire = host.session.players.get(guestId).gait;
  guest.world.player.keys.forward = false;
  runTicks([host, guest], 0.4);

  const walked = Math.hypot(guest.world.player.x - from.x, guest.world.player.z - from.z);
  const mirrored = host.session.players.get(guestId);
  check('a crewmate who walks is a crewmate who walks over there', walked > 1.5,
    `${walked.toFixed(2)} m`);
  check('and the host has them where they actually are',
    Math.hypot(mirrored.x - guest.world.player.x, mirrored.z - guest.world.player.z) < 0.6,
    `${Math.hypot(mirrored.x - guest.world.player.x, mirrored.z - guest.world.player.z).toFixed(2)} m adrift`);
  check('the joiner is told about the host in return',
    guest.session.players.get(host.session.localId).x === host.world.player.x ||
    guest.log.frames > 0);
  check('and their gait travels with them',
    gaitOnTheWire === 'walk' && mirrored.gait === 'still',
    `walking read as ${gaitOnTheWire}, stopped read as ${mirrored.gait}`);

  // Fifteen a second each way, not sixty.
  check('positions are not sent every frame',
    host.room.sent < 90 * 1.4 && host.room.sent > 12,
    `${host.room.sent} messages in 1.5 s`);
}

section('crew: his body, mirrored');
{
  const { host, guest } = boardTogether(MODE.COOP, 0xA11CE5);

  check('only the host thinks for him',
    host.world.enemy.simulate === true && guest.world.enemy.simulate === false);
  check('and only the host decides who he caught',
    host.world.enemy.authoritative === true && guest.world.enemy.authoritative === false);
  check('both start him in the same berth',
    Math.hypot(host.world.enemy.x - guest.world.enemy.x,
               host.world.enemy.z - guest.world.enemy.z) < 0.01);

  runTicks([host, guest], 6);

  const drift = Math.hypot(host.world.enemy.x - guest.world.enemy.x,
                           host.world.enemy.z - guest.world.enemy.z);
  check('he paces on the host', (() => {
    const spawn = host.world.layout.enemySpawn;
    return Math.hypot(host.world.enemy.x - spawn.x, host.world.enemy.z - spawn.z) > 3;
  })());
  check('and the mirror keeps up with him', drift < 1.2, `${drift.toFixed(2)} m behind`);
  check('without ever pathfinding for itself',
    guest.world.enemy.poi === null && guest.world.enemy.cachedStep === null,
    'a mirror holds no plan; it is walked toward what it was told');

  // Fifteen positions a second on a body that runs at five metres of them:
  // dropped onto each one he would advance in visible jerks.
  const before = { x: guest.world.enemy.x, z: guest.world.enemy.z };
  guest.world.enemy.applyRemote({ x: before.x + 0.4, z: before.z });
  stepBrowser(guest, 1 / 60);
  const stepped = Math.hypot(guest.world.enemy.x - before.x, guest.world.enemy.z - before.z);
  check('a fresh position is walked toward, not jumped to',
    stepped > 0.01 && stepped < 0.3, `${stepped.toFixed(3)} m in one frame`);

  // But a placement is a placement.
  const far = cell(19, 1);
  guest.world.enemy.applyRemote({ x: far.x, z: far.z });
  check('a placement is not', Math.hypot(guest.world.enemy.x - far.x,
                                         guest.world.enemy.z - far.z) < 0.01,
    'the start of a run, or the altar moving him');
}

section('crew: the host rules on the pakjes');
{
  const { host, guest } = boardTogether(MODE.COOP, 0x9911AA);

  // Stand the joiner on a pakje and let them tear it open. The paper only
  // tears when the host says so, so a pass through the wire is compulsory.
  const target = guest.world.items.presents[0];
  guest.world.player.setPosition(target.worldPos.x, target.worldPos.z);
  guest.world.player.interactHeld = true;
  runTicks([host, guest], 2.4);
  guest.world.player.interactHeld = false;
  runTicks([host, guest], 0.2);

  check('the pakje opened', guest.world.items.collectedCount === 1);
  check('on the host as well', host.world.items.collectedCount === 1,
    'the tear is a request; the host is what makes it true');
  check('and it was the same pakje', host.world.items.presents[0].isUnwrapped);
  check('with the same pillow in it',
    host.world.items.inventory[0].name === guest.world.items.inventory[0].name);
  check('the bang reached him', host.world.enemy.awareness > 0 ||
    host.world.enemy.lastKnown !== null);
  check('but the joiner did not tell him about it herself',
    guest.world.enemy.lastKnown === null,
    'a mirror holds no belief of its own — it is shown the host\'s');
}

section('crew: down, and back up');
{
  const { host, guest } = boardTogether(MODE.COOP, 0x4D4D4D);
  const guestId = guest.session.localId;

  // Put both of them in the same open stretch, then walk him onto the joiner.
  const spot = cell(13, 5);
  host.world.player.setPosition(spot.x, spot.z);
  guest.world.player.setPosition(spot.x + 2.0, spot.z);
  // Let a few frames go out first: pinning him to the roster before it has
  // heard from anybody would only prove the seating works.
  runTicks([host, guest], 0.3);

  runTicks([host, guest], 1.2, () => {
    const prey = host.session.players.get(guestId);
    host.world.enemy.x = prey.x;
    host.world.enemy.z = prey.z;
  });

  const downedHost = host.session.players.get(guestId);
  const downedGuest = guest.session.local();
  check('he takes somebody down rather than out', downedHost.down && !downedHost.dead);
  check('and they know it on their own machine', downedGuest.down && !downedGuest.dead);
  check('the run is not over', host.session.phase === 'run' && !host.log.ended);
  check('both screens were told', host.log.events.includes(`down:Piet`) &&
    guest.log.events.includes('down:Piet'));
  check('he loses interest for a moment', host.world.enemy.satedTimer > 0,
    'or a rescue would never be worth attempting');
  check('and stops hunting the body', (() => {
    const targets = host.session.huntTargets(host.world);
    return targets.some(t => t.netId === guestId && t.netHunted === false);
  })());

  // The body does not walk.
  const fell = { x: guest.world.player.x, z: guest.world.player.z };
  guest.world.player.keys.forward = true;
  runTicks([host, guest], 0.8);
  guest.world.player.keys.forward = false;
  check('a downed body stays where it fell',
    Math.hypot(guest.world.player.x - fell.x, guest.world.player.z - fell.z) < 0.05);
  check('and the clock is running on it',
    downedHost.bleed < BLEED_SECONDS && downedHost.bleed > BLEED_SECONDS - 8);

  // He has had what he came for and gone. Kneel over them and haul.
  const away = cell(1, 19);
  host.world.enemy.x = away.x;
  host.world.enemy.z = away.z;
  host.world.player.setPosition(fell.x + 1.4, fell.z);
  host.world.player.interactHeld = true;
  runTicks([host, guest], 1.0);
  check('hauling takes a while', guest.session.local().down === true);
  runTicks([host, guest], 3.6);
  host.world.player.interactHeld = false;

  check('and then they are up', !host.session.players.get(guestId).down &&
    !guest.session.local().down);
  check('on both machines', guest.session.local().alive === true);
  check('and both screens said so', host.log.events.includes('up:Piet') &&
    guest.log.events.includes('up:Piet'));
}

section('crew: nobody left to come and get you');
{
  const { host, guest } = boardTogether(MODE.COOP, 0x7A7A11);
  const hostId = host.session.localId;
  const guestId = guest.session.localId;

  const spot = cell(13, 9);
  host.world.player.setPosition(spot.x, spot.z);
  guest.world.player.setPosition(spot.x + 2.4, spot.z);
  runTicks([host, guest], 0.3);

  // Take the first one down, then keep going. With one body already on the
  // deck the last one upright has nobody coming, so he takes them outright.
  runTicks([host, guest], 3.0, () => {
    const first = host.session.players.get(guestId);
    const target = first.down ? host.session.players.get(hostId) : first;
    host.world.enemy.x = target.x;
    host.world.enemy.z = target.z;
    // sate() is the whole reason going back for somebody works; hold it off so
    // this test can reach the wipe inside a reasonable number of ticks.
    host.world.enemy.satedTimer = 0;
  });

  check('the last one upright is not downed, he is taken',
    host.session.players.get(hostId).dead,
    'there is nobody left who could have come for them');
  check('and the body left on the deck bleeds out fast', (() => {
    const left = host.session.players.get(guestId);
    return left.dead || left.bleed < BLEED_SECONDS - 12;
  })(), 'nobody upright means nobody coming');

  runTicks([host, guest], 10);
  check('so the run ends rather than running the clock down',
    host.log.ended && host.log.ended.outcome === 'taken');
  check('for everybody', guest.log.ended && guest.log.ended.outcome === 'taken');
}

section('crew: the offering');
{
  const { host, guest } = boardTogether(MODE.COOP, 0x0FFE12);

  // Five pakjes between them, however they were shared out.
  for (let i = 0; i < 5; i++) {
    host.session.openPresent(host.world.items.presents[i].id, host.session.localId);
  }
  check('the count is shared', host.world.items.collectedCount === 5 &&
    guest.world.items.collectedCount === 5);
  check('and so is what is in the pile',
    host.world.items.inventory.map(p => p.name).join() ===
    guest.world.items.inventory.map(p => p.name).join());

  // The joiner walks it to the altar on their own; the host is elsewhere.
  const altar = host.world.map.altarLocation;
  guest.world.player.setPosition(altar.x, altar.z - 2.4);
  guest.world.player.interactHeld = true;
  runTicks([host, guest], 1.0);
  check('the host is laying it out even though nobody there is theirs',
    host.world.altar.progress > 0.2, `${host.world.altar.progress.toFixed(2)}`);
  check('and the joiner is shown the host’s progress, not their own',
    Math.abs(guest.world.altar.progress - host.world.altar.progress) < 0.2);

  runTicks([host, guest], 2.4);
  guest.world.player.interactHeld = false;

  check('the offering is made', host.world.altar.isOffered);
  check('and it is the ending, on both machines',
    host.log.ended && host.log.ended.outcome === 'offered' &&
    guest.log.ended && guest.log.ended.outcome === 'offered');
  check('he is pacified where the crew can see it',
    host.world.enemy.state === STATE.PACIFIED);
}

section('crew: the hunt');
{
  const { host, guest } = boardTogether(MODE.HUNT, 0x11EE22);

  check('one of them is him', guest.session.isHunter() && !host.session.isHunter());
  check('and is in his body', guest.world.player.profileName === 'geil');
  check('which is a different body', guest.world.player.profile.speed.walk >
    host.world.player.profile.speed.walk);
  check('he does not carry a torch', (() => {
    guest.world.player.toggleFlashlight();
    return guest.world.player.flashlightOn === false;
  })());
  check('and cannot climb into a crate', (() => {
    const crate = guest.world.map.hidingSpots[0];
    guest.world.player.setPosition(crate.x, crate.z);
    return guest.world.player.canHideAt(crate) === false;
  })());
  check('the survivor still gets one', host.world.player.profileName === 'survivor' &&
    host.world.player.profile.torch === true);
  check('the AI is off on both machines',
    host.world.enemy.simulate === false && guest.world.enemy.simulate === false);
  check('and only the host rules on catches',
    host.world.enemy.authoritative === true && guest.world.enemy.authoritative === false);
  check('the person playing him is not also haunted by him',
    guest.world.enemy.embodied === true && guest.world.enemy.sprite.visible === false);

  // Walk him across the ship and check his body follows on the host.
  const open = cell(13, 3);
  guest.world.player.setPosition(open.x, open.z);
  guest.world.player.yaw = Math.PI;
  runTicks([host, guest], 0.4);
  check('the host puts him where the player playing him is',
    Math.hypot(host.world.enemy.x - guest.world.player.x,
               host.world.enemy.z - guest.world.player.z) < 0.5,
    `${Math.hypot(host.world.enemy.x - guest.world.player.x, host.world.enemy.z - guest.world.player.z).toFixed(2)} m`);
  check('and faces him the way they are looking', (() => {
    const want = Math.atan2(-Math.sin(guest.world.player.yaw), -Math.cos(guest.world.player.yaw));
    return Math.abs(Math.atan2(Math.sin(host.world.enemy.facing - want),
                               Math.cos(host.world.enemy.facing - want))) < 0.02;
  })());

  // The nose. Somebody standing still is nobody; somebody sprinting is not.
  const survivor = host.session.players.get(host.session.localId);
  survivor.gait = 'still';
  guest.session.reuk.timer = 0;
  guest.session.updateReuk(1 / 60, guest.world);
  check('a crew standing still leaves no smell', guest.session.reuk.strength === 0);

  host.world.player.setPosition(open.x + 10, open.z);
  runTicks([host, guest], 0.3);
  host.session.players.get(host.session.localId).gait = 'sprint';
  guest.session.players.get(host.session.localId).gait = 'sprint';
  guest.session.reuk.timer = 0;
  guest.session.updateReuk(1 / 60, guest.world);
  check('somebody sprinting does', guest.session.reuk.strength > 0);
  check('and it points roughly at them', (() => {
    const me = guest.session.local();
    const prey = guest.session.players.get(host.session.localId);
    const want = Math.atan2(prey.x - me.x, prey.z - me.z);
    const got = Math.atan2(guest.session.reuk.dx, guest.session.reuk.dz);
    return Math.abs(Math.atan2(Math.sin(got - want), Math.cos(got - want))) < 0.9;
  })(), 'a strong reading is nearly exact; a faint one is a direction, not a fix');
  check('it names who it found', guest.session.reuk.name === 'Sint');
  check('and the survivor gets no ring pointing back at him',
    host.world.enemy.awareness === 0,
    'a person playing him builds no AI awareness, so nothing gives him away');
}

section('crew: the boat goes down');
{
  const { host, guest, rooms } = boardTogether(MODE.COOP, 0x33AA55);
  runTicks([host, guest], 0.3);

  rooms.host.close();
  rooms.guest.part();

  check('the joiner is told the boat closed',
    guest.log.ended && guest.log.ended.outcome === 'hostgone');
  check('and stops simulating', guest.session.phase === 'over');
}

section('crew: a crewmate walks off');
{
  const { host, guest, rooms } = boardTogether(MODE.COOP, 0x66BB77);
  const guestId = guest.session.localId;
  runTicks([host, guest], 0.3);

  rooms.guest.close();
  rooms.host.part();

  check('the host keeps the run going', host.session.phase === 'run' && !host.log.ended);
  check('but stops hunting somebody who is not there',
    host.session.huntTargets(host.world).every(t => t.netId !== guestId));

  // And with nobody else aboard, the run is over rather than unwinnable.
  check('a boat with nobody left on it ends', host.log.ended === null ||
    host.log.ended.outcome === 'taken');
}

// --- Report -------------------------------------------------------------

const total = passed + failures.length;
if (failures.length) {
  console.log(`\n${failures.length} of ${total} checks failed:\n`);
  for (const line of failures) console.log(`  ✗ ${line}`);
  console.log('');
  process.exit(1);
}
console.log(`\n${total} checks passed.\n`);
