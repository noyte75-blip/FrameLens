import {clamp, normText, inspectStyle, composeFrame, chooseFrame, fitText, boxPixel} from './visual-engine.js';
const $ = id => document.getElementById(id);
const el = Object.fromEntries(['dropzone','fileInput','fileDetails','demoBtn','sourceLang','targetLang','interval','intervalValue','enhance','processBtn','cancelBtn','progressWrap','progressBar','progressLabel','status','video','scanVideo','stage','stageCanvas','placeholder','videoDetails','playBtn','playIcon','currentTime','totalTime','seekBar','muteBtn','results','countBadge','srtBtn','videoBtn','exportNote','beforeBtn','afterBtn','downloadPanel','downloadTitle','downloadDescription','downloadButtonLabel','downloadProgressWrap','downloadProgressBar','downloadProgressLabel'].map(id=>[id,$(id)]));
const stageCtx=el.stageCanvas.getContext('2d',{willReadFrequently:true});
const scanCanvas=document.createElement('canvas'),scanCtx=scanCanvas.getContext('2d',{willReadFrequently:true});
let videoUrl=null, videoFile=null, duration=0, ocrWorker=null, workerLang='',busy=false,cancel=false,job=0;
let samples=[], tracks=new Map(), nextTrackId=1, translateOn=true, rendering=false, exporting=false,exportAbort=false,playerFrame=0, lastDraw=0;
let scanInterval=1;
const sourceCode=()=>el.sourceLang.value.split('|')[1];
const sourceOCR=()=>el.sourceLang.value.split('|')[0];
const targetCode=()=>el.targetLang.value;
const safeError=e=>e?.message||String(e);
const timestamp = s => {const n=Math.floor(Math.max(0,s));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;};
const timestampSRT = s => {const ms=Math.round(Math.max(0,s)*1000),h=Math.floor(ms/3600000),m=Math.floor(ms/60000)%60,sec=Math.floor(ms/1000)%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')},${String(ms%1000).padStart(3,'0')}`;};
function setStatus(message,type=''){el.status.textContent=message;el.status.className='status'+(type?' '+type:'');}
function setProgress(value,label){
 el.progressWrap.classList.remove('hidden');el.progressBar.style.width=`${clamp(value,0,100)}%`;el.progressLabel.textContent=label;
 if(exporting){el.downloadProgressWrap.classList.remove('hidden');el.downloadProgressBar.style.width=`${clamp(value,0,100)}%`;el.downloadProgressLabel.classList.remove('hidden');el.downloadProgressLabel.textContent=label;}
}
function clearProgress(){el.progressWrap.classList.add('hidden');el.progressBar.style.width='0%';el.downloadProgressWrap.classList.add('hidden');el.downloadProgressBar.style.width='0%';el.downloadProgressLabel.classList.add('hidden');el.downloadProgressLabel.textContent='';}
function canCancel(){if(cancel)throw new Error('Operação cancelada.');}
const countPending=()=>[...tracks.values()].filter(tr=>!tr.translation?.trim()).length;
const downloadReady=()=>Boolean(videoUrl && duration>0 && samples.length && tracks.size && !countPending());
function updateDownloadState(){
 if(exporting){el.downloadPanel.dataset.state='exporting';el.videoBtn.disabled=false;el.downloadButtonLabel.textContent='Cancelar exportação';el.downloadTitle.textContent='Gerando seu vídeo traduzido';el.downloadDescription.textContent='Não feche esta aba. A geração acompanha a duração do vídeo.';return;}
 const ready=downloadReady();
 el.videoBtn.disabled=busy || !ready;
 el.downloadPanel.dataset.state=ready?'ready':busy?'busy':'empty';
 el.downloadButtonLabel.textContent='Baixar vídeo traduzido';
 if(ready){el.downloadTitle.textContent='Tradução pronta para baixar';el.downloadDescription.textContent=`${tracks.size} trecho(s) traduzido(s). Clique para gerar e baixar um novo vídeo WebM com as escritas substituídas.`;}
 else if(busy){el.downloadTitle.textContent='Identificando e traduzindo...';el.downloadDescription.textContent='O botão de download será liberado quando a análise e a tradução forem concluídas.';}
 else if(tracks.size && countPending()) {el.downloadTitle.textContent='Corrija as traduções pendentes';el.downloadDescription.textContent=`Faltam ${countPending()} tradução(ões). Preencha os campos abaixo para baixar o vídeo sem partes não traduzidas.`;}
 else if(videoUrl){el.downloadTitle.textContent='Vídeo carregado';el.downloadDescription.textContent='Clique em “Detectar e traduzir” no painel à esquerda. Depois, baixe o vídeo pronto aqui.';}
 else {el.downloadTitle.textContent='Baixe seu vídeo já traduzido';el.downloadDescription.textContent='Envie seu arquivo, clique em “Detectar e traduzir” e, quando terminar, baixe o vídeo com o texto substituído.';}
}
function setBusy(on){busy=on;el.processBtn.disabled=on||!videoUrl;el.demoBtn.disabled=on;el.cancelBtn.classList.toggle('hidden',!on);el.srtBtn.disabled=on||!tracks.size;updateDownloadState();}
function reset(){samples=[];tracks.clear();nextTrackId=1;el.results.innerHTML='<div class="blank-results"><div class="blank-icon">Aa</div><strong>Pronto para um novo projeto.</strong><span>Após a análise, traduções e controles de estilo aparecerão aqui.</span></div>';el.countBadge.textContent='0';el.srtBtn.disabled=true;el.exportNote.textContent='A tradução é incorporada ao vídeo baixado acima. Legendas SRT são opcionais.';clearProgress();updateDownloadState();}
function updateSize(){
  const vw=el.video.videoWidth||1280,vh=el.video.videoHeight||720;
  const scale=Math.min(1,1280/vw,720/vh);
  el.stageCanvas.width=Math.max(1,Math.round(vw*scale));el.stageCanvas.height=Math.max(1,Math.round(vh*scale));
  el.stage.style.aspectRatio=`${vw}/${vh}`;
}
function draw(){
 if(!el.video.videoWidth||el.video.readyState<2)return;
 const t=el.video.currentTime||0;
 const gap=Math.max(scanInterval*1.08,.48);
 const info=composeFrame(stageCtx,el.video,t,samples,tracks,{translate:translateOn,mode:document.querySelector('input[name="rebuild"]:checked')?.value||'safe',gap});
 el.currentTime.textContent=timestamp(t);el.seekBar.value=duration?String(Math.round(t/duration*1000)):'0';
 return info;
}
function frameLoop(){if(rendering)return;rendering=true;const loop=()=>{if(!el.video.paused && !el.video.ended){draw();playerFrame=requestAnimationFrame(loop);}else{rendering=false;draw();}};loop();}
function loadFile(file){
 if(!file)return;
 if(busy || exporting){setStatus('Conclua ou cancele o processamento atual antes de importar outro vídeo.','error');return;}
 if(!file.type.startsWith('video/')&&!/\.(mp4|mov|m4v|webm|ogv)$/i.test(file.name)){setStatus('Escolha um arquivo de vídeo compatível.','error');return;}
 cancel=true;job++;
 if(videoUrl) URL.revokeObjectURL(videoUrl);
 videoFile=file;duration=0;videoUrl=URL.createObjectURL(file);el.video.pause();el.scanVideo.pause();el.video.src=videoUrl;el.scanVideo.src=videoUrl;el.video.load();el.scanVideo.load();
 el.placeholder.classList.add('hidden');el.stageCanvas.classList.remove('hidden');el.fileDetails.classList.remove('hidden');
 el.fileDetails.textContent=`${file.name} · ${(file.size/1048576).toFixed(1)} MB`;
 el.processBtn.disabled=true;el.playBtn.disabled=true;el.seekBar.disabled=true;el.muteBtn.disabled=true;
 reset();setStatus('Carregando vídeo...');
}
el.dropzone.addEventListener('click',()=>el.fileInput.click());
el.dropzone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.fileInput.click();}});
el.fileInput.addEventListener('change',e=>loadFile(e.target.files?.[0]));
for(const evt of ['dragover','dragenter'])el.dropzone.addEventListener(evt,e=>{e.preventDefault();el.dropzone.classList.add('dragover');});
for(const evt of ['dragleave','drop'])el.dropzone.addEventListener(evt,e=>{e.preventDefault();el.dropzone.classList.remove('dragover');});
el.dropzone.addEventListener('drop',e=>loadFile(e.dataTransfer?.files?.[0]));
el.demoBtn.addEventListener('click',async()=>{try {setStatus('Carregando o arquivo de demonstração...');const res=await fetch('/demo.mp4');if(!res.ok)throw new Error('Demo indisponível');const b=await res.blob();loadFile(new File([b],'exemplo-hello-world.mp4',{type:'video/mp4'}));}catch(e){setStatus(safeError(e),'error');}});
el.video.addEventListener('loadedmetadata',()=>{
 duration=el.video.duration;
 if(!Number.isFinite(duration)||duration<=0){setStatus('Não foi possível identificar a duração. Tente um MP4 H.264 ou WebM.','error');return;}
 updateSize();el.totalTime.textContent=timestamp(duration);el.videoDetails.textContent=`${el.video.videoWidth} × ${el.video.videoHeight} · ${timestamp(duration)}`;
 el.processBtn.disabled=busy;el.playBtn.disabled=false;el.seekBar.disabled=false;el.muteBtn.disabled=false;
 setStatus('Vídeo pronto. Selecione os idiomas e inicie a análise.');updateDownloadState();draw();
});
el.video.addEventListener('loadeddata',draw);el.video.addEventListener('seeked',draw);el.video.addEventListener('timeupdate',draw);
el.video.addEventListener('play',()=>{el.playIcon.innerHTML='<rect x="7" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/>';frameLoop();});
el.video.addEventListener('pause',()=>{el.playIcon.innerHTML='<path d="m8 5 11 7-11 7z" fill="currentColor"/>';});
el.video.addEventListener('error',()=>setStatus('O navegador não conseguiu abrir este vídeo. Prefira MP4 (H.264/AAC) ou WebM.','error'));
el.playBtn.addEventListener('click',async()=>{if(el.video.paused)try{await el.video.play();}catch(e){setStatus('Não foi possível iniciar o vídeo: '+safeError(e),'error');}else el.video.pause();});
el.seekBar.addEventListener('input',()=>{if(duration)el.video.currentTime=Number(el.seekBar.value)/1000*duration;});
el.muteBtn.addEventListener('click',()=>{el.video.muted=!el.video.muted;el.muteBtn.style.color=el.video.muted?'#e7a5a5':'#d8e6dc';});
el.interval.addEventListener('input',()=>el.intervalValue.textContent=`${Number(el.interval.value).toFixed(1).replace('.',',')} s`);
function showComparison(on){translateOn=on;el.afterBtn.classList.toggle('active',on);el.beforeBtn.classList.toggle('active',!on);draw();}
el.afterBtn.addEventListener('click',()=>showComparison(true));el.beforeBtn.addEventListener('click',()=>showComparison(false));
for(const mode of document.querySelectorAll('.mode'))mode.addEventListener('click',()=>{document.querySelectorAll('.mode').forEach(m=>m.classList.toggle('selected',m===mode));draw();});

