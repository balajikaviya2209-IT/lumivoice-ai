/* Lumi AI: voice shortcuts to other apps (YouTube, Spotify, Google, Maps, calls, texts...).
   A web page cannot press buttons inside other apps. What it can do is open their links, which
   the phone hands to the installed app. Calls and messages always need one tap from you.
   Depends on window.Lumi (exposed by index.html). */
(function(){
'use strict';
const L=window.Lumi; if(!L)return;

/*APPS-TEST-BEGIN*/
const APPS={
  youtube:{name:'YouTube',home:'https://www.youtube.com/',search:q=>'https://www.youtube.com/results?search_query='+encodeURIComponent(q)},
  spotify:{name:'Spotify',home:'https://open.spotify.com/',search:q=>'https://open.spotify.com/search/'+encodeURIComponent(q)},
  google:{name:'Google',home:'https://www.google.com/',search:q=>'https://www.google.com/search?q='+encodeURIComponent(q)},
  maps:{name:'Maps',home:'https://www.google.com/maps',search:q=>'https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(q)},
  gmail:{name:'Gmail',home:'https://mail.google.com/'},
  whatsapp:{name:'WhatsApp',home:'https://wa.me/'},
  instagram:{name:'Instagram',home:'https://www.instagram.com/'},
  facebook:{name:'Facebook',home:'https://www.facebook.com/'},
  netflix:{name:'Netflix',home:'https://www.netflix.com/'},
  x:{name:'X',home:'https://x.com/'}
};
const ALIAS={'google maps':'maps','twitter':'x','you tube':'youtube'};
const NAV_BLOCK=/\b(editor|edit|chat|voice|files?|folders?|photos?)\b/i;

function parse(raw){
  const t=raw.trim().replace(/\byou tube\b/ig,'youtube').replace(/^(?:hey |hi |ok |okay )?please\s+/i,'').replace(/[.!?,]+$/,'').trim();
  let m;
  if((m=/^(?:call|phone|dial|ring)\s+(.+)$/i.exec(t)))
    return {kind:'call',target:m[1].replace(/\s+(?:on|using)\s+(?:my\s+)?phone$/i,'').trim()};
  if((m=/^(?:send\s+(?:a\s+)?(?:(?:text|sms|whatsapp)\s+)?(?:message\s+)?to|text|sms|whatsapp|message)\s+(.+)$/i.exec(t))){
    const wa=/whatsapp/i.test(t);
    const rest=m[1].replace(/\s+(?:on|via|using|in)\s+whatsapp\b/ig,'').trim();
    const parts=rest.split(/\s+(?:saying|that says|and say|and tell (?:him|her|them)|with the message)\s+|:\s*/i);
    return {kind:'msg',via:wa?'wa':'sms',target:parts[0].trim(),body:parts.slice(1).join(' ').trim()};
  }
  if((m=/^(?:navigate to|navigate|directions to|directions|take me to|get me to|drive to|route to)\s+(.+)$/i.exec(t))&&!NAV_BLOCK.test(m[1]))
    return {kind:'nav',query:m[1].trim()};
  for(const key of ['youtube','spotify']){
    if(!new RegExp(key,'i').test(t))continue;
    let q=null;
    if(new RegExp('^(?:open|launch|start|go to)\\s+(?:the\\s+)?'+key+'(?:\\s+app)?$','i').test(t))return {kind:'app',app:key,query:null};
    if((m=new RegExp('^(?:open|launch|start)\\s+'+key+'\\s+(?:and\\s+)?(?:play|search(?:\\s+for)?|find)\\s+(.+)$','i').exec(t)))q=m[1];
    else if((m=new RegExp('^(?:play|watch|search|find|show me|look up|put on|listen to)\\s+(.+?)\\s+(?:on|in|using|via|with|from)\\s+(?:the\\s+)?'+key+'(?:\\s+app)?$','i').exec(t)))q=m[1];
    else if((m=new RegExp('^(?:search|find|look up)\\s+(?:on\\s+)?'+key+'\\s+(?:for\\s+)?(.+)$','i').exec(t)))q=m[1];
    else if((m=new RegExp('^'+key+'\\s+(?:play\\s+|search\\s+(?:for\\s+)?)?(.+)$','i').exec(t)))q=m[1];
    if(q)return {kind:'app',app:key,query:q.trim()};
  }
  if((m=/^google\s+(.+)$/i.exec(t)))return {kind:'app',app:'google',query:m[1].trim()};
  if((m=/^(?:search(?:\s+(?:google|the web|the internet|online))?(?:\s+for)?|look up)\s+(.+?)(?:\s+(?:on|in|using)\s+google)?$/i.exec(t)))
    return {kind:'app',app:'google',query:m[1].trim()};
  if((m=/^play\s+(.+)$/i.exec(t)))return {kind:'app',app:'youtube',query:m[1].trim(),implicit:true};
  if((m=/^(?:open|launch|start|go to)\s+(?:the\s+)?(.+?)(?:\s+app)?$/i.exec(t))){
    const n=m[1].toLowerCase().trim(),key=ALIAS[n]||n;
    if(APPS[key])return {kind:'app',app:key,query:null};
    if(/^(?:my\s+)?contacts$/.test(n))return {kind:'contacts'};
  }
  if(/^(?:show|manage|edit)\s+(?:my\s+)?contacts$/i.test(t))return {kind:'contacts'};
  return null;
}
function numberFrom(s){
  const W={zero:0,oh:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9};
  const t=s.toLowerCase().replace(/\bplus\b/g,'+').replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g,m=>W[m]);
  const d=t.replace(/[^\d+]/g,''),digits=d.replace(/\D/g,'');
  if(digits.length<5||digits.length>15)return null;
  return (d[0]==='+'?'+':'')+digits;
}
function findContact(name,list){
  const norm=x=>x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,' ').replace(/\s+/g,' ').trim();
  let n=norm(name).replace(/^(?:my|to)\s+/,'');
  if(n==='mum'||n==='mummy'||n==='mother')n='mom';
  if(!n)return null;
  const same=c=>{const x=norm(c.name);return x===n||(n==='mom'&&(x==='mum'||x==='mother'||x==='mummy'))};
  return list.find(same)||list.find(c=>norm(c.name).startsWith(n))||list.find(c=>norm(c.name).split(' ').includes(n))||list.find(c=>norm(c.name).includes(n))||null;
}
/*APPS-TEST-END*/

/* ---------- contacts (stored on this device only) ---------- */
function contacts(){try{return JSON.parse(localStorage.getItem('lumi.contacts')||'[]')}catch(e){return []}}
function saveContacts(l){try{localStorage.setItem('lumi.contacts',JSON.stringify(l))}catch(e){}}
function cleanNum(s){const p=String(s).trim().startsWith('+')?'+':'';return p+String(s).replace(/\D/g,'')}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}

