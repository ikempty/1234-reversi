const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/engine.js':'engine.js','/app.js':'app.js','/ai.js':'ai.js','/ai-worker.js':'ai-worker.js','/online.js':'online.js','/online-config.js':'online-config.js'};
files['/assets/brand-logo.png']='assets/brand-logo.png';
files['/nickname-policy.js']='nickname-policy.js';
files['/assets/jardin-banner.webp']='assets/jardin-banner.webp';
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.webp':'image/webp','.png':'image/png'};
const server=http.createServer((req,res)=>{
  const file=files[new URL(req.url,'http://localhost').pathname];
  if(!file){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(__dirname,file),(error,data)=>{
    if(error){res.writeHead(500);res.end('Read error');return;}
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(data);
  });
});
server.listen(4173,'127.0.0.1',()=>console.log('1234リバーシ: http://127.0.0.1:4173'));
