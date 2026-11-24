(function(root) {
  'use strict';
  const g=typeof module!=='undefined' && module.exports?require('./engine.js'):root.Reversi;
  const weights=[
    [100,-24,14,8,8,14,-24,100],[-24,-45,-4,-3,-3,-4,-45,-24],
    [14,-4,7,3,3,7,-4,14],[8,-3,3,1,1,3,-3,8],
    [8,-3,3,1,1,3,-3,8],[14,-4,7,3,3,7,-4,14],
    [-24,-45,-4,-3,-3,-4,-45,-24],[100,-24,14,8,8,14,-24,100]
  ];
  const settings=[null,
    {depth:0,width:1,ms:20},{depth:0,width:1,ms:30},
    {depth:1,width:4,ms:60},{depth:1,width:6,ms:100},
    {depth:2,width:6,ms:180},{depth:2,width:8,ms:300},
    {depth:3,width:8,ms:450},{depth:3,width:10,ms:650},
    {depth:4,width:12,ms:950},{depth:5,width:16,ms:1400}
  ];
  function moves(state) {
    return g.SHAPES.flatMap(shape=>g.legalMoves(state,shape).map(move=>({...move,shape})));
  }
  function evaluate(state,player) {
    const count=g.score(state), opponent=3-player;
    if(state.over) return Math.sign(count[player]-count[opponent])*100000+(count[player]-count[opponent])*100;
    let position=0,frontier=0;
    for(let r=0;r<8;r++) for(let c=0;c<8;c++) {
      const piece=state.board[r][c];if(!piece)continue;
      const sign=piece===player?1:-1;
      position+=sign*weights[r][c];
      if([[1,0],[-1,0],[0,1],[0,-1]].some(([dr,dc])=>state.board[r+dr]?.[c+dc]===0))frontier-=sign;
    }
    const remaining=count[0];
    return position+(count[player]-count[opponent])*(remaining<14?12:remaining<30?3:.4)+frontier*2+(state.stock[player]-state.stock[opponent])*.6;
  }
  function projected(state,move) {
    const next={...state,board:state.board.map(r=>r.slice()),stock:{...state.stock}};
    for(const [r,c] of [...move.cells,...move.flips])next.board[r][c]=state.current;
    next.stock[state.current]-=move.cells.length;
    return next;
  }
  function chooseMove(state,level=5,options={}) {
    if(state.over)return null;
    level=Math.max(1,Math.min(10,Math.trunc(Number(level))||1));
    const random=options.random||Math.random, config=settings[level];
    const available=moves(state);if(!available.length)return null;
    if(level===1)return available[Math.floor(random()*available.length)];
    if(level===2) {
      if(random()<.25)return available[Math.floor(random()*available.length)];
      return available.sort((a,b)=>(b.flips.length+b.cells.length)-(a.flips.length+a.cells.length))[0];
    }
    const player=state.current;
    const ordered=available.map(move=>({move,value:evaluate(projected(state,move),player)+(level===3?(random()-.5)*70:0)})).sort((a,b)=>b.value-a.value);
    let best=ordered[0].move;
    if(config.depth===1)return best;
    const deadline=performance.now()+Math.max(5,options.budgetMs??config.ms);
    const timeout=Symbol('timeout');
    const check=()=>{if(performance.now()>=deadline)throw timeout;};
    function search(position,depth,alpha,beta) {
      check();
      if(position.over||depth===0)return evaluate(position,player);
      const maximizing=position.current===player;
      const candidates=moves(position).map(move=>({move,value:evaluate(projected(position,move),player)})).sort((a,b)=>maximizing?b.value-a.value:a.value-b.value).slice(0,config.width);
      let value=maximizing?-Infinity:Infinity;
      for(const {move} of candidates) {
        check();
        const next=g.play(position,move.shape,move.r,move.c);
        const child=search(next,depth-1,alpha,beta);
        value=maximizing?Math.max(value,child):Math.min(value,child);
        if(maximizing)alpha=Math.max(alpha,value);else beta=Math.min(beta,value);
        if(beta<=alpha)break;
      }
      return Number.isFinite(value)?value:evaluate(position,player);
    }
    for(let depth=2;depth<=config.depth;depth++) {
      let candidate=best,value=-Infinity;
      try {
        for(const {move} of ordered.slice(0,config.width)) {
          check();
          const next=g.play(state,move.shape,move.r,move.c);
          const score=search(next,depth-1,value,Infinity);
          if(score>value){value=score;candidate=move;}
        }
        best=candidate;
      } catch(error) {if(error!==timeout)throw error;break;}
    }
    return best;
  }
  const api={chooseMove,settings};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.ReversiAI=api;
})(typeof globalThis!=='undefined'?globalThis:this);
