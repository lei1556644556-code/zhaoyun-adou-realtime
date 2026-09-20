import { expect, test } from "@playwright/test";
import { cellIndex } from "@adou/shared";
import { acceptanceSnapshot, designPoint, mockAuthenticatedAccount, openRestoredBattle, QA_USER_ID } from "./fixtures";

test.use({video:"on"});
test.beforeEach(async({page})=>{
  await page.emulateMedia({reducedMotion:process.env.QA_REDUCED_MOTION==="1" ? "reduce" : "no-preference"});
});
for(const mode of ["image","text"]) for(const kind of ["刀","枪","弓","骑"]) test(`${mode} ${kind} performs a weapon pose and recovers during repeated attacks`,async({page},info)=>{
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));
  page.on("response",r=>{if(r.url().includes("/assets/")&&r.status()>=400)errors.push(r.url());});
  const s=acceptanceSnapshot();s.phase="battle";
  for(const p of s.players){p.phase="battle";p.spawnMs=999999;p.remainingToSpawn=1;p.enemies=[];p.units=[];}
  s.players[0].units=[{id:"animated",kind,level:3,cell:cellIndex(2,7),cooldownMs:1500,attackCount:0}];
  s.players[0].enemies=[{id:"target",hp:1e8,maxHp:1e8,progress:5/17,boss:false,stunnedMs:1e8}];
  await page.addInitScript(mode=>localStorage.setItem("adou-piece-display-mode-v1",mode),mode);
  await mockAuthenticatedAccount(page,s);await openRestoredBattle(page);
  const count=()=>page.evaluate(id=>JSON.parse(localStorage.getItem(`adou-practice-save-v1:${id}`)!)?.snapshot.players[0].units[0].attackCount,QA_USER_ID);
  await expect.poll(count,{intervals:[20]}).toBeGreaterThan(0);
  const shots:Buffer[]=[];
  for(let i=0;i<4;i++) {
    shots.push(await page.locator("#game canvas").screenshot({path:info.outputPath(`pose-${i}.png`)}));
    await page.waitForTimeout(45);
  }
  expect(shots.some(s=>!s.equals(shots[0]!))).toBe(true);
  // Isolate the attacker, not the animated target or floating damage text.
  const box=(await page.locator("#game canvas").boundingBox())!;
  const scale=box.width/640;
  const clip={x:box.x+164*scale,y:box.y+766*scale,width:72*scale,height:68*scale};
  const idle=await page.screenshot({clip});let moved=false;
  for(let i=0;i<20;i++) {
    await page.waitForTimeout(55);
    const pose=await page.screenshot({clip});
    if(!pose.equals(idle)) { moved=true; await info.attach("attacker-articulated-pose",{body:pose,contentType:"image/png"});break; }
  }
  expect(moved,"attacker itself must change pose, not only send a projectile").toBe(true);
  await expect.poll(count).toBeGreaterThan(2);
  const unitPoint=await designPoint(page,200,800);
  await page.mouse.click(unitPoint.x,unitPoint.y);
  await expect(page.locator("#unit-inspector")).toBeVisible();
  await expect(page.locator("#unit-inspector-name")).toHaveText(`${kind}兵`);
  expect(errors).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for(const mode of ["image","text"]) test(`${mode} mixed formation keeps repeated articulated attacks readable`,async({page},info)=>{
  const s=acceptanceSnapshot();s.phase="battle";
  for(const p of s.players){p.phase="battle";p.spawnMs=999999;p.remainingToSpawn=1;p.units=[];p.enemies=[];p.reserve=[];p.buns=0;}
  s.players[0].units=s.players[0].unlockedCells.map((cell,i)=>({
    id:`formation-${i}`,kind:["刀","枪","弓","骑"][i%4]!,level:3,cell,cooldownMs:1500+i*70,attackCount:0,
  }));
  s.players[0].enemies=Array.from({length:8},(_,i)=>({
    id:`crowd-${i}`,hp:1e8,maxHp:1e8,progress:(3+i*.48)/17,boss:false,stunnedMs:1e8,
  }));
  await page.addInitScript(mode=>localStorage.setItem("adou-piece-display-mode-v1",mode),mode);
  await mockAuthenticatedAccount(page,s);await openRestoredBattle(page);
  await page.waitForTimeout(4500);
  await page.locator("#game canvas").screenshot({path:info.outputPath("formation.png")});
  const attackers=await page.evaluate(id=>JSON.parse(localStorage.getItem(`adou-practice-save-v1:${id}`)!).snapshot.players[0].units.filter((u:any)=>u.attackCount>2).length,QA_USER_ID);
  expect(attackers).toBeGreaterThanOrEqual(3);
});

test("paired general letters remain inspectable while attacking",async({page},info)=>{
  const s=acceptanceSnapshot();s.phase="battle";
  for(const p of s.players){p.phase="battle";p.spawnMs=999999;p.remainingToSpawn=1;p.units=[];p.enemies=[];}
  s.players[0].units=[{id:"letter-general",kind:"赵云",parts:["赵","云"],level:1,
    cell:cellIndex(2,7),secondaryCell:cellIndex(3,7),cooldownMs:1500,attackCount:0}];
  s.players[0].enemies=[{id:"target",hp:1e8,maxHp:1e8,progress:5/17,boss:false,stunnedMs:1e8}];
  await page.addInitScript(()=>localStorage.setItem("adou-piece-display-mode-v1","text"));
  await mockAuthenticatedAccount(page,s);await openRestoredBattle(page);
  await expect.poll(()=>page.evaluate(id=>JSON.parse(localStorage.getItem(`adou-practice-save-v1:${id}`)!)?.snapshot.players[0].units[0].attackCount,QA_USER_ID)).toBeGreaterThan(0);
  await page.locator("#game canvas").screenshot({path:info.outputPath("general-letters.png")});
  for(const x of [200,280]) {
    const point=await designPoint(page,x,800);await page.mouse.click(point.x,point.y);
    await expect(page.locator("#unit-inspector-name")).toHaveText("赵云");
    await expect(page.locator("#unit-inspector")).toBeVisible();
  }
});
