/* FrameLens Studio — motor de composição. Nenhum pixel fora da região original de texto é alterado. */
export const families = {
  sans: '"DM Sans", Arial, sans-serif',
  geometric: '"Space Grotesk", Arial, sans-serif',
  condensed: '"Oswald", Impact, sans-serif',
  serif: '"Playfair Display", Georgia, serif',
  mono: 'ui-monospace, Consolas, monospace'
};
export function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
export function normText(s) { return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim(); }
export function boxPixel(b, w, h) {
  const x = clamp(Math.round(b.x * w), 0, Math.max(0, w - 1));
  const y = clamp(Math.round(b.y * h), 0, Math.max(0, h - 1));
  const width = clamp(Math.round(b.w * w), 1, Math.max(1, w - x));
  const height = clamp(Math.round(b.h * h), 1, Math.max(1, h - y));
  return {x, y, w:width, h:height};
}
export function chooseFrame(samples, seconds, gap = 1.25) {
  if (!samples?.length) return null;
  let low = 0, high = samples.length - 1;
  while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (samples[mid].t <= seconds) low = mid; else high = mid - 1; }
  const a = samples[low], b = samples[Math.min(low + 1, samples.length - 1)];
  const choice = Math.abs(a.t - seconds) <= Math.abs(b.t - seconds) ? a : b;
  return Math.abs(choice.t - seconds) <= gap ? choice : null;
}
/** Interpolates a tracked text box between neighboring OCR samples, avoiding jumpy text. */
export function interpolatedFrame(samples, seconds, gap = 1.25) {
  const selected = chooseFrame(samples, seconds, gap);
  if (!selected || samples.length < 2) return selected;
  let left = 0;
  while (left < samples.length - 1 && samples[left + 1].t <= seconds) left++;
  const a=samples[left], b=samples[Math.min(left+1,samples.length-1)];
  if(a===b || seconds<a.t || seconds>b.t || b.t-a.t>gap*2.2) return selected;
  const part=clamp((seconds-a.t)/(b.t-a.t),0,1);
  const interpolate=(aa,bb)=>({x:aa.x+(bb.x-aa.x)*part,y:aa.y+(bb.y-aa.y)*part,w:aa.w+(bb.w-aa.w)*part,h:aa.h+(bb.h-aa.h)*part});
  const prev=new Map(a.rows.map(row=>[row.track,row]));
  const next=new Map(b.rows.map(row=>[row.track,row]));
  const rows=selected.rows.map(row=>{
    const aa=prev.get(row.track),bb=next.get(row.track);
    if(!aa||!bb)return row;
    const words=aa.words?.length===bb.words?.length?aa.words.map((word,i)=>interpolate(word,bb.words[i])):row.words;
    return {...row,box:interpolate(aa.box,bb.box),words};
  });
  return {t:seconds,rows};
}
function wrapBalanced(ctx, text, maxWidth, maxLines) {
  const words = text.trim().split(/\s+/);
  if (maxLines === 1 || words.length < 2) return [text];
  let best = [text], bestPenalty = Infinity;
  // Only split into two lines: avoids covering more image than original text.
  for (let i = 1; i < words.length; i++) {
    const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
    const measures = lines.map(l => ctx.measureText(l).width);
    const penalty = Math.max(...measures) / maxWidth + Math.abs(measures[0] - measures[1]) / (maxWidth * 3);
    if (penalty < bestPenalty) {bestPenalty = penalty;best = lines;}
  }
  return best;
}
export function fitText(ctx, text, bbox, style = {}) {
  const value = (text || '').trim();
  const requested = clamp(Number(style.scale) || 100, 60, 110) / 100;
  const padX = Math.min(2, bbox.w * 0.025), padY = Math.min(1, bbox.h * .025);
  const areaWidth = Math.max(1, bbox.w - 2 * padX);
  const areaHeight = Math.max(1, bbox.h - 2 * padY);
  const baseFont = Math.max(1, Math.min(areaHeight * .96, bbox.h * .98) * requested);
  const fontFamily = families[style.family] || families.geometric;
  const weight = style.weight || '700';
  const options = [];
  for (const rows of [1, 2]) {
    const size = rows === 1 ? baseFont : Math.min(baseFont, areaHeight / 2.05);
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    const lines = wrapBalanced(ctx, value, areaWidth, rows);
    const measured = Math.max(1, ...lines.map(l => ctx.measureText(l).width));
    const horizontalScale = Math.min(1, areaWidth / measured);
    const score = (size / Math.max(baseFont, 1)) * Math.sqrt(horizontalScale) * (rows === 1 ? 1 : .90);
    options.push({lines, size, horizontalScale, score, fontFamily, weight});
  }
  const best = options.reduce((a,b) => b.score > a.score ? b : a);
  return {...best, compressed:best.horizontalScale < .67 || best.size < baseFont * .55,
    areaWidth, areaHeight, padX, padY};
}
export function paintText(ctx, text, rect, style = {}) {
  const fitted = fitText(ctx, text, rect, style);
  const {lines, size, horizontalScale, fontFamily, weight} = fitted;
  ctx.save();
  ctx.beginPath(); ctx.rect(rect.x, rect.y, rect.w, rect.h); ctx.clip();
  ctx.font = `${weight} ${size}px ${fontFamily}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = style.color || '#ffffff';
  ctx.lineJoin = 'round';
  ctx.shadowColor = style.shadow ? 'rgba(0,0,0,.75)' : 'transparent';
  ctx.shadowBlur = style.shadow ? Math.max(1, size * .12) : 0;
  const strokeWidth = style.stroke ? Math.min(3, size * .065) : 0;
  if (strokeWidth) { ctx.lineWidth = strokeWidth; ctx.strokeStyle = 'rgba(0,0,0,.8)'; }
  const gap = lines.length === 1 ? size : size * 1.02;
  const centerX = rect.x + rect.w / 2, centerY = rect.y + rect.h / 2;
  ctx.translate(centerX,centerY);ctx.scale(horizontalScale, 1);
  lines.forEach((line,index) => {
    const y = (index - (lines.length-1)/2) * gap;
    if (strokeWidth) ctx.strokeText(line, 0, y);
    ctx.fillText(line, 0, y);
  });
  ctx.restore();
  return fitted;
}
function rgbDist(r,g,b,v) { return Math.sqrt((r-v[0])**2+(g-v[1])**2+(b-v[2])**2); }
function meanEdge(data,w,h,x0,y0,x1,y1) {
  let r=0,g=0,b=0,n=0;
  for (let y=y0;y<=y1;y++) for (let x=x0;x<=x1;x++) {
    if (x!==x0 && x!==x1 && y!==y0 && y!==y1) continue;
    const i=(y*w+x)*4; r+=data[i];g+=data[i+1];b+=data[i+2];n++;
  }
  return [r/Math.max(n,1),g/Math.max(n,1),b/Math.max(n,1)];
}
/** Get estimated letter color from the image and a per-letter rather than rectangular repair mask. */
export function inspectStyle(ctx, bbox, text='') {
  const width=ctx.canvas.width,height=ctx.canvas.height;
  const r=boxPixel(bbox,width,height);
  try {
    const im=ctx.getImageData(0,0,width,height), a=im.data;
    const x0=clamp(r.x-3,0,width-1), y0=clamp(r.y-3,0,height-1);
    const x1=clamp(r.x+r.w+2,0,width-1), y1=clamp(r.y+r.h+2,0,height-1);
    const bg=meanEdge(a,width,height,x0,y0,x1,y1);
    let hi=[255,255,255], hiDistance=0, brightness=0, count=0;
    const step=Math.max(1,Math.floor(r.w*r.h / 1200));
    for (let i=0;i<r.w*r.h;i+=step) {
      const x=r.x+i%r.w,y=r.y+Math.floor(i/r.w), p=(y*width+x)*4;
      const d=rgbDist(a[p],a[p+1],a[p+2],bg);
      if(d>hiDistance){hiDistance=d;hi=[a[p],a[p+1],a[p+2]];}
      brightness += (a[p]+a[p+1]+a[p+2])/3;count++;
    }
    const avg=brightness/Math.max(count,1);
    const contrast=hiDistance > 35;
    const color=contrast?`#${hi.map(x=>Math.round(x).toString(16).padStart(2,'0')).join('')}`:(avg < 120 ? '#ffffff':'#111111');
    const upper=text.replace(/[^A-Za-z]/g,'');
    const family=upper.length > 4 && upper === upper.toUpperCase() ? 'condensed' :
        /^[\x00-\x7f]+$/.test(text) && (text.length > 30) ? 'sans' : 'geometric';
    return {color,family,weight: '700',scale:100,stroke: Math.abs((hi[0]+hi[1]+hi[2])/3-(bg[0]+bg[1]+bg[2])/3) < 80,shadow:false,fg:hi,bg};
  } catch {return {color:'#ffffff',family:'geometric',weight:'700',scale:100,stroke:true,shadow:false,fg:[255,255,255],bg:[15,15,15]};}
}
/* Conservative pixel repair. Cap the modified area and restore only pixels close to the detected glyph color.
   When segmentation is uncertain, leave the pixels intact rather than obliterating objects behind them. */
