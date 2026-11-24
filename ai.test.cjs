const {test}=require('node:test');
const assert=require('node:assert/strict');
const game=require('./engine.js');
const ai=require('./ai.js');
test('all ten CPU levels choose legal moves without mutating the board',()=>{
  const state=game.initialState(),before=JSON.stringify(state);
  for(let level=1;level<=10;level++){
    const move=ai.chooseMove(state,level,{budgetMs:40,random:()=>.35});
    assert.ok(move);assert.ok(game.inspect(state,move.shape,move.r,move.c));
    assert.equal(JSON.stringify(state),before);
  }
});
test('CPU respects inventory and handles finished games',()=>{
  const state=game.initialState();state.stock[1]=1;
  for(const level of [1,3,10])assert.equal(ai.chooseMove(state,level,{budgetMs:10}).shape.length,1);
  state.stock[1]=0;assert.equal(ai.chooseMove(state,10),null);
  state.over=true;assert.equal(ai.chooseMove(state,1),null);
});
test('higher level takes a winning corner in the endgame',()=>{
  const state=game.initialState();state.board=Array.from({length:8},()=>Array(8).fill(1));
  state.board[0][0]=0;state.board[0][1]=2;
  const move=ai.chooseMove(state,10,{budgetMs:50});
  assert.equal(move.r,0);assert.equal(move.c,0);assert.ok(game.play(state,move.shape,move.r,move.c).over);
});
test('CPU versus CPU completes a match with all stocks conserved',()=>{
  let state=game.initialState();let turns=0;
  while(!state.over){
    const move=ai.chooseMove(state,state.current===1?1:4,{random:()=>.4});assert.ok(move);
    state=game.play(state,move.shape,move.r,move.c);assert.ok(state);
    assert.ok(++turns<=60);
    const score=game.score(state);assert.equal(score[1]+score[2]+state.stock[1]+state.stock[2],64);
  }
});
