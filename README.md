# GEIL — De Stoomboot

**Play the game:** [https://crazycheese26.github.io/GeilHorror/](https://crazycheese26.github.io/GeilHorror/)

A first-person stealth horror game set in the dark corridors of Sinterklaas'
steamboat. Mr. Geil wants to eat you. Five anime body pillows will change his
mind. The boat is dealt fresh every run.

Play it alone, or with two to four of you: co-op against the AI, or **de
jacht**, where one of you *is* Mr. Geil.

Three.js, the Web Audio API and six mp3s, no build step, no dependencies to
install, and — including the multiplayer — no server. Drop the folder on any
static host and it runs.

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

## Met z'n allen

Two to four of you, browser to browser. **Sail with a crew** on the title
screen; one of you opens a boat and reads out the five-character code, and
everybody else types it in or opens the link. The person who opened it picks
the mode, deals the ship and starts the run.

### Co-op

Mr. Geil is the same Mr. Geil. He hunts the whole crew at once — sight, hearing
and one memory between the lot of you — and works on whoever is giving
themselves away hardest, which means the loudest person on the ship is
everyone's problem. Five pillows finish the run whoever tore the paper, so the
sensible thing is to spread out, and the sensible thing is also how people get
caught alone.

Caught is not dead. You go down on the deck with about **fifty seconds** on you,
and a crewmate has to reach you and hold **E** for four to get you back up.
Sint's lamp goes out while you are down, the compartment goes quiet, and the
only thing you can do is look. Mr. Geil has what he came for and wanders off for
five seconds after taking somebody — long enough that going back for them is
worth trying, short enough that standing over the body is not. With nobody left
upright there is nobody coming, and the clock runs six times faster.

### De jacht

One player is Mr. Geil, in the first person. The AI is switched off on every
machine and his body comes down the wire like anyone else's.

He is a different body, not a faster one. He **walks** at 4.35 m/s — quicker
than your walk, slower than your sprint — so a survivor who spots him early
breaks away for the four seconds their breath lasts and then has to have found
cover. He never has to stop. His sprint is a **lunge**: two and a half seconds
of 6.5 m/s, and then nothing at all until his breath has come all the way back,
which makes reaching for somebody a decision instead of a habit. He can go quiet
by sneaking, at the cost of most of his speed.

What he does not have is a torch or a lantaarntje. What he has is **de reuk**: a
pulse every three and a half seconds that gives him the direction of whoever is
making the most noise, with the error shrinking as the noise grows. Standing
still leaves nothing. Sneaking carries eight metres. Sprinting carries
forty-six, across half the ship. It is the AI's hearing, handed to a person —
so everything the game already taught you about being quiet is still exactly
the game.

He can hold **E** over somebody on the deck for two and a half seconds to make
sure of them, which costs him the time he would otherwise spend finding the
ones still upright. The crew still win by getting five pillows onto the altar;
he wins when there is nobody left.

Survivors get no awareness ring and no chevron in de jacht. There is no AI
belief to read off him. There is the lantaarntje, and there are his boots on
the deck.

### Nobody is running a server

GitHub Pages serves files. It cannot run a lobby, and there is no server behind
this game — not a rented one, not a free tier, not an account anywhere.

Browsers can talk to each other directly over **WebRTC** once they have swapped
a session description, and that swap is the only part that needs a third party.
It goes through [ntfy.sh](https://ntfy.sh), a free public pub/sub service that
needs no key and no account: the room code hashes to a topic, everyone in the
room subscribes to it, and the four or five messages it takes to shake hands go
over it. Then the topic goes quiet and every byte for the rest of the run is
peer to peer.

The shape is a **star**, not a mesh. Everyone connects to the host and nobody
else; the host forwards anything addressed past itself. Three connections
instead of six, one clock instead of four, and the host is already the authority
on the world because it is the one running Mr. Geil.

**The ship is never sent.** `layout.js` is deterministic, so the seed is the
whole boat: the pakjes, the pillow inside each one, his berth, his circuit, the
dead lanterns and every crew berth all come out identical on four machines
without a byte being spent on them. What actually travels is only what a seed
cannot predict — where people are, fifteen times a second, and what they have
done.

The host rules on the world and nothing else. It runs Mr. Geil, decides who he
caught, says which pakje was torn open by whom, and calls the offering. It does
**not** rule on where anybody is standing: every player walks their own body at
full frame rate and simply reports where they ended up. That is the difference
between a corridor that feels solid under you and one that drags you backwards
every time the connection hiccups, and nobody needs protecting from their
friends in a Sinterklaas horror game.

Positions go out on an unreliable channel and arrive fifteen times a second, so
nothing is drawn where a packet said: the last two are kept and every crewmate
is rendered a tenth of a second in the past, between them. Mr. Geil is walked
toward the last thing the host said about him rather than dropped onto it.
Events that must not be lost — a pakje opened, somebody going down, the run
ending — go on a reliable one.

### When two browsers cannot reach each other

Most of the time they can. Two home connections find each other directly with
nothing but STUN — a free public service that does not carry any traffic, it
only tells a browser what its own address looks like from outside. That is the
whole ICE configuration this game ships with, and a connection takes well under
a second.

Some pairs cannot. A mobile network, a work or school firewall, a VPN, or two
players sat behind the same carrier-grade NAT: the descriptions get swapped
fine and then no packet ever gets through. When that happens the traffic has to
go through a **relay** (a TURN server), and the lobby says so plainly rather
than sitting on "opening a line" — along with one line of detail about what ICE
actually managed, which is the thing worth pasting into a bug report.

**Trouble connecting?** in the lobby has a **Test my connection** button, and
it is the first thing to press when something does not work. It runs in one
browser, on its own, without needing anybody at the other end, and it separates
the four things that all look like the same stuck spinner:

```
·  Page version     2026-09-04 · net 3
✓  Secure context   yes — https://crazycheese26.github.io
✓  WebRTC           available
✓  Lobby service    reachable, 118 ms round trip
✓  Addresses found  host 2, srflx 2, relay 0 in 87 ms
✓  Data channel     opened in 22 ms
·  Relay            none set
```

- **Page version** is there because a browser holding a cached copy of the game
  is the most common reason a fix appears not to have worked. If two people
  disagree here, one of them needs a hard reload.
- **Addresses found** with `srflx 0` means the network is blocking STUN and this
  browser cannot tell anybody how to reach it.
- **Data channel** passing while a real run still fails means both browsers are
  fine and the problem is between the two of you — which is the relay case.

**Copy report** puts the whole thing on the clipboard, with the relay password
masked, for pasting at whoever is helping.

Open **Trouble connecting?** in the lobby and paste a relay in. **Only one of you
needs it**; a relay allocated by either side works for both. Free tiers exist
and none of them is a server you run:

| | |
| --- | --- |
| **Metered** | [metered.ca/tools/openrelay](https://www.metered.ca/tools/openrelay/) — free account, 50 GB a month, gives you a host, username and password straight away |
| **Twilio** | free trial credit, and a relay in every region |
| **Cloudflare** | Cloudflare Calls TURN — free tier, needs a Cloudflare account |
| **Your own** | `coturn` on any box you already have |

The box takes the shape they hand you:

```
turn:relay.example.com:3478|username|password
turn:username:password@relay.example.com:3478
turns:relay.example.com:5349?transport=tcp|username|password
```

It is kept in `localStorage` with the rest of the settings, so it is typed once.

A word on why there is no relay in the box already. There used to be several
free public ones with published credentials, and every hobby project on the
internet hardcoded them; this game shipped with one too. They are all gone —
`openrelay.metered.ca`, `turn.anyfirewall.com`, `freeturn.net` and the rest
either refuse the allocation or no longer answer at all. And a **dead** TURN
server is much worse than none: ICE waits on it, gathering never finishes, and
every connection pays a two-and-a-half second timeout twice before it can even
start looking. That was measured, and it is why the default list is STUN only
and a relay is something you add when the lobby tells you that you need one.

### What else it cannot do

- **The room is the host's tab.** Close it and the boat goes down with it.
  There is nowhere for a room to live when nobody is holding it open.
- **No reconnecting.** A dropped player is gone for that run; the room takes
  joiners again from the ending screen.
- **A room code is the only thing keeping a room private**, the same as every
  party-code game. It is five characters out of thirty-three million.

---

## The lantaarntje

Sinterklaas does not send you down empty-handed. Before you go below he hands
you a Piet's belt lantern, and it sits in the top right of the HUD under the
torch. The lamp is dead while Mr. Geil is more than 26 m off; inside that it
ticks, and it ticks faster the nearer he gets — roughly one flash a second
across the ship, ten a second when he is stood on top of you, and it turns from
amber to red inside 11 m, the same distance the score already treats as him
closing.

That is the whole of it. It reads straight-line distance through the hull, so a
bulkhead between you counts for nothing on the dial even though it counts for
everything in the dark, and it never once tells you which way he is. Knowing he
is near and not knowing where is most of what this game is for; the lamp is
there to make you feel the room shrinking, not to hand you the answer.

The rate is the readout, so it survives a player who cannot take the flashing:
under `prefers-reduced-motion` the bulb holds a steady brightness that rises as
he closes instead of strobing, and the tick keeps its rate either way.

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
lantaarntje's tick, the jumpscare — is still synthesised at runtime. If the
mp3s never arrive, the synthesised music box that was carrying the game before
them keeps playing and nothing else changes: `startVoice` is the only place a
track begins, and it is also the only place that stands the music box down.

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

With a crew, `E` also hauls a downed crewmate off the deck — and, if you are
playing Mr. Geil, makes sure of one. Pausing in a crew run opens the menu and
hands the pointer back without stopping the boat: the run carries on around you.

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

To try multiplayer on one machine, open it twice — a normal window and a
private one, so the two tabs do not share a name in `localStorage`. The running
game is on `window.GEIL` in the console if you want to poke at it.

### GitHub Pages

Push the folder, then **Settings → Pages → Deploy from a branch**, pick your
branch and `/ (root)`. No build step, and multiplayer works from the same
static files — the only thing the page reaches for is a public pub/sub topic to
carry the handshake, and after that the browsers are talking to each other.

Play the live version at [https://crazycheese26.github.io/GeilHorror/](https://crazycheese26.github.io/GeilHorror/).

---

## Layout

```
index.html          markup and the HUD
css/style.css       interface
libs/three.min.js   Three.js r128, vendored, with a CDN fallback
assets/             the hand-drawn Mr. Geil and Sinterklaas sketches
  PlayerSprite.png  the crewmate everybody else sees you as
  audio/            the six-track soundtrack
src/
  main.js           game loop, state machine, Sint's briefing, the lobby, all DOM access
  map.js            corridor layout, geometry, lighting, line of sight, pathfinding
  player.js         both control schemes, both bodies, gait, stamina, noise, torch, hiding
  enemy.js          Mr. Geil: perception, memory, state machine, and being driven
  items.js          presents and the pillows inside them
  tribute.js        the altar and the ending
  lantern.js        Sint's lamp: how near he is, turned into a rate
  layout.js         the per-run ship: pakjes, his berth, his circuit, dead lanterns, berths
  rng.js            seeded generator and the seed codes
  textures.js       every texture, drawn to canvas at runtime
  audio.js          synthesised sfx, and the soundtrack's crossfades and cues
  crew.js           the other players: sprites, torches, interpolation, footsteps
  net/
    signal.js       room codes, and the handshake carried over a free public topic
    peer.js         one WebRTC connection: two channels, reliable and not
    room.js         the star: one host, up to three joiners, and the relay between
    session.js      a run with other people in it — roster, snapshots, downs, the hunt
tests/
  run-tests.mjs     the headless harness
  stubs.mjs         just enough Three.js, canvas and DOM to run in node
```

The simulation modules never touch the DOM — `main.js` owns all of it — so the
map, player, enemy and items can be driven headlessly:

```bash
node tests/run-tests.mjs
```

251 assertions over seeds, generated layouts, line of sight, pathfinding,
collision clearance, the stealth arithmetic, the offering, the lantaarntje's
rate curve, the soundtrack's files and its silence when there is no audio
context, and a soak that runs the real update loop for 150 simulated seconds on
eight unseen ships to catch a patrol waypoint that would wedge him against a
crate. No dependencies; node 22
or newer, which detects the ES modules without a `package.json`.

Multiplayer is tested the same way, and it is worth knowing how: there is no
WebRTC in the harness, but everything above the transport is the code that
ships. Two `NetSession`s hand each other deep-copied JSON through a pair of
loopback objects, each driving its own `SteamboatMap`, `GeilEnemy`,
`ItemManager` and `TributeAltar` through the same update loop `main.js` runs.
A whole run is played out that way — two browsers dealing the same ship from
one seed, a pakje torn open on one machine and counted on both, somebody taken
down and hauled back up, the offering made by whoever is standing at the altar,
and a hunt where one player's body *is* Mr. Geil. Deep-copying is deliberate: a
bug where one browser holds a reference into another one's state shows up as a
failing check rather than as a run that only works on one machine.

### Five invariants worth knowing

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
- **The seed is the ship, so the ship is never sent.** `generateRunLayout` is
  pure in its `Rng`, and `ItemManager` draws the pillow order from the same
  generator immediately after it. Four browsers handed one seed therefore deal
  one boat. Put a `Math.random()` anywhere along that path — a tiebreak in
  `drawSpread`, a shuffle in `buildPresents` — and multiplayer does not throw:
  it quietly gives two players different ships, and the pakje one of them opens
  is a different pillow on the other's screen. Anything that must differ between
  two runs of the same ship (flicker, footstep timing, his look-around pauses)
  stays on `Math.random`; anything a player can see the position of comes off
  the seed. `crew: one seed, one ship` in the harness is the guard.

- **The torch is dimmed, never hidden.** Setting `visible = false` on a
  shadow-casting light takes it out of the renderer's lighting state, which
  changes the program cache key, which recompiles every material in the scene.
  Measured on r128 in this ship that is a 91 ms frame — six dropped — on a key
  the player presses all run. `setFlashlight` moves `intensity` between 0 and
  `TORCH_INTENSITY` and parks `shadow.autoUpdate` instead, and the same frame
  costs 0.1 ms. Anything that adds or drops a light mid-run pays that price —
  which is why every crewmate's torch in `crew.js` is built empty in the lobby,
  before anybody is playing, and only ever dimmed afterwards.

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
