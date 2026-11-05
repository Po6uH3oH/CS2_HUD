import { useId, type CSSProperties } from 'react';

export type EquipmentKind = 'armor' | 'helmet' | 'kit' | 'bomb' | 'skull' | 'health' | 'flash' | 'smoke' | 'he' | 'fire' | 'decoy' | 'kill' | 'damage';

/** Оригинальные векторные пиктограммы; игровые файлы и торговые марки не используются. */
export function EquipmentIcon({ kind, className = '', title }: { kind: EquipmentKind; className?: string; title?: string }) {
  const mask = useId();
  return <svg className={`ov-icon ${className}`} width="24" height="24" viewBox="0 0 24 24" role="img" aria-label={title || kind}><title>{title || kind}</title><defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24" style={{maskType:'luminance'}}><image href={`/assets/icons/equipment/${kind}.svg`} width="24" height="24" /></mask></defs><rect width="24" height="24" fill="currentColor" mask={`url(#${mask})`} /></svg>;

}

type GunShape = 'ak' | 'rifle' | 'sniper' | 'pistol' | 'smg' | 'shotgun' | 'machinegun' | 'knife' | 'taser' | 'generic';
const weaponKinds: Record<string, GunShape> = {
  ak47: 'ak', m4a1: 'rifle', m4a1_silencer: 'rifle', aug: 'rifle', sg556: 'rifle', famas: 'rifle', galilar: 'rifle',
  awp: 'sniper', ssg08: 'sniper', scar20: 'sniper', g3sg1: 'sniper',
  glock: 'pistol', hkp2000: 'pistol', usp_silencer: 'pistol', deagle: 'pistol', elite: 'pistol', fiveseven: 'pistol', p250: 'pistol', tec9: 'pistol', cz75a: 'pistol', revolver: 'pistol',
  mac10: 'smg', mp9: 'smg', mp7: 'smg', mp5sd: 'smg', ump45: 'smg', p90: 'smg', bizon: 'smg',
  nova: 'shotgun', xm1014: 'shotgun', mag7: 'shotgun', sawedoff: 'shotgun', m249: 'machinegun', negev: 'machinegun', taser: 'taser',
};
export const itemName = (name: string) => name.replace(/^weapon_/, '').replace(/_silencer$/, '-S').replace(/_/g, ' ').toUpperCase();
export const grenadeKind = (name: string): EquipmentKind => name.includes('flash') ? 'flash' : name.includes('smoke') ? 'smoke' : name.includes('molotov') || name.includes('inc') || name.includes('fire') || name.includes('inferno') ? 'fire' : name.includes('decoy') ? 'decoy' : 'he';
export const isGrenade = (name: string) => /grenade|flashbang|molotov|incgrenade|decoy/.test(name);

export function WeaponIcon({ name, className = '', style, ammoRatio }: { name: string; className?: string; style?: CSSProperties; ammoRatio?: number | null }) {
  const fillId = useId().replace(/:/g, '');
  const ratio = ammoRatio == null ? null : Math.max(0, Math.min(1, ammoRatio));
  const clean = name.replace(/^weapon_/, '');
  if (isGrenade(name)) return <EquipmentIcon className={className} kind={grenadeKind(name)} title={itemName(name)} />;
  if (clean === 'c4') return <EquipmentIcon className={className} kind="bomb" title="C4" />;
  const kind = clean.includes('knife') || clean === 'bayonet' ? 'knife' : weaponKinds[clean] || 'generic';
  const asset = new Set(['ak47', 'aug', 'awp', 'bizon', 'cz75a', 'deagle', 'elite', 'famas', 'fiveseven', 'g3sg1', 'galilar', 'generic', 'glock', 'hkp2000', 'knife', 'knife_bowie', 'knife_butterfly', 'knife_canis', 'knife_cord', 'knife_css', 'knife_falchion', 'knife_flip', 'knife_gut', 'knife_gypsy_jackknife', 'knife_karambit', 'knife_kukri', 'knife_m9_bayonet', 'knife_outdoor', 'knife_push', 'knife_skeleton', 'knife_stiletto', 'knife_survival_bowie', 'knife_t', 'knife_tactical', 'knife_twinblade', 'knife_ursus', 'knife_widowmaker', 'm249', 'm4a1', 'm4a1_silencer', 'mac10', 'mag7', 'mp5sd', 'mp7', 'mp9', 'negev', 'nova', 'p250', 'p90', 'revolver', 'sawedoff', 'scar20', 'sg556', 'ssg08', 'taser', 'tec9', 'ump45', 'usp_silencer', 'xm1014']).has(clean) ? clean : clean.includes('knife') || clean === 'bayonet' ? 'knife' : 'generic';
  const mask = `${fillId}-mask`;
  return <svg className={`ov-weapon ${className}`} style={style} viewBox="0 0 120 48" role="img" aria-label={itemName(name)}><title>{itemName(name)}</title><defs><mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="120" height="48" style={{maskType:'luminance'}}><image href={`/assets/icons/weapons/${asset}.svg`} width="120" height="48" /></mask>{ratio != null && <linearGradient id={fillId}><stop offset={`${ratio * 100}%`} stopColor="currentColor" /><stop offset={`${ratio * 100}%`} stopColor="#687582" /></linearGradient>}</defs><rect width="120" height="48" mask={`url(#${mask})`} fill={ratio == null ? 'currentColor' : `url(#${fillId})`} /></svg>;

}

export function TeamMark({ name, tag, logo, color, className = '' }: { name: string; tag: string; logo?: string; color?: string; className?: string }) {
  return <span className={`ov-team-mark ${className}`} style={{ color }}>
    {logo ? <img src={logo} alt={name} /> : <svg viewBox="0 0 80 80" role="img" aria-label={name}><path d="M40 3 73 18v40L40 77 7 58V18Z" fill="currentColor" opacity=".13" /><path d="m40 6 30 14v36L40 73 10 56V20Z" fill="none" stroke="currentColor" strokeWidth="2" /><path d="m19 27 21-10 21 10-21 10Z" fill="currentColor" opacity=".16" /><text x="40" y="50" fontFamily="Arial,sans-serif" textAnchor="middle" fontSize={tag.length > 3 ? '17' : '23'} fontWeight="900" fill="currentColor">{tag.slice(0, 4)}</text></svg>}
  </span>;
}
