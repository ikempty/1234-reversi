import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {RankedStore,elo,TURN_MS} from './store.mjs';
import game from '../engine.js';
function setup(){
  const db=new DatabaseSync(':memory:');let clock=1000000;
  const sql={exec(query,...args){
    if(query.includes('CREATE TABLE')){db.exec(query);return {toArray:()=>[]};}
    const rows=db.prepare(query).all(...args);return {toArray:()=>rows};
  }};
  const transaction=callback=>{db.exec('BEGIN');try{const value=callback();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}};
  const store=new RankedStore(sql,transaction,()=>clock);
  const a=store.register('a','Alice','ip1'),b=store.register('b','Bob','ip2');
  return {store,a,b,advance:ms=>clock+=ms};
}
function pair(){const fixture=setup();fixture.store.join(fixture.a.id);fixture.store.join(fixture.b.id);return fixture;}

test('ranking reset preserves identity, archives scores and only runs once across restarts',()=>{
  const {store,a,b}=pair(),matchId=store.snapshot(a.id).match.id;
  store.resign(a.id,matchId);
  assert.equal(store.resetRankingsOnce('reset-test'),true);
  assert.deepEqual(store.rankings(),[]);
  assert.equal(store.authenticate('a').id,a.id);
  assert.equal(store.player(a.id).nickname,'Alice');
  for(const player of [a,b]){
    const profile=store.snapshot(player.id).profile;
    assert.deepEqual([profile.rating,profile.wins,profile.losses,profile.draws],[1500,0,0,0]);
    assert.equal(store.snapshot(player.id).match,null);
  }
  const backup=store.first('SELECT * FROM ranking_reset_backup WHERE player_id=?',a.id);
  assert.equal(backup.rating,1488);assert.equal(backup.losses,1);assert.equal(backup.match_id,matchId);
  store.join(a.id);store.join(b.id);store.resign(b.id,store.snapshot(a.id).match.id);
  const restarted=new RankedStore(store.sql,store.transaction,store.now);
  assert.equal(restarted.resetRankingsOnce('reset-test'),false);
  assert.equal(restarted.player(a.id).rating,1512);
  assert.equal(restarted.first('SELECT COUNT(*) AS count FROM ranking_reset_backup').count,2);
});

