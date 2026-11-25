const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const game=require('./engine.js');
const ai=require('./ai.js');
function setup({configured=false,profile=null,rankings={players:[]}}={}){
  const nodes=new Map(),timers=new Map(),workers=[],clients=[];let timerId=0;
  function element(){return {children:[],events:{},textContent:'',value:'',hidden:false,disabled:false,classList:{toggle(){}},focus(){},showModal(){this.open=true;},close(){this.open=false;},append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(name,callback){this.events[name]=callback;}};}
  const document={getElementById(id){if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},createElement:element};
  class FakeWorker{
    constructor(){workers.push(this);}postMessage(data){this.data=structuredClone(data);}terminate(){this.terminated=true;}
    reply(){this.onmessage({data:{id:this.data.id,move:ai.chooseMove(this.data.state,1,{random:()=>.5})}});}
  }
  class FakeRanked{
    constructor(url,onEvent){this.ready=false;this.onEvent=onEvent;this.connections=[];this.closed=false;clients.push(this);}
    close(){this.closed=true;this.ready=false;}
    async connect(name,options){assert.ok(configured);this.closed=false;this.connections.push({name,options});}
    send(message){assert.ok(configured);this.lastMessage=message;return this.ready;}
    queue(){return this.send();}
    async getProfile(){return typeof profile==='function'?profile():profile;}
    async getRankings(){return typeof rankings==='function'?rankings():rankings;}
    emit(event){if(event.type==='connection')this.ready=event.ready;this.onEvent(event);}
  }
  const context=vm.createContext({NicknamePolicy:require('./nickname-policy.js'),Reversi:game,ReversiAI:ai,RankedClient:FakeRanked,document,window:{REVERSI_ONLINE_URL:configured?'https://test.example':'',addEventListener(){}},location:{protocol:'http:'},Worker:FakeWorker,localStorage:{getItem(){return null;}},confirm:()=>true,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);},setInterval(){return 0;},clearInterval(){}});
  vm.runInContext(fs.readFileSync('app.js','utf8'),context);
  function click(element){assert.equal(element.disabled,false);element.events.click();}
  const byId=id=>nodes.get(id);
  function placeFirst(){click(byId('board').children[19]);click(byId('place'));}
  function startCPU(level=3){click(byId('mode-cpu'));click(byId('level-choices').children[level-1]);}
  function runTimers(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}
  return {byId,click,startCPU,placeFirst,runTimers,workers,clients,context};
}
test('inappropriate nickname stays on TOP without making a connection',()=>{
  const ui=setup({configured:true});ui.byId('nickname').value='死ね';
  ui.click(ui.byId('mode-online'));
  assert.equal(ui.byId('top-screen').hidden,false);
  assert.equal(ui.byId('nickname-error').hidden,false);
  assert.equal(ui.clients[0].connections.length,0);
});
test('rules can open from TOP and during a game without resetting the board',()=>{
  const ui=setup();ui.click(ui.byId('rules-open'));
  assert.equal(ui.byId('rules-dialog').open,true);ui.click(ui.byId('rules-close'));
  assert.equal(ui.byId('rules-dialog').open,false);
  ui.startCPU();ui.placeFirst();const moves=ui.byId('move-count').textContent;
  ui.click(ui.byId('rules-open'));assert.equal(ui.byId('rules-dialog').open,true);
  ui.click(ui.byId('rules-close'));assert.equal(ui.byId('move-count').textContent,moves);
  assert.equal(ui.byId('game-screen').hidden,false);
});
test('rules appear on page entry once, not on return to TOP',()=>{
  const ui=setup();assert.equal(ui.byId('rules-dialog').open,true);
  ui.click(ui.byId('rules-close'));ui.startCPU();ui.click(ui.byId('back-top'));
  assert.equal(ui.byId('rules-dialog').open,false);
  ui.click(ui.byId('rules-open'));assert.equal(ui.byId('rules-dialog').open,true);
});
test('ranked win, loss and draw show one result per match with server rating',()=>{
  for(const [winner,title,delta,kind] of [[1,'あなたの勝ち',12,'win'],[2,'あなたの負け',-12,'loss'],[0,'引き分け',0,'draw']]){
    const ui=setup({configured:true});ui.click(ui.byId('rules-close'));
    ui.byId('nickname').value='Player';ui.click(ui.byId('mode-online'));
    const client=ui.clients[0];client.emit({type:'connection',ready:true});
    const match={id:'match',state:game.initialState(),color:1,black:{nickname:'Player',rating:1500},white:{nickname:'Opponent',rating:1500},deadline:Date.now()+120000};
    const snapshot={type:'snapshot',profile:{rating:1500},queued:false,match,serverTime:Date.now()};
    client.emit(snapshot);assert.ok(!ui.byId('result-dialog').open);
    ui.click(ui.byId('rules-open'));
    const ended={...snapshot,profile:{rating:1500+delta},match:{...match,state:{...match.state,over:true},winner,delta,reason:'normal'}};
    client.emit(ended);
    assert.equal(ui.byId('rules-dialog').open,false);assert.equal(ui.byId('result-dialog').open,true);
    assert.equal(ui.byId('result-title').textContent,title);assert.equal(ui.byId('result-dialog').className,'match-result result-'+kind);
    assert.equal(ui.byId('result-rating').textContent,`1500 → ${1500+delta}`);
    assert.equal(ui.byId('result-delta').textContent,`${delta>=0?'+':''}${delta}`);
    ui.click(ui.byId('result-close'));client.emit(ended);
    assert.equal(ui.byId('result-dialog').open,false);
    ui.click(ui.byId('back-top'));assert.equal(ui.byId('rules-dialog').open,false);
    // A stale completed match received when matching again must not open a result.
    ui.click(ui.byId('mode-online'));client.emit(ended);assert.equal(ui.byId('result-dialog').open,false);
  }
});
test('TOP opens first, then CPU level selection, then the game',()=>{
  const ui=setup();assert.equal(ui.byId('top-screen').hidden,false);assert.equal(ui.byId('game-screen').hidden,true);
  assert.equal(ui.byId('board').children[19].disabled,true);
  ui.click(ui.byId('mode-cpu'));assert.equal(ui.byId('top-screen').hidden,true);assert.equal(ui.byId('level-screen').hidden,false);
  assert.equal(ui.byId('game-screen').hidden,true);assert.equal(ui.byId('level-choices').children.length,10);
  ui.click(ui.byId('level-choices').children[9]);assert.equal(ui.byId('level-screen').hidden,true);assert.equal(ui.byId('game-screen').hidden,false);
  assert.equal(ui.byId('white-name').textContent,'CPU Lv.10');
});

