// Sint's lantaarntje: the one thing you carry that Mr. Geil does not know about.
//
// A Piet's belt lantern with a flame that answers to him. It ticks, and the
// nearer he is the faster it ticks. That is the whole of it — it never says
// which way, which is what stops it playing the game for you. It tells you how
// much room you have left; working out where the room is, is still your problem.
//
// Distance is straight-line, through bulkheads and all, so a wall between you
// buys you nothing on the dial even though it buys you everything in the dark.
//
// No DOM here, the same as every other simulation module: main.js paints the
// lamp and plays the tick.

// Past this he may as well be on another deck, and the flame goes out.
export const LANTERN_RANGE = 26;

// Where the lamp turns from amber to red. 11 m is the distance the score
// already treats as him closing on you, so the two agree.
export const LANTERN_ALARM = 11;

// Seconds between ticks at the edge of the range and stood on top of you. The
// interval slides between them geometrically rather than linearly, so the rate
// climbs evenly to the ear instead of crawling and then snapping.
const SLOW_TICK = 1.5;
const FAST_TICK = 0.1;

// How fast the reading chases the truth. Slow enough that stepping behind a
// cargo stack does not make the lamp stutter, fast enough to be worth trusting.
const EASE = 6;

export class Lantern {
  constructor() {
    this.reset();
  }

  reset() {
    this.proximity = 0;      // 0 at the edge of the range, 1 stood on top of you
    this.interval = SLOW_TICK;
    this.phase = 0;
    this.glow = 0;
    this.ticked = false;     // true on the one frame a tick lands
    this.alarm = false;
    this.lit = false;
  }

  // dist is the straight-line distance to Mr. Geil; quiet goes true once he has
  // been pacified, when the flame goes out for the rest of the crossing.
  update(delta, dist, quiet = false) {
    this.ticked = false;

    const sensed = !quiet && Number.isFinite(dist) && dist < LANTERN_RANGE;
    const target = sensed ? 1 - dist / LANTERN_RANGE : 0;

    this.proximity += (target - this.proximity) * Math.min(1, delta * EASE);
    // Settle rather than approaching zero forever, so the lamp does go out.
    if (!sensed && this.proximity < 0.004) this.proximity = 0;

    this.interval = SLOW_TICK * Math.pow(FAST_TICK / SLOW_TICK, this.proximity);
    this.alarm = this.proximity > 1 - LANTERN_ALARM / LANTERN_RANGE;
    this.lit = this.proximity > 0;

    if (!this.lit) {
      this.phase = 0;
      this.glow = 0;
      return;
    }

    this.phase += delta / this.interval;
    if (this.phase >= 1) {
      // A frame long enough to hold several ticks still only reports one.
      this.phase -= Math.floor(this.phase);
      this.ticked = true;
    }

    // Full flash on the tick whatever the distance — the rate is what carries
    // the reading — decaying to an ember that sits higher the closer he is.
    const ember = 0.06 + 0.22 * this.proximity;
    this.glow = ember + (1 - ember) * Math.pow(1 - this.phase, 2.6);
  }
}
