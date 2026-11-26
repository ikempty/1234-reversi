import {DurableObject} from 'cloudflare:workers';

const ACTIVE_MS=60000;
export class PresenceLobby extends DurableObject {
  constructor(ctx,env){super(ctx,env);this.ctx=ctx;}
  count(now=Date.now()){
    const visitors=new Set();
    for(const socket of this.ctx.getWebSockets()){
      const visitor=socket.deserializeAttachment();
      if(socket.readyState===1&&visitor&&now-visitor.seen<ACTIVE_MS)visitors.add(visitor.id);
    }
    return visitors.size;
  }
  send(socket,count){try{socket.send(JSON.stringify({type:'presence',count}));}catch{}}
  broadcast(){const count=this.count();for(const socket of this.ctx.getWebSockets())this.send(socket,count);}
  async fetch(request){
    const protocol=request.headers.get('Sec-WebSocket-Protocol')||'';
    if(request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return new Response('WebSocket required',{status:426});
    if(!/^presence\.[a-f0-9]{32}$/.test(protocol))return new Response('Invalid visitor',{status:400});
    const id=protocol.slice(9);
    if(this.ctx.getWebSockets(id).length>=8)return new Response('Too many tabs',{status:429});
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server,[id]);
    server.serializeAttachment({id,seen:Date.now()});
    this.broadcast();
    return new Response(null,{status:101,webSocket:client,headers:{'Sec-WebSocket-Protocol':protocol}});
  }
  async webSocketMessage(socket,message){
    if(message!=='heartbeat'){socket.close(1008,'Invalid message');return;}
    const visitor=socket.deserializeAttachment();if(!visitor)return socket.close(1008,'Invalid visitor');
    const now=Date.now();
    if(now-visitor.seen<2000)return;
    visitor.seen=now;socket.serializeAttachment(visitor);
    // Each visitor receives a fresh count on its heartbeat, without database writes.
    this.send(socket,this.count(now));
  }
  async webSocketClose(socket){try{socket.close(1000);}catch{}this.broadcast();}
  async webSocketError(socket){await this.webSocketClose(socket);}
}
