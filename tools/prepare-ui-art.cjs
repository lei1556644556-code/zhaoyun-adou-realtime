// Mechanical atlas export, no generated painting or background removal here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require(process.env.ADOU_SHARP || require.resolve('sharp', { paths: [process.cwd(), path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node')] }));
const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'art_sources/ui-production');
const output = path.join(root, 'apps/client/public/assets/ui-production');
const jobs = [
  ['panels-web-v1.png', 2, ['panel-dark','panel-light']],
  ['buttons-web-v2.png', 2, ['mode-blue','mode-red','button-blue','button-red','recruit-red','button-short']],
  ['combat-fx-web-v2.png', 3, ['fx-jade','fx-silver','fx-holy','fx-fire','fx-dust','fx-thunder']],
  ['props-a-web-v1.png', 3, Array.from({length:9},(_,i)=>`prop-${i}`)],
  ['props-b-web-v1.png', 3, Array.from({length:9},(_,i)=>`prop-${i+9}`)],
  ['props-c-web-v1.png', 3, [...Array.from({length:7},(_,i)=>`prop-${i+18}`),'gold','stamina']],
];
async function main() {
  const records = {};
  const pending = [];
  const selected = process.argv.includes('--panels-only') ? jobs.slice(0,1) : jobs;
  for (const [sourceName, grid, keys] of selected) {
    const bytes = fs.readFileSync(path.join(sourceRoot,sourceName));
    const sourceHash = crypto.createHash('sha256').update(bytes).digest('hex');
    const meta = await sharp(bytes).metadata();
    for (const [i,key] of keys.entries()) {
      // Observed panel sheet: squares extend below the mathematical midpoint;
      // the safe horizontal gutter is at 60%, well above both buttons.
      const row=Math.floor(i/grid);
      const rows=sourceName==='combat-fx-web-v2.png'?[0,.58,1]:sourceName==='buttons-web-v2.png'?[0,.51,.7,1]:grid===2?[0,.6,1]:sourceName==='props-c-web-v1.png'?[0,425/1254,810/1254,1]:[0,1/3,2/3,1];
      // A's first vertical empty gutter is just right of the nominal third.
      const columns=sourceName==='combat-fx-web-v2.png'?(row===0?[0,.334,.71,1]:[0,.34,.68,1]):grid===2?[0,.5,1]:sourceName==='props-a-web-v1.png'?[0,440/1254,850/1254,1]:[0,1/3,2/3,1];
      const left = Math.round(columns[i%grid]*meta.width), top = Math.round(rows[row]*meta.height);
      const width = Math.round(columns[i%grid+1]*meta.width)-left, height = Math.round(rows[row+1]*meta.height)-top;
      const slice = sharp(bytes).extract({left,top,width,height});
      const {data,info} = await slice.clone().ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let x0=width,y0=height,x1=-1,y1=-1,transparent=0;
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const a=data[(y*width+x)*4+3];
        if(a===0)transparent++;
        if(a>20){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
      }
      if(!transparent || x1<0) throw new Error(`${key}: missing true alpha or empty`);
      if(Math.min(x0,y0,width-1-x1,height-1-y1)<4) throw new Error(`${key}: unsafe crop ${[x0,y0,x1,y1]}`);
      const crop=sharp(await slice.extract({left:x0-2,top:y0-2,width:x1-x0+5,height:y1-y0+5}).png().toBuffer());
      const panel=key.startsWith('panel-'),button=sourceName==='buttons-web-v2.png';
      const resized=panel ? crop.resize(384,384) : button ? crop.resize({width:384}) : key.startsWith('fx-') ? crop.resize({width:256}) : crop.resize(112,112,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).extend({top:8,bottom:8,left:8,right:8,background:{r:0,g:0,b:0,alpha:0}});
      const encoded=await resized.webp({quality:84,alphaQuality:100,effort:6}).toBuffer();
      const dimensions=await sharp(encoded).metadata();
      pending.push([key,encoded]);
      records[key]={path:`assets/ui-production/${key}.webp`,width:dimensions.width,height:dimensions.height,bytes:encoded.length,source:sourceName,sourceHash,bounds:[x0,y0,x1,y1],alpha:true};
    }
  }
  fs.mkdirSync(output,{recursive:true});
  for(const [key,encoded] of pending) fs.writeFileSync(path.join(output,`${key}.webp`),encoded);
  if(!process.argv.includes('--panels-only')) fs.writeFileSync(path.join(root,'apps/client/src/presentation/assets/ui-production.json'),JSON.stringify(records,null,2)+'\n');
  console.log(JSON.stringify({count:pending.length,bytes:pending.reduce((n,entry)=>n+entry[1].length,0),records},null,2));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
