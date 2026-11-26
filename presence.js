(function(root){
  'use strict';
  const label=document.getElementById('online-count');
  if(!label||!root.REVERSI_ONLINE_URL)return;
  let visitor;
  try{visitor=localStorage.getItem('1234-presence-id');}catch{}
  if(!/^[a-f0-9]{32}$/.test(visitor||'')){
    visitor=Array.from(crypto.getRandomValues(new Uint8Array(16)),n=>n.toString(16).padStart(2,'0')).join('');
    try{localStorage.setItem('1234-presence-id',visitor);}catch{}
  }
  let socket,timer,retryTimer,attempt=0,lastResponse=0,leaving=false;
  const unknown=()=>{label.textContent='オンライン —';};
  function stop(){
    clearInterval(timer);clearTimeout(retryTimer);
    if(socket){const previous=socket;socket=null;previous.close();}
  }
  function connect(){
    if(leaving||document.visibilityState==='hidden'||socket)return;
    const url=new URL(root.REVERSI_ONLINE_URL+'/presence');url.protocol=url.protocol==='https:'?'wss:':'ws:';
    let current;try{current=new WebSocket(url,'presence.'+visitor);}catch{retry();return;}
    socket=current;lastResponse=Date.now();
    current.onmessage=({data})=>{
      if(socket!==current)return;
      let value;try{value=JSON.parse(data);}catch{return;}
      if(value.type!=='presence'||!Number.isSafeInteger(value.count)||value.count<0)return;
      attempt=0;lastResponse=Date.now();label.textContent=`オンライン ${value.count}人`;
    };
    current.onclose=()=>{if(socket!==current)return;socket=null;clearInterval(timer);unknown();retry();};
    current.onerror=()=>{};
    timer=setInterval(()=>{
      if(Date.now()-lastResponse>45000){stop();unknown();retry();return;}
      if(current.readyState===WebSocket.OPEN)current.send('heartbeat');
    },25000);
  }
  function retry(){
    clearTimeout(retryTimer);
    if(!leaving&&document.visibilityState!=='hidden')retryTimer=setTimeout(connect,Math.min(30000,1000*2**Math.min(attempt++,5))+Math.random()*1000);
  }
  document.addEventListener('visibilitychange',()=>{
    stop();unknown();if(document.visibilityState!=='hidden'){leaving=false;connect();}
  });
  root.addEventListener('pagehide',()=>{leaving=true;stop();});
  root.addEventListener('pageshow',()=>{leaving=false;connect();});
  root.addEventListener('online',()=>{stop();connect();});
  connect();
})(window);
