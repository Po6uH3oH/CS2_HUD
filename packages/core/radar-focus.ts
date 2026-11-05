export interface RadarView { x: number; y: number; width: number; height: number }
export interface RadarPoint { x: number; y: number }

/** Fit every relevant point, preserving the viewport aspect ratio and a generous safe margin. */
export function radarFocus(bounds: RadarView, points: RadarPoint[], enabled = true): RadarView {
  const valid = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!enabled || !valid.length) return { ...bounds };
  const xs = valid.map(p => p.x), ys = valid.map(p => p.y);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const fraction = Math.min(1, Math.max(1 / 1.9, (right - left) / (bounds.width * .64), (bottom - top) / (bounds.height * .64)));
  const width = bounds.width * fraction, height = bounds.height * fraction;
  return {
    x: Math.max(bounds.x, Math.min(bounds.x + bounds.width - width, (left + right - width) / 2)),
    y: Math.max(bounds.y, Math.min(bounds.y + bounds.height - height, (top + bottom - height) / 2)),
    width, height,
  };
}

export function stepRadarFocus(current: RadarView, target: RadarView, dt: number): RadarView {
  const amount = 1 - Math.exp(-Math.min(100, Math.max(0, dt)) / (target.width > current.width ? 240 : 1100));
  return Object.fromEntries(Object.keys(current).map(key => {
    const k = key as keyof RadarView;
    return [k, current[k] + (target[k] - current[k]) * amount];
  })) as unknown as RadarView;
}
