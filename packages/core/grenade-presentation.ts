import type { Grenade } from '../shared/types.js';

export function grenadePhase(g: Grenade): 'flight' | 'smoke' | 'fire' | 'burst' | 'expired' {
  const effectStarted = g.effectTime != null && g.effectTime > 0;
  if (/inferno|fire/.test(g.type)) return g.flames.length ? 'fire' : 'expired';
  if (g.type.includes('smoke')) return effectStarted ? 'smoke' : 'flight';
  if (/flash|frag|hegrenade/.test(g.type)) {
    if (effectStarted) return g.effectTime! < .45 ? 'burst' : 'expired';
    // GSI can retain a stationary projectile after its standard fuse has elapsed,
    // without an effecttime. Hide that remnant; do not invent an explosion event.
    const stopped = g.velocity != null && Math.hypot(g.velocity.x, g.velocity.y, g.velocity.z) < 1;
    const fuse = g.type.includes('flash') ? 1.4 : 1.6;
    if (stopped && g.lifetime != null && g.lifetime >= fuse) return 'expired';
  }
  return 'flight';
}

/** Emit one event on detonation/removal, never repeatedly for retained remnants. */
export function grenadeBursts(previous: Grenade[], current: Grenade[]): Grenade[] {
  const old = new Map(previous.map(g => [g.id, g]));
  const next = new Map(current.map(g => [g.id, g]));
  return [
    ...current.filter(g => /flash|frag|hegrenade/.test(g.type) && grenadePhase(g) === 'burst' &&
      (!old.has(g.id) || grenadePhase(old.get(g.id)!) === 'flight')),
    ...previous.filter(g => /flash|frag|hegrenade/.test(g.type) && grenadePhase(g) === 'flight' &&
      (!next.has(g.id) || grenadePhase(next.get(g.id)!) === 'expired')),
  ];
}

export function bombPulsePeriod(seconds: number | null): number {
  return seconds == null || seconds > 20 ? 1.2 : seconds > 10 ? .8 : seconds > 5 ? .5 : .25;
}

/** Both score icon and radar ring use the same countdown phase, independent of mount time. */
export function bombPulseFrame(seconds: number | null) {
  if (seconds === null) return { iconScale: 1, ringScale: 1, ringOpacity: .2 };
  const phase = (Math.max(0, seconds) % bombPulsePeriod(seconds)) / bombPulsePeriod(seconds);
  const beat = (.5 + .5 * Math.cos(phase * 2 * Math.PI));
  return { iconScale: 1 + .18 * beat, ringScale: .35 + (1 - phase) * .85, ringOpacity: phase * .85 };
}

export function expiredSmokes(previous: Grenade[], current: Grenade[]): Grenade[] {
  return previous.filter(g => grenadePhase(g) === 'smoke' && !current.some(n => n.id === g.id && grenadePhase(n) === 'smoke'));
}
