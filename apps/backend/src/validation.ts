import { z } from 'zod';
import { demoScenarios } from '../../../packages/core/index.js';

const text = z.string().max(200);
const id = z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
const image = z.string().max(2048).refine(value => !value || /^\/(assets|uploads)\/[a-zA-Z0-9_./-]+$/.test(value) || /^https:\/\/[^\s]+$/.test(value), 'Допустим локальный путь /assets, /uploads или HTTPS URL');
const nonnegative = z.number().finite().min(0);
const nullableMoney = nonnegative.max(1_000_000).nullable();
const side = z.enum(['CT', 'T']);
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/);
export const teamSchema = z.object({
  id, name: text, tag: z.string().max(20), logo: image, color, secondaryColor: color, side,
  steamIds: z.array(z.string().regex(/^\d{1,20}$/)).max(20), faceitId: z.string().max(100).optional(),
  roster: z.array(z.object({ steamId: z.string().regex(/^\d{1,20}$/), name: text })).max(20).optional(),
});
export const matchSchema = z.object({
  autoSides: z.boolean().default(true),
  id, name: text, map: z.string().max(100), bestOf: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)]),
  seriesScore: z.tuple([nonnegative.int().max(3), nonnegative.int().max(3)]), maps: z.array(z.string().max(100)).max(10),
  mapDetails: z.record(z.string().max(100).regex(/^[a-zA-Z0-9_/-]+$/), z.object({ startingCTTeamId: id.nullable().optional(), pickTeamId: id.nullable(), decider: z.boolean(), scores: z.record(id, nonnegative.int().max(999)) })).default({}),
  faceitMatchId: z.string().max(100), scoreOverride: z.tuple([nonnegative.int().max(999), nonnegative.int().max(999)]).nullable(),
  timeouts: z.tuple([nonnegative.int().max(99).nullable(), nonnegative.int().max(99).nullable()]),
  lossBonus: z.tuple([nullableMoney, nullableMoney]),
});
export const tournamentSchema = z.object({
  id, name: text, tag: z.string().max(40), logo: image, date: z.string().max(50), format: text,
  description: z.string().max(4000), faceitHubId: z.string().max(100),
});
export const settingsSchema = z.object({
  teams: z.tuple([teamSchema, teamSchema]).refine(teams => teams[0].id !== teams[1].id && teams[0].side !== teams[1].side, 'Команды должны иметь разные ID и стороны'),
  match: matchSchema, tournament: tournamentSchema,
  hud: z.object({
    scale: z.number().min(0.5).max(1.5), opacity: z.number().min(0).max(1), showRadar: z.boolean(),
    showAliveCount: z.boolean().default(true), showMapOrder: z.boolean().default(false),
    showPlayers: z.boolean(), showObserved: z.boolean(), showHistory: z.boolean(), animate: z.boolean(),
    radarSize: z.number().min(120).max(1000), radarX: z.number().min(0).max(2560), radarY: z.number().min(0).max(1440),
    radarOpacity: z.number().min(0).max(1), radarLayer: z.string().max(40), showGrenades: z.boolean(), timerStyle: z.enum(['bar', 'compact']), sideColors: z.object({ T: color, CT: color }).default({ T: '#ef3c50', CT: '#00c9e8' }),
  }),
  radarMaps: z.array(z.object({
    id, name: text, originX: z.number().finite(), originY: z.number().finite(), scale: z.number().positive().max(100),
    rotation: z.number().finite().min(-360).max(360), size: z.number().min(100).max(10000), calibrated: z.boolean(),
    viewBounds: z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().positive(), height: z.number().positive() }).optional(),
    layers: z.array(z.object({ id, name: text, image, minZ: z.number().finite(), maxZ: z.number().finite() })).max(10),
    regions: z.array(z.object({ name: text, polygon: z.array(z.tuple([z.number().finite(), z.number().finite()])).min(3).max(100), minZ: z.number().finite(), maxZ: z.number().finite(), layer: z.string().max(100) })).max(200),
    sites: z.array(z.object({ label: text, x: z.number().finite(), y: z.number().finite(), layer: z.string().max(100) })).max(20),
  })).max(50),
  bombDuration: z.number().min(10).max(120), defuseWithKit: z.number().min(1).max(30),
  defuseWithoutKit: z.number().min(1).max(30), staleAfterMs: z.number().min(1000).max(60000), autoPause: z.boolean(),
});

export const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mode'), mode: z.enum(['live', 'demo']) }),
  z.object({ type: z.literal('pause'), kind: z.enum(['tactical', 'technical', 'admin', 'paused', 'resuming']), teamId: id.optional(), duration: nonnegative.max(3600) }),
  z.object({ type: z.literal('resume') }),
  z.object({ type: z.literal('overlay'), overlay: z.enum(['auto', 'game', 'pause', 'hidden']) }),
  z.object({ type: z.literal('demo'), action: z.enum(['play', 'pause', 'restart', 'next']), scenario: z.enum(demoScenarios).optional(), speed: z.number().min(0.25).max(4).optional() }),
  z.object({ type: z.literal('swap-sides') }),
  z.object({ type: z.literal('reset') }),
]);

export const faceitSettingsSchema = z.object({
  apiKey: z.string().max(500).optional(), hubId: z.string().max(100).optional(), matchId: z.string().max(100).optional(),
  autoSync: z.boolean().optional(), intervalSeconds: z.number().int().min(30).max(3600).optional(),
});
export const obsSettingsSchema = z.object({
  url: z.string().max(1000).url().refine(value => /^wss?:\/\//.test(value), 'Используйте ws:// или wss://'),
  password: z.string().max(500).optional(),
});
export const entitySchemas = { team: teamSchema, match: matchSchema, tournament: tournamentSchema };
