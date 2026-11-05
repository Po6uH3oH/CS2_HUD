import { useEffect, useRef, useState } from 'react';
import { radarFocus, stepRadarFocus, type RadarPoint, type RadarView } from '../../../../packages/core/radar-focus';

export function useRadarFocus(bounds: RadarView, points: RadarPoint[], enabled: boolean, animate: boolean) {
  const target = useRef(bounds);
  const next = radarFocus(bounds, points, enabled);
  // Ignore small changes in framing, rather than following every footstep.
  if (!enabled || Math.abs(next.width - target.current.width) > bounds.width * .035 ||
      Math.hypot(next.x - target.current.x, next.y - target.current.y) > bounds.width * .035) target.current = next;
  const [view, setView] = useState(bounds);
  useEffect(() => {
    if (!animate) return;
    let frame = 0, previous = performance.now();
    const draw = (now: number) => {
      if (now - previous >= 30) {
        const dt = now - previous; previous = now;
        setView(current => {
          if (Math.abs(current.x - target.current.x) + Math.abs(current.y - target.current.y) + Math.abs(current.width - target.current.width) < .05) return current;
          return stepRadarFocus(current, target.current, dt);
        });
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [animate]);
  return animate ? view : next;
}
