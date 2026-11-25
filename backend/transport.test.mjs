import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import game from '../engine.js';

test('two real WebSocket clients match, play, reconnect and settle Elo once', {timeout:30000}, async()=>{
  const mf=new Miniflare(convertV4MiniflareOptions({workers:[{
    name:'ranked-test',modules:true,scriptPath:fileURLToPath(new URL('./.worker-build/worker.js',import.meta.url)),
    compatibilityDate:'2026-11-24',
    bindings:{RANKED_ENABLED:'true',ALLOWED_ORIGINS:'http://127.0.0.1:4173'},
    durableObjects:{RANKED:{className:'RankedLobby',useSQLite:true}}
  }]}));
  const sockets=[];
  const headers={Origin:'http://127.0.0.1:4173'};
  async function connect(token,nickname){
    if(nickname){
      const response=await mf.dispatchFetch('http://localhost/session',{method:'POST',headers:{...headers,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({nickname})});
      assert.equal(response.status,200,await response.text());
    }
    const response=await mf.dispatchFetch('http://localhost/connect',{headers:{...headers,Upgrade:'websocket','Sec-WebSocket-Protocol':'auth.'+token}});
    assert.equal(response.status,101);const socket=response.webSocket;sockets.push(socket);
    const messages=[],waiting=[];
    socket.addEventListener('message',event=>{
      if(event.data==='pong')return;
      const message=JSON.parse(event.data);messages.push(message);
      for(const item of [...waiting])if(item.predicate(message)){waiting.splice(waiting.indexOf(item),1);clearTimeout(item.timer);item.resolve(message);}
    });
    function next(predicate){
      const found=messages.find(predicate);if(found)return Promise.resolve(found);
      return new Promise((resolve,reject)=>{
        const item={predicate,resolve,timer:setTimeout(()=>reject(new Error('Expected WebSocket event not received')),8000)};waiting.push(item);
      });
    }
    socket.accept();await next(m=>m.type==='snapshot');
    return {socket,next,send:data=>socket.send(JSON.stringify(data))};
  }
  try{
    const rejected=await mf.dispatchFetch('http://localhost/session',{method:'POST',headers:{...headers,Authorization:'Bearer '+'c'.repeat(64),'Content-Type':'application/json'},body:JSON.stringify({nickname:'ＦＵＣＫ'})});
    assert.equal(rejected.status,400);
    assert.match((await rejected.json()).error,/ニックネーム/);
    const missing=await mf.dispatchFetch('http://localhost/profile',{headers:{...headers,Authorization:'Bearer '+'c'.repeat(64)}});
    assert.equal(missing.status,404);
    const denied=await mf.dispatchFetch('http://localhost/session',{method:'POST',headers:{Origin:'https://untrusted.example'},body:'{}'});assert.equal(denied.status,403);
    const empty=await mf.dispatchFetch('http://localhost/ranking',{headers});
    assert.equal(empty.status,200);assert.deepEqual(await empty.json(),{players:[]});
    const unauthenticated=await mf.dispatchFetch('http://localhost/profile',{headers});assert.equal(unauthenticated.status,401);
    const a=await connect('a'.repeat(64),'Network A'),b=await connect('b'.repeat(64),'Network B');
    a.send({type:'queue'});await a.next(m=>m.type==='snapshot'&&m.queued);
    b.send({type:'queue'});
    const sa=await a.next(m=>m.type==='snapshot'&&m.match),sb=await b.next(m=>m.type==='snapshot'&&m.match);
    assert.equal(sa.match.id,sb.match.id);
    const black=sa.match.color===1?a:b;
    const move=game.legalMoves(sa.match.state,[[0,0]])[0];
    black.send({type:'move',matchId:sa.match.id,version:0,shape:[[0,0]],row:move.r,col:move.c});
    await a.next(m=>m.match?.state.moves===1);await b.next(m=>m.match?.state.moves===1);
    a.socket.close(1000);
    const reconnected=await connect('a'.repeat(64));
    const restored=await reconnected.next(m=>m.match?.state.moves===1);assert.equal(restored.match.id,sa.match.id);
    reconnected.send({type:'resign',matchId:sa.match.id});
    const result=await reconnected.next(m=>m.match?.state.over);
    assert.equal(result.profile.rating,1488);assert.equal(result.match.reason,'resign');
    const winner=await b.next(m=>m.match?.state.over);assert.equal(winner.profile.rating,1512);
    reconnected.send({type:'resign',matchId:sa.match.id});
    reconnected.send({type:'ranking'});
    const rankings=await reconnected.next(m=>m.type==='ranking');assert.equal(rankings.players[0].rating,1512);
    const profile=await mf.dispatchFetch('http://localhost/profile',{headers:{...headers,Authorization:'Bearer '+'a'.repeat(64)}});
    assert.equal(profile.status,200);assert.deepEqual(await profile.json(),{rating:1488,wins:0,losses:1,draws:0});
    const publicRanking=await mf.dispatchFetch('http://localhost/ranking',{headers});
    assert.deepEqual((await publicRanking.json()).players,rankings.players);
    const readOnly=await mf.dispatchFetch('http://localhost/profile',{headers:{...headers,Authorization:'Bearer '+'c'.repeat(64)}});
    assert.equal(readOnly.status,404);
  }finally{for(const socket of sockets)try{socket.close(1000);}catch{}await mf.dispose();}
});
