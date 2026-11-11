import type { Settings } from '../shared/types.js';
import { builtInRadarMaps } from './radar-presets.js';

/** Production settings never manufacture live player data. Stock radar overviews are bundled locally. */
export const defaultSettings: Settings = {
  teams: [
    { id: 'navi', name: 'Natus Vincere', tag: 'NAVI', logo: '', color: '#ef3c50', secondaryColor: '#902737', side: 'T', steamIds: [] },
    { id: 'fnatic', name: 'Fnatic', tag: 'FNATIC', logo: '', color: '#00c9e8', secondaryColor: '#067b91', side: 'CT', steamIds: [] },
  ],
  match: { autoSides: true, id: 'match-1', name: 'NAVI vs FNATIC', map: 'de_nuke', bestOf: 3, seriesScore: [0, 0], maps: ['de_mirage', 'de_nuke', 'de_ancient'], mapDetails: {}, faceitMatchId: '', scoreOverride: null, timeouts: [null, null], lossBonus: [null, null] },
  tournament: { id: 'tournament-1', name: 'COUNTER-STRIKE CHAMPIONSHIP', tag: 'CS2', logo: '', date: '', format: 'Playoffs · Upper bracket', description: '', faceitHubId: '' },
  hud: { scale: 1, opacity: 0.94, showRadar: true, showAliveCount: true, showMapOrder: false, showPlayers: true, showObserved: true, showHistory: true, animate: true, radarSize: 520, radarX: 48, radarY: 50, radarOpacity: 0.88, radarLayer: 'auto', showGrenades: true, timerStyle: 'bar', sideColors: { T: '#ef3c50', CT: '#00c9e8' } },
  radarMaps: structuredClone(builtInRadarMaps),
  bombDuration: 40, defuseWithKit: 5, defuseWithoutKit: 10, staleAfterMs: 5000, autoPause: true,
};
