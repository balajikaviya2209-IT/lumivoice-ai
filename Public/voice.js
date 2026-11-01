/* Lumi AI: voice assistant + "only my voice" lock.
   Depends on window.Lumi (exposed by index.html). */
(function(){
'use strict';
const L=window.Lumi; if(!L)return;
const $=s=>document.querySelector(s);
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;

const store={
  get(k,d){try{const v=localStorage.getItem(k);return v==null?d:JSON.parse(v)}catch(e){return d}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}},
  del(k){try{localStorage.removeItem(k)}catch(e){}}
};
let prefs=Object.assign({speak:true,speakChat:false,hands:false,lock:false,sens:'balanced'},store.get('lumi.prefs',{}),{wake:false});
let vp=store.get('lumi.voiceprint',null);           // numbers only, never audio
const savePrefs=()=>store.set('lumi.prefs',Object.assign({},prefs,{wake:false}));  // the wake word is never auto-started

/* ================= voiceprint maths (pure) ================= */
/*TEST-BEGIN*/
const NB=24, DIMS=NB*2+2;
const FLOOR=[...Array(NB).fill(2.0),...Array(NB).fill(1.5),0.06,0.04];
const WEIGHT=[...Array(NB).fill(1),...Array(NB).fill(1),8,3];
function summarize(frames,f0s){
  const n=frames.length; if(n<8)return null;
  const vec=new Array(DIMS).fill(0), means=new Array(NB).fill(0);
  for(const r of frames)for(let b=0;b<NB;b++)means[b]+=r[b]/n;
  const gm=means.reduce((a,b)=>a+b,0)/NB;               // remove overall level (mic gain, distance)
  for(let b=0;b<NB;b++){
    vec[b]=means[b]-gm;
    let s=0;for(const r of frames)s+=(r[b]-means[b])**2;
    vec[NB+b]=Math.sqrt(s/n);
  }
  const lf=f0s.map(Math.log), mf=lf.reduce((a,b)=>a+b,0)/n;
  vec[2*NB]=mf; vec[2*NB+1]=Math.sqrt(lf.reduce((a,b)=>a+(b-mf)**2,0)/n);
  return {vec,n};
}
function dist(x,mu,sd){
  let s=0,w=0;
  for(let i=0;i<DIMS;i++){const z=(x[i]-mu[i])/sd[i];s+=WEIGHT[i]*z*z;w+=WEIGHT[i]}
  return Math.sqrt(s/w);
}
function meanVec(a){const m=new Array(DIMS).fill(0);for(const v of a)for(let i=0;i<DIMS;i++)m[i]+=v[i]/a.length;return m}
function buildPrint(samples){
  const n=samples.length, mu=meanVec(samples), sd=new Array(DIMS);
  for(let i=0;i<DIMS;i++){let s=0;for(const v of samples)s+=(v[i]-mu[i])**2;sd[i]=Math.max(Math.sqrt(s/(n-1)),FLOOR[i])}
  let dloo=0;
  for(let k=0;k<n;k++){dloo=Math.max(dloo,dist(samples[k],meanVec(samples.filter((_,j)=>j!==k)),sd))}
  return {v:1,mu,sd,dloo};
}
const FACT={strict:1.2,balanced:1.55,relaxed:2.1};
function thresholdFor(print,sens){return Math.max(1.0,print.dloo*FACT[sens])}
function verifyWith(print,sens,sum,minN){
  if(!sum||sum.n<(minN||14))return {ok:false,why:'short'};
  const d=dist(sum.vec,print.mu,print.sd);
  return {ok:d<=thresholdFor(print,sens),d};
}
/*TEST-END*/

/* ================= microphone capture ================= */
const MIC={echoCancellation:true,noiseSuppression:false,autoGainControl:false};
let stream=null;
async function getStream(){
  if(stream&&stream.active)return stream;
  stream=await navigator.mediaDevices.getUserMedia({audio:MIC});
  return stream;
}
function releaseMic(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}}

