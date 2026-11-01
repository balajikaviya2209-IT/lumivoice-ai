/* Lumi AI: permission-based file access.
   Lumi can only see what you pick. Folder access is read-only and stored as a handle,
   not a copy. Depends on window.Lumi (exposed by index.html). */
(function(){
'use strict';
const L=window.Lumi; if(!L)return;
const TEXT=/\.(txt|md|markdown|json|csv|tsv|log|js|mjs|ts|jsx|tsx|py|rb|go|java|c|h|cpp|html?|css|xml|ya?ml|sql|sh|ini|toml)$/i;
const IMG=/\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const canDir=typeof window.showDirectoryPicker==='function';
let root=null,stack=[],loose=[],body=null;

/* remember the folder handle across visits (the browser still asks again after a restart) */
function db(){return new Promise((res,rej)=>{const r=indexedDB.open('lumi-fs',1);r.onupgradeneeded=()=>r.result.createObjectStore('h');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function idb(mode,fn){try{const d=await db();return await new Promise((res,rej)=>{const q=fn(d.transaction('h',mode).objectStore('h'));q.onsuccess=()=>res(q.result||null);q.onerror=()=>rej(q.error)})}catch(e){return null}}
const idbGet=k=>idb('readonly',s=>s.get(k)), idbSet=(k,v)=>idb('readwrite',s=>s.put(v,k)), idbDel=k=>idb('readwrite',s=>s.delete(k));

function h(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e}

async function handleFile(file){
  if(file.type.startsWith('image/')||IMG.test(file.name)){L.closeSheet();L.go('edit');await L.loadFile(file);return}
  if(file.type.startsWith('text/')||TEXT.test(file.name)){
    if(file.size>2e6){L.toast('That file is too large to attach (2 MB max)');return}
    let t=await file.text();const cut=t.length>20000;t=t.slice(0,20000)+(cut?'\n[truncated]':'');
    L.setAttach({name:file.name,text:t});L.closeSheet();L.go('chat');
    L.toast(cut?'Attached the first 20,000 characters':'Attached '+file.name);return;
  }
  L.toast('Lumi can read images and text files for now');
}
async function listDir(dir){
  const out=[];
  for await(const [name,hd] of dir.entries()){out.push({name,hd});if(out.length>=300)break}
  out.sort((a,b)=>a.hd.kind===b.hd.kind?a.name.localeCompare(b.name):a.hd.kind==='directory'?-1:1);
  return out;
}
function badge(name,kind){
  if(kind==='directory')return ['dir','DIR'];
  if(IMG.test(name))return ['img','IMG'];
  if(TEXT.test(name))return ['txt','TXT'];
  const m=/\.([a-z0-9]{1,4})$/i.exec(name);return ['',m?m[1].toUpperCase():'FILE'];
}
function row(name,kind,onTap){
  const r=h('button','fr'),[c,t]=badge(name,kind);
  r.append(h('span','fb '+c,t),h('span','nm',name));r.onclick=onTap;return r;
}
function chooseFiles(){
  const i=document.createElement('input');i.type='file';i.multiple=true;
  i.onchange=()=>{loose=[...i.files];render()};i.click();
}
async function connect(){
  try{
    const dir=await window.showDirectoryPicker({mode:'read'});     // read-only: Lumi can never change your files
    root=dir;stack=[dir];await idbSet('dir',dir);loose=[];render();
  }catch(e){/* cancelled */}
}
async function render(){
  if(!body)return;
  body.innerHTML='';
  body.appendChild(h('p','note','Lumi only sees what you choose here. Your browser will ask you to confirm. Text you attach is sent to your chat endpoint.'));
  const btns=h('div','btnrow');
  const b1=h('button','pill glass small','Choose files');b1.onclick=chooseFiles;btns.appendChild(b1);
  if(canDir){const b2=h('button','pill primary small',root?'Choose another folder':'Allow access to a folder');b2.onclick=connect;btns.appendChild(b2)}
  const b3=h('button','pill glass small','Photo editor');b3.onclick=()=>{L.closeSheet();L.go('edit')};btns.appendChild(b3);
  body.appendChild(btns);
  if(!canDir)body.appendChild(h('p','note','Folder access needs Chrome, Edge or another Chromium browser. You can still choose files one at a time.'));

  if(root){
    let perm='prompt';try{perm=await root.queryPermission({mode:'read'})}catch(e){}
    const head=h('div','fhead');
    if(stack.length>1){const up=h('button','pill glass small','‹ Back');up.onclick=()=>{stack.pop();render()};head.appendChild(up)}
    head.appendChild(h('span','',stack[stack.length-1].name||root.name));
    const dc=h('button','pill glass small danger','Disconnect');
    dc.onclick=async()=>{await idbDel('dir');root=null;stack=[];render();L.toast('Folder disconnected. You can also remove it in your browser\'s site settings.')};
    head.appendChild(dc);body.appendChild(head);
    if(perm!=='granted'){
      const rc=h('button','pill primary small','Reconnect “'+root.name+'”');
      rc.onclick=async()=>{try{await root.requestPermission({mode:'read'})}catch(e){}render()};
      body.appendChild(rc);return;
    }
    const list=h('div','fl');body.appendChild(list);
    try{
      const items=await listDir(stack[stack.length-1]);
      if(!items.length)list.appendChild(h('p','note','This folder is empty.'));
      for(const it of items){
        list.appendChild(row(it.name,it.hd.kind,async()=>{
          try{
            if(it.hd.kind==='directory'){stack.push(it.hd);render()}
            else await handleFile(await it.hd.getFile());
          }catch(e){L.toast("Couldn't open that")}
        }));
      }
    }catch(e){list.appendChild(h('p','note',"Couldn't read this folder."))}
  }else if(loose.length){
    const list=h('div','fl');body.appendChild(list);
    loose.forEach(f=>list.appendChild(row(f.name,'file',()=>handleFile(f))));
  }
}
L.openFiles=async function(){
  if(!root){const saved=await idbGet('dir');if(saved){root=saved;stack=[saved]}}
  L.openSheet('Files',b=>{body=b;render()});
};
window.addEventListener('lumi:sheetclose',()=>{body=null});
})();
