export interface MotionPoint { x: number; y: number; time: number }

/** Small playout buffer absorbs irregular packet intervals without predicting through walls. */
export class RadarTrack {
  private points: MotionPoint[] = [];
  push(x: number, y: number, time: number) {
    const last = this.points.at(-1);
    if (last && time <= last.time) return;
    if (last && (time - last.time > 1000 || Math.hypot(x - last.x, y - last.y) > 140)) this.points = [];
    this.points.push({ x, y, time });
    this.points = this.points.filter(p => p.time >= time - 1500).slice(-80);
  }
  at(now: number): MotionPoint | null {
    if (!this.points.length) return null;
    const target = now - 200;
    const first = this.points[0];
    if (target <= first.time) return first;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1], b = this.points[i];
      if (target <= b.time) {
        const t = (target - a.time) / (b.time - a.time);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, time: target };
      }
    }
    return this.points.at(-1)!;
  }
  clear() { this.points = []; }
}
