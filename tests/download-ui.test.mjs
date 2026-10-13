import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('O fluxo de upload, tradução e download está presente e acessível',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  for(const id of ['fileInput','processBtn','videoBtn','downloadPanel','downloadDescription']){
    assert.match(html,new RegExp(`id="${id}"`));
    assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} deve ser único`);
  }
  assert.match(html,/Baixar vídeo traduzido/);
  assert.match(html,/accept="video\/\*/);
});

test('A exportação só fica disponível com traduções completas',async()=>{
  const src=await readFile(new URL('../public/app.js',import.meta.url),'utf8');
  assert.match(src,/const downloadReady=.*!countPending\(\)/);
  assert.match(src,/downloadReady\(\)/);
  assert.match(src,/\+'-traduzido\.webm'/);
});

test('O Netlify publica a função de tradução',async()=>{
  const cfg=await readFile(new URL('../netlify.toml',import.meta.url),'utf8');
  assert.match(cfg,/publish = "public"/);
  assert.match(cfg,/from = "\/api\/translate"/);
  assert.match(cfg,/to = "\/\.netlify\/functions\/translate"/);
});
