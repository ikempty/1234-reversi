(function (root) {
  'use strict';
  const SIZE = 8;
  const DIRECTIONS = [-1, 0, 1].flatMap(r => [-1, 0, 1].map(c => [r, c])).filter(([r, c]) => r || c);
  const SHAPES = [ [[0,0]], [[0,0],[0,1]], [[0,0],[1,0]], [[0,0],[0,1],[1,0]], [[0,0],[0,1],[1,1]], [[0,0],[1,0],[1,1]], [[0,1],[1,0],[1,1]], [[0,0],[0,1],[1,0],[1,1]] ];
  const inside = (r,c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
  function normalize(shape) {
    if (!shape.length) return [];
    const minR = Math.min(...shape.map(p => p[0]));
    const minC = Math.min(...shape.map(p => p[1]));
    return shape.map(([r,c]) => [r-minR,c-minC]).sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  }
  function validShape(shape) {
    if (!Array.isArray(shape) || shape.length < 1 || shape.length > 4) return false;
    if (shape.some(p => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger))) return false;
    if (normalize(shape).some(([r,c]) => r >= 2 || c >= 2)) return false;
    const keys = new Set(shape.map(p => p.join(',')));
    if (keys.size !== shape.length) return false;
    const seen = new Set([shape[0].join(',')]);
    const queue = [shape[0]];
    while (queue.length) {
      const [r,c] = queue.pop();
      for (const [dr,dc] of [[0,1],[0,-1],[1,0],[-1,0]]) {
        const key = [r+dr,c+dc].join(',');
        if (keys.has(key) && !seen.has(key)) { seen.add(key); queue.push([r+dr,c+dc]); }
      }
    }
    return seen.size === shape.length;
  }
  function initialState() {
    const board = Array.from({length:8}, () => Array(8).fill(0));
    board[3][3] = board[4][4] = 2;
    board[3][4] = board[4][3] = 1;
    return { board, stock: {1:30,2:30}, current:1, moves:0, over:false, last:null };
  }
  function inspect(state, shape, row, col, player = state.current) {
    if (!Number.isInteger(row) || !Number.isInteger(col) || (player !== 1 && player !== 2)) return null;
    if (state.over || !validShape(shape) || shape.length > state.stock[player]) return null;
    const normalized = normalize(shape), pivot = normalized[0];
    const cells = normalized.map(([r,c]) => [row+r-pivot[0], col+c-pivot[1]]);
    if (cells.some(([r,c]) => !inside(r,c) || state.board[r][c] !== 0)) return null;
    const board = state.board.map(r => r.slice());
    for (const [r,c] of cells) board[r][c] = player;
    const captured = new Set();
    for (const [r,c] of cells) {
      for (const [dr,dc] of DIRECTIONS) {
        let rr=r+dr, cc=c+dc;
        const line=[];
        while (inside(rr,cc) && board[rr][cc] === 3-player) { line.push(rr*8+cc); rr+=dr; cc+=dc; }
        if (line.length && inside(rr,cc) && board[rr][cc] === player) line.forEach(index => captured.add(index));
      }
    }
    if (!captured.size) return null;
    return { cells, flips:[...captured].map(index => [Math.floor(index/8),index%8]) };
  }
  function legalMoves(state, shape, player = state.current) {
    const moves=[];
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
      const result=inspect(state,shape,r,c,player);
      if (result) moves.push({r,c,...result});
    }
    return moves;
  }
  function canMove(state, player) {
    if (state.stock[player] <= 0) return false;
    for (const shape of SHAPES) {
      if (shape.length > state.stock[player]) continue;
      for (let r=0;r<8;r++) for (let c=0;c<8;c++) if (inspect(state,shape,r,c,player)) return true;
    }
    return false;
  }
  function play(state,shape,row,col) {
    const result=inspect(state,shape,row,col);
    if (!result) return null;
    const player=state.current;
    const next={...state,board:state.board.map(r => r.slice()),stock:{...state.stock},moves:state.moves+1};
    for (const [r,c] of [...result.cells,...result.flips]) next.board[r][c]=player;
    next.stock[player]-=result.cells.length;
    next.last={player,...result,passed:null};
    next.current=3-player;
    if (!canMove(next,next.current)) {
      next.last.passed=next.current;
      next.current=player;
      if (!canMove(next,player)) next.over=true;
    }
    return next;
  }
  function score(state) {
    return state.board.flat().reduce((counts,p) => { counts[p]++; return counts; },{0:0,1:0,2:0});
  }
  const api={normalize,validShape,initialState,inspect,legalMoves,canMove,play,score,SHAPES};
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  else root.Reversi=api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
