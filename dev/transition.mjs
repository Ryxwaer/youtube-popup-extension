import {launch,openYouTube,pipBox,sleep} from './harness.mjs';
import fs from 'node:fs';
const out=process.argv[2]||'transition';fs.mkdirSync(out,{recursive:true});
const browser=await launch({exe:'/usr/bin/brave',headless:true,dpr:2});
async function receiver(page) {
 const cdp=await page.createCDPSession();
 try {
  const {root}=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
  function walk(n){if(n.nodeName==='VIDEO')return n;for(const c of [...n.children||[],...n.shadowRoots||[]]){const r=walk(c);if(r)return r;}}
  const n=walk(root);if(!n)return null;
  const {object}=await cdp.send('DOM.resolveNode',{nodeId:n.nodeId});
  const {result}=await cdp.send('Runtime.callFunctionOn',{objectId:object.objectId,functionDeclaration:'function(){return {w:this.videoWidth,h:this.videoHeight,t:this.currentTime,frames:this.getVideoPlaybackQuality().totalVideoFrames,ready:this.readyState,paused:this.paused,track:this.srcObject?.getVideoTracks().map(t=>({id:t.id,ready:t.readyState,muted:t.muted}))}}',returnByValue:true});return result.value;
 }finally{await cdp.detach();}
}
const source=page=>page.evaluate(()=>{const v=document.querySelector('#movie_player video');return {w:v.videoWidth,h:v.videoHeight,src:v.currentSrc,t:v.currentTime,frames:v.getVideoPlaybackQuality().totalVideoFrames,paused:v.paused,ready:v.readyState,ad:!!document.querySelector('.ad-showing'),url:location.href}});
const data=[];
try {
 const target=await browser.newPage();await target.goto('https://en.wikipedia.org/wiki/Picture-in-picture',{waitUntil:'domcontentloaded'});
 const yt=await openYouTube(browser);await yt.bringToFront();await sleep(1000);await target.bringToFront();await sleep(2000);
 data.push({stage:'before',source:await source(yt),receiver:await receiver(target)});
 await yt.$eval('.ytp-next-button',b=>b.click());
 for(let i=0;i<10;i++) {
  await sleep(2000);
  await yt.evaluate(()=>{const v=document.querySelector('#movie_player video');v.muted=true;v.play().catch(()=>{});document.querySelector('.ytp-skip-ad-button, .ytp-ad-skip-button-modern')?.click();});
  const row={stage:`next-${i}`,source:await source(yt),receiver:await receiver(target)};data.push(row);console.log(JSON.stringify(row));
 }
 await target.screenshot({path:`${out}/next.png`});
}finally{fs.writeFileSync(`${out}/results.json`,JSON.stringify(data,null,2));await browser.close();}
