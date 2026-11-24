(function(root){
  'use strict';
  class RankedClient {
    constructor(url,onEvent){this.url=url.replace(/\/$/,'');this.onEvent=onEvent;this.socket=null;this.ready=false;this.closed=true;this.retry=0;this.wantsQueue=false;this.attempt=0;}
    async read(path,headers={}){
      if(!this.url)throw new Error('オンライン対戦は準備中です。');
      const response=await fetch(this.url+path,{headers,cache:'no-store',signal:AbortSignal.timeout(12000)});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error||'読み込めませんでした。');
      return data;
    }
    async getProfile(){
      const token=localStorage.getItem('1234-player-token');
      if(!/^[a-f0-9]{64}$/.test(token||''))return null;
      return this.read('/profile',{Authorization:'Bearer '+token});
    }
    getRankings(){return this.read('/ranking');}
    async connect(nickname,{queue=false}={}){
      if(!this.url)throw new Error('オンライン対戦は準備中です。');
      if(!nickname.trim()||[...nickname.trim()].length>16)throw new Error('ニックネームは1〜16文字で入力してください。');
      const endpoint=new URL(this.url);
      if(endpoint.protocol!=='https:' && !['localhost','127.0.0.1'].includes(endpoint.hostname))throw new Error('接続先の設定を確認してください。');
      let token;
      try {
        token=localStorage.getItem('1234-player-token');
        if(!/^[a-f0-9]{64}$/.test(token||'')){
          token=Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
          localStorage.setItem('1234-player-token',token);
        }
        localStorage.setItem('1234-nickname',nickname.trim());
      }catch(error){throw new Error('成績を保持するため、ブラウザの保存機能を有効にしてください。');}
      this.close();this.closed=false;this.token=token;this.retry=0;this.wantsQueue=queue;
      const attempt=this.attempt;
      this.onEvent({type:'connection',ready:false,connecting:true,message:'接続中…'});
      try {
        const response=await fetch(this.url+'/session',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({nickname:nickname.trim()}),signal:AbortSignal.timeout(12000)});
        const data=await response.json();
        if(this.closed||attempt!==this.attempt)return;
        if(!response.ok)throw new Error(data.error||'サーバーに接続できません。');
        this.openSocket();
      }catch(error){if(this.closed||attempt!==this.attempt)return;this.closed=true;this.onEvent({type:'connection',ready:false,message:'接続できません。しばらくしてから再試行してください。'});throw error;}
    }
    openSocket(){
      if(this.closed)return;
      const url=new URL(this.url+'/connect');url.protocol=url.protocol==='https:'?'wss:':'ws:';
      const socket=new WebSocket(url,'auth.'+this.token);this.socket=socket;
      const timeout=setTimeout(()=>{if(socket.readyState===WebSocket.CONNECTING)socket.close();},12000);
      socket.onopen=()=>{
        clearTimeout(timeout);if(this.socket!==socket||this.closed)return;
        this.ready=true;this.retry=0;
        this.onEvent({type:'connection',ready:true,message:''});
        this.ping=setInterval(()=>{if(socket.readyState===WebSocket.OPEN)socket.send('ping');},30000);
      };
      socket.onmessage=({data})=>{
        if(this.socket!==socket||this.closed)return;
        if(data==='pong')return;
        let message;try{message=JSON.parse(data);}catch{return;}
        this.onEvent(message);
        if(message.type==='snapshot'){
          if(message.match && !message.match.state.over)this.wantsQueue=false;
          else if(this.wantsQueue&&!message.queued)this.send({type:'queue'});
        }
      };
      socket.onclose=()=>{
        clearTimeout(timeout);
        if(this.socket!==socket)return;
        clearInterval(this.ping);
        this.ready=false;
        if(!this.closed && this.retry<6){
          this.onEvent({type:'connection',ready:false,connecting:true,message:'再接続中…'});
          this.reconnect=setTimeout(()=>this.openSocket(),Math.min(15000,1000*2**this.retry++));
        }else if(!this.closed){this.onEvent({type:'connection',ready:false,message:'接続が切れました。「再接続」を押してください。'});}
      };
      socket.onerror=()=>{};
    }
    send(message){if(!this.ready||this.socket?.readyState!==WebSocket.OPEN)return false;this.socket.send(JSON.stringify(message));return true;}
    queue(){this.wantsQueue=true;return this.send({type:'queue'});}
    cancel(){this.wantsQueue=false;return this.send({type:'cancel'});}
    close(){this.attempt++;this.closed=true;this.ready=false;this.wantsQueue=false;clearTimeout(this.reconnect);clearInterval(this.ping);if(this.socket){this.socket.onclose=null;this.socket.close();}this.socket=null;}
  }
  root.RankedClient=RankedClient;
})(window);
