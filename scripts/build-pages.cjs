const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'..');
const destination=path.join(root,'docs');
fs.mkdirSync(destination,{recursive:true});
fs.mkdirSync(path.join(destination,'assets'),{recursive:true});
for(const asset of ['jardin-banner.webp','brand-logo.png'])fs.copyFileSync(path.join(root,'assets',asset),path.join(destination,'assets',asset));
for(const file of ['CNAME','index.html','style.css','engine.js','app.js','ai.js','ai-worker.js','online.js','online-config.js','nickname-policy.js']){
  fs.copyFileSync(path.join(root,file),path.join(destination,file));
}
fs.writeFileSync(path.join(destination,'.nojekyll'),'');
// Updated HTML must never reuse an older script from the browser's cache.
const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/\b(src|href)="([^"?]+\.(?:js|css|webp|png))"/g,(match,attribute,file)=>{
  const version=createHash('sha256').update(fs.readFileSync(path.join(destination,file))).digest('hex').slice(0,12);
  return `${attribute}="${file}?v=${version}"`;
});
fs.writeFileSync(path.join(destination,'index.html'),html);
console.log('GitHub Pages files prepared in docs/');
