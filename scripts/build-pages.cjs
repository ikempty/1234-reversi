const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'docs');
fs.mkdirSync(destination,{recursive:true});
for(const file of ['index.html','style.css','engine.js','app.js','ai.js','ai-worker.js','online.js','online-config.js']){
  fs.copyFileSync(path.join(root,file),path.join(destination,file));
}
fs.writeFileSync(path.join(destination,'.nojekyll'),'');
console.log('GitHub Pages files prepared in docs/');
