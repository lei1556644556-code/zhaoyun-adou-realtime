// Mechanical atlas normalization: shared scale and authored foot anchors, no redraw.
// Adapted from the sprite-pipeline normalization workflow for unequal AI strip margins.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(require.resolve('sharp', { paths: [process.cwd(), path.join(require('node:os').homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node')] }));
const root = path.resolve(__dirname, '..');
const sources = {
  blade: { file: 'blade.png', cuts: [0, 440, 870, 1385, 1763], anchors: [220,665,1065,1535] },
  bow: { file: 'bow.png', cuts: [0, 560, 1080, 1715, 2172], anchors: [285,805,1332,1920] },
  spear: { file: 'spear.png', cuts: [0, 550, 1060, 1715, 2172], anchors: [270,805,1270,1925] },
  cavalry: { file: 'cavalry.png', cuts: [0, 545, 1080, 1690, 2172], anchors: [280,850,1380,1950] },
};
async function bounds(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  let x0=info.width,y0=info.height,x1=0,y1=0;
  for(let y=0;y<info.height;y++) for(let x=0;x<info.width;x++) if(data[(y*info.width+x)*4+3]>24) {
    x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);
  }
  if(x0>x1) throw new Error('Empty animation frame');
  return {left:x0,top:y0,width:x1-x0+1,height:y1-y0+1};
}
(async()=>{
  const out = path.join(root,'apps/client/public/assets/motion');fs.mkdirSync(out,{recursive:true});
  const manifest={};
  for(const [name,source] of Object.entries(sources)) {
    const input=path.join(root,'art_sources/attack-motion',source.file);
    const meta=await sharp(input).metadata();
    if(!meta.hasAlpha || meta.width!==source.cuts[4]) throw new Error(`Unexpected strip ${name}`);
    const seed=path.join(root,`apps/client/public/assets/v2/troop-${name}.webp`), seedBox=await bounds(seed);
    const slices=[],boxes=[];
    for(let i=0;i<4;i++) {
      const slice=await sharp(input).extract({left:source.cuts[i],top:0,width:source.cuts[i+1]-source.cuts[i],height:meta.height}).png().toBuffer();
      slices.push(slice);boxes.push(await bounds(slice));
    }
    const scale=seedBox.height/boxes[0].height, frames=[];
    for(let i=0;i<4;i++) {
      let content,left,top;
      if(i===0) { content=await sharp(seed).png().toBuffer();left=128;top=128; }
      else {
        const box=boxes[i],w=Math.round(box.width*scale),h=Math.round(box.height*scale);
        content=await sharp(slices[i]).extract(box).resize(w,h).png().toBuffer();
        left=Math.round(256+(source.cuts[i]+box.left-source.anchors[i])*scale);
        top=128+seedBox.top+seedBox.height-h;
        if(left<2 || left+w>510 || top<2 || top+h>510) throw new Error(`${name} frame ${i}: would clip (${left},${top},${w},${h})`);
      }
      frames.push(await sharp({create:{width:512,height:512,channels:4,background:'#00000000'}}).composite([{input:content,left,top}]).png().toBuffer());
    }
    const bytes=await sharp({create:{width:2048,height:512,channels:4,background:'#00000000'}})
      .composite(frames.map((input,i)=>({input,left:i*512,top:0}))).webp({quality:82,alphaQuality:100,effort:6}).toBuffer();
    fs.writeFileSync(path.join(out,`${name}.webp`),bytes);
    manifest[name]={path:`assets/motion/${name}.webp`,width:2048,height:512,frames:4,bytes:bytes.length};
    console.log(name,bytes.length);
  }
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
})();