function openContacts(){L.openSheet('Contacts',renderContacts)}
function renderContacts(b){
  b.innerHTML='';
  b.appendChild(el('p','note','Saved on this device only and never sent to the chat server. Say “call Mom” or “text Dad saying I’m late”. Include the country code (like +91…) so WhatsApp works.'));
  const list=contacts(),box=el('div','fl');
  if(!list.length)box.appendChild(el('p','note','No contacts yet.'));
  list.forEach((c,i)=>{
    const r=el('div','fr');const info=el('span','nm',c.name+'  ·  '+c.number);
    const del=el('button','pill glass small danger','Remove');del.onclick=()=>{const l=contacts();l.splice(i,1);saveContacts(l);renderContacts(b)};
    r.append(info,del);box.appendChild(r);
  });
  b.appendChild(box);
  const name=el('input','fld');name.placeholder='Name';name.autocomplete='off';
  const num=el('input','fld');num.placeholder='Phone number, e.g. +14155550123';num.type='tel';
  num.style.marginTop='8px';
  const add=el('button','pill primary small','Save contact');add.style.marginTop='10px';
  add.onclick=()=>{
    const nm=name.value.trim(),nn=cleanNum(num.value);
    if(!nm||nn.replace(/\D/g,'').length<5){L.toast('Enter a name and a valid number');return}
    const l=contacts().filter(c=>c.name.toLowerCase()!==nm.toLowerCase());l.push({name:nm,number:nn});saveContacts(l);renderContacts(b);
  };
  b.append(name,num,add);
  if('contacts' in navigator&&'ContactsManager' in window){
    const imp=el('button','pill glass small','Import from phone');imp.style.cssText='margin:10px 0 0 8px';
    imp.onclick=async()=>{
      try{
        const res=await navigator.contacts.select(['name','tel'],{multiple:true});const l=contacts();
        for(const r of res){const nm=(r.name&&r.name[0])||'',tel=(r.tel&&r.tel[0])||'';if(nm&&tel&&!l.some(c=>c.name===nm))l.push({name:nm,number:cleanNum(tel)})}
        saveContacts(l);renderContacts(b);
      }catch(e){}
    };
    b.appendChild(imp);
  }
}

