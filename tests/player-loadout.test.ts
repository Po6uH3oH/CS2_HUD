import test from 'node:test';
import assert from 'node:assert/strict';
import type { Weapon } from '../packages/shared/types';
import { primaryWeapon, weaponFill } from '../packages/core/player-loadout';

const item = (name: string, type: string, state = 'holstered'): Weapon => ({ name: `weapon_${name}`, type, state, count: 1 });

test('inventory priority remains stable while switching between rifle, pistol, taser, knife and utility', () => {
  const knife = item('knife_kukri', 'Knife', 'active'), taser = item('taser', 'Pistol');
  const pistol = item('deagle', 'Pistol'), rifle = { ...item('ak47', 'Rifle'), ammoClip: 15, ammoClipMax: 30 };
  const utility = [item('c4', 'C4'), item('flashbang', 'Grenade'), item('molotov', 'Grenade')];
  assert.equal(primaryWeapon(utility), undefined);
  assert.equal(primaryWeapon([...utility, knife]), knife);
  assert.equal(primaryWeapon([taser, ...utility, knife]), taser);
  assert.equal(primaryWeapon([taser, pistol, knife]), pistol);
  assert.equal(primaryWeapon([taser, pistol, rifle, knife, ...utility]), rifle);
  assert.equal(weaponFill(rifle), 0);
  rifle.state = 'active'; knife.state = 'holstered';
  assert.equal(primaryWeapon([knife, rifle, pistol, taser]), rifle);
  assert.equal(weaponFill(rifle), .5);
  assert.equal(weaponFill({ ...knife, state: 'active' }), null);
  assert.equal(primaryWeapon([item('bayonet', 'Knife'), item('awp', 'SniperRifle')])?.name, 'weapon_awp');
});