test('CPU posts use the selected level and final outcome, and clear for a new game',()=>{
  const suffix='\n1〜4個の駒を組み合わせる、新しいリバーシ。\nhttps://1234reversi.com/\n#1234リバーシ';
  for(const [color,headline] of [[1,'レベル10に勝利！'],[2,'レベル10に敗北！'],[0,'レベル10と引き分け！']]){
    const ui=setup();assert.equal(ui.byId('game-share').hidden,true);ui.startCPU(10);
    assert.equal(ui.byId('game-share').hidden,true);
    vm.runInContext(`state.board=Array.from({length:8},(_,r)=>Array(8).fill(${color}||r%2+1));state.over=true;render();`,ui.context);
    assert.equal(ui.byId('game-share').hidden,false);
    const url=new URL(ui.byId('game-share').href);
    assert.equal(url.origin,'https://x.com');assert.equal(url.pathname,'/intent/tweet');
    assert.equal(url.searchParams.get('text'),headline+suffix);
    ui.click(ui.byId('back-top'));assert.equal(ui.byId('game-share').hidden,true);
    ui.startCPU(1);assert.equal(ui.byId('game-share').href,'');
  }
});

test('ranked posts use authoritative outcomes for either color and actual rating changes',()=>{
  for(const [color,winner,rating,delta,result] of [[1,1,1582,16,'勝利'],[2,2,1582,16,'勝利'],[2,1,1468,-16,'敗北'],[1,0,1500,0,'引き分け']]){
    const ui=setup({configured:true});ui.byId('nickname').value='Private player';ui.click(ui.byId('mode-online'));
    const client=ui.clients[0];client.emit({type:'connection',ready:true});
    const match={id:'private-match-id',state:game.initialState(),color,black:{nickname:'Black'},white:{nickname:'White'}};
    const event={type:'snapshot',profile:{rating:1500},queued:false,match,serverTime:Date.now()};
    client.emit(event);assert.equal(ui.byId('game-share').hidden,true);
    client.emit({...event,profile:{rating},match:{...match,state:{...match.state,over:true},winner,delta,reason:'resign'}});
    const text=new URL(ui.byId('result-share').href).searchParams.get('text');
    assert.equal(text,`1234リバーシのランクマッチで${result}！レート：${rating}（${delta>=0?'+':''}${delta}）\n1〜4個の駒を組み合わせる、新しいリバーシ。\nhttps://1234reversi.com/\n#1234リバーシ`);
    assert.equal(ui.byId('game-share').href,ui.byId('result-share').href);
    assert.equal(ui.byId('result-share').hidden,false);
    ui.click(ui.byId('result-top'));assert.equal(ui.byId('result-share').hidden,true);
  }
});
test('TOP loads the saved rating without connecting or queuing',async()=>{
  const ui=setup({configured:true,profile:{rating:1632}});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.byId('top-rating').textContent,'レート 1632');
  assert.equal(ui.clients[0].connections.length,0);
  assert.equal(ui.byId('top-screen').hidden,false);
  const first=setup({configured:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(first.byId('top-rating').textContent,'レート 1500');
});
test('TOP ranking opens without a nickname or matchmaking and returns to TOP',async()=>{
  const ui=setup({configured:true,rankings:{players:[{nickname:'Player',rating:1712}]}});
  ui.click(ui.byId('top-ranking'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.byId('ranking-screen').hidden,false);assert.equal(ui.byId('top-screen').hidden,true);
  assert.equal(ui.byId('online-options').hidden,true);
  assert.equal(ui.byId('top-leaderboard').children[0].children[0].textContent,'1712');
  assert.equal(ui.clients[0].connections.length,0);
  ui.click(ui.byId('back-top'));assert.equal(ui.byId('ranking-screen').hidden,true);
  assert.equal(ui.byId('top-screen').hidden,false);
});
test('failed ranking can retry, and a late response cannot replace a CPU screen',async()=>{
  let resolveRanking,requests=0;
  const ui=setup({configured:true,rankings:()=>++requests===1?Promise.reject(new Error('offline')):new Promise(resolve=>resolveRanking=resolve)});
  ui.click(ui.byId('top-ranking'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.byId('ranking-retry').hidden,false);
  ui.click(ui.byId('ranking-retry'));ui.click(ui.byId('back-top'));ui.startCPU();
  resolveRanking({players:[{nickname:'Late',rating:1800}]});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.byId('game-screen').hidden,false);assert.equal(ui.byId('ranking-screen').hidden,true);
  assert.equal(ui.byId('top-leaderboard').children.length,0);
});
test('returning to TOP refreshes the rating and handles a failed lookup',async()=>{
  let current={rating:1540};
  const ui=setup({configured:true,profile:()=>current});await new Promise(resolve=>setImmediate(resolve));
  ui.startCPU();current={rating:1576};ui.click(ui.byId('back-top'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.byId('top-rating').textContent,'レート 1576');
  ui.startCPU();current=Promise.reject(new Error('offline'));ui.click(ui.byId('back-top'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ui.byId('top-rating').textContent,'レート 取得できません');
});
test('human move schedules CPU, CPU responds, undo restores both sides',()=>{
  const ui=setup();ui.startCPU();assert.equal(ui.byId('builder').children.length,4);
  ui.placeFirst();assert.equal(ui.byId('black-stock').textContent,29);assert.equal(ui.byId('place').disabled,true);
  ui.runTimers();assert.equal(ui.workers.length,1);ui.workers[0].reply();
  assert.ok(Number(ui.byId('white-stock').textContent)<30);
  ui.click(ui.byId('undo'));assert.equal(ui.byId('black-stock').textContent,30);assert.equal(ui.byId('white-stock').textContent,30);
  assert.equal(ui.byId('black-count').textContent,2);
});
test('CPU result cannot be undone, while TOP navigation remains available',()=>{
  const ui=setup();ui.startCPU();
  vm.runInContext('state.board=Array.from({length:8},()=>Array(8).fill(1));state.board[0][1]=2;state.board[0][2]=0;render();',ui.context);
  ui.click(ui.byId('board').children[2]);ui.click(ui.byId('place'));
  assert.equal(ui.byId('turn').textContent,'あなたの勝ち');
  assert.equal(ui.byId('undo').disabled,true);
  ui.byId('undo').events.click();
  assert.equal(ui.byId('black-count').textContent,64);
  assert.equal(ui.byId('turn').textContent,'あなたの勝ち');
  ui.click(ui.byId('back-top'));assert.equal(ui.byId('top-screen').hidden,false);
});
test('undo during CPU thinking cancels stale worker result',()=>{
  const ui=setup();ui.startCPU();ui.placeFirst();ui.runTimers();const worker=ui.workers[0];
  ui.click(ui.byId('undo'));assert.ok(worker.terminated);worker.reply();
  assert.equal(ui.byId('white-count').textContent,2);assert.equal(ui.byId('black-stock').textContent,30);
});
test('online mode is explicitly unavailable without a configured server',()=>{
  const ui=setup();ui.byId('nickname').value='Player';ui.click(ui.byId('mode-online'));
  assert.equal(ui.byId('match').disabled,true);assert.equal(ui.byId('place').disabled,true);
  assert.match(ui.byId('online-status').textContent,/準備中/);
  assert.equal(ui.byId('game-screen').hidden,true);
  ui.click(ui.byId('back-top'));ui.startCPU();assert.equal(ui.byId('board').children[19].disabled,false);
});
test('returning to TOP cancels CPU work before selecting a new level',()=>{
  const ui=setup();ui.startCPU();ui.placeFirst();ui.runTimers();const worker=ui.workers[0];
  ui.click(ui.byId('back-top'));assert.ok(worker.terminated);assert.equal(ui.byId('top-screen').hidden,false);
  ui.startCPU(10);worker.reply();
  assert.equal(ui.byId('white-name').textContent,'CPU Lv.10');assert.equal(ui.byId('black-stock').textContent,30);
});
test('random match starts connecting from TOP and shows the board only when matched',()=>{
  const ui=setup({configured:true});ui.byId('nickname').value='Player';ui.click(ui.byId('mode-online'));
  const client=ui.clients[0];assert.equal(client.connections.length,1);assert.equal(client.connections[0].options.queue,true);
  assert.equal(ui.byId('top-screen').hidden,true);assert.equal(ui.byId('game-screen').hidden,true);
  client.emit({type:'connection',ready:true});
  client.emit({type:'snapshot',profile:{rating:1500},queued:true,match:null,serverTime:Date.now()});
  assert.equal(ui.byId('game-screen').hidden,true);
  client.emit({type:'snapshot',profile:{rating:1500},queued:false,match:{id:'match',state:game.initialState(),color:1,black:{nickname:'Player',rating:1500},white:{nickname:'Opponent',rating:1632},deadline:Date.now()+120000},serverTime:Date.now()});
  assert.equal(ui.byId('game-screen').hidden,false);assert.equal(ui.byId('matching-view').hidden,true);
  assert.equal(ui.byId('back-top').disabled,true);assert.equal(ui.byId('board').children[19].disabled,false);
  assert.equal(ui.byId('black-rating').textContent,'レート 1500');assert.equal(ui.byId('white-rating').textContent,'レート 1632');
  assert.equal(ui.byId('rating').hidden,true);assert.equal(ui.byId('match').hidden,true);
  assert.equal(ui.byId('resign').hidden,false);ui.click(ui.byId('resign'));
  assert.equal(client.lastMessage.type,'resign');assert.equal(client.lastMessage.matchId,'match');
  client.emit({type:'connection',ready:false});
  assert.equal(ui.byId('resign').disabled,true);assert.equal(ui.byId('match').hidden,false);assert.equal(ui.byId('match').textContent,'再接続');
});
test('cancel during matchmaking disconnects and keeps late events off TOP',()=>{
  const ui=setup({configured:true});ui.byId('nickname').value='Player';ui.click(ui.byId('mode-online'));const client=ui.clients[0];
  assert.equal(client.connections[0].name,'Player');
  ui.click(ui.byId('back-top'));assert.ok(client.closed);
  client.emit({type:'snapshot',profile:{rating:1500},queued:true,match:null,serverTime:Date.now()});
  assert.equal(ui.byId('top-screen').hidden,false);assert.equal(ui.byId('online-options').hidden,true);
});
test('blank and whitespace names cannot start matching, while CPU remains available',()=>{
  const ui=setup({configured:true});
  for(const name of ['', ' \u3000 ']){
    ui.byId('nickname').value=name;ui.click(ui.byId('mode-online'));
    assert.equal(ui.byId('top-screen').hidden,false);
    assert.equal(ui.clients[0].connections.length,0);
    assert.equal(ui.byId('nickname-error').hidden,false);
  }
  ui.byId('nickname').value='';ui.startCPU();assert.equal(ui.byId('game-screen').hidden,false);
  ui.click(ui.byId('back-top'));ui.byId('nickname').value='Player';ui.byId('nickname').events.input();
  assert.equal(ui.byId('nickname-error').hidden,true);
  ui.click(ui.byId('mode-online'));assert.equal(ui.clients[0].connections.length,1);
});
test('cancelled connection cannot reopen a socket after a new connection begins',async()=>{
  const requests=[],sockets=[];
  class Socket{constructor(){sockets.push(this);}close(){} }
  const context=vm.createContext({window:{NicknamePolicy:require('./nickname-policy.js')},URL,AbortSignal,WebSocket:Socket,localStorage:{getItem:()=> 'a'.repeat(64),setItem(){}},fetch:()=>new Promise(resolve=>requests.push(resolve)),setTimeout:()=>0,clearTimeout(){},setInterval:()=>0,clearInterval(){}});
  vm.runInContext(fs.readFileSync('online.js','utf8'),context);
  const client=new context.window.RankedClient('https://test.example',()=>{});
  const first=client.connect('First',{queue:true});client.close();const second=client.connect('Second',{queue:true});
  requests[0]({ok:true,json:async()=>({})});await first;assert.equal(sockets.length,0);
  requests[1]({ok:true,json:async()=>({})});await second;assert.equal(sockets.length,1);
  client.close();sockets[0].onopen();assert.equal(client.ready,false);
});