/* ---------- action card: one tap to confirm ---------- */
let card=null,cardT=0;
function hideCard(){if(card)card.classList.remove('show')}
function showCard(a){
  if(!card){card=document.createElement('div');card.id='actionCard';card.className='glass';card.setAttribute('role','alert');document.getElementById('app').appendChild(card)}
  card.innerHTML='';
  const info=el('div','ac-info');info.append(el('b','',a.title),el('small','',a.detail||''));
  const go=el('a','pill primary small',a.btn);go.href=a.url;
  if(/^https?:/i.test(a.url)){go.target='_blank';go.rel='noopener noreferrer'}
  go.addEventListener('click',()=>setTimeout(hideCard,300));
  const no=el('button','pill glass small','Cancel');no.onclick=hideCard;
  card.append(info,go,no);
  requestAnimationFrame(()=>card.classList.add('show'));
  clearTimeout(cardT);cardT=setTimeout(hideCard,45000);
}
function tryOpen(url){
  try{const w=window.open(url,'_blank');if(w){try{w.opener=null}catch(e){}return true}}catch(e){}
  return false;                                    // blocked: browsers need a tap to launch another app
}

/* ---------- run a spoken command; returns what Lumi should say, or null if it isn't ours ---------- */
function resolvePerson(target){
  const n=numberFrom(target);if(n)return {number:n,label:n};
  const c=findContact(target,contacts());
  return c?{number:cleanNum(c.number),label:c.name}:null;
}
function handle(raw){
  const p=parse(raw);if(!p)return null;
  if(p.kind==='contacts'){openContacts();return 'Here are your contacts.'}
  if(p.kind==='app'||p.kind==='nav'){
    const A=p.kind==='nav'?APPS.maps:APPS[p.app];
    const url=p.kind==='nav'?'https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(p.query):(p.query&&A.search?A.search(p.query):A.home);
    const what=p.kind==='nav'?'directions to '+p.query:p.query;
    const shown=tryOpen(url);
    if(!shown)showCard({title:p.kind==='nav'?'Directions to '+p.query:'Open '+A.name,detail:p.query&&p.kind!=='nav'?p.query:A.name,btn:p.kind==='nav'?'Navigate':'Open',url});
    const say=p.kind==='nav'?'Getting directions to '+p.query+'.':p.query?(p.app==='google'?'Searching Google for ':p.app==='spotify'?'Searching Spotify for ':'Opening '+A.name+' for ')+p.query+'.':'Opening '+A.name+'.';
    return say+(shown?'':' Tap the button to continue.');
  }
  if(p.kind==='call'){
    const who=resolvePerson(p.target);
    if(!who)return "I don't have a number for "+p.target+". Add them in Contacts, or say the number.";
    showCard({title:'Call '+who.label,detail:who.number,btn:'Call',url:'tel:'+who.number});
    return 'Calling '+who.label+'. Tap Call to confirm.';
  }
  if(p.kind==='msg'){
    const who=resolvePerson(p.target);
    if(!who)return "I don't have a number for "+p.target+". Add them in Contacts, or say the number.";
    if(!p.body)return 'What should the message say? Try: text '+p.target+' saying I will be late.';
    const url=p.via==='wa'?'https://wa.me/'+who.number.replace(/\D/g,'')+'?text='+encodeURIComponent(p.body):'sms:'+who.number+'?&body='+encodeURIComponent(p.body);
    showCard({title:(p.via==='wa'?'WhatsApp ':'Text ')+who.label,detail:'“'+p.body+'”',btn:'Review & send',url});
    return 'Message to '+who.label+' is ready. Tap to review and send.';
  }
  return null;
}
L.apps={handle,openContacts};
const vc=document.getElementById('vContacts');if(vc)vc.addEventListener('click',openContacts);
})();
