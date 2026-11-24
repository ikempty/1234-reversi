const {test}=require('node:test');
const assert=require('node:assert/strict');
const g=require('./engine.js');
function empty(){const s=g.initialState();s.board=Array.from({length:8},()=>Array(8).fill(0));return s;}
test('initial pieces and stock',()=>{
  const s=g.initialState();assert.deepEqual(g.score(s),{0:60,1:2,2:2});assert.deepEqual(s.stock,{1:30,2:30});
  assert.deepEqual(g.legalMoves(s,[[0,0]]).map(m=>[m.r,m.c]),[[2,3],[3,2],[4,5],[5,4]]);
});
test('connected shapes only, with up to four unique cells within 2 by 2',()=>{
  for(const shape of g.SHAPES) assert.ok(g.validShape(shape));
  for(const shape of [[],[[0,0],[1,1]],[[0,0],[0,0]],[[0,0],[0,2]],[[0,0],[0,1],[0,2]],[[0,0],[1,0],[2,0]],[[0,0],[0,1],[0,2],[1,1]],[[0,0],[0,1],[1,0],[1,1],[2,0]]]) assert.equal(g.validShape(shape),false);
});
test('a group is legal when only one member captures',()=>{
  const s=g.initialState(), shape=[[0,0],[1,0],[1,1]];
  const result=g.inspect(s,shape,1,2);assert.equal(result.cells.length,3);assert.deepEqual(result.flips,[[3,3]]);
  const next=g.play(s,shape,1,2);assert.equal(next.stock[1],27);assert.equal(next.current,2);assert.deepEqual(g.score(next),{0:57,1:6,2:1});
  assert.equal(s.board[1][2],0);assert.equal(s.stock[1],30);
});
test('square places four pieces and consumes four from stock',()=>{
  const s=g.initialState(), square=[[0,0],[0,1],[1,0],[1,1]];
  const next=g.play(s,square,1,2);assert.ok(next);
  assert.equal(next.last.cells.length,4);assert.deepEqual(next.last.flips,[[3,3]]);
  assert.equal(next.stock[1],26);assert.equal(next.stock[2],30);
  assert.deepEqual(g.score(next),{0:56,1:7,2:1});assert.equal(next.current,2);
  s.stock[1]=3;assert.equal(g.inspect(s,square,1,2),null);
});
test('straight triples cannot be played even when they would capture',()=>{
  const s=g.initialState();
  assert.equal(g.inspect(s,[[0,0],[0,1],[0,2]],2,1),null);
  assert.equal(g.inspect(s,[[0,0],[1,0],[2,0]],1,2),null);
});
test('all eight directions capture',()=>{
  const s=empty();for(let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc){s.board[3+dr][3+dc]=2;s.board[3+2*dr][3+2*dc]=1;}
  assert.equal(g.inspect(s,[[0,0]],3,3).flips.length,8);
});
test('all group members contribute captures',()=>{
  const s=empty();s.board[3][2]=s.board[3][3]=2;s.board[4][2]=s.board[4][3]=1;
  assert.deepEqual(g.inspect(s,[[0,0],[0,1]],2,2).flips,[[3,2],[3,3]]);
});
test('no occupied cells, off-board placements, or non-capturing moves',()=>{
  const s=g.initialState();assert.equal(g.inspect(s,[[0,0]],0,0),null);
  assert.equal(g.inspect(s,[[0,0],[1,0]],2,3),null);
  assert.equal(g.inspect(s,[[0,0],[0,1],[1,0],[1,1]],2,7),null);
  assert.equal(g.inspect(s,[[0,0],[0,1],[1,0],[1,1]],7,2),null);
});
test('L shape anchor is its first occupied cell',()=>{
  const result=g.inspect(g.initialState(),[[0,1],[1,0],[1,1]],1,3);
  assert.ok(result);assert.deepEqual(result.cells,[[1,3],[2,2],[2,3]]);
});
test('remaining stock limits group size',()=>{
  const s=g.initialState();s.stock[1]=1;
  assert.equal(g.inspect(s,[[0,0],[0,1]],2,2),null);assert.ok(g.inspect(s,[[0,0]],2,3));
  s.stock[1]=0;assert.equal(g.canMove(s,1),false);
});
test('exhausted opponent automatically passes',()=>{
  const s=empty();s.stock[2]=0;s.board[0][1]=s.board[1][1]=2;s.board[0][2]=s.board[1][2]=1;
  const next=g.play(s,[[0,0]],0,0);assert.equal(next.current,1);assert.equal(next.last.passed,2);assert.equal(next.over,false);
});
test('opponent with no legal moves passes even with stock',()=>{
  const s=empty();s.board=Array.from({length:8},()=>Array(8).fill(1));
  s.board[0][0]=s.board[7][0]=0;s.board[0][1]=s.board[7][1]=2;
  const next=g.play(s,[[0,0]],0,0);assert.equal(next.current,1);assert.equal(next.last.passed,2);assert.equal(next.over,false);
});
test('both exhausted ends game even with empty cells',()=>{
  const s=g.initialState();s.stock={1:1,2:0};
  const next=g.play(s,[[0,0]],2,3);assert.equal(next.over,true);assert.equal(g.score(next)[0],59);
  assert.equal(g.play(next,[[0,0]],0,0),null);
});
test('no legal moves for either side ends the game',()=>{
  const s=empty();s.board[0][1]=2;s.board[0][2]=1;
  const next=g.play(s,[[0,0]],0,0);assert.equal(next.over,true);assert.equal(next.stock[1],29);
});
test('placed group members can be flipped individually',()=>{
  let s=g.play(g.initialState(),[[0,0],[1,0],[1,1]],1,2);
  s.board[1][1]=2;
  const result=g.inspect(s,[[0,0]],1,3);assert.ok(result);
  assert.ok(result.flips.some(([r,c])=>r===1&&c===2));
  assert.ok(!result.flips.some(([r,c])=>r===2&&c===2));
});
test('complete games preserve inventory and terminate',()=>{
  let seed=1789;
  const random=n=>{seed=(seed*1664525+1013904223)>>>0;return seed%n;};
  for(let run=0;run<12;run++) {
    let s=g.initialState();
    while(!s.over){
      const choices=g.SHAPES.flatMap(shape=>g.legalMoves(s,shape).map(m=>({shape,...m})));
      assert.ok(choices.length);const move=choices[random(choices.length)];
      const next=g.play(s,move.shape,move.r,move.c);assert.ok(next);s=next;
      const score=g.score(s);assert.equal(score[1]+score[2]+s.stock[1]+s.stock[2],64);
      assert.ok(s.stock[1]>=0&&s.stock[2]>=0);assert.ok(s.moves<=60);
    }
    assert.equal(g.canMove(s,1),false);assert.equal(g.canMove(s,2),false);
  }
});
