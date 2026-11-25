'use strict';
const game=Reversi;
const $=id=>document.getElementById(id);
const names={1:'黒',2:'白'};
const QUOTED_POST_URL='https://x.com/ikempty2/status/2096434947267703185';
let state=game.initialState(),shape=[[0,0]],selected=null,hover=null,history=[],legal=[];
let screen='top',mode=null,level=3,thinking=false,worker=null,cpuTimer=null,job=0;
let navigation=0;
let profileRequest=0;
let online=null,connecting=false,pending=false,serverOffset=0,pendingTimer=null;
const shownResults=new Set();
const configured=!!window.REVERSI_ONLINE_URL;
const ranked=new RankedClient(window.REVERSI_ONLINE_URL||'',onOnline);
const boardButtons=[],builderButtons=[];
const matches=(cells,r,c)=>cells?.some(p=>p[0]===r&&p[1]===c);
const myColor=()=>mode==='cpu'?1:online?.match?.color;
const onlineActive=()=>mode==='online'&&online?.match&&!online.match.state.over;
const canInteract=()=>screen==='game'&&!state.over&&!thinking&&!pending&&state.current===myColor()&&(mode==='cpu'||ranked.ready);
function message(text=''){$('status').textContent=text;$('status').hidden=!text;}
function resetSelection(){selected=null;hover=null;message();}
for(let value=1;value<=10;value++){
  const button=document.createElement('button');
  button.textContent=String(value);button.setAttribute('aria-label',`CPUレベル${value}`);
  button.addEventListener('click',()=>{
    if(screen!=='levels')return;
    level=value;screen='game';newGame();$('turn').focus();
  });
  $('level-choices').append(button);
}
for(let r=0;r<8;r++)for(let c=0;c<8;c++){
  const button=document.createElement('button');
  button.addEventListener('click',()=>{
    if(!canInteract())return;
    if(!game.inspect(state,shape,r,c)){selected=null;hover=null;renderBoard();renderPlacement();message('ここには置けません。');return;}
    selected=[r,c];hover=null;message();renderBoard();renderPlacement();
  });
  button.addEventListener('pointerenter',event=>{if(event.pointerType==='mouse'&&canInteract()){hover=[r,c];renderBoard();}});
  button.addEventListener('focus',()=>{if(canInteract()){hover=[r,c];renderBoard();}});
  button.addEventListener('blur',()=>{hover=null;renderBoard();});
  boardButtons.push(button);$('board').append(button);
}
$('board').addEventListener('pointerleave',()=>{hover=null;renderBoard();});
for(let r=0;r<2;r++)for(let c=0;c<2;c++){
  const button=document.createElement('button');
  button.setAttribute('aria-label',`合体スペース ${r+1}行${c+1}列`);
  button.addEventListener('click',()=>{
    if(!canInteract())return;
    if(matches(shape,r,c))shape=shape.filter(([rr,cc])=>rr!==r||cc!==c);else shape.push([r,c]);
    shape.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);resetSelection();render();
    if(shape.length&&!game.validShape(shape))message('縦横につながる形にしてください。');
    else if(shape.length>state.stock[state.current])message('手持ちの駒が足りません。');
    else if(shape.length&&!legal.length)message('この形は置けません。');
  });
  builderButtons.push(button);$('builder').append(button);
}
function renderBoard(){
  const location=hover||selected;
  const preview=canInteract()&&location&&game.inspect(state,shape,...location);
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){
    const button=boardButtons[r*8+c],value=state.board[r][c];
    const anchor=canInteract()&&legal.some(m=>m.r===r&&m.c===c);
    const ghost=preview&&matches(preview.cells,r,c),flip=preview&&matches(preview.flips,r,c);
    button.className='cell'+(selected?.[0]===r&&selected?.[1]===c?' selected':'')+(matches(state.last?.cells,r,c)?' last':'')+(flip?' will-flip':'');
    button.innerHTML=value?`<i class="disc ${value===1?'black':'white'}"></i>`:ghost?`<i class="disc ghost ${state.current===1?'black':'white'}"></i>`:anchor?'<i class="hint"></i>':'';
    button.setAttribute('aria-label',`${String.fromCharCode(65+c)}${r+1} ${value?names[value]:'空き'}${anchor?' 配置可能':''}${flip?' 裏返る駒':''}`);
    button.setAttribute('aria-pressed',String(selected?.[0]===r&&selected?.[1]===c));button.disabled=!canInteract();
  }
}
function renderPlacement(){
  const result=selected&&game.inspect(state,shape,...selected);
  $('place').disabled=!canInteract()||!result;
  $('place').textContent=pending?'送信中…':'置く';
}
function resultPostText(){
  if(screen!=='game'||!state.over)return '';
  let headline;
  if(mode==='online'){
    const match=online?.match,rating=online?.profile?.rating;
    if(!match?.state.over||!Number.isFinite(rating))return '';
    const result=match.winner===0?'引き分け':match.winner===match.color?'勝利':'敗北';
    const delta=Number.isFinite(match.delta)?`（${match.delta>=0?'+':''}${match.delta}）`:'';
    headline=`1234リバーシのランクマッチで${result}！レート：${rating}${delta}`;
  }else if(mode==='cpu'){
    const counts=game.score(state);
    headline=counts[1]===counts[2]?`レベル${level}と引き分け！`:`レベル${level}に${counts[1]>counts[2]?'勝利':'敗北'}！`;
  }else return '';
  return `${headline}\n1〜4個の駒を組み合わせる、新しいリバーシ。\nhttps://1234reversi.com/\n#1234リバーシ`;
}
function renderResultShare(){
  const text=resultPostText();
  for(const id of ['game-share','result-share']){
    $(id).hidden=!text;
    $(id).href=text?'https://x.com/intent/tweet?text='+encodeURIComponent(text)+'&url='+encodeURIComponent(QUOTED_POST_URL):'';
  }
}
function renderTurn(){
  let text;
  if(mode==='online'&&!online?.match)text=online?.queued?'対戦待ち':'—';
  else if(state.over){
    const counts=game.score(state);
    const winner=mode==='online'?online.match.winner:counts[1]===counts[2]?0:counts[1]>counts[2]?1:2;
    text=winner===0?'引き分け':winner===myColor()?'あなたの勝ち':'あなたの負け';
  }else if(thinking)text='CPU思考中';
  else text=state.current===myColor()?'あなたの番':'相手の番';
  if(onlineActive()){
    const seconds=Math.max(0,Math.ceil((online.match.deadline-(Date.now()+serverOffset))/1000));
    text+=' '+seconds+'秒';
  }
  $('turn').textContent=text;
}
function render(){
  $('app').classList.toggle('menu-view',screen!=='game');
  $('top-screen').hidden=screen!=='top';
  $('level-screen').hidden=screen!=='levels';
  $('ranking-screen').hidden=screen!=='ranking';
  $('top-ranking').disabled=!configured;
  $('top-ranking').hidden=screen!=='top';
  $('game-screen').hidden=screen!=='game';
  $('online-options').hidden=mode!=='online';
  $('matching-view').hidden=screen!=='matching';
  $('matching-spinner').hidden=screen!=='matching'||(!connecting&&!(ranked.ready&&online?.queued));
  $('back-top').hidden=screen==='top';
  $('back-top').disabled=!!onlineActive();
  $('back-top').textContent=screen==='matching'?'キャンセル':'TOPへ戻る';
  legal=canInteract()?game.legalMoves(state,shape):[];
  const counts=game.score(state);
  for(const [p,color]of[[1,'black'],[2,'white']]){
    $(color+'-count').textContent=counts[p];$(color+'-stock').textContent=state.stock[p];
    $(color+'-score').classList.toggle('active',!state.over&&state.current===p&&(mode==='cpu'||!!online?.match));
    $(color+'-name').textContent=mode==='cpu'?(p===1?'あなた':`CPU Lv.${level}`):(online?.match?.[color]?.nickname||names[p]);
    const rating=mode==='online'?online?.match?.[color]?.rating:null;
    $(color+'-rating').hidden=rating==null;
    $(color+'-rating').textContent=rating==null?'':`レート ${rating}`;
  }
  $('move-count').textContent=(mode==='cpu'||online?.match)?`${state.moves}${state.over?'手で終了':'手'}`:'';
  $('pass').textContent=state.last?.passed&&!state.over?`${names[state.last.passed]}はパス`:'';
  for(let r=0;r<2;r++)for(let c=0;c<2;c++){
    const button=builderButtons[r*2+c],filled=matches(shape,r,c);
    button.className=(filled?'filled ':'')+(shape[0]?.[0]===r&&shape[0]?.[1]===c?'pivot':'');
    button.innerHTML=filled?`<i class="disc ${myColor()===2?'white':'black'}"></i>`:'<span>+</span>';
    button.setAttribute('aria-pressed',String(!!filled));button.disabled=!canInteract();
  }
  $('undo').hidden=mode!=='cpu';$('undo').disabled=state.over||!history.length;
  $('place').hidden=state.over;
  if(state.over)$('undo').hidden=true;
  $('resign').hidden=screen!=='game'||!onlineActive();
  $('resign').disabled=!ranked.ready||connecting||pending;
  $('match').disabled=!configured||connecting;
  $('match').hidden=!configured||connecting||!!(ranked.ready&&(online?.queued||onlineActive()));
  $('match').textContent=!ranked.ready&&online?.match?'再接続':screen==='game'?'もう一度対戦':'再試行';
  $('nickname').disabled=connecting||!!online?.queued||!!onlineActive();
  $('leaderboard-toggle').disabled=!ranked.ready;
  $('leaderboard-toggle').hidden=screen==='game';
  if(screen==='game')$('leaderboard').hidden=true;
  const delta=online?.match?.delta;
  $('rating').hidden=screen==='game'&&!state.over;
  $('rating').textContent=online?.profile?`レート ${online.profile.rating}${delta!=null?` (${delta>=0?'+':''}${delta})`:''}`:'レート —';
  renderTurn();renderBoard();renderPlacement();renderResultShare();
}
function stopCPU(){job++;clearTimeout(cpuTimer);if(worker){worker.terminate();worker=null;}thinking=false;}
function scheduleCPU(){
  if(screen!=='game'||mode!=='cpu'||state.over||state.current!==2)return;
  thinking=true;resetSelection();render();const id=++job;
  function finish(move){
    if(id!==job||mode!=='cpu')return;
    if(worker){worker.terminate();worker=null;}
    const next=move&&game.play(state,move.shape,move.r,move.c);
    if(!next){thinking=false;render();message('CPUの処理に失敗しました。「戻す」で再試行できます。');return;}
    state=next;thinking=false;shape=[[0,0]];resetSelection();render();scheduleCPU();
  }
  function fallback(){
    if(id!==job)return;
    if(worker){worker.terminate();worker=null;}
    cpuTimer=setTimeout(()=>{
      if(id!==job)return;
      try{finish(ReversiAI.chooseMove(state,level,{budgetMs:Math.min(180,ReversiAI.settings[level].ms)}));}
      catch{finish(null);}
    },30);
  }
  cpuTimer=setTimeout(()=>{
    if(id!==job)return;
    if(typeof Worker==='undefined'||location.protocol==='file:'){fallback();return;}
    try{
      worker=new Worker('ai-worker.js');
      worker.onmessage=({data})=>{if(data.id===id){if(data.error)fallback();else finish(data.move);}};
      worker.onerror=event=>{event.preventDefault();fallback();};
      worker.postMessage({id,state,level});
    }catch{fallback();}
  },200);
}
function newGame(){stopCPU();state=game.initialState();shape=[[0,0]];history=[];resetSelection();render();}
$('place').addEventListener('click',()=>{
  if(!canInteract()||!selected)return;
  if(mode==='online'){
    if(ranked.send({type:'move',matchId:online.match.id,version:state.moves,shape,row:selected[0],col:selected[1]})){
      pending=true;render();clearTimeout(pendingTimer);
      pendingTimer=setTimeout(()=>{pending=false;ranked.send({type:'sync'});render();},8000);
    }
    return;
  }
  const next=game.play(state,shape,...selected);if(!next)return;
  history.push({state,shape:shape.map(p=>p.slice())});state=next;shape=[[0,0]];resetSelection();render();scheduleCPU();
});
$('undo').addEventListener('click',()=>{
  if(mode!=='cpu'||state.over||!history.length)return;
  stopCPU();const previous=history.pop();state=previous.state;shape=previous.shape;resetSelection();render();
});
$('rules-open').addEventListener('click',()=>$('rules-dialog').showModal());
$('rules-close').addEventListener('click',()=>$('rules-dialog').close());
$('rules-dialog').addEventListener('click',event=>{if(event.target===$('rules-dialog')){
  const rect=$('rules-dialog').getBoundingClientRect();
  if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)$('rules-dialog').close();
}});
function requireNickname(){
  const result=NicknamePolicy.validate($('nickname').value),valid=result.ok;
  $('nickname-error').textContent=result.message;
  $('nickname-error').hidden=valid;
  $('nickname').setAttribute('aria-invalid',String(!valid));
  if(!valid)$('nickname').focus();
  return valid;
}
$('nickname').addEventListener('input',()=>{if($('nickname').value.trim())requireNickname();});
function chooseMode(next){
  if(screen!=='top')return;
  if(next==='online'&&!requireNickname())return;
  mode=next;screen=next==='cpu'?'levels':'matching';newGame();
  if(next==='cpu')$('level-title').focus();
  else{$('matching-title').focus();startMatching();}
}
$('mode-cpu').addEventListener('click',()=>chooseMode('cpu'));
$('mode-online').addEventListener('click',()=>chooseMode('online'));
function returnToTop(){
  if(onlineActive())return;
  if(screen==='game'&&mode==='cpu'&&state.moves&&!state.over&&!confirm('CPU対戦を終了してTOPへ戻りますか？'))return;
  navigation++;stopCPU();ranked.close();online=null;connecting=false;pending=false;clearTimeout(pendingTimer);
  mode=null;screen='top';$('leaderboard').hidden=true;$('online-status').textContent='';newGame();$('mode-cpu').focus();
  refreshTopProfile();
}
$('back-top').addEventListener('click',returnToTop);
$('result-top').addEventListener('click',()=>{$('result-dialog').close();returnToTop();});
$('result-close').addEventListener('click',()=>$('result-dialog').close());
$('result-dialog').addEventListener('close',()=>{if(screen==='game')$('back-top').focus();});
function showRankedResult(){
  const match=online?.match;
  if(mode!=='online'||screen!=='game'||!match?.state.over||shownResults.has(match.id))return;
  shownResults.add(match.id);
  const outcome=match.winner===0?'draw':match.winner===match.color?'win':'loss';
  const counts=game.score(match.state),delta=match.delta,rating=online.profile.rating;
  const dialog=$('result-dialog');
  dialog.className='match-result result-'+outcome;
  $('result-label').textContent={win:'VICTORY',loss:'DEFEAT',draw:'DRAW'}[outcome];
  $('result-title').textContent={win:'あなたの勝ち',loss:'あなたの負け',draw:'引き分け'}[outcome];
  $('result-reason').textContent=match.reason==='resign'?'投了により決着':match.reason==='timeout'?'時間切れにより決着':'対局終了';
  $('result-black').textContent=String(counts[1]);$('result-white').textContent=String(counts[2]);
  $('result-rating').textContent=delta==null?String(rating):`${rating-delta} → ${rating}`;
  $('result-delta').textContent=delta==null?'':`${delta>=0?'+':''}${delta}`;
  if($('rules-dialog').open)$('rules-dialog').close();
  if(dialog.open)dialog.close();
  dialog.showModal();
}
async function refreshTopProfile(){
  const request=++profileRequest;
  if(!configured){$('top-rating').textContent='レート —';return;}
  $('top-rating').textContent='レート 確認中…';
  try{
    const profile=await ranked.getProfile();
    if(request===profileRequest)$('top-rating').textContent=`レート ${profile?.rating??1500}`;
  }catch{if(request===profileRequest)$('top-rating').textContent='レート 取得できません';}
}
function showRankings(list,players){
  list.replaceChildren();
  for(const player of players){const li=document.createElement('li'),rating=document.createElement('span');li.textContent=player.nickname;rating.textContent=String(player.rating);li.append(rating);list.append(li);}
  if(!players.length){const li=document.createElement('li');li.textContent='まだ対戦記録がありません。';list.append(li);}
}
async function loadTopRankings(){
  const attempt=++navigation;
  $('top-leaderboard').replaceChildren();$('ranking-status').textContent='読み込み中…';$('ranking-retry').hidden=true;
  try{
    const data=await ranked.getRankings();
    if(attempt!==navigation||screen!=='ranking')return;
    showRankings($('top-leaderboard'),data.players);$('ranking-status').textContent='';
  }catch{
    if(attempt!==navigation||screen!=='ranking')return;
    $('ranking-status').textContent='ランキングを読み込めませんでした。';$('ranking-retry').hidden=false;
  }
}
$('top-ranking').addEventListener('click',()=>{
  if(screen!=='top'||!configured)return;
  mode=null;screen='ranking';render();$('ranking-title').focus();loadTopRankings();
});
$('ranking-retry').addEventListener('click',()=>{if(screen==='ranking')loadTopRankings();});
async function startMatching(){
  if(mode!=='online'||connecting)return;
  if(!requireNickname()){mode=null;screen='top';render();$('nickname').focus();return;}
  if(!configured){$('online-status').textContent='オンライン対戦は準備中です。';render();return;}
  const attempt=++navigation;
  if(!onlineActive())screen='matching';
  $('online-status').textContent='接続中…';
  if(!ranked.ready){
    connecting=true;render();
    try{await ranked.connect($('nickname').value,{queue:true});}
    catch(error){if(attempt===navigation){connecting=false;$('online-status').textContent=error.message;render();}}
  }else{
    ranked.queue();$('online-status').textContent='対戦相手を探しています…';render();
  }
}
$('match').addEventListener('click',()=>{
  if(!configured||connecting)return;
  if(onlineActive()&&ranked.ready)return;
  startMatching();
});
$('resign').addEventListener('click',()=>{
  if(screen!=='game'||!onlineActive()||!ranked.ready||connecting||pending)return;
  if(confirm('投了しますか？ レートが更新されます。'))ranked.send({type:'resign',matchId:online.match.id});
});
$('leaderboard-toggle').addEventListener('click',()=>{
  if(screen==='game')return;
  $('leaderboard').hidden=!$('leaderboard').hidden;
  if(!$('leaderboard').hidden)ranked.send({type:'ranking'});
});
function onOnline(event){
  if(mode!=='online')return;
  if(event.type==='connection'){
    connecting=!!event.connecting;
    $('online-status').textContent=event.message;
    if(!event.ready){pending=false;clearTimeout(pendingTimer);}
  }else if(event.type==='snapshot'){
    profileRequest++;$('top-rating').textContent=`レート ${event.profile.rating}`;
    online=event;serverOffset=event.serverTime-Date.now();pending=false;clearTimeout(pendingTimer);
    connecting=false;
    if(event.match&&!event.queued&&(!event.match.state.over||screen==='game'))screen='game';
    else screen='matching';
    state=event.match?.state||game.initialState();shape=[[0,0]];resetSelection();
    $('online-status').textContent=event.queued?'対戦相手を探しています…':event.match?.reason==='timeout'?'時間切れ':event.match?.reason==='resign'?'投了により終了':'';
  }else if(event.type==='error'){
    pending=false;clearTimeout(pendingTimer);$('online-status').textContent=event.message;
  }else if(event.type==='ranking'){
    showRankings($('leaderboard'),event.players);
  }
  render();
  showRankedResult();
}
try{$('nickname').value=localStorage.getItem('1234-nickname')||'';}catch{}
setInterval(()=>{if(onlineActive())renderTurn();},500);
window.addEventListener('beforeunload',event=>{if(onlineActive()){event.preventDefault();event.returnValue='';}});
render();
refreshTopProfile();
$('rules-dialog').showModal();
