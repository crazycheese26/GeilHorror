# GEIL — De Stoomboot

A first-person stealth horror game set in the dark corridors of Sinterklaas'
steamboat. Mr. Geil wants to eat you. Five anime body pillows will change his
mind. The boat is dealt fresh every run.

Three.js, the Web Audio API and six mp3s, no build step, no dependencies to
install. Drop the folder on any static host and it runs.

---

## The game

Sinterklaas stops you on deck before you go down. Something came aboard with
the pakjes and it lives in het ruim now, the Pieten will not go near it, and
the boat cannot dock with it awake. It cannot be fought and it cannot be
reasoned with — it can only be given something.

So: you are below deck. Mr. Geil is somewhere on the ship and he does not know
where you are — he has to work it out. Find five anime body pillows inside the
Sint presents scattered through the compartments, and lay them out in a row on
the tribute altar in **het ruim**. Do that and the hold goes quiet and the
stoomboot comes safely ashore, which is the whole of the ending song.

The loop is hiding, not running:

| You do this | He notices |
| --- | --- |
| Stand still in the dark | Nothing |
| Sneak (`C`) | Almost nothing — 3.5 m of noise, and seen from little over half as far |
| Walk | 13 m of noise |
| Sprint | 26 m of noise, across half the ship |
| Torch on | Seen from ~1.85× as far away |
| Tear a present open | A 30 m bang that pulls him straight to you |

He hunts with three things:

- **Sight** — a forward cone, blocked by bulkheads, scaled by your torch and
  your stance. Crouching behind a cargo stack breaks it, and it keeps breaking
  it when you stop moving.
- **Hearing** — a radius around every footstep, roughly halved through walls.
- **Memory** — your last known position. He walks there, sweeps the cover
  nearby, and gives up after about twenty seconds.

When he has nothing to go on he paces a circuit of five waypoints, one in each
compartment, taking a detour about a quarter of the time. Watch him for a
minute and you can work out where he will be; the circuit is dealt fresh with
the rest of the ship, so what you learn is good for this run and no other.

Break line of sight and go quiet and he loses you. The awareness ring around
the crosshair shows how much he has pieced together; when it fills, he runs.

You cannot out-walk a chase, and you can only out-sprint one for about four
seconds before your breath runs out — and sprinting is exactly what tells him
where you went. Cover is the answer, not speed.

Every pillow you collect makes him faster and sharper. After the fifth he
starts drifting toward your part of the ship on his own, so the walk back to
the altar is the hardest part of the run.

---

## Every run is a different boat

The hull never changes — the corridors, the bulkheads, the cargo stacks and the
shrine in het ruim are hand-authored and stay put. Everything you could
otherwise memorise is dealt from the run's seed:

- the ten pakjes, spread at least 13 m apart with at least two in every
  compartment, tucked against a bulkhead rather than dropped mid-junction
- which pillow is inside which one
- where Mr. Geil starts — always at least 28 m away, never down a straight
  corridor from where you wake up
- the five-waypoint circuit he paces
- which lanterns are dead, so the dark stretches move

Every plan is checked before the game uses it: nothing walled off, nothing on
top of you, no waypoint and no berth whose cell centre a body of his size
cannot stand in.
A plan that fails is re-rolled, and if the rules were ever tightened past what
the hull can support the game falls back to the hand-authored layout instead of
shipping a broken ship.

The seed is on the pause and ending screens. **Same ship** replays the layout
you just died on — the point of a stealth game is learning a route, and that
button is where it happens. **New ship** deals another. Typing a code, or any
word, into **Ship** on the title screen pins a layout so you can hand someone
the exact boat you played; leaving it empty deals a new one every run.

---

## The score

Six tracks live in `assets/audio`, and they are the only files the game loads
that it did not draw itself. They are routed through the same Web Audio graph
as everything else, so the one volume slider governs the lot.

| | |
| --- | --- |
| **Title** | the haunted music box, on the menu and over Sint's briefing |
| **Explore** | the below-deck drone, when he has no idea where you are |
| **Stalk** | triangulation, when he is working it out |
| **Stinger** | a one-shot the moment he lays eyes on you |
| **Game over** | after the jumpscare has had the room to itself |
| **Victory** | the offering song, over the ending screen |

Explore and stalk are looping beds that crossfade over 2.2 s. The stalk bed
comes in as soon as he is suspicious, searching, chasing, over 30% aware, or
simply within 11 m; it does not go back until four and a half quiet seconds
have passed, so one glance down a corridor does not flip the score twice.

Everything else — footsteps, the engine, the tearing paper, the growl, the
jumpscare — is still synthesised at runtime. If the mp3s never arrive, the
synthesised music box that was carrying the game before them keeps playing and
nothing else changes: `startVoice` is the only place a track begins, and it is
also the only place that stands the music box down.

