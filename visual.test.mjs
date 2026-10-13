import test from 'node:test';
import assert from 'node:assert/strict';
import {boxPixel,chooseFrame,interpolatedFrame,fitText} from '../public/visual-engine.js';
test('Caixas permanecem dentro das dimensões da imagem',()=>{
 const result=boxPixel({x:.95,y:.93,w:.2,h:.2},1280,720);
 assert.ok(result.x+result.w<=1280);assert.ok(result.y+result.h<=720);
});
test('Layout de tradução nunca define largura maior que o texto original',()=>{
 const ctx={font:'',measureText:s=>({width:s.length*15})};
 const original={x:100,y:100,w:120,h:20};
 const fit=fitText(ctx,'Isto aqui é uma frase traduzida muito maior que a original',original,{scale:100});
 assert.ok(fit.horizontalScale>0 && fit.horizontalScale<=1);
 assert.ok(fit.areaWidth<=original.w);
 assert.ok(fit.size*fit.lines.length<=original.h+1);
});
test('Sem quadros próximos, não pinta substituição de texto em cenas desconhecidas',()=>{
 const sample=[{t:1,rows:[]}];assert.equal(chooseFrame(sample,50,1),null);
});

test('Tracking mantém a caixa na região interpolada entre quadros',()=>{
 const a={x:0,y:.3,w:.2,h:.1},b={x:.2,y:.3,w:.2,h:.1};
 const samples=[{t:0,rows:[{track:1,box:a,words:[]}]},{t:1,rows:[{track:1,box:b,words:[]}]}];
 assert.ok(Math.abs(interpolatedFrame(samples,.5,1).rows[0].box.x-.1)<.0001);
});