export function repairText(ctx, bbox, style, mode='safe', wordBoxes=[]) {
  const w=ctx.canvas.width,h=ctx.canvas.height;
  const outer=boxPixel(bbox,w,h);
  if(outer.w<2 || outer.h<2) return;
  if(mode==='solid') {
    const inset=0;
    ctx.save();ctx.beginPath();ctx.rect(outer.x,outer.y,outer.w,outer.h);ctx.clip();
    const gradient=ctx.createLinearGradient(outer.x,outer.y,outer.x+outer.w,outer.y+outer.h);
    const bg=style.bg||[30,40,45];
    gradient.addColorStop(0,`rgb(${bg.map(Math.round).join(',')})`);
    gradient.addColorStop(1,`rgba(${bg.map(Math.round).join(',')},.93)`);
    ctx.fillStyle=gradient;ctx.fillRect(outer.x+inset,outer.y+inset,outer.w-2*inset,outer.h-2*inset);ctx.restore();return;
  }
  const im=ctx.getImageData(outer.x,outer.y,outer.w,outer.h),pix=im.data;
  const fg=style.fg || [255,255,255];
  const bg=style.bg || [25,25,25];
  const area=outer.w*outer.h; const mask=new Uint8Array(area);
  let marked=0;
  const targets=(wordBoxes && wordBoxes.length) ? wordBoxes.map(b=>boxPixel(b,w,h)) : [outer];
  for (const t of targets) {
    const x0=clamp(t.x-1,outer.x,outer.x+outer.w-1)-outer.x,x1=clamp(t.x+t.w,outer.x,outer.x+outer.w-1)-outer.x;
    const y0=clamp(t.y-1,outer.y,outer.y+outer.h-1)-outer.y,y1=clamp(t.y+t.h,outer.y,outer.y+outer.h-1)-outer.y;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      const p=(y*outer.w+x)*4,distFg=rgbDist(pix[p],pix[p+1],pix[p+2],fg),distBg=rgbDist(pix[p],pix[p+1],pix[p+2],bg);
      if(distBg > 26 && distFg < Math.min(95, distBg * .91)) {mask[y*outer.w+x]=1;marked++;}
    }
  }
  if(marked<2 || marked/area>.66) return;
  const expanded=new Uint8Array(area);
  for(let j=0;j<area;j++) if(mask[j]) {
    const x=j%outer.w,y=Math.floor(j/outer.w);
    for(let yy=Math.max(0,y-1);yy<=Math.min(outer.h-1,y+1);yy++)for(let xx=Math.max(0,x-1);xx<=Math.min(outer.w-1,x+1);xx++) expanded[yy*outer.w+xx]=1;
  }
  const next=new Uint8ClampedArray(pix);
  for(let y=0;y<outer.h;y++)for(let x=0;x<outer.w;x++) {
    if(!expanded[y*outer.w+x]) continue;
    const p=(y*outer.w+x)*4;
    let rr=0,gg=0,bb=0,wt=0;
    const directions=[[1,0],[-1,0],[0,1],[0,-1]];
    for(const [dx,dy] of directions) {
      for(let k=1;k<=Math.max(6,Math.min(25,outer.h));k++) {
        const xx=clamp(x+dx*k,0,outer.w-1),yy=clamp(y+dy*k,0,outer.h-1);
        if(expanded[yy*outer.w+xx]) continue;
        const ix=(yy*outer.w+xx)*4;
        const weight=1/(k+.5);
        rr+=pix[ix]*weight;gg+=pix[ix+1]*weight;bb+=pix[ix+2]*weight;wt+=weight;break;
      }
    }
    if(wt){next[p]=rr/wt;next[p+1]=gg/wt;next[p+2]=bb/wt;}
  }
  im.data.set(next);ctx.putImageData(im,outer.x,outer.y);
}
export function composeFrame(ctx, video, seconds, samples, trackMap, options={}) {
  const width=ctx.canvas.width,height=ctx.canvas.height;
  ctx.drawImage(video,0,0,width,height);
  if(!options.translate) return {rendered:0,warnings:0};
  const frame=interpolatedFrame(samples,seconds,options.gap||1.15);
  if(!frame) return {rendered:0,warnings:0};
  let rendered=0,warnings=0;
  const active=[];
  for (const row of frame.rows) {
    const tr=trackMap.get(row.track);
    if(!tr?.translation?.trim()) continue;
    active.push([row,tr]);
  }
  // Separate passes: repair original regions before drawing replacement text.
  for(const [row,tr] of active) repairText(ctx,row.box,tr.style,options.mode||'safe',row.words);
  for(const [row,tr] of active) {
    const fit=paintText(ctx,tr.translation,boxPixel(row.box,width,height),tr.style);
    if(fit.compressed) warnings++;
    rendered++;
  }
  return {rendered,warnings};
}
