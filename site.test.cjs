const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('published TOP loads current scripts despite cached older files and shows rating and rankings',async()=>{
  const html=fs.readFileSync('docs/index.html','utf8');
  const nodes=new Map(),requests=[];
  function element(){return {children:[],events:{},textContent:'',value:'',hidden:false,disabled:false,classList:{toggle(){}},focus(){},showModal(){this.open=true;},close(){this.open=false;},append(child){this.children.push(child);},replaceChildren(){this.children=[];},setAttribute(){},addEventListener(name,callback){this.events[name]=callback;}};}
  for(const [,id]of html.matchAll(/\bid="([^"]+)"/g))nodes.set(id,element());
  const context=vm.createContext({URL,AbortSignal,document:{getElementById:id=>nodes.get(id)||null,createElement:element},location:{protocol:'https:'},localStorage:{getItem:key=>key==='1234-player-token'?'a'.repeat(64):'Player'},addEventListener(){},setInterval:()=>0,clearInterval(){},setTimeout,clearTimeout,
    fetch:async(url)=>{
      requests.push(url);
      if(url.endsWith('/profile'))return {ok:true,json:async()=>({rating:1678})};
      if(url.endsWith('/ranking'))return {ok:true,json:async()=>({players:[{nickname:'Ranked Player',rating:1800}]})};
      throw new Error('Unexpected matchmaking request: '+url);
    }
  });
  context.window=context;
  const oldCache=new Map([['app.js','/* Previous app did not wire TOP rating/ranking. */'],['online-config.js',"window.REVERSI_ONLINE_URL='';"]]);
  for(const [,src]of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)){
    const code=oldCache.get(src)??fs.readFileSync('docs/'+src.split('?')[0],'utf8');
    vm.runInContext(code,context,{filename:src});
  }
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('top-rating').textContent,'レート 1678');
  assert.equal(nodes.get('top-ranking').disabled,false);
  nodes.get('top-ranking').events.click();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(nodes.get('ranking-screen').hidden,false);
  assert.equal(nodes.get('top-leaderboard').children[0].children[0].textContent,'1800');
  assert.equal(requests.length,2);
});
