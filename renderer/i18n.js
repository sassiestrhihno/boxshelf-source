// Interface language (Settings → Display → Language). Translates the UI as it's drawn instead of touching the strings in
// the code: text nodes and the placeholder / title / aria-label attributes whose whole text (trimmed) is in the chosen
// language's dictionary (renderer/locales/<lang>.js, window.BS_LOCALES[lang] = { strings: {en: tr}, rules: [[RegExp, tr]] }).
// Exact matches only, so game titles, paths and anything the player typed are never changed. English is the code itself:
// with ui.lang 'en' (or 'auto' on a non-matching system) this file does nothing. Text drawn on a canvas goes through the
// same dictionary (see fillText below). An element (or any ancestor) with data-no-i18n is left alone.
(function(){
"use strict";
const LS_KEY="bs-lang";
const ATTRS=["placeholder","title","aria-label","data-st"]; // data-st: the setup sidebar's status word, shown by CSS attr()
const SKIP=new Set(["SCRIPT","STYLE","TEXTAREA","INPUT","SELECT","CODE","PRE","CANVAS","SVG"]);
let lang="en",dict=null,rules=[],obs=null,mine=0; // mine: texts translated so far
const memo=new Map(); // text → its pattern translation (or null): the shelf redraws the same strings over and over
let upper=null; // the dictionary by its keys in capitals, built the first time an ALL CAPS text comes by
// node → { o: original English, t: what we put there }: a node whose text is still our own translation is left alone,
// one the app rewrote is translated again, and switching back to English puts the originals back
const orig=new WeakMap(),attrOrig=new WeakMap();
const norm=s=>s.replace(/\s+/g," ").trim();

function supported(l){return !!(window.BS_LOCALES&&window.BS_LOCALES[l])}
function resolve(v){
  if(v&&v!=="auto")return supported(v)?v:"en";
  const nav=String(navigator.language||"").toLowerCase();
  if(nav.startsWith("pt")&&supported("pt-BR"))return "pt-BR";
  return "en";
}
function load(l){
  const L=l!=="en"&&window.BS_LOCALES&&window.BS_LOCALES[l];
  dict=null;rules=[];memo.clear();upper=null;if(!L)return;
  dict=new Map();const s=L.strings||{};
  for(const k in s)if(s[k])dict.set(norm(k),s[k]);
  rules=(L.rules||[]).filter(r=>Array.isArray(r)&&r[0] instanceof RegExp);
  // patterns: {"Use your setup from Boxshelf {0}": "Use a configuração do Boxshelf {0}"}: each {n} matches any text, and
  // goes into the translation translated itself when the dictionary has it (a console or button name stays as it is)
  const P=L.patterns||{};
  for(const k in P){const to=P[k];if(!to)continue;
    const ks=norm(k),order=[];
    const src="^"+ks.split(/(\{\d\})/).map(p=>{const m=/^\{(\d)\}$/.exec(p);if(m){order.push(+m[1]);return "(.+?)"}return p.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}).join("")+"$";
    if(!order.length)continue;
    let re;try{re=new RegExp(src)}catch{continue}
    rules.push([re,(...m)=>{const g={};order.forEach((n,i)=>{const v=m[i+1],t=tr(v);g[n]=t!=null?t:v});return to.replace(/\{(\d)\}/g,(_,n)=>g[n]!=null?g[n]:"")}]);
  }
  // the most specific (longest literal text) first, so "{0} not found yet" wins over "{0} not found"
  rules.sort((a,b)=>b[0].source.replace(/\(\.\+\?\)/g,"").length-a[0].source.replace(/\(\.\+\?\)/g,"").length);
}
// one string: the dictionary first, then the pattern rules (anchored, so only a whole-string match counts)
function tr(src){
  if(!dict||!src)return null;
  const key=norm(src);if(!key||!/[A-Za-z]/.test(key))return null;
  let hit=dict.get(key);
  // ALL CAPS on screen ("MAGAZINES", "IN USE"): the dictionary's own words, in capitals too
  if(hit==null&&key===key.toUpperCase()&&/[A-Z]{3}/.test(key)){
    if(!upper){upper=new Map();for(const [k,v] of dict)if(!upper.has(k.toUpperCase()))upper.set(k.toUpperCase(),v)}
    const u=upper.get(key);if(u!=null)hit=u.toLocaleUpperCase("pt-BR");
  }
  if(hit==null){
    if(memo.has(key))hit=memo.get(key);
    else{
      for(const [re,to] of rules){re.lastIndex=0;const m=re.exec(key);if(m&&m[0]===key){hit=typeof to==="function"?to(...m):key.replace(re,to);break}}
      // a trail or a list built from pieces ("Library › Switch › Emulator & advanced", "Spectrum · Aero"): each piece
      // on its own, the separators kept; only when at least one piece is in the dictionary
      // a comma list ("Action, Adventure, Role-Playing"): only when every item is in the dictionary, so a title with a
      // comma in it is never half translated
      if(hit==null&&/, /.test(key)&&key.length<160){const ps=key.split(", "),ts=ps.map(p=>dict.get(p));if(ts.every(t=>t!=null))hit=ts.join(", ")}
      if(hit==null&&/ [›·|•] /.test(key)){let any=false;
        const out=key.split(/( [›·|•] )/).map(p=>{if(/^ [›·|•] $/.test(p))return p;const t=tr(p);if(t!=null){any=true;return t}return p}).join("");
        if(any)hit=out}
      if(memo.size>4000)memo.clear();memo.set(key,hit==null?null:hit);
    }
  }
  if(hit==null)return null;
  const lead=src.match(/^\s*/)[0],tail=src.match(/\s*$/)[0];return lead+hit+tail;
}
function skipped(el){
  for(let e=el;e&&e.nodeType===1;e=e.parentElement){
    if(SKIP.has(e.tagName.toUpperCase()))return true;
    if(e.hasAttribute("data-no-i18n")||e.isContentEditable)return true;
  }
  return false;
}
function doText(n){
  const cur=n.nodeValue,rec=orig.get(n);
  if(rec&&cur===rec.t)return; // still ours
  const src=cur; // new or rewritten by the app: this is the English
  if(!dict){if(rec&&cur===rec.t)n.nodeValue=rec.o;return}
  if(!n.parentElement||skipped(n.parentElement))return;
  const t=tr(src);
  if(t!=null&&t!==src){orig.set(n,{o:src,t});n.nodeValue=t;mine++}else{orig.delete(n);if(t==null)machine(n,src)}
}
// Game descriptions (free text from the game databases, no dictionary can cover them): main/translate.js translates them
// once each (Settings → Look → Translate game descriptions) and the answer replaces the text if it's still the same one.
// The element gets data-mt, which shows a small "machine translated" note under it.
const MT_SEL="#dDesc";
const mtAsked=new Map(); // English text → its translation (or null), so a description shown again is instant
function machine(n,src){
  const el=n.parentElement,api=window.boxshelf;
  if(!el||!el.matches||!el.matches(MT_SEL)||!api||typeof api.translateText!=="function")return;
  const text=src.trim();if(text.length<20)return;
  const put=t=>{if(!t||lang==="en"||n.nodeValue!==src)return;orig.set(n,{o:src,t});n.nodeValue=t;el.setAttribute("data-mt","");mine++};
  el.removeAttribute("data-mt");
  if(mtAsked.has(text)){put(mtAsked.get(text));return}
  const want=lang;
  Promise.resolve(api.translateText(text,want)).then(t=>{mtAsked.set(text,t||null);if(lang===want)put(t)}).catch(()=>{});
}
// the note under a machine-translated description, in the interface language
(function(){try{const st=document.createElement("style");
  st.textContent='#dDesc[data-mt]::after{content:var(--bs-mt-note,"");display:block;margin-top:.5em;font-size:.72em;opacity:.55;letter-spacing:.01em}';
  (document.head||document.documentElement).appendChild(st)}catch{}})();
function doAttrs(el){
  if(skipped(el))return;
  let rec=attrOrig.get(el);
  for(const a of ATTRS){
    if(!el.hasAttribute(a))continue;
    const cur=el.getAttribute(a);
    if(rec&&rec[a]&&cur===rec[a].t)continue;
    const t=tr(cur);
    if(t!=null&&t!==cur){if(!rec){rec={};attrOrig.set(el,rec)}rec[a]={o:cur,t};el.setAttribute(a,t)}
    else if(rec)delete rec[a];
  }
}
// a problem with one node must never leave the rest of the batch (a whole menu built at once) in English: each node on
// its own, and the first few problems go to the log (boxshelf.log) with the text that caused them
let errs=0;
function report(e,n){if(errs++>=5)return;try{const t=n&&(n.nodeType===3?n.nodeValue:n.textContent);const m=`i18n: ${e&&e.message||e} @ ${String(t||"").slice(0,80)}`;console.warn(m);window.boxshelf&&window.boxshelf.log&&window.boxshelf.log(m)}catch{}}
function walkSafe(root){
  if(!root)return;
  if(root.nodeType===3){try{doText(root)}catch(e){report(e,root)}return}
  if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11)return;
  if(root.nodeType===1){try{if(skipped(root))return;doAttrs(root)}catch(e){report(e,root)}}
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode:n=>n.nodeType===1&&SKIP.has(n.tagName.toUpperCase())?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  let n;while((n=w.nextNode())){try{if(n.nodeType===3)doText(n);else doAttrs(n)}catch(e){report(e,n)}}
}
// The page's changes are translated right in the observer's callback, never later and never with the observer switched
// off: switching it off (to ignore our own edits) threw away whatever the page changed in between, so a menu built by
// async code at the wrong moment stayed in English for good. Our own edits are dropped afterwards with takeRecords(),
// which is safe because no page code can run while this callback does.
function handle(ms){
  const list=new Set();
  for(const m of ms){
    if(m.type==="characterData"||m.type==="attributes")list.add(m.target);
    else for(const n of m.addedNodes)list.add(n);
  }
  if(!dict)return;
  for(const n of list){try{if(n.isConnected)walkSafe(n)}catch(e){report(e,n)}}
  if(obs)obs.takeRecords(); // only our own edits are in there
}
function observe(){
  if(!obs)obs=new MutationObserver(handle);
  obs.observe(document.documentElement,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:ATTRS});
}
// back to English: every node we changed gets its original text again
function restore(root){
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);let n;
  while((n=w.nextNode())){
    if(n.nodeType===3){const r=orig.get(n);if(r&&n.nodeValue===r.t)n.nodeValue=r.o;orig.delete(n)}
    else{const r=attrOrig.get(n);if(r){for(const a in r)if(n.getAttribute(a)===r[a].t)n.setAttribute(a,r[a].o);attrOrig.delete(n)}}
  }
}
function apply(v){
  const l=resolve(v);
  try{localStorage.setItem(LS_KEY,v||"auto")}catch{}
  if(l===lang&&(l==="en"||dict))return;
  if(obs)obs.disconnect();
  if(lang!=="en"&&document.documentElement){restore(document.documentElement);document.querySelectorAll("[data-mt]").forEach(e=>e.removeAttribute("data-mt"))}
  lang=l;load(l);
  if(document.documentElement){document.documentElement.lang=l==="en"?"en":l;
    document.documentElement.style.setProperty("--bs-mt-note",JSON.stringify(tr("Machine translated (Google Translate)")||"Machine translated (Google Translate)"))}
  mtAsked.clear();
  if(dict){if(document.body)walkSafe(document.body);observe()}
  try{const m=`i18n: ${l}${dict?` (${dict.size} strings, ${rules.length} patterns)`:""}`;window.boxshelf&&window.boxshelf.log&&window.boxshelf.log(m)}catch{}
  window.dispatchEvent(new CustomEvent("bs-lang",{detail:{lang:l}}));
}

