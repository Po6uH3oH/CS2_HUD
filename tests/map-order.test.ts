import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultSettings, DemoEngine } from '../packages/core';
import { settingsSchema } from '../apps/backend/src/validation';
import { MapOrder } from '../apps/web/src/overlay/MapOrder';
import { Overlay } from '../apps/web/src/overlay/Overlay';

test('map picks/results keep team identity through side swaps and hide independently', () => {
  const settings=structuredClone(defaultSettings);
  settings.hud.showMapOrder=true;
  settings.match.mapDetails={
    de_mirage:{pickTeamId:'navi',decider:false,scores:{navi:13,fnatic:7}},
    de_nuke:{pickTeamId:'fnatic',decider:false,scores:{navi:13,fnatic:9}},
    de_ancient:{pickTeamId:null,decider:true,scores:{}},
  };
  const state=new DemoEngine(settings).control('pause',{scenario:'live'});
  const render=()=>renderToStaticMarkup(createElement(MapOrder,{settings,state}));
  const initial=render();
  assert.match(initial,/ov-pick-won[^>]*>13:7/); assert.match(initial,/ov-pick-lost[^>]*>9:13/);
  assert.match(initial,/Решающая карта/); assert.doesNotMatch(initial,/LIVE|DECIDER|ov-map-index/);
  state.teams.reverse();state.teams.forEach(t=>{t.side=t.side==='T'?'CT':'T';});
  assert.equal(render(),initial);
  settings.match.bestOf=1;assert.equal(render(),'');
  settings.match.bestOf=5;settings.hud.showMapOrder=false;assert.equal(render(),'');
  settings.hud.showAliveCount=false;
  const html=renderToStaticMarkup(createElement(Overlay,{settings,state,variant:'game'}));
  assert.doesNotMatch(html,/class="ov-alive"/);
  assert.match(html,/ov-radar/);
});

test('older settings gain optional HUD controls without resetting the saved match', () => {
  const old=structuredClone(defaultSettings) as any;
  old.match.name='Saved match';delete old.match.mapDetails;delete old.hud.showAliveCount;delete old.hud.showMapOrder;
  const upgraded=settingsSchema.parse(old);
  assert.equal(upgraded.match.name,'Saved match');assert.deepEqual(upgraded.match.mapDetails,{});
  assert.equal(upgraded.hud.showAliveCount,true);assert.equal(upgraded.hud.showMapOrder,false);
});
