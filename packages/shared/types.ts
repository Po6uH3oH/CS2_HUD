export type Side = 'CT' | 'T';
export type Mode = 'live' | 'demo';
export type Source = 'gsi' | 'manual' | 'demo' | 'estimate' | 'unknown';
export type Vec3 = { x: number; y: number; z: number };
export type Timer = { remaining: number | null; duration: number | null; running: boolean; updatedAt: number; source: Source };
export interface Weapon { name: string; type: string; state: string; ammoClip?: number; ammoClipMax?: number; ammoReserve?: number; count: number }
export interface Player {
  steamId: string; name: string; teamId: string; side: Side; slot: number | null;
  health: number | null; flashed: number | null; armor: number | null; helmet: boolean | null; money: number | null;
  alive: boolean; defuseKit: boolean | null; hasBomb: boolean; weapons: Weapon[]; inventoryKnown: boolean;
  kills: number | null; assists: number | null; deaths: number | null; roundKills: number | null; roundDamage: number | null; equipmentValue: number | null;
  position: Vec3 | null; deathPosition: Vec3 | null; forward: Vec3 | null; observed: boolean;
}
export interface TeamConfig { id: string; name: string; tag: string; logo: string; color: string; secondaryColor: string; side: Side; steamIds: string[]; faceitId?: string; roster?: { steamId: string; name: string }[] }
export interface TeamState extends TeamConfig { score: number | null; seriesScore: number; timeoutsLeft: number | null; lossBonus: number | null }
export interface Economy { money: number | null; equipmentValue: number | null; alive: number; grenades: Record<string, number>; utilityLevel: 'full' | 'partial' | 'low' | 'unknown'; complete: boolean }
export type PauseKind = 'tactical' | 'technical' | 'admin' | 'paused' | 'resuming';
export interface PauseState { active: boolean; kind: PauseKind; teamId: string | null; timer: Timer; source: Source }
export interface BombState { state: 'unknown' | 'carried' | 'dropped' | 'planting' | 'planted' | 'defusing' | 'defused' | 'exploded'; position: Vec3 | null; playerId: string | null; timer: Timer; defuseTimer: Timer; defuserHasKit: boolean | null }
export interface Grenade { id: string; type: string; position: Vec3; owner?: string; ownerTeamId?: string; ownerSide?: Side; velocity: Vec3 | null; effectTime: number | null; lifetime: number | null; flames: Vec3[] }
export interface RoundResult { round: number; teamId: string; side: Side; method: string }
export interface GameState {
  broadcastAt?: number;
  revision: number; mode: Mode; receivedAt: number; connected: boolean; map: string; phase: string; round: number;
  teams: [TeamState, TeamState]; players: Player[]; observedId: string | null;
  roundTimer: Timer; bomb: BombState; pause: PauseState; roundHistory: RoundResult[]; grenades: Grenade[];
  capabilities: string[]; warnings: string[]; winner: string | null;
}
export interface RadarRegion { name: string; polygon: [number, number][]; minZ: number; maxZ: number; layer: string }
export interface RadarLayer { id: string; name: string; image: string; minZ: number; maxZ: number }
export interface RadarMap { id: string; name: string; originX: number; originY: number; scale: number; rotation: number; size: number; calibrated: boolean; viewBounds?: { x: number; y: number; width: number; height: number }; layers: RadarLayer[]; regions: RadarRegion[]; sites: { label: string; x: number; y: number; layer: string }[] }
export interface HudSettings { scale: number; opacity: number; showRadar: boolean; showAliveCount: boolean; showMapOrder: boolean; showPlayers: boolean; showObserved: boolean; showHistory: boolean; animate: boolean; radarSize: number; radarX: number; radarY: number; radarOpacity: number; radarLayer: 'auto' | 'both' | string; showGrenades: boolean; timerStyle: 'bar' | 'compact'; sideColors: Record<Side, string> }
export interface MapDetail { startingCTTeamId?: string | null; pickTeamId: string | null; decider: boolean; scores: Record<string, number> }
export interface MatchConfig { autoSides: boolean; id: string; name: string; map: string; bestOf: 1 | 2 | 3 | 5; seriesScore: [number, number]; maps: string[]; mapDetails: Record<string, MapDetail>; faceitMatchId: string; scoreOverride: [number, number] | null; timeouts: [number | null, number | null]; lossBonus: [number | null, number | null] }
export interface Tournament { id: string; name: string; tag: string; logo: string; date: string; format: string; description: string; faceitHubId: string }
export interface Settings { teams: [TeamConfig, TeamConfig]; match: MatchConfig; tournament: Tournament; hud: HudSettings; radarMaps: RadarMap[]; bombDuration: number; defuseWithKit: number; defuseWithoutKit: number; staleAfterMs: number; autoPause: boolean }
export interface IntegrationStatus { configured: boolean; connected: boolean; message: string; lastSync: number | null }
export interface Diagnostics { gsi: { packets: number; rejected: number; lastPacket: number | null; fields: string[] }; faceit: IntegrationStatus; obs: IntegrationStatus; logs: { time: number; level: string; message: string }[]; demo: { playing: boolean; scenario: string; speed: number; event: number }; mode: Mode }
export interface Snapshot { state: GameState; settings: Settings; diagnostics?: Diagnostics }
export interface LibraryItem { id: string; kind: 'team' | 'match' | 'tournament'; name: string; data: unknown; updatedAt: number }
export type OperatorCommand =
  | { type: 'mode'; mode: Mode }
  | { type: 'pause'; kind: PauseKind; teamId?: string; duration: number }
  | { type: 'resume' }
  | { type: 'overlay'; overlay: 'auto' | 'game' | 'pause' | 'hidden' }
  | { type: 'demo'; action: 'play' | 'pause' | 'restart' | 'next'; scenario?: string; speed?: number }
  | { type: 'swap-sides' }
  | { type: 'reset' };
export interface WireSnapshot extends Snapshot { overlay: 'auto' | 'game' | 'pause' | 'hidden' }
