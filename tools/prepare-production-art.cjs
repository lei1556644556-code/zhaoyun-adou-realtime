// Deterministic export only: crop declared atlas slots, retain alpha, normalize,
// compress and report. No painting, background removal or synthesized pixels.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.ADOU_SHARP || require.resolve('sharp', {
  paths: [process.cwd(), path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node')],
}));
const root = path.resolve(__dirname, '..');
const input = path.join(root, 'art_sources/production');
const output = path.join(root, 'apps/client/public/assets/v2');
const jobs = [
  ['zhao-yun-web-v1.png', 1, 1, ['hero-zhao-yun']],
  // The returned atlas gutter is at y=660/1254, not the mathematical midpoint.
  // Slice the observed empty gutter; never crop through a foot or weapon.
  ['heroes-main-web-v2.png', 2, 2, ['hero-zhang-fei','hero-guan-yu','hero-ma-chao','hero-huang-zhong'], [0, 660 / 1254, 1]],
  ['heroes-secondary-web-v2.png', 2, 2, ['hero-guan-ping','hero-guan-xing','hero-zhang-bao','hero-zhang-yi']],
  ['heroes-support-web-v1.png', 2, 2, ['hero-huang-gai','hero-liu-bei','hero-huang-zu', 'ui-adou']],
  ['troops-web-v1.png', 2, 2, ['troop-blade','troop-bow','troop-spear','troop-cavalry']],
  ['enemies-web-v1.png', 2, 2, ['enemy-rebel','enemy-brute','enemy-scout','enemy-captain']],
  ['structures-web-v1.png', 2, 2, ['ui-fort','ui-camp','enemy-boss-horned','enemy-boss-banner']],
  ['terrain-web-v1.png', 2, 2, ['tile-grass','tile-road','tile-deployment','tile-paper']],
  ['buffs-web-v1.png', 3, 2, ['buff-invulnerable','buff-haste','buff-giant','buff-rally','buff-smoke','buff-decoy']],
  ['effects-web-v2.png', 2, 2, ['fx-art-thrust','fx-art-crescent','fx-art-shockwave','fx-art-impact']],
];
(async()=>{
  fs.mkdirSync(output,{recursive:true});
  const overrides={};
  const report=[];
  const pending=[];
  for(const [file, columns, rows, keys, rowSplits] of jobs){
    if(!fs.existsSync(path.join(input,file)))throw new Error(`Missing production source: ${file}`);
    const sourceBytes=fs.readFileSync(path.join(input,file));
    const sourceHash=require('node:crypto').createHash('sha256').update(sourceBytes).digest('hex');
    const source=sharp(sourceBytes);
    const meta=await source.metadata();
    for(let i=0;i<keys.length;i++){
      const key=keys[i], isTile=key.startsWith('tile-');
      const size=key.startsWith('buff-') || key.startsWith('fx-') ? 192 : 256;
      const row=Math.floor(i/columns);
      const left=Math.round((i%columns)*meta.width/columns), top=Math.round((rowSplits?.[row] ?? row/rows)*meta.height);
      const width=Math.round(((i%columns)+1)*meta.width/columns)-left, height=Math.round((rowSplits?.[row+1] ?? (row+1)/rows)*meta.height)-top;
      let crop=sharp(await source.clone().extract({left,top,width,height}).png().toBuffer());
      const stats=await crop.clone().ensureAlpha().stats();
      if(!isTile && stats.channels[3].min===255)throw new Error(`${file}/${key}: no true transparency; return to generation, do not auto remove the background`);
      if(!isTile){
        const {data,info}=await crop.clone().ensureAlpha().raw().toBuffer({resolveWithObject:true});
        let x0=info.width,y0=info.height,x1=0,y1=0;
        for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>20){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
        if(x1<=x0||y1<=y0)throw new Error(`${key}: empty slot`);
        if(Math.min(x0,y0,info.width-1-x1,info.height-1-y1)<4)throw new Error(`${file}/${key}: clipped or unsafe slot boundary; regenerate with wider transparent gutters`);
        const pad=4;
        crop=crop.extract({left:Math.max(0,x0-pad),top:Math.max(0,y0-pad),width:Math.min(info.width-1,x1+pad)-Math.max(0,x0-pad)+1,height:Math.min(info.height-1,y1+pad)-Math.max(0,y0-pad)+1});
        const margin=size===256?12:10;
        crop=sharp(await crop.png().toBuffer()).resize(size-margin*2,size-margin*2,{fit:'contain',position:key.startsWith('fx-')?'centre':'bottom',background:{r:0,g:0,b:0,alpha:0}}).extend({top:margin,bottom:margin,left:margin,right:margin,background:{r:0,g:0,b:0,alpha:0}});
        report.push({key,file,sourceHash,bounds:[x0,y0,x1,y1],trueAlpha:true});
      }else crop=crop.resize(256,256);
      const dest=path.join(output,`${key}.webp`);
      const encoded=await crop.webp({quality:84,alphaQuality:100,effort:6}).toBuffer();
      pending.push({dest,encoded});
      if(isTile)report.push({key,file,sourceHash,trueAlpha:false});
      overrides[key]={path:`assets/v2/${key}.webp`,width:size,height:size,bytes:encoded.length,alpha:!isTile};
    }
  }
  // Validate every source before replacing any active output.
  for(const {dest,encoded} of pending)fs.writeFileSync(dest,encoded);
  fs.writeFileSync(path.join(root,'apps/client/src/presentation/assets/production.json'),JSON.stringify(overrides,null,2)+'\n');
  fs.writeFileSync(path.join(root,'apps/client/src/presentation/assets/production-keys.json'),JSON.stringify(Object.keys(overrides))+'\n');
  fs.writeFileSync(path.join(input,'export-report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(`${Object.keys(overrides).length} assets exported; ${Object.values(overrides).reduce((n,a)=>n+a.bytes,0)} bytes`);
})();