---

## Controls

Pick a scheme on the title screen; both are complete.

**Mouse look** (default) — click to capture the pointer, mouse aims, `A`/`D`
strafe.
**Keyboard turn** — no mouse needed, `A`/`D` turn the camera. Arrow keys always
move and turn under either scheme.

| Key | |
| --- | --- |
| `W` `S` / `↑` `↓` | forward, back |
| `A` `D` / `←` `→` | strafe or turn, depending on scheme |
| `Shift` | sprint (drains breath, very loud) |
| `C` | sneak (slow, quiet, low) |
| `F` | torch on/off (every run starts with it out) |
| `E` / `Space` / click | hold to open a present or lay out the offering; press to hide behind a crate |
| `Esc` | pause |

Brightness, mouse sensitivity and volume are on the title and pause screens,
and the seed box is on the title screen. The game is genuinely dark by design —
turn brightness up rather than playing blind. Settings persist in
`localStorage`.

---

## Running it

It must be served over HTTP. Opening `index.html` from the filesystem taints
the canvas, and the monster sketch cannot be alpha-keyed (the game detects this
and falls back, but it looks wrong).

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

### GitHub Pages

Push the folder, then **Settings → Pages → Deploy from a branch**, pick your
branch and `/ (root)`. No build step.

---

## Layout

```
index.html          markup and the HUD
css/style.css       interface
libs/three.min.js   Three.js r128, vendored, with a CDN fallback
assets/             the hand-drawn Mr. Geil and Sinterklaas sketches
  audio/            the six-track soundtrack
src/
  main.js           game loop, state machine, Sint's briefing, settings, all DOM access
  map.js            corridor layout, geometry, lighting, line of sight, pathfinding
  player.js         both control schemes, gait, stamina, noise, torch, hiding
  enemy.js          Mr. Geil: perception, memory, state machine
  items.js          presents and the pillows inside them
  tribute.js        the altar and the ending
  layout.js         the per-run ship: pakjes, his berth, his circuit, dead lanterns
  rng.js            seeded generator and the seed codes
  textures.js       every texture, drawn to canvas at runtime
  audio.js          synthesised sfx, and the soundtrack's crossfades and cues
tests/
  run-tests.mjs     the headless harness
  stubs.mjs         just enough Three.js, canvas and DOM to run in node
```

The simulation modules never touch the DOM — `main.js` owns all of it — so the
map, player, enemy and items can be driven headlessly:

```bash
node tests/run-tests.mjs
```

141 assertions over seeds, generated layouts, line of sight, pathfinding,
collision clearance, the stealth arithmetic, the offering, the soundtrack's
files and its silence when there is no audio context, and a soak that runs the
real update loop for 150 simulated seconds on eight unseen ships to catch a
patrol waypoint that would wedge him against a crate. No dependencies; node 22
or newer, which detects the ES modules without a `package.json`.

### Three invariants worth knowing

- **Every walkable cell centre must be standable by a body of radius 0.5, and
  every crossing between two of them must be walkable.** Pathfinding hops from
  cell centre to cell centre, so a prop encroaching on a centre wedges Mr. Geil
  against it, and a prop lying across the boundary between two cells makes him
  walk into furniture the grid says he can pass. This is why the cargo stacks
  sit 1.32 m off centre with a 0.62 m half-extent, and why `buildEdgeBlocks`
  works out the crossings the altar closes so the pathfinder goes round the
  shrine instead of through it.
- **A generated layout is only as safe as its rules.** Anything `layout.js`
  places is walked by something: pakjes by you, waypoints by him. The rules in
  `LAYOUT_RULES` and the checks in `validateRunLayout` are what keep a seed
  from quietly producing an unwinnable or unpatrollable ship, so loosen them
  and run the harness before believing the result.
- **Sneak must not be bound to `Ctrl`.** `Ctrl`+`W` closes the tab and the page
  never sees the event.

---

## Notes on the art

Mr. Geil is the original hand-drawn sketch, unretouched. The paper is keyed out
to alpha at load time and the remaining ink is recoloured bone white, so he
reads as a drawing loose in the dark rather than a lit rectangle. He is a dim
silhouette until your torch lands on him, then he resolves.

Sinterklaas is the same kind of sketch and gets the same treatment, keyed in CSS
rather than canvas because he only ever appears on a screen: inverted, screened
over the dark, and pulled warm so the one person on your side is the one warm
thing in the game.

Everything else — deck planks, five compartment bulkheads, burlap, gift wrap,
altar cloth, and all ten body pillows — is drawn to a canvas at runtime.
