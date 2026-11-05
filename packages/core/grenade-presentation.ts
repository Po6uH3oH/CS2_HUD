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