const mel=f=>2595*Math.log10(1+f/700), imel=m=>700*(Math.pow(10,m/2595)-1);
function Capture(st,onLevel){
  const AC=window.AudioContext||window.webkitAudioContext, ac=new AC();
  const src=ac.createMediaStreamSource(st), an=ac.createAnalyser();
  an.fftSize=2048; an.smoothingTimeConstant=0; src.connect(an);
  const sr=ac.sampleRate, td=new Float32Array(2048), fd=new Float32Array(1024), binHz=sr/2048;
  const m0=mel(100), m1=mel(5000), edges=[];
  for(let i=0;i<=NB;i++)edges.push(imel(m0+(m1-m0)*i/NB));
  const bands=[];
  for(let i=0;i<NB;i++){const a=Math.max(1,Math.floor(edges[i]/binHz));bands.push([a,Math.max(a+1,Math.ceil(edges[i+1]/binHz))])}
  const lagMin=Math.max(2,Math.floor(sr/400)), lagMax=Math.min(Math.floor(sr/70),1000);
  const cs=new Float32Array(lagMax+2);
  let noise=0.004; const frames=[], f0s=[];
  function tick(){
    an.getFloatTimeDomainData(td);
    let e=0;for(let i=0;i<td.length;i++)e+=td[i]*td[i];
    const rms=Math.sqrt(e/td.length);
    noise=rms<noise?noise*.9+rms*.1:noise*.995+rms*.005;
    if(onLevel)onLevel(rms);
    if(rms<Math.max(.012,noise*3))return;                    // silence
    const n=td.length-lagMax; let r0=0;
    for(let i=0;i<n;i++)r0+=td[i]*td[i];
    let best=0;
    for(let l=lagMin;l<=lagMax;l++){
      let s=0,e2=0;for(let i=0;i<n;i++){s+=td[i]*td[i+l];e2+=td[i+l]*td[i+l]}
      const c=s/Math.sqrt(r0*e2+1e-12);cs[l]=c;if(c>best)best=c;
    }
    if(best<.55)return;                                       // not a voiced vowel
    let lag=0;                                                // smallest strong peak (avoids octave errors)
    for(let l=lagMin+1;l<lagMax;l++){if(cs[l]>=best*.92&&cs[l]>=cs[l-1]&&cs[l]>=cs[l+1]){lag=l;break}}
    if(!lag)return;
    an.getFloatFrequencyData(fd);
    const row=new Float32Array(NB);
    for(let b=0;b<NB;b++){
      let p=0,c=0;for(let k=bands[b][0];k<bands[b][1]&&k<fd.length;k++){p+=Math.pow(10,fd[k]/10);c++}
      row[b]=10*Math.log10(p/Math.max(1,c)+1e-12);
    }
    frames.push(row);f0s.push(sr/lag);
  }
  const timer=setInterval(tick,30);
  return {
    take(){const r=summarize(frames,f0s);frames.length=0;f0s.length=0;return r},
    stop(){clearInterval(timer);try{src.disconnect()}catch(e){}ac.close().catch(()=>{});return summarize(frames,f0s)}
  };
}

/* ================= UI state ================= */
const orb=$('#orb'),vstatus=$('#vstatus'),vheard=$('#vheard'),vsay=$('#vsay');
let vstate='idle',curTab='chat',rec=null,cap=null,speakTok=0;
const wake={sr:null,paused:false,armed:false,armT:0,resumeT:0,cap:null,wl:null};

function lockOn(){return !!(prefs.lock&&vp)}
function idleText(){return lockOn()?'Tap to talk. Only your voice works.':'Tap to talk'}
function setState(s,t){
  vstate=s;orb.className='orb '+s;
  vstatus.textContent=t||({idle:idleText(),listening:'Listening…',thinking:'Thinking…',speaking:'Speaking…'}[s]);
  if(s!=='listening')orb.style.setProperty('--lvl',0);
  if(s==='idle')resumeWake();else pauseWake();
}
function setSwitch(id,on){const b=$(id);b.setAttribute('aria-checked',on?'true':'false')}
function refreshUI(){
  setSwitch('#swLock',lockOn());setSwitch('#swSpeak',prefs.speak);setSwitch('#swHands',prefs.hands);setSwitch('#swWake',prefs.wake);syncWakeCap();
  $('#lockSub').textContent=vp?(prefs.lock?'On: only your voice is accepted':'Voice recorded, lock is off'):'Not set up';
  $('#lockSetupT').textContent=vp?'Voice lock settings':'Set up voice lock';
  const sp=$('#spk');sp.classList.toggle('off',!prefs.speakChat);sp.setAttribute('aria-pressed',String(!!prefs.speakChat));
  if(vstate==='idle')setState('idle');
}