test('ranking reset retains active matches and settles them against reset ratings',()=>{
  const {store,a,b}=pair(),matchId=store.snapshot(a.id).match.id;
  store.sql.exec('UPDATE players SET rating=1700,wins=5 WHERE id=?',a.id);
  store.resetRankingsOnce('reset-active');
  assert.equal(store.snapshot(a.id).match.id,matchId);
  assert.equal(store.snapshot(a.id).match.state.over,false);
  store.resign(a.id,matchId);
  assert.equal(store.player(a.id).rating,1488);assert.equal(store.player(b.id).rating,1512);
  assert.equal(store.player(a.id).losses,1);
});
test('server rejects forbidden registration and rename without changing records',()=>{
  const {store,a}=setup();
  assert.throws(()=>store.register('new','死ね','ip3'));
  assert.equal(store.authenticate('new'),null);
  assert.throws(()=>store.register('a','ＦＵＣＫ','ip1'));
  assert.equal(store.player(a.id).nickname,'Alice');
  assert.equal(store.player(a.id).rating,1500);
});
test('legacy forbidden names are masked and must change before queuing',()=>{
  const {store,a,b}=setup();
  store.sql.exec('UPDATE players SET nickname=?,wins=1 WHERE id=?','死ね',a.id);
  assert.equal(store.snapshot(a.id).profile.nickname,'プレイヤー');
  assert.equal(store.rankings()[0].nickname,'プレイヤー');
  assert.throws(()=>store.join(a.id));
  store.sql.exec('INSERT INTO queue(player_id,joined) VALUES(?,?)',a.id,0);
  store.join(b.id);assert.equal(store.snapshot(b.id).match,null);
  store.register('a','さくら','ip1');store.join(a.id);
  assert.ok(store.snapshot(a.id).match);
  assert.equal(store.player(a.id).wins,1);
});
test('anonymous identity survives nickname changes and never leaks credentials',()=>{
  const {store,a}=setup();const again=store.register('a','New name','ip1');assert.equal(again.id,a.id);
  const snapshot=store.snapshot(a.id);assert.equal(snapshot.profile.nickname,'New name');assert.equal(snapshot.profile.rating,1500);
  assert.ok(!JSON.stringify(snapshot).includes('secret_hash'));assert.equal(store.authenticate('wrong'),null);
});
test('random queue creates one shared match, prevents self matching and double matching',()=>{
  const {store,a,b}=setup();store.join(a.id);store.join(a.id);
  assert.ok(store.snapshot(a.id).queued);assert.equal(store.snapshot(a.id).match,null);
  store.join(b.id);const first=store.snapshot(a.id),second=store.snapshot(b.id);
  assert.equal(first.match.id,second.match.id);assert.notEqual(first.match.color,second.match.color);
  assert.equal(first.queued,false);store.join(a.id);assert.equal(store.snapshot(a.id).match.id,first.match.id);
});
test('disconnected waiting players are skipped, cancellation removes queue entry',()=>{
  const {store,a,b}=setup();store.join(a.id);store.join(b.id,()=>false);
  assert.equal(store.snapshot(a.id).queued,false);assert.equal(store.snapshot(b.id).match,null);
  assert.ok(store.snapshot(b.id).queued);store.cancel(b.id);assert.equal(store.snapshot(b.id).queued,false);
});
test('server rejects outsiders, wrong turn, malformed move and replay',()=>{
  const {store,a,b}=pair(),c=store.register('c','Carol','ip3');
  const snap=store.snapshot(a.id),black=snap.match.color===1?a:b,white=black.id===a.id?b:a;
  const move={matchId:snap.match.id,version:0,shape:[[0,0]],row:2,col:3};
  assert.throws(()=>store.move(c.id,move));assert.throws(()=>store.move(white.id,move));
  assert.throws(()=>store.move(black.id,{...move,row:'2'}));
  assert.throws(()=>store.move(black.id,{...move,shape:[[0,0],[0,1],[0,2]]}));
  store.move(black.id,move);assert.equal(store.snapshot(black.id).match.state.moves,1);
  assert.throws(()=>store.move(black.id,move));
  assert.equal(store.snapshot(black.id).profile.rating,1500);
});
test('resignation updates both ratings exactly once and can resume with stored identity',()=>{
  const {store,a,b}=pair(),id=store.snapshot(a.id).match.id;
  store.resign(a.id,id);assert.equal(store.player(a.id).rating,1488);assert.equal(store.player(b.id).rating,1512);
  store.resign(a.id,id);assert.equal(store.player(a.id).losses,1);assert.equal(store.player(b.id).wins,1);
  assert.ok(store.snapshot(store.authenticate('a').id).match.state.over);
  assert.equal(store.rankings()[0].nickname,'Bob');
});
test('turn timeout settles once, prevents a late move and does not reset on reconnect',()=>{
  const {store,a,b,advance}=pair(),snap=store.snapshot(a.id),black=snap.match.color===1?a:b;
  const deadline=snap.match.deadline;advance(TURN_MS+1);
  assert.equal(store.snapshot(a.id).match.deadline,deadline);
  store.move(black.id,{matchId:snap.match.id,version:0,shape:[[0,0]],row:2,col:3});
  assert.equal(store.snapshot(a.id).match.reason,'timeout');assert.equal(store.player(black.id).rating,1488);
  assert.deepEqual(store.expire(),[]);
});
test('alarm expiry and full natural match both persist authoritative results',()=>{
  const expired=pair();expired.advance(TURN_MS+1);assert.equal(expired.store.expire().length,2);
  assert.ok(expired.store.snapshot(expired.a.id).match.state.over);
  const {store,a,b}=pair();let snap=store.snapshot(a.id),turns=0;
  while(!snap.match.state.over){
    const state=snap.match.state;
    const choices=game.SHAPES.flatMap(shape=>game.legalMoves(state,shape).map(m=>({...m,shape})));
    const move=choices[Math.floor(choices.length/2)];
    const actor=state.current===snap.match.color?a:b;
    store.move(actor.id,{matchId:snap.match.id,version:state.moves,shape:move.shape,row:move.r,col:move.c});
    snap=store.snapshot(a.id);assert.ok(++turns<=60);
  }
  const counts=game.score(snap.match.state);assert.equal(snap.match.winner,counts[1]===counts[2]?0:counts[1]>counts[2]?1:2);
  assert.equal(store.player(a.id).rating+store.player(b.id).rating,3000);
  assert.equal(store.player(a.id).wins+store.player(a.id).losses+store.player(a.id).draws,1);
});
test('Elo rewards upsets and handles draws',()=>{
  assert.deepEqual(elo(1500,1500,1),[1512,1488]);assert.deepEqual(elo(1500,1500,.5),[1500,1500]);
  assert.ok(elo(1200,1800,1)[0]-1200>12);
});
test('anonymous creation limit and nickname validation',()=>{
  const {store}=setup();assert.throws(()=>store.register('bad','','new-ip'));
  assert.throws(()=>store.register('bad','a'.repeat(17),'new-ip'));
  for(let i=0;i<20;i++)store.register('new'+i,'Guest','new-ip');
  assert.throws(()=>store.register('overflow','Guest','new-ip'));
});
