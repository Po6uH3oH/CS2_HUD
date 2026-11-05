import type { RadarMap } from '../shared/types.js';
import { builtInRadarMaps } from './radar-presets.js';

/** Fill missing stock maps and the original empty Nuke scaffold; keep operator calibrations. */
export function upgradeRadarMaps(maps: RadarMap[]): RadarMap[] {
  const next = structuredClone(maps);
  for (const preset of builtInRadarMaps) {
    const index = next.findIndex(map => map.id === preset.id);
    if (index < 0) { next.push(structuredClone(preset)); continue; }
    const old = next[index];
    if (!old.viewBounds && old.layers.every(layer => preset.layers.some(stock => stock.id === layer.id && stock.image === layer.image)) && old.originX === preset.originX && old.originY === preset.originY && old.scale === preset.scale && old.rotation === preset.rotation) old.viewBounds = structuredClone(preset.viewBounds);
    if (old.id === 'de_nuke' && !old.calibrated && old.layers.every(layer => !layer.image) &&
      old.originX === -3453 && old.originY === 2887 && old.scale === 7 && old.rotation === 0 &&
      old.regions.length === 0 && old.sites.length === 0) next[index] = structuredClone(preset);
  }
  return next;
}