/* ================= speaking ================= */
function cleanText(t){return t.replace(/[*_`#>~]/g,'').replace(/\s+/g,' ').trim()}
function pickVoice(){
  const vs=(window.speechSynthesis&&speechSynthesis.getVoices())||[], lang=(navigator.language||'en-US').toLowerCase();
  return vs.find(v=>v.lang.toLowerCase()===lang&&/enhanced|premium|natural|siri/i.test(v.name))
      ||vs.find(v=>v.lang.toLowerCase()===lang)
      ||vs.find(v=>v.lang.toLowerCase().startsWith(lang.slice(0,2)))||null;
}
function stopSpeaking(){speakTok++;if('speechSynthesis' in window)speechSynthesis.cancel()}
function afterSpeak(){
  setState('idle');
  if(prefs.hands&&curTab==='voice')setTimeout(()=>{if(vstate==='idle'&&curTab==='voice')listen()},450);
}
function speak(text,ui,done){
  const fin=()=>{if(ui)afterSpeak();if(done)done()};
  if(!('speechSynthesis' in window)){fin();return}
  speechSynthesis.cancel();const tok=++speakTok;
  const parts=(cleanText(text).match(/[^.!?\n]+[.!?]*\s*/g)||[]).map(p=>p.trim()).filter(Boolean);
  if(!parts.length){fin();return}
  if(ui)setState('speaking');
  const v=pickVoice();
  parts.forEach((p,i)=>{
    const u=new SpeechSynthesisUtterance(p);
    if(v){u.voice=v;u.lang=v.lang}else u.lang=navigator.language||'en-US';
    u.rate=1.02;
    if(i===parts.length-1){u.onend=u.onerror=()=>{if(tok===speakTok)fin()}}
    speechSynthesis.speak(u);
  });
}
L.onReply=(text,o)=>{if(!o.voice&&prefs.speakChat)speak(text,false)};

/* ================= local voice commands ================= */
/*CMD-TEST-BEGIN*/
const GREET=new Set(['hi','hey','hay','hello','okay','ok','hai','hii']);
const NAMES=new Set(['lumi','loomy','loomi','lumie','luomi','loumi','lomi','lummy','luumi','looming','loomie','lumy','lumia']);
function lev(a,b){const d=[];for(let i=0;i<=a.length;i++){d[i]=[i];for(let j=1;j<=b.length;j++)d[i][j]=i?0:j}
  for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
const isName=w=>NAMES.has(w)||lev(w,'lumi')<=1;
function findWake(t){
  const w=t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu,' ').split(/\s+/).filter(Boolean);
  for(let i=w.length-2;i>=0;i--)if(GREET.has(w[i])&&isName(w[i+1]))return {rest:w.slice(i+2).join(' ')};
  return null;
}
const FILTER_WORDS={'black and white':'Mono',mono:'Mono',noir:'Noir',vivid:'Vivid',warm:'Warm',cool:'Cool',faded:'Fade',fade:'Fade',chrome:'Chrome'};
function matchEdit(x){
  const fw=Object.keys(FILTER_WORDS).find(k=>new RegExp('\\b'+k+'\\b').test(x));
  if(fw&&(/\bfilter\b/.test(x)||/\b(apply|use|try|switch to|make it)\b/.test(x)))return {f:'filter',name:FILTER_WORDS[fw]};
  if(/\b(reset|clear|remove)\b.*\b(filters?|adjustments?|edits?)\b/.test(x)||/\boriginal look\b/.test(x))return {f:'reset'};
  const down=/\b(less|decrease|reduce|lower|remove)\b/;
  if(/\b(brighter|brighten)\b/.test(x))return {f:'adj',key:'bright',d:20};
  if(/\b(darker|darken)\b/.test(x))return {f:'adj',key:'bright',d:-20};
  if(/\bbrightness\b/.test(x))return {f:'adj',key:'bright',d:down.test(x)?-20:20};
  if(/\bcontrast\b/.test(x))return {f:'adj',key:'contrast',d:down.test(x)?-20:20};
  if(/\b(desaturate|less colou?r\w*|less saturat\w*|muted)\b/.test(x))return {f:'adj',key:'sat',d:-20};
  if(/\b(saturat\w*|colou?rful|more colou?r\w*)\b/.test(x))return {f:'adj',key:'sat',d:down.test(x)?-20:20};
  if(/\b(warmer|more warmth)\b/.test(x))return {f:'adj',key:'warm',d:20};
  if(/\b(cooler|colder|less warmth)\b/.test(x))return {f:'adj',key:'warm',d:-20};
  if(/\bvignette\b/.test(x))return {f:'adj',key:'vig',d:down.test(x)?-20:20};
  return null;
}
/*CMD-TEST-END*/
function runEdit(a){
  if(!L.edit.has()){L.go('edit');return 'Open or choose a photo first, then ask again.'}
  if(a.f==='filter')L.edit.filter(a.name);
  else if(a.f==='reset')L.edit.reset();
  else L.edit.adjust(a.key,a.d);
  L.go('edit');
  return a.f==='filter'?a.name+' filter applied.':a.f==='reset'?'Back to the original look.':'Done.';
}
const CMDS=[
  [/\b(open|go to|show|take me to)\b.*\b(edit|editor|photo|photos|picture|pictures)\b/,()=>{L.go('edit');return 'Opening the photo editor.'}],
  [/\b(open|go to|show|take me to)\b.*\b(files?|folders?|documents?)\b/,()=>{L.go('chat');if(L.openFiles)L.openFiles();return 'Here are your files.'}],
  [/\b(open|go to|show|take me to)\b.*\bchat\b/,()=>{L.go('chat');return 'Opening chat.'}],
  [/\b(open|go to|show|take me to)\b.*\bvoice\b/,()=>{L.go('voice');return 'Opening voice.'}],
  [/\b(new chat|start over|clear (the )?chat)\b/,()=>{L.click('newChat');return 'Started a new chat.'}],
  [/\bundo\b/,()=>{L.click('undo');return 'Undone.'}],
  [/\b(save|download|export)\b.*\b(photo|picture|image)\b/,()=>{L.click('save');return 'Saving your photo.'}]
];
function tryCommand(t){
  const x=t.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu,' ').replace(/\s+/g,' ').trim();
  if(/\b(stop listening|turn off (the )?(wake|hi lumi|listening|microphone|mic)|disable (the )?wake)\b/.test(x)){
    if(prefs.wake){stopWake();return "Okay, I've stopped listening for Hi Lumi."}
    return "I wasn't listening for the wake word.";
  }
  if(/^(help|what can you do|what are your commands|commands)$/.test(x))
    return 'I can open YouTube, Spotify, Google and Maps, call or text your contacts, open the editor, chat or your files, apply filters like noir, and adjust brightness, contrast or warmth. Or ask me anything.';
  if(L.apps){const a=L.apps.handle(t);if(a!==null)return a}       // YouTube, Spotify, Google, calls, texts
  for(const [re,fn] of CMDS)if(re.test(x))return fn();
  const ed=matchEdit(x);if(ed)return runEdit(ed);
  return null;
}

/* ================= listening ================= */
const ERR={
  'not-allowed':'Microphone or speech recognition is blocked. Allow it in your browser settings.',
  'service-not-allowed':'Speech recognition is blocked in this browser.',
  'network':'Speech recognition needs an internet connection.',
  'audio-capture':'I could not find a microphone.',
  'no-speech':"I didn't hear anything."
};
async function listen(){
  if(vstate!=='idle')return;
  if(!SR){setState('idle','Voice input is not supported in this browser. Try Chrome, Edge or Safari.');return}
  if(prefs.lock&&!vp){openLock();return}
  vheard.textContent='';
  try{
    if(lockOn()){const st=await getStream();cap=Capture(st,r=>orb.style.setProperty('--lvl',Math.min(1,r*8)))}
  }catch(e){setState('idle','Microphone access was blocked.');return}
  const r=new SR();rec=r;r.lang=navigator.language||'en-US';r.interimResults=true;r.continuous=false;r.maxAlternatives=1;
  let text='',err='';
  r.onresult=ev=>{let t='';for(let i=0;i<ev.results.length;i++)t+=ev.results[i][0].transcript;text=t;vheard.textContent=t?'“'+t.trim()+'”':''};
  r.onerror=ev=>{err=ev.error||'error'};
  r.onend=()=>{rec=null;finishListening(text.trim(),err)};
  const hadWake=prefs.wake;setState('listening');
  if(hadWake)await new Promise(res=>setTimeout(res,250));
  try{r.start()}catch(e){if(cap){cap.stop();cap=null}setState('idle')}
}
async function finishListening(text,err){
  const sum=cap?cap.stop():null;cap=null;
  if(err&&err!=='aborted'){setState('idle',ERR[err]||'Something went wrong with the microphone.');return}
  if(!text){setState('idle',ERR['no-speech']);return}
  if(lockOn()){
    const res=verifyWith(vp,prefs.sens,sum);
    if(!res.ok){
      orb.classList.add('deny');setTimeout(()=>orb.classList.remove('deny'),500);
      vheard.textContent='';
      setState('idle',res.why==='short'?'Say a little more so I can check your voice.':"That didn't sound like you, so I ignored it.");
      return;
    }
  }
  handle(text);
}
async function handle(text){
  const cmd=tryCommand(text);
  if(cmd!==null){
    vsay.textContent=cmd;if(curTab!=='voice')L.toast(cmd);
    if(prefs.speak)speak(cmd,true);else setState('idle');return;
  }
  if(!L.hasChat()){
    const m="Chat isn't connected yet. Add a chat endpoint in config.js. I can still open the editor, your files, undo and save by voice.";
    vsay.textContent=m;if(curTab!=='voice')L.toast(m);setState('idle');return;
  }
  setState('thinking');vsay.textContent='';
  const reply=await L.converse(text,{voice:true});
  if(!reply){setState('idle');return}
  vsay.textContent=reply;
  if(prefs.speak)speak(reply,true);else afterSpeak();
}
orb.addEventListener('click',()=>{
  if(vstate==='idle')listen();
  else if(vstate==='listening'&&rec){try{rec.stop()}catch(e){}}
  else if(vstate==='speaking'){stopSpeaking();setState('idle')}
});
function stopAll(){
  if(rec){try{rec.abort()}catch(e){}rec=null}
  if(cap){cap.stop();cap=null}
  stopSpeaking();
  if(!prefs.wake)releaseMic();
  if(vstate!=='thinking')setState('idle');
}
window.addEventListener('lumi:tab',e=>{curTab=e.detail;if(curTab!=='voice')stopAll()});
window.addEventListener('lumi:sheetclose',()=>{if(vstate!=='listening')releaseMic()});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){stopAll();pauseWake()}
  else if(prefs.wake){lockScreen();resumeWake()}
});

/* ================= "Hi Lumi" wake word ================= */
/* Works only while this page is open and the screen is on (a web page cannot listen in the background). */
let actx=null;
function beep(freqs){
  try{
    actx=actx||new (window.AudioContext||window.webkitAudioContext)();if(actx.state==='suspended')actx.resume();
    const t=actx.currentTime;
    (freqs||[880,1320]).forEach((f,i)=>{
      const o=actx.createOscillator(),g=actx.createGain(),s=t+i*.11;
      o.type='sine';o.frequency.value=f;g.gain.setValueAtTime(0,s);g.gain.linearRampToValueAtTime(.2,s+.015);g.gain.exponentialRampToValueAtTime(.0001,s+.17);
      o.connect(g);g.connect(actx.destination);o.start(s);o.stop(s+.19);
    });
  }catch(e){}
}
async function lockScreen(){
  try{if('wakeLock' in navigator&&!wake.wl){wake.wl=await navigator.wakeLock.request('screen');wake.wl.addEventListener('release',()=>{wake.wl=null})}}catch(e){}
}
function unlockScreen(){try{wake.wl&&wake.wl.release()}catch(e){}wake.wl=null}
function updateBadge(){
  const b=$('#wakeBadge');b.hidden=!prefs.wake;b.classList.toggle('armed',wake.armed);
  $('#wakeTxt').textContent=wake.armed?'Yes? Go ahead':wake.paused?'Wake word paused':'Listening for “Hi Lumi”';
  setSwitch('#swWake',prefs.wake);
}
async function syncWakeCap(){
  if(!prefs.wake)return;
  try{
    if(lockOn()&&!wake.cap){const st=await getStream();wake.cap=Capture(st)}
    else if(!lockOn()&&wake.cap){wake.cap.stop();wake.cap=null}
  }catch(e){}
}
async function startWake(){
  if(!SR){L.toast('The wake word needs speech recognition. Try Chrome, Edge or Safari.');return}
  if(!window.isSecureContext){L.toast('The wake word needs HTTPS or localhost');return}
  try{if(lockOn()){const st=await getStream();wake.cap=Capture(st)}}
  catch(e){L.toast('Microphone access was blocked.');return}
  prefs.wake=true;wake.paused=false;wake.armed=false;
  beep([660]);lockScreen();updateBadge();loopWake();
  L.toast('Say “Hi Lumi”. The microphone stays on while this page is open.');
}
function stopWake(){
  prefs.wake=false;wake.armed=false;clearTimeout(wake.armT);clearTimeout(wake.resumeT);
  if(wake.sr){try{wake.sr.abort()}catch(e){}wake.sr=null}
  if(wake.cap){wake.cap.stop();wake.cap=null}
  unlockScreen();if(vstate==='idle')releaseMic();updateBadge();
}
function pauseWake(){
  if(!prefs.wake)return;
  clearTimeout(wake.resumeT);wake.paused=true;
  if(wake.sr){try{wake.sr.abort()}catch(e){}wake.sr=null}
  updateBadge();
}
function resumeWake(){
  if(!prefs.wake)return;
  clearTimeout(wake.resumeT);
  wake.resumeT=setTimeout(()=>{
    if(!prefs.wake||vstate!=='idle'||document.hidden||wake.sr)return;
    if(prefs.hands&&curTab==='voice')return;                 // hands-free conversation takes the mic
    wake.paused=false;wake.armed=false;if(wake.cap)wake.cap.take();   // drop anything recorded while Lumi spoke
    updateBadge();loopWake();
  },400);
}
function loopWake(){
  if(!prefs.wake||wake.paused||document.hidden||wake.sr)return;
  const r=new SR();wake.sr=r;
  r.lang=navigator.language||'en-US';r.continuous=true;r.interimResults=true;r.maxAlternatives=1;
  const done=new Set(),early=new Set();let err='';
  r.onresult=ev=>{
    for(let i=ev.resultIndex;i<ev.results.length;i++){
      const res=ev.results[i],t=res[0].transcript;
      if(res.isFinal){if(!done.has(i)){done.add(i);onWakeFinal(t,i,early)}}
      else if(!wake.armed&&!early.has(i)&&findWake(t)){early.add(i);beep()}      // quick "ding" as soon as it hears you
    }
  };
  r.onerror=e=>{err=e.error||'error'};
  r.onend=()=>{
    if(wake.sr===r)wake.sr=null;
    if(!prefs.wake||wake.paused)return;
    if(err==='not-allowed'||err==='service-not-allowed'||err==='audio-capture'){
      stopWake();L.toast('The wake word needs microphone access.');return;
    }
    setTimeout(loopWake,err==='network'?3000:err==='no-speech'?250:600);   // browsers end long sessions; start again
  };
  try{r.start()}catch(e){wake.sr=null;setTimeout(loopWake,1000)}
}
function onWakeFinal(text,idx,early){
  const sum=wake.cap?wake.cap.take():null;
  const w=findWake(text);
  if(w){
    if(!early.has(idx))beep();
    clearTimeout(wake.armT);
    if(w.rest){wake.armed=false;fireWake(w.rest,sum)}
    else{wake.armed=true;wake.armT=setTimeout(()=>{wake.armed=false;updateBadge();beep([440])},8000)}
  }else if(wake.armed){
    clearTimeout(wake.armT);wake.armed=false;fireWake(text.trim(),sum);
  }
  updateBadge();
}
function fireWake(text,sum){
  if(!text)return;
  if(lockOn()){
    const res=verifyWith(vp,prefs.sens,sum,10);
    if(!res.ok){
      beep([300]);orb.classList.add('deny');setTimeout(()=>orb.classList.remove('deny'),500);
      L.toast(res.why==='short'?'Say a little more so I can check your voice.':"That didn't sound like you, so I ignored it.");
      return;
    }
  }
  pauseWake();vheard.textContent='“'+text+'”';handle(text);
}

/* ================= switches ================= */
$('#swWake').addEventListener('click',()=>{prefs.wake?stopWake():startWake()});
$('#wakeBadge').addEventListener('click',stopWake);
$('#swSpeak').addEventListener('click',()=>{prefs.speak=!prefs.speak;if(!prefs.speak)stopSpeaking();savePrefs();refreshUI()});
$('#swHands').addEventListener('click',()=>{prefs.hands=!prefs.hands;savePrefs();refreshUI()});
$('#swLock').addEventListener('click',()=>{
  if(!vp){openLock();return}
  prefs.lock=!prefs.lock;savePrefs();refreshUI();
});
$('#lockSetup').addEventListener('click',openLock);
$('#vFiles').addEventListener('click',()=>{if(L.openFiles)L.openFiles()});
$('#spk').addEventListener('click',()=>{prefs.speakChat=!prefs.speakChat;if(!prefs.speakChat)stopSpeaking();savePrefs();refreshUI();L.toast(prefs.speakChat?'Chat replies will be read aloud':'Chat replies are silent')});

/* ================= voice lock sheet ================= */
const PHRASES=[
  'The quick brown fox jumps over the lazy dog.',
  "Hey Lumi, what's the weather like today?",
  'My voice is my own, and only I should unlock this.',
  'Please open my photos and clean up the picture.'
];
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}
function openLock(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){L.toast('This browser has no microphone access');return}
  L.openSheet('Voice lock',body=>vp?renderManage(body):renderEnroll(body));
}
function renderManage(body){
  body.innerHTML='';
  body.appendChild(el('p','note','Lumi only acts on speech that matches your recorded voice. It is a convenience filter, not a security lock: a recording of you or a very similar voice can get through.'));
  const seg=el('div','seg');
  [['strict','Strict'],['balanced','Balanced'],['relaxed','Relaxed']].forEach(([k,t])=>{
    const b=el('button',prefs.sens===k?'on':'',t);
    b.onclick=()=>{prefs.sens=k;savePrefs();[...seg.children].forEach(c=>c.classList.toggle('on',c===b))};
    seg.appendChild(b);
  });
  body.appendChild(seg);
  body.appendChild(el('p','note','Strict rejects more of your own voice on a bad day. Relaxed lets in more lookalikes.'));
  const row=el('div','btnrow');
  const re=el('button','pill glass small','Re-record my voice');re.onclick=()=>renderEnroll(body);
  const del=el('button','pill glass small danger','Delete my voiceprint');
  del.onclick=()=>{vp=null;prefs.lock=false;store.del('lumi.voiceprint');savePrefs();refreshUI();L.closeSheet();L.toast('Voiceprint deleted')};
  row.append(re,del);body.appendChild(row);
}
function renderEnroll(body){
  body.innerHTML='';
  const samples=[];
  body.appendChild(el('p','note','Read each phrase aloud in your normal voice, in a quiet place. Lumi keeps a short list of numbers about your voice on this device. No audio is saved.'));
  const dots=el('div','dots4');for(let i=0;i<PHRASES.length;i++)dots.appendChild(el('i'));
  const phrase=el('div','phrase',PHRASES[0]);
  const meter=el('div','meter');const bar=el('i');meter.appendChild(bar);
  const status=el('p','note','Tap Record, then read the phrase.');status.style.textAlign='center';
  const btn=el('button','pill primary','Record');btn.style.cssText='display:block;margin:0 auto';
  body.append(dots,phrase,meter,status,btn);
  let busy=false;
  btn.onclick=async()=>{
    if(busy)return;busy=true;btn.disabled=true;status.textContent='Listening… read the phrase now';
    let c;
    try{const st=await getStream();c=Capture(st,r=>{bar.style.transform='scaleX('+Math.min(1,r*10)+')'})}
    catch(e){status.textContent='Microphone access was blocked. Allow it in your browser settings.';busy=false;btn.disabled=false;return}
    await new Promise(r=>setTimeout(r,4500));
    const sum=c.stop();bar.style.transform='scaleX(0)';
    if(!sum||sum.n<20){status.textContent="I couldn't hear enough. Move closer and try this phrase again.";busy=false;btn.disabled=false;return}
    samples.push(sum.vec);dots.children[samples.length-1].classList.add('on');
    if(samples.length<PHRASES.length){
      phrase.textContent=PHRASES[samples.length];status.textContent='Got it. Next phrase.';btn.textContent='Record';
      busy=false;btn.disabled=false;
    }else{
      vp=buildPrint(samples);store.set('lumi.voiceprint',vp);prefs.lock=true;savePrefs();refreshUI();
      L.closeSheet();L.toast('Voice lock is on');
    }
  };
}

refreshUI();
if(!SR)vstatus.textContent='Voice input is not supported in this browser';
if('speechSynthesis' in window)speechSynthesis.getVoices();
})();
