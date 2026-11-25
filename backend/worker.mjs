import {DurableObject} from 'cloudflare:workers';
import {RankedStore,ClientError} from './store.mjs';

// User-requested one-time reset. The database marker prevents repeat resets on deploy/restart.
const RANKING_RESET_ID='2026-11-25-ranking-reset-1';
async function readSessionBody(request){
  const reader=request.body?.getReader();if(!reader)throw new ClientError('入力内容が不正です。');
  const chunks=[];let size=0;
  try{
    for(;;){
      const {done,value}=await reader.read();if(done)break;
      size+=value.byteLength;
      if(size>2048){await reader.cancel();throw new ClientError('リクエストが大きすぎます。',413);}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new ClientError('入力内容が不正です。');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new ClientError('入力内容が不正です。');
  return data;
}

const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
async function digest(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}

export default {
  async fetch(request,env){
    const origin=request.headers.get('Origin');
    const allowed=(env.ALLOWED_ORIGINS||'').split(',').map(s=>s.trim()).filter(Boolean);
    if(!origin||!allowed.includes(origin))return json({error:'許可されていない接続元です。'},403);
    const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST,GET,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Vary':'Origin'};
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(env.RANKED_ENABLED!=='true')return json({error:'オンライン対戦は準備中です。'},503,headers);
    const url=new URL(request.url);
    if(!['/session','/connect','/profile','/ranking'].includes(url.pathname))return json({error:'Not found'},404,headers);
    if(Number(request.headers.get('Content-Length'))>2048)return json({error:'リクエストが大きすぎます。'},413,headers);
    try{
      const response=await env.RANKED.getByName('ranked-v1').fetch(request);
      if(response.status===101)return response;
      const result=new Response(response.body,{status:response.status,headers:response.headers});
      for(const [key,value]of Object.entries(headers))result.headers.set(key,value);
      return result;
    }catch{return json({error:'現在接続できません。時間を置いて再試行してください。'},503,headers);}
  }
};

export class RankedLobby extends DurableObject {
  constructor(ctx,env){
    super(ctx,env);this.ctx=ctx;
    this.store=new RankedStore(ctx.storage.sql,callback=>ctx.storage.transactionSync(callback));
    this.store.resetRankingsOnce(RANKING_RESET_ID);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping','pong'));
  }
  connected(id){return this.ctx.getWebSockets(id).some(socket=>socket.readyState===1);}
  send(socket,message){try{socket.send(JSON.stringify(message));}catch{}}
  broadcast(ids){for(const id of new Set(ids)){const snapshot=this.store.snapshot(id);for(const socket of this.ctx.getWebSockets(id))this.send(socket,snapshot);}}
  async schedule(){const deadline=this.store.nextDeadline();if(deadline)await this.ctx.storage.setAlarm(Math.max(Date.now()+100,deadline));else await this.ctx.storage.deleteAlarm();}
  async fetch(request){
    const url=new URL(request.url);
    if(url.pathname==='/ranking'&&request.method==='GET')return json({players:this.store.rankings()});
    const protocol=request.headers.get('Sec-WebSocket-Protocol')||'';
    const token=url.pathname==='/connect'?protocol.replace(/^auth\./,''):(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
    if(!/^[a-f0-9]{64}$/.test(token))return json({error:'認証情報が不正です。'},401);
    const hash=await digest(token);
    try{
      if(url.pathname==='/profile'&&request.method==='GET'){
        const player=this.store.authenticate(hash);
        if(!player)return json({error:'プレイヤー情報が見つかりません。'},404);
        const {rating,wins,losses,draws}=player;
        return json({rating,wins,losses,draws});
      }
      if(url.pathname==='/session'&&request.method==='POST'){
        const data=await readSessionBody(request);
        const ipHash=await digest((request.headers.get('CF-Connecting-IP')||'local')+Math.floor(Date.now()/86400000));
        const player=this.store.register(hash,data.nickname,ipHash);
        return json({id:player.id});
      }
      if(url.pathname!=='/connect'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return json({error:'Not found'},404);
      const player=this.store.authenticate(hash);if(!player)return json({error:'認証が必要です。'},401);
      if(this.ctx.getWebSockets(player.id).length>=2)return json({error:'同時接続は2画面までです。'},429);
      const pair=new WebSocketPair(),[client,server]=Object.values(pair);
      this.ctx.acceptWebSocket(server,[player.id]);server.serializeAttachment({id:player.id,window:Date.now(),count:0});
      const expired=this.store.expire();this.broadcast(expired);
      this.send(server,this.store.snapshot(player.id));await this.schedule();
      return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':protocol}});
    }catch(error){return json({error:error instanceof ClientError?error.message:'接続に失敗しました。'},error instanceof ClientError?error.status:500);}
  }
  async webSocketMessage(socket,message){
    const auth=socket.deserializeAttachment();if(!auth)return socket.close(1008,'Unauthorized');
    if(typeof message!=='string'||message.length>2048)return socket.close(1009,'Message too large');
    const now=Date.now();if(now-auth.window>10000){auth.window=now;auth.count=0;}
    auth.count++;socket.serializeAttachment(auth);
    if(auth.count>40){socket.close(1008,'Rate limit exceeded');return;}
    try{
      let data;try{data=JSON.parse(message);}catch{throw new ClientError('入力内容が不正です。');}
      if(!data||typeof data!=='object'||Array.isArray(data))throw new ClientError('入力内容が不正です。');
      this.broadcast(this.store.expire());
      let ids=[auth.id];
      if(data.type==='queue')ids=this.store.join(auth.id,id=>this.connected(id));
      else if(data.type==='cancel')ids=this.store.cancel(auth.id);
      else if(data.type==='move')ids=this.store.move(auth.id,data);
      else if(data.type==='resign')ids=this.store.resign(auth.id,data.matchId);
      else if(data.type==='ranking'){this.send(socket,{type:'ranking',players:this.store.rankings()});return;}
      else if(data.type!=='sync')throw new ClientError('不明な操作です。');
      this.broadcast(ids);
    }catch(error){this.send(socket,{type:'error',message:error instanceof ClientError?error.message:'操作に失敗しました。'});}
    await this.schedule();
  }
  async webSocketClose(socket,code){
    const auth=socket.deserializeAttachment();try{socket.close(code===1005?1000:code);}catch{}
    if(auth&&!this.connected(auth.id))this.store.cancel(auth.id);
    await this.schedule();
  }
  async webSocketError(socket){await this.webSocketClose(socket,1011);}
  async alarm(){this.broadcast(this.store.expire());await this.schedule();}
}