// Text drawn on a canvas (the museum's plaques, signs and cards, labels on 3D boxes) goes through fillText / strokeText,
// and measureText has to agree with what's drawn for the layout to fit: all three see the translated text. A texture
// already drawn keeps its words until it's drawn again (changing language mid-session repaints the DOM, not the 3D).
(function(){
  const C=window.CanvasRenderingContext2D&&CanvasRenderingContext2D.prototype;if(!C)return;
  const wrap=name=>{const f=C[name];if(typeof f!=="function")return;
    C[name]=function(text,...rest){if(dict&&typeof text==="string"&&text){const t=tr(text);if(t!=null)text=t}return f.call(this,text,...rest)}};
  ["fillText","strokeText","measureText"].forEach(wrap);
})();

window.BsI18n={
  // the setting changed (Settings live preview, or the saved config on start)
  set:apply,
  get lang(){return lang},
  // for code that wants a string in the current language (falls back to the English)
  t:s=>{const r=tr(String(s==null?"":s));return r==null?s:r},
  languages:()=>[["auto","Automatic (system)"],["en","English"],...Object.keys(window.BS_LOCALES||{}).map(k=>[k,window.BS_LOCALES[k].name||k])],
};

// safety net: now and then, when the page is idle, anything on screen still in English that the dictionary knows (text
// that changed in a way the observer didn't report) is translated. Cheap: nodes already done or unknown are a map lookup.
let sweeps=0;
function sweep(){
  if(dict&&document.body&&!document.hidden){const before=mine;walkSafe(document.body);if(obs)obs.takeRecords();const got=mine-before;
    if(got>0&&sweeps++<3)try{window.boxshelf&&window.boxshelf.log&&window.boxshelf.log(`i18n: sweep translated ${got} missed text(s)`)}catch{}}
  schedule();
}
function schedule(){const go=()=>sweep();setTimeout(()=>{if(window.requestIdleCallback)requestIdleCallback(go,{timeout:2000});else go()},2500)}
schedule();

// start: the last choice at once (so the first frame is already translated), then the saved config
let first="auto";try{first=localStorage.getItem(LS_KEY)||"auto"}catch{}
const go=()=>{apply(first);
  const api=window.boxshelf;
  if(api&&typeof api.getConfig==="function")Promise.resolve(api.getConfig()).then(r=>{const v=r&&r.config&&r.config.ui&&r.config.ui.lang;if(v&&v!==first)apply(v)}).catch(()=>{});
};
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go,{once:true});else go();
})();
