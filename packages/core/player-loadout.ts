import type { Weapon } from '../shared/types';

/** Inventory priority, independent of the currently held item. */
export function primaryWeapon(weapons: Weapon[]): Weapon | undefined {
  const rank = (weapon: Weapon) => {
    const name = weapon.name.replace(/^weapon_/, '').toLowerCase();
    const type = weapon.type.toLowerCase();
    if (/grenade|flashbang|molotov|decoy|^c4$/.test(name) || /grenade|c4/.test(type)) return 0;
    if (/knife|bayonet/.test(name) || type === 'knife') return 1;
    if (name === 'taser' || type === 'taser') return 2;
    if (type === 'pistol' || /^(glock|hkp2000|usp_silencer|deagle|elite|fiveseven|p250|tec9|cz75a|revolver)$/.test(name)) return 3;
    return /rifle|smg|submachine|shotgun|machinegun/.test(type) || /^(ak47|m4a1(_silencer)?|aug|sg556|famas|galilar|awp|ssg08|scar20|g3sg1|mac10|mp9|mp7|mp5sd|ump45|p90|bizon|nova|xm1014|mag7|sawedoff|m249|negev)$/.test(name) ? 4 : 0;
  };
  return weapons.reduce<Weapon | undefined>((best, weapon) => rank(weapon) > (best ? rank(best) : 0) ? weapon : best, undefined);
}

export function weaponFill(weapon: Weapon): number | null {
  if (weapon.state !== 'active') return 0;
  return weapon.ammoClip != null && weapon.ammoClipMax ? weapon.ammoClip / weapon.ammoClipMax : null;
}
