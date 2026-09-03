# GEIL — De Stoomboot

A first-person stealth horror game set in the dark corridors of Sinterklaas'
steamboat. Mr. Geil wants to eat you. Five anime body pillows will change his
mind.

Three.js and the Web Audio API, no build step, no dependencies to install.
Drop the folder on any static host and it runs.

---

## The game

You are below deck. Mr. Geil is somewhere on the ship and he does not know
where you are — he has to work it out. Find five anime body pillows inside the
Sint presents scattered through the compartments, and lay them on the tribute
altar in **het ruim**.

The loop is hiding, not running:

| You do this | He notices |
| --- | --- |
| Stand still in the dark | Nothing |
| Sneak (`C`) | Almost nothing — 3.5 m of noise |
| Walk | 13 m of noise |
| Sprint | 26 m of noise, across half the ship |
| Torch on | Seen from ~1.85× as far away |
| Tear a present open | A 30 m bang that pulls him straight to you |

He hunts with three things:

- **Sight** — a forward cone, blocked by bulkheads, scaled by your torch and
  your gait. Crouching behind a cargo stack breaks it.
- **Hearing** — a radius around every footstep, roughly halved through walls.
- **Memory** — your last known position. He walks there, sweeps the cover
  nearby, and gives up after about twenty seconds.

Break line of sight and go quiet and he loses you. The awareness ring around
the crosshair shows how much he has pieced together; when it fills, he runs.

You cannot out-walk a chase, and you can only out-sprint one for about four
seconds before your breath runs out — and sprinting is exactly what tells him
where you went. Cover is the answer, not speed.

Every pillow you collect makes him faster and sharper. After the fifth he
starts drifting toward your part of the ship on his own, so the walk back to
the altar is the hardest part of the run.

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
| `F` | torch on/off |
| `E` / `Space` / click | hold to open a present or lay out the offering; press to hide behind a crate |
| `Esc` | pause |

Brightness, mouse sensitivity and volume are on the title and pause screens.
The game is genuinely dark by design — turn brightness up rather than playing
blind. Settings persist in `localStorage`.

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
assets/             the original hand-drawn Mr. Geil sketch
src/
  main.js           game loop, state machine, settings, all DOM access
  map.js            corridor layout, geometry, lighting, line of sight, pathfinding
  player.js         both control schemes, gait, stamina, noise, torch, hiding
  enemy.js          Mr. Geil: perception, memory, state machine
  items.js          presents and the pillows inside them
  tribute.js        the altar and the ending
  textures.js       every texture, drawn to canvas at runtime
  audio.js          synthesised sound; there are no audio files
```

The simulation modules never touch the DOM — `main.js` owns all of it — so the
map, player, enemy and items can be driven headlessly. There is a test harness
that does exactly that (stubbed Three.js and DOM, 52 assertions over layout
reachability, line of sight, pathfinding, collision clearance, and the stealth
loop). It is not checked in; see the notes below if you want to rebuild it.

### Two invariants worth knowing

- **Every walkable cell centre must be standable by a body of radius 0.5.**
  Pathfinding walks cell centre to cell centre, so if a prop's collider
  encroaches on one, Mr. Geil wedges himself against it and stops patrolling.
  This is why the cargo stacks sit 1.32 m off centre with a 0.62 m half-extent.
- **Sneak must not be bound to `Ctrl`.** `Ctrl`+`W` closes the tab and the page
  never sees the event.

---

## Notes on the art

Mr. Geil is the original hand-drawn sketch, unretouched. The paper is keyed out
to alpha at load time and the remaining ink is recoloured bone white, so he
reads as a drawing loose in the dark rather than a lit rectangle. He is a dim
silhouette until your torch lands on him, then he resolves.

Everything else — deck planks, five compartment bulkheads, burlap, gift wrap,
altar cloth, and all ten body pillows — is drawn to a canvas at runtime.
