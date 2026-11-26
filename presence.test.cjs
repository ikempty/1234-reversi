const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('presence deduplicates visitors and excludes expired or closed connections',()=>{
  const source=fs.readFileSync('backend/presence.mjs','utf8').replace(/^import .*;\r?\n/,'').replace('export class PresenceLobby','class PresenceLobby');
  const context=vm.createContext({DurableObject:class{},Date});
  vm.runInContext(source+'\nglobalThis.PresenceLobby=PresenceLobby;',context);
  const sockets=[['a',50000,1],['a',55000,1],['b',50000,1],['expired',0,1],['closed',55000,3]].map(([id,seen,readyState])=>({readyState,deserializeAttachment:()=>({id,seen})}));
  const lobby=new context.PresenceLobby({getWebSockets:()=>sockets},{});
  assert.equal(lobby.count(60000),2);
  assert.equal(lobby.count(110000),1);
  assert.equal(lobby.count(115000),0);
});

test('presence client counts during CPU play, suspends hidden pages and recovers from failure',()=>{
  let now=0;const intervals=new Map(),timeouts=new Map(),events={},pageEvents={},sockets=[];let id=0;
  const label={textContent:''};
  class Socket{
    static OPEN=1;
    constructor(){this.readyState=1;this.sent=[];sockets.push(this);}
    send(message){this.sent.push(message);}
    close(){this.readyState=3;this.onclose?.();}
    receive(value){this.onmessage({data:JSON.stringify(value)});}
  }
  const context=vm.createContext({URL,Date:{now:()=>now},WebSocket:Socket,document:{visibilityState:'visible',getElementById:()=>label,addEventListener:(name,fn)=>events[name]=fn},localStorage:{getItem:()=> 'a'.repeat(32)},setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:id=>intervals.delete(id),setTimeout:fn=>{timeouts.set(++id,fn);return id;},clearTimeout:id=>timeouts.delete(id),REVERSI_ONLINE_URL:'https://example.test',addEventListener:(name,fn)=>pageEvents[name]=fn});context.window=context;
  vm.runInContext(fs.readFileSync('presence.js','utf8'),context);
  assert.equal(sockets.length,1);sockets[0].receive({type:'presence',count:3});assert.equal(label.textContent,'オンライン 3人');
  sockets[0].receive({type:'presence',count:-1});assert.equal(label.textContent,'オンライン 3人');
  now=25000;for(const fn of intervals.values())fn();assert.deepEqual(sockets[0].sent,['heartbeat']);
  context.document.visibilityState='hidden';events.visibilitychange();assert.equal(sockets[0].readyState,3);assert.equal(intervals.size,0);assert.equal(timeouts.size,0);
  context.document.visibilityState='visible';events.visibilitychange();assert.equal(sockets.length,2);
  sockets[1].receive({type:'presence',count:2});now=75000;for(const fn of [...intervals.values()])fn();assert.equal(label.textContent,'オンライン —');assert.equal(timeouts.size,1);
  pageEvents.pagehide();assert.equal(timeouts.size,0);
  pageEvents.pageshow();assert.equal(sockets.length,3);
});
