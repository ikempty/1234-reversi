importScripts('engine.js','ai.js');
self.onmessage=({data})=>{
  try { self.postMessage({id:data.id,move:ReversiAI.chooseMove(data.state,data.level)}); }
  catch(error){self.postMessage({id:data.id,error:'CPUの処理に失敗しました。'});}
};