async function videoSeek(v,t){
 const time=clamp(t,0,Math.max(.001,(v.duration||duration)-.06));
 if(Math.abs(v.currentTime-time)<.025&&v.readyState>=2)return;
 await new Promise((resolve,reject)=>{
  let tid;const cleanup=()=>{clearTimeout(tid);v.removeEventListener('seeked',success);v.removeEventListener('error',failed);};
  const success=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Falha ao procurar quadro do vídeo.'));};
  v.addEventListener('seeked',success,{once:true});v.addEventListener('error',failed,{once:true});
  tid=setTimeout(()=>{cleanup();reject(new Error('O vídeo demorou demais para fornecer um quadro.'));},17000);
  try{v.currentTime=time;}catch(e){cleanup();reject(e);}
 });
}
function bboxLine(obj,sw,sh){
 const b=obj?.bbox;if(!b || !Number.isFinite(b.x0)||!Number.isFinite(b.y0))return null;
 const x=clamp(b.x0/sw,0,1),y=clamp(b.y0/sh,0,1),w=clamp((b.x1-b.x0)/sw,0,1-x),h=clamp((b.y1-b.y0)/sh,0,1-y);
 if(w<.004 || h<.006 || !Number.isFinite(w+h))return null;
 return {x,y,w,h};
}
function extractLines(blocks,sw,sh,confidence=38){
 const out=[];
 for(const block of blocks||[])for(const para of block.paragraphs||[])for(const line of para.lines||[]){
  const text=(line.text||'').replace(/\s+/g,' ').trim();const box=bboxLine(line,sw,sh);
  if(!text||!box||!/\p{L}/u.test(text)||text.length>300||Number(line.confidence||0)<confidence)continue;
  const words=(line.words||[]).map(word=>bboxLine(word,sw,sh)).filter(Boolean);
  out.push({text,box,words,confidence:line.confidence||0});
 }
 return out;
}
function intersection(a,b){const x=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x));const y=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return x*y;}
function overlaps(a,b){const i=intersection(a,b);return i/(a.w*a.h+b.w*b.h-i||1);}
function mergeDetections(first,enhanced){const merged=[...first];for(const b of enhanced){const similar=merged.find(a=>overlaps(a.box,b.box)>.45 || (normText(a.text)===normText(b.text)&&overlaps(a.box,b.box)>.18));if(!similar)merged.push(b);else if(b.confidence>similar.confidence+.3)Object.assign(similar,b);}return merged;}
function preprocess(canvas){const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(canvas,0,0);const im=x.getImageData(0,0,c.width,c.height);for(let i=0;i<im.data.length;i+=4){const y=.299*im.data[i]+.587*im.data[i+1]+.114*im.data[i+2];const out=y>145?255:Math.max(0,y*1.8-53);im.data[i]=im.data[i+1]=im.data[i+2]=out;}x.putImageData(im,0,0);return c;}
async function ensureWorker(lang){
 if(!window.Tesseract)throw new Error('Não foi possível carregar o motor de OCR. Verifique sua conexão e o bloqueio do CDN.');
 if(ocrWorker && workerLang===lang)return ocrWorker;
 if(ocrWorker){await ocrWorker.terminate();ocrWorker=null;}
 ocrWorker=await window.Tesseract.createWorker(lang,1,{logger(m){if(m.status==='loading language traineddata')setProgress(3,'Baixando dados de idioma do OCR...');}});
 workerLang=lang;return ocrWorker;
}
async function analyzeFrame(t,enhance){
 await videoSeek(el.scanVideo,t);canCancel();
 const vw=el.scanVideo.videoWidth,vh=el.scanVideo.videoHeight;
 const factor=Math.min(1.7,1280/vw,900/vh),s=Math.max(.1,factor);
 scanCanvas.width=Math.max(1,Math.round(vw*s));scanCanvas.height=Math.max(1,Math.round(vh*s));
 scanCtx.drawImage(el.scanVideo,0,0,scanCanvas.width,scanCanvas.height);
 const base=(await ocrWorker.recognize(scanCanvas,{}, {blocks:true})).data.blocks;
 let rows=extractLines(base,scanCanvas.width,scanCanvas.height);
 if(enhance){const enhancedCanvas=preprocess(scanCanvas);const alt=(await ocrWorker.recognize(enhancedCanvas,{}, {blocks:true})).data.blocks;rows=mergeDetections(rows,extractLines(alt,scanCanvas.width,scanCanvas.height));}
 return rows;
}
function textSimilarity(a,b){
 a=normText(a);b=normText(b);if(a===b)return 1;
 if(!a.length||!b.length)return 0;
 const wordsA=new Set(a.split(' ')),wordsB=new Set(b.split(' '));
 const overlap=[...wordsA].filter(w=>wordsB.has(w)).length;
 return Math.max(overlap/Math.max(wordsA.size,wordsB.size),a.includes(b)||b.includes(a)? Math.min(a.length,b.length)/Math.max(a.length,b.length):0);
}
function assignTrack(row,t,lastRows){
 let best=null,bestScore=0;
 for(const old of lastRows){
  const tr=tracks.get(old.track);if(!tr)continue;
  const cx=old.box.x+old.box.w/2, cy=old.box.y+old.box.h/2;
  const dx=(row.box.x+row.box.w/2)-cx,dy=(row.box.y+row.box.h/2)-cy;
  const distance=Math.hypot(dx,dy);
  const sim=textSimilarity(row.text,old.text);
  if(distance>.16 || sim<.55)continue;
  const score=sim*2+(1-distance)*.5;
  if(score>bestScore){best=tr;bestScore=score;}
 }
 if(best){best.end=t+scanInterval*.5;best.seen++;row.track=best.id;return;}
 const id=nextTrackId++;
 const track={id,text:row.text,translation:'',translated:false,failed:false,start:t,end:t+scanInterval*.5,seen:1,
   style:inspectStyle(scanCtx,row.box,row.text),box:row.box};
 tracks.set(id,track);row.track=id;
}
async function translate(text,from,to){
 const res=await fetch('/api/translate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,from,to})});
 let value;try{value=await res.json();}catch{throw new Error('Resposta inválida do serviço de tradução.');}
 if(!res.ok||typeof value.translation!=='string')throw new Error(value.error||`Erro HTTP ${res.status}`);
 return value.translation;
}
async function startProcessing(){
 if(busy||!videoUrl||!duration)return;
 const current=++job;cancel=false;el.video.pause();setBusy(true);setProgress(1,'Inicializando OCR...');reset();setProgress(1,'Inicializando OCR...');
 try{
  await ensureWorker(sourceOCR());canCancel();
  const reqInterval=Number(el.interval.value)||1;
  scanInterval=Math.max(reqInterval,duration/250);
  const count=Math.max(1,Math.ceil(duration/scanInterval));
  const timepoints=Array.from({length:count},(_,i)=>Math.min(duration-.06,i*scanInterval));
  let prev=[];
  for(let i=0;i<timepoints.length;i++){
   canCancel();if(current!==job)throw new Error('Operação substituída.');
   const t=timepoints[i],rows=await analyzeFrame(t,el.enhance.checked);
   for(const r of rows)assignTrack(r,t,prev);
   samples.push({t,rows});prev=rows;
   if(i%2===0 || i===timepoints.length-1){setProgress(6+63*(i+1)/timepoints.length,`Lendo quadros ${i+1}/${timepoints.length} · ${tracks.size} textos encontrados`);}
  }
  // Prevent late reappearance of replaced text beyond end.
  for(const tr of tracks.values()) tr.end=Math.min(duration,tr.end);
  if(!tracks.size){setStatus('Análise concluída, mas não identifiquei texto legível. Experimente 0,5 s, outro idioma ou um vídeo de melhor qualidade.','error');renderResults();return;}
  const cache=new Map();let index=0;
  for(const tr of tracks.values()){
    canCancel();index++;
    const key=normText(tr.text);
    if(cache.has(key)){const prior=cache.get(key);tr.translation=prior.translation;tr.translated=prior.translated;tr.failed=prior.failed;}
    else{
     try{tr.translation=await translate(tr.text,sourceCode(),targetCode());tr.translated=true;tr.failed=false;}
     catch(e){tr.translation='';tr.failed=safeError(e);}
     cache.set(key,{translation:tr.translation,translated:tr.translated,failed:tr.failed});
    }
    setProgress(70+30*index/tracks.size,`Traduzindo ${index}/${tracks.size} · ${tr.failed?'serviço não respondeu':'concluído'}`);
    renderResults();draw();
  }
  const failures=[...tracks.values()].filter(tr=>tr.failed).length;
  setStatus(failures?`OCR concluído. ${tracks.size-failures} tradução(ões) recebida(s); ${failures} falhou/falharam e podem ser preenchidas manualmente.`:`Pronto. ${tracks.size} trecho(s) detectado(s), traduzido(s) e disponíveis para edição.`,failures?'':'success');
  el.exportNote.textContent=`${tracks.size} trecho(s) detectado(s) · WebM · Recriação limitada às caixas de texto${scanInterval>reqInterval?' · Amostragem reduzida':''}`;
  renderResults();draw();
 }catch(e){setStatus(safeError(e),cancel?'':'error');}
 finally{if(current===job){setBusy(false);clearProgress();el.processBtn.disabled=!videoUrl;el.srtBtn.disabled=!tracks.size;updateDownloadState();draw();}}
}
el.processBtn.addEventListener('click',startProcessing);
el.cancelBtn.addEventListener('click',()=>{cancel=true;setStatus('Cancelando após a etapa atual...');});
function makeEl(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
function chooseOption(values,value){const select=makeEl('select','editor-select');for(const [v,label] of values){const option=makeEl('option',null,label);option.value=v;select.append(option);}select.value=value;return select;}
function renderResults(){
 el.countBadge.textContent=String(tracks.size);el.results.replaceChildren();
 if(!tracks.size){el.results.innerHTML='<div class="blank-results"><strong>Nenhum texto encontrado</strong><span>Verifique o idioma original e a qualidade da imagem.</span></div>';return;}
 const all=[...tracks.values()].sort((a,b)=>a.start-b.start);
 for(const tr of all){
  const row=makeEl('article','result-item');
  const top=makeEl('div','result-top'),time=makeEl('span','result-time',`${timestamp(tr.start)} — ${timestamp(tr.end)}`);
  const status=makeEl('span','result-flags'+(tr.failed?' warn':''),tr.failed?'Tradução pendente':tr.translated?'Traduzido':'Aguardando');
  top.append(time,status);row.append(top);
  const pair=makeEl('div','result-pair');
  const left=makeEl('div');left.append(makeEl('span','mini-label','TEXTO ORIGINAL'),makeEl('div','source-text',tr.text));
  const right=makeEl('div');right.append(makeEl('span','mini-label','TRADUÇÃO · EDITÁVEL'));
  const textarea=makeEl('textarea','editor-textarea');textarea.value=tr.translation;textarea.placeholder='Digite uma tradução curta para preservar a composição';textarea.setAttribute('aria-label',`Tradução de ${tr.text}`);
  textarea.addEventListener('input',()=>{tr.translation=textarea.value;tr.failed=false;tr.translated=Boolean(textarea.value.trim());updateDownloadState();status.textContent=tr.translated?'Edição manual':'Sem tradução';status.className='result-flags';updateWarning();draw();});
  right.append(textarea);
  if(tr.failed)right.append(makeEl('div','translation-failed','O serviço externo falhou. Insira uma tradução manualmente.'));
  pair.append(left,right);row.append(pair);
  const controls=makeEl('div','editor-controls');
  const fonts=chooseOption([['geometric','Geométrica'],['sans','Sans-serif'],['condensed','Condensada'],['serif','Serifada'],['mono','Monoespaçada']],tr.style.family);
  fonts.title='Fonte aproximada';fonts.addEventListener('change',()=>{tr.style.family=fonts.value;updateWarning();draw();});controls.append(fonts);
  const color=makeEl('input','editor-input');color.type='color';color.title='Cor do texto';color.value=tr.style.color?.match(/^#[0-9a-f]{6}$/i)?tr.style.color:'#ffffff';color.addEventListener('input',()=>{tr.style.color=color.value;tr.style.fg=[parseInt(color.value.slice(1,3),16),parseInt(color.value.slice(3,5),16),parseInt(color.value.slice(5,7),16)];draw();});controls.append(color);
  controls.append(makeEl('span','editor-label','Tamanho'));
  const size=makeEl('input','editor-number');size.type='number';size.min='60';size.max='110';size.step='5';size.value=String(tr.style.scale||100);size.title='Tamanho relativo, limitado à área original';
  size.addEventListener('input',()=>{tr.style.scale=clamp(Number(size.value)||100,60,110);updateWarning();draw();});controls.append(size);
  controls.append(makeEl('span','editor-label','%'));
  const outline=makeEl('label','editor-label'),checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=Boolean(tr.style.stroke);outline.append(checkbox,document.createTextNode(' Contorno'));checkbox.addEventListener('change',()=>{tr.style.stroke=checkbox.checked;draw();});controls.append(outline);
  const go=makeEl('button','subtle-button','Ver na cena ↗');go.type='button';go.style.marginLeft='auto';go.addEventListener('click',()=>{el.video.pause();el.video.currentTime=tr.start;el.stage.scrollIntoView({behavior:'smooth',block:'center'});});controls.append(go);
  row.append(controls);
  const warning=makeEl('div','translation-failed hidden','Tradução longa para o espaço original. Encurte o texto para melhorar a legibilidade.');
  row.append(warning);
  function updateWarning(){
    const info=fitText(stageCtx,tr.translation,boxPixel(tr.box,el.stageCanvas.width,el.stageCanvas.height),tr.style);
    warning.classList.toggle('hidden',!tr.translation.trim() || !info.compressed);
  }
  updateWarning();
  el.results.append(row);
 }
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const anchor=document.createElement('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
function fileBase(){return (videoFile?.name||'video').replace(/\.[^.]+$/,'').replace(/[^a-zA-Z0-9_-]/g,'_');}
el.srtBtn.addEventListener('click',()=>{
 const items=[...tracks.values()].filter(v=>v.translation?.trim()).sort((a,b)=>a.start-b.start);
 const contents=items.map((tr,i)=>`${i+1}\n${timestampSRT(tr.start)} --> ${timestampSRT(Math.max(tr.start+.2,tr.end))}\n${tr.translation.trim()}\n`).join('\n');
 downloadBlob(new Blob(['\uFEFF',contents],{type:'text/plain;charset=utf-8'}),fileBase()+'-traduzido.srt');
});
async function exportVideo(){
 if(exporting){exportAbort=true;setStatus('Cancelando exportação...');return;}
 if(!downloadReady()){setStatus('Conclua a análise e corrija as traduções pendentes antes de baixar o vídeo.','error');updateDownloadState();return;}
 if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){setStatus('Seu navegador não suporta exportação WebM. Use Chrome ou Edge atualizado.','error');return;}
 const kind=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
 if(!kind){setStatus('Não foi encontrado um codificador WebM compatível neste navegador.','error');return;}
 exporting=true;exportAbort=false;el.demoBtn.disabled=true;el.srtBtn.disabled=true;el.processBtn.disabled=true;el.video.pause();updateDownloadState();
 let recording=null, audioContext=null, source=null, stream=null, movie=null, raf=0;
 try {
  movie=document.createElement('video');movie.playsInline=true;movie.preload='auto';movie.src=videoUrl;movie.style.display='none';document.body.append(movie);
  await new Promise((resolve,reject)=>{if(movie.readyState>=1)resolve();else{movie.addEventListener('loadedmetadata',resolve,{once:true});movie.addEventListener('error',()=>reject(new Error('Erro ao abrir vídeo para exportação.')),{once:true});}});
  const canvas=document.createElement('canvas');canvas.width=el.stageCanvas.width;canvas.height=el.stageCanvas.height;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});stream=canvas.captureStream(30);
  let audioStatus='';
  try{
   const AC=window.AudioContext||window.webkitAudioContext;
   if(AC){audioContext=new AC();source=audioContext.createMediaElementSource(movie);const destination=audioContext.createMediaStreamDestination();source.connect(destination);for(const track of destination.stream.getAudioTracks())stream.addTrack(track);await audioContext.resume();audioStatus=' e áudio';}
  }catch(e){audioStatus=' (áudio indisponível)';if(audioContext){await audioContext.close().catch(()=>{});audioContext=null;}}
  const chunks=[];
  recording=new MediaRecorder(stream,{mimeType:kind,videoBitsPerSecond:4_000_000});
  recording.addEventListener('dataavailable',e=>{if(e.data?.size)chunks.push(e.data);});
  const stopped=new Promise((resolve,reject)=>{recording.addEventListener('stop',resolve,{once:true});recording.addEventListener('error',e=>reject(e.error||new Error('Erro no MediaRecorder')),{once:true});});
  const loop=()=>{if(!movie.paused){composeFrame(ctx,movie,movie.currentTime,samples,tracks,{translate:true,mode:document.querySelector('input[name="rebuild"]:checked')?.value||'safe',gap:Math.max(scanInterval*1.08,.48)});setProgress(100*movie.currentTime/duration,`Renderizando ${timestamp(movie.currentTime)} / ${timestamp(duration)}${audioStatus}`);}if(!movie.ended && !exportAbort)raf=requestAnimationFrame(loop);};
  await videoSeek(movie,0.01);composeFrame(ctx,movie,0,samples,tracks,{translate:true,mode:document.querySelector('input[name="rebuild"]:checked')?.value||'safe',gap:Math.max(scanInterval*1.08,.48)});
  setProgress(0,'Exportação em tempo real — não feche esta aba.');recording.start(1000);
  const ended=new Promise((resolve,reject)=>{const poll=()=>{if(exportAbort){movie.pause();resolve(false);return;}if(movie.ended||movie.currentTime>=duration-.08){resolve(true);return;}if(movie.error){reject(new Error('Erro de reprodução durante exportação.'));return;}setTimeout(poll,160);};poll();});
  await movie.play();loop();const completed=await ended;
  cancelAnimationFrame(raf);movie.pause();if(recording.state!=='inactive')recording.stop();await stopped;
  if(completed && chunks.length){downloadBlob(new Blob(chunks,{type:kind}),fileBase()+'-traduzido.webm');setStatus('Download iniciado. O arquivo contém a tradução recriada no vídeo. Revise o resultado antes de compartilhar.','success');}
  else if(!completed)setStatus('Exportação cancelada.');
  else throw new Error('O navegador não gerou quadros de vídeo.');
 }catch(e){setStatus('Exportação não concluída: '+safeError(e),'error');if(recording?.state==='recording')recording.stop();}
 finally{cancelAnimationFrame(raf);movie?.pause();movie?.remove();stream?.getTracks().forEach(t=>t.stop());if(audioContext&&audioContext.state!=='closed')await audioContext.close().catch(()=>{});exporting=false;exportAbort=false;el.demoBtn.disabled=false;el.srtBtn.disabled=!tracks.size;el.processBtn.disabled=!videoUrl;clearProgress();updateDownloadState();draw();}
}
el.videoBtn.addEventListener('click',exportVideo);
window.addEventListener('beforeunload',()=>{if(videoUrl)URL.revokeObjectURL(videoUrl);ocrWorker?.terminate().catch(()=>{});});
