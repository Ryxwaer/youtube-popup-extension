import { launch, openYouTube, pipBox, sleep } from './harness.mjs';
import fs from 'node:fs';
const out = process.argv[2] || 'final';
const dpr = Number(process.argv[3] || 2);
const full = process.argv.includes('--full');
fs.mkdirSync(out, { recursive: true });
const browser = await launch({ exe: process.env.PIP_TEST_BROWSER || '/usr/bin/brave', headless: true, dpr });
const results = [];
function check(name, ok, detail) { results.push({ name, ok, detail }); console.log(JSON.stringify(results.at(-1))); }
async function inside(page, fn) {
  const cdp = await page.createCDPSession();
  try {
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    function walk(n) {
      if (n.attributes?.includes('pip')) return n;
      for (const c of [...(n.children || []), ...(n.shadowRoots || [])]) { const r = walk(c); if (r) return r; }
    }
    const n = walk(root); if (!n) return null;
    const { object } = await cdp.send('DOM.resolveNode', { nodeId: n.nodeId });
    const { result, exceptionDetails } = await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function() { return (${fn.toString()})(this); }`, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(JSON.stringify(exceptionDetails));
    return result.value;
  } finally { await cdp.detach(); }
}
const shots = {};
const mediaEvents=[];
let testSource;
const shot = async (page, name) => { shots[name] = {box:await pipBox(page),at:Date.now()}; await page.screenshot({ path: `${out}/${name}.png` }); };
async function waitForPip(page) {
  for(let i=0;i<150;i++){const b=await pipBox(page);if(b)return b;await sleep(100);}
  const pages=await Promise.all((await browser.pages()).map(async p=>({url:p.url(),media:await p.evaluate(()=>[...document.querySelectorAll('video')].map(v=>({t:v.currentTime,d:v.duration,w:v.videoWidth,paused:v.paused,ready:v.readyState,error:v.error?.message})))})));
  throw new Error('Overlay did not appear: '+JSON.stringify(pages));
}
async function tap(page) { const b = await waitForPip(page); await page.mouse.click(b.x + b.w / 2, b.y + b.h * .8); await sleep(600); }
async function click(page, act) { const r = await inside(page, el => Object.fromEntries([...el.querySelectorAll('[data-act]')].map(b => { const r = b.getBoundingClientRect(); return [b.dataset.act, { x: r.x + r.width / 2, y: r.y + r.height / 2 }]; }))); await page.mouse.click(r[act].x, r[act].y); await sleep(600); }
async function drag(page, x, y) {
  const b = await pipBox(page); const sx = b.x + b.w / 2, sy = b.y + b.h / 2;
  await page.mouse.move(sx, sy); await page.mouse.down();
  for (let i=1;i<=20;i++) { await page.mouse.move(sx+(x-sx)*i/20,sy+(y-sy)*i/20); await sleep(16); }
  await sleep(130); await page.mouse.up(); await sleep(1000);
}
async function progress(page) {
  return inside(page, el => {
    const bar = el.querySelector('.progress'), fill = el.querySelector('.elapsed');
    const b = bar.getBoundingClientRect(), p = el.getBoundingClientRect(), style = getComputedStyle(bar);
    return { visible: !bar.hidden && style.display !== 'none' && +getComputedStyle(el.querySelector('.controls')).opacity > .99,
      fraction: parseFloat(fill.style.width)/100,
      height: b.height / p.width, inset: (b.left - p.left) / p.width,
      bottom: (p.bottom - b.bottom) / p.width, radius: parseFloat(style.borderRadius) / p.width,
      track: style.backgroundColor, opacity: style.opacity, fill: getComputedStyle(fill).backgroundColor };
  });
}
try {
  const target = await browser.newPage();
  await target.goto('https://en.wikipedia.org/wiki/Picture-in-picture', { waitUntil: 'domcontentloaded' });
  const yt = testSource = await openYouTube(browser);
  const mediaCdp=await yt.createCDPSession();
  for(const event of ['playerErrorsRaised','playerMessagesLogged','playerEventsAdded','playerPropertiesChanged'])mediaCdp.on('Media.'+event,data=>mediaEvents.push({at:Date.now(),event,data}));
  await mediaCdp.send('Media.enable');
  await yt.bringToFront(); await sleep(1800);
  check('No overlay on YouTube', !await pipBox(yt));
  await target.bringToFront();
  shots.switchAt=Date.now();
  for (const t of [80,160,300]) { await sleep(t === 80 ? 80 : t === 160 ? 80 : 140); await shot(target, `fly-${t}`); }
  await sleep(2000); await shot(target, 'corner');
  const info = await inside(target, el => { const v=el.querySelector('video'), b=el.getBoundingClientRect(); return { width:b.width,height:b.height,dpr:devicePixelRatio, viewport:[innerWidth,innerHeight], video:[v.videoWidth,v.videoHeight],time:v.currentTime,radius:getComputedStyle(el).getPropertyValue('--r') }; });
  check('Live WebRTC frames', info?.video[0] > 0 && info?.time > 0, info);
  await tap(target); await shot(target,'controls');
  const bar = await progress(target);
  check('Progress matches reference proportions and colors',bar.visible&&Math.abs(bar.height-4/344)<.001&&Math.abs(bar.inset-12/344)<.001&&Math.abs(bar.bottom-9/344)<.001&&Math.abs(bar.radius-2/344)<.001&&bar.track==='rgba(255, 255, 255, 0.4)'&&bar.opacity==='0.65'&&bar.fill==='rgb(255, 255, 255)',bar);
  const samples = await inside(target, async el => {
    const values=[];
    for(let i=0;i<10;i++){await new Promise(requestAnimationFrame);values.push(parseFloat(el.querySelector('.elapsed').style.width)/100);}
    return values;
  });
  check('Progress interpolates between source reports',new Set(samples).size>5&&samples.at(-1)>samples[0],samples);
  await sleep(3600); await shot(target, 'autohide');
  check('Controls auto-hide during playback', !(await pipBox(target)).cls.includes('ctl'));
  check('Progress hides with controls',!(await progress(target)).visible);
  await drag(target,220,370); await shot(target,'edge-middle');
  const left = await pipBox(target); check('Free vertical edge position',left.x >= 0 && left.x <= 20 && left.y > 50 && left.y < 450,left);
  await drag(target,8,left.y+left.h/2); await shot(target,'stash-left');
  let stash = await pipBox(target); check('Stash left',stash.cls.includes('stashed'),stash);
  await target.mouse.click(10,stash.y+stash.h/2); await sleep(900);
  check('Tap stash restores',!(await pipBox(target)).cls.includes('stashed'));
  if (full) {
    const right = await target.evaluate(()=>innerWidth);
    await drag(target,right-220,370);const rb=await pipBox(target);
    await drag(target,right-8,rb.y+rb.h/2);await shot(target,'stash-right');const rs=await pipBox(target);
    check('Stash right',rs.cls.includes('stashed')&&Math.abs(rs.x-(right-24))<1,rs);
    await target.mouse.click(right-10,rs.y+rs.h/2);await sleep(900);
    check('Right stash restores',!(await pipBox(target)).cls.includes('stashed'));
  }
  await tap(target);
  if (full) {
    const sourceInfo=await yt.$eval('#movie_player video',v=>({t:v.currentTime,d:v.duration,w:v.videoWidth,ready:v.readyState,src:v.currentSrc,error:v.error?.message}));
    check('Source remains loaded',sourceInfo.w>0&&sourceInfo.d>0,sourceInfo);
    await click(target,'toggle'); check('Pause controls source',await yt.$eval('#movie_player video',v=>v.paused));
    const pausedBar = await progress(target);await sleep(350);
    check('Paused progress remains still and visible',pausedBar.visible&&Math.abs((await progress(target)).fraction-pausedBar.fraction)<.00001);
    await shot(target,'paused');
    const start = await yt.$eval('#movie_player video',v=>v.currentTime);
    await click(target,'fwd');const next=await yt.$eval('#movie_player video',v=>v.currentTime);check('Forward 10 seconds',Math.abs(next-start-10)<.5,{start,next});
    const duration=await yt.$eval('#movie_player video',v=>v.duration);
    check('Progress follows seeks',Math.abs((await progress(target)).fraction-next/duration)<.0001);
    await click(target,'back');check('Back 10 seconds',Math.abs(await yt.$eval('#movie_player video',v=>v.currentTime)-start)<.5);
    const worker = await (await browser.waitForTarget(t=>t.type()==='service_worker')).worker();
    const originalState = await worker.evaluate(async()=>{
      const st=(await chrome.storage.session.get('pipState')).pipState;
      return (await chrome.tabs.sendMessage(st.source.tabId,{type:'src:query'})).state;
    });
    async function stateFixture(changes) {
      await worker.evaluate(async (state)=>{
        const st=(await chrome.storage.session.get('pipState')).pipState;
        await chrome.tabs.sendMessage(st.overlayTab,{type:'pip:state',sid:st.sid,state});
      },{...originalState,...changes});await sleep(150);
    }
    try {
      await stateFixture({live:true});
      check('Live state hides progress',!(await progress(target)).visible);
      await stateFixture({d:0});
      check('Unknown duration hides progress',!(await progress(target)).visible);
      await stateFixture({ad:true});const adBar=await progress(target);
      check('Ad state keeps neutral progress',adBar.visible&&adBar.fill==='rgb(255, 255, 255)'&&adBar.track==='rgba(255, 255, 255, 0.4)');
      await stateFixture({playing:true,rate:2});
      const rateSample=await inside(target,async el=>{
        const fraction=()=>parseFloat(el.querySelector('.elapsed').style.width)/100;
        const start=fraction(),at=performance.now();
        await new Promise(resolve=>setTimeout(resolve,450));
        return {delta:fraction()-start,seconds:(performance.now()-at)/1000};
      });
      check('Progress follows playback rate',Math.abs(rateSample.delta*duration/rateSample.seconds-2)<.4,rateSample);
    } finally {await stateFixture({});}
    check('Finite duration restores progress',(await progress(target)).visible);
    await click(target,'toggle'); await sleep(500);
    const sizes=[],barSizes=[];
    for(let i=0;i<3;i++) { const b=await pipBox(target);await target.mouse.click(b.x+b.w/2,b.y+b.h*.8);await sleep(70);await target.mouse.click(b.x+b.w/2,b.y+b.h*.8);await sleep(1000); sizes.push((await pipBox(target)).w);barSizes.push(await progress(target));await shot(target,`detent-${i}`); }
    check('Double-tap reaches three detents',new Set(sizes.map(Math.round)).size===3,sizes);
    check('Progress scales across all detents',barSizes.every(b=>Math.abs(b.height-4/344)<.001&&Math.abs(b.inset-12/344)<.001&&Math.abs(b.bottom-9/344)<.001),barSizes);
    await target.mouse.move((await pipBox(target)).x+80,(await pipBox(target)).y+60);await target.keyboard.down('Control');await target.mouse.wheel({deltaY:-22});await target.keyboard.up('Control');await sleep(1000);check('Ctrl-wheel resize remains in viewport',(await pipBox(target)).x>=0);
    {
      let initial=await pipBox(target);
      await target.mouse.click(initial.x+initial.w/2,initial.y+initial.h*.8);await sleep(70);await target.mouse.click(initial.x+initial.w/2,initial.y+initial.h*.8);await sleep(1000);
      const b=await pipBox(target), cdp=await target.createCDPSession();
      const cx=b.x+b.w/2,cy=b.y+b.h/2;
      const points=span=>[{x:cx-span,y:cy,id:1},{x:cx+span,y:cy,id:2}];
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points(35)});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:points(60)});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await sleep(1000);
      const pinched=await pipBox(target);check('Two-pointer pinch settles to detent',pinched.w>b.w&&[180,270,379.47].some(w=>Math.abs(pinched.w-w)<1),{before:b.w,after:pinched.w});
      await target.setViewport({width:320,height:480,deviceScaleFactor:dpr});await sleep(500);const narrow=await pipBox(target);
      check('Viewport resize fits window',narrow.x>=0&&narrow.y>=0&&narrow.x+narrow.w<=320&&narrow.y+narrow.h<=480,narrow);await shot(target,'narrow-viewport');
      await target.setViewport({width:1440,height:819,deviceScaleFactor:dpr});await sleep(500);
    }
    for(let i=0;i<3;i++){await yt.bringToFront();await sleep(400);check(`Return hides overlay ${i}`,!await pipBox(target));await target.bringToFront();await sleep(1400);check(`Switch resumes stream ${i}`,(await inside(target,el=>el.querySelector('video').currentTime))>0);}
    await tap(target);await click(target,'restore');check('Restore selects YouTube',await yt.evaluate(()=>document.visibilityState==='visible'));check('Restore removes overlay',!await pipBox(target));
    await target.bringToFront();await waitForPip(target);await tap(target);await click(target,'close');check('Close pauses source',await yt.$eval('#movie_player video',v=>v.paused));check('Close removes overlay',!await pipBox(target));
    await yt.bringToFront();await yt.$eval('#movie_player video',v=>{v.play().catch(()=>{});});await sleep(500);await target.bringToFront();await sleep(1600);
    // YouTube's next-video action exercises the autoplay player transition.
    const oldId = await yt.evaluate(()=>location.href);
    await yt.$eval('.ytp-next-button', b=>b.click());
    await sleep(6500);
    await yt.$eval('#movie_player video',v=>{v.muted=true;v.play().catch(()=>{});});await sleep(2000);
    const newId = await yt.evaluate(()=>location.href);
    const framesBefore = await inside(target,el=>el.querySelector('video').getVideoPlaybackQuality().totalVideoFrames);
    await sleep(1200);
    const framesAfter = await inside(target,el=>el.querySelector('video').getVideoPlaybackQuality().totalVideoFrames);
    check('Autoplay next transition delivers new frames', oldId!==newId && framesAfter>framesBefore,{oldId,newId,framesBefore,framesAfter});await shot(target,'video-change');
    await yt.bringToFront();
    await yt.goto('https://www.youtube.com/shorts/RaqREI_rcu8',{waitUntil:'domcontentloaded'});
    await yt.waitForSelector('ytd-reel-video-renderer[is-active] video, #shorts-player video',{timeout:30000});
    await yt.evaluate(()=>{const v=document.querySelector('ytd-reel-video-renderer[is-active] video, #shorts-player video');v.muted=true;return v.play().catch(()=>{});});
    await sleep(6000);
    const portrait = await yt.evaluate(()=>{const v=document.querySelector('ytd-reel-video-renderer[is-active] video, #shorts-player video');return {w:v.videoWidth,h:v.videoHeight,playing:!v.paused,url:location.href};});
    check('Real Shorts portrait player',portrait.w>0 && portrait.h>portrait.w,portrait);
    await target.bringToFront();await sleep(2500);await shot(target,'portrait');await tap(target);await shot(target,'portrait-controls');
    const pb=await pipBox(target);check('Portrait overlay preserves source aspect',Math.abs(pb.w/pb.h-portrait.w/portrait.h)<.02,pb);
    const pf1=await inside(target,el=>el.querySelector('video').getVideoPlaybackQuality().totalVideoFrames);await sleep(1200);const pf2=await inside(target,el=>el.querySelector('video').getVideoPlaybackQuality().totalVideoFrames);
    check('Portrait receives moving frames',pf2>pf1,{pf1,pf2});
    await yt.bringToFront();await yt.keyboard.press('ArrowDown');await sleep(4500);
    const secondShort=await yt.evaluate(()=>{const v=document.querySelector('ytd-reel-video-renderer[is-active] video, #shorts-player video');v.muted=true;v.play().catch(()=>{});return {w:v.videoWidth,h:v.videoHeight,url:location.href};});
    await target.bringToFront();await sleep(1800);const sb=await pipBox(target);
    check('Shorts next uses active player',secondShort.url!==portrait.url&&sb&&Math.abs(sb.w/sb.h-secondShort.w/secondShort.h)<.02,secondShort);
    await shot(target,'portrait-next');

  }
} catch(e) {
  if(testSource&&!testSource.isClosed()) {
    try {const diagnostic=await testSource.evaluate(()=>{const p=document.querySelector('#movie_player');return {url:location.href,playerState:p?.getPlayerState?.(),playability:p?.getPlayerResponse?.()?.playabilityStatus,text:p?.innerText,videos:[...document.querySelectorAll('video')].map(v=>({t:v.currentTime,d:String(v.duration),ready:v.readyState,w:v.videoWidth,paused:v.paused,src:v.currentSrc,error:v.error?.message}))};});fs.writeFileSync(`${out}/source-failure.json`,JSON.stringify(diagnostic,null,2));console.error(JSON.stringify(diagnostic));}catch{}
  }
  console.error(e);results.push({name:'Run completed',ok:false,detail:String(e)});process.exitCode=1; }
finally { fs.writeFileSync(`${out}/media-events.json`,JSON.stringify(mediaEvents,null,2));if(results.some(r=>!r.ok))process.exitCode=1;fs.writeFileSync(`${out}/shots.json`,JSON.stringify(shots,null,2));fs.writeFileSync(`${out}/results.json`,JSON.stringify(results,null,2));await browser.close(); }
