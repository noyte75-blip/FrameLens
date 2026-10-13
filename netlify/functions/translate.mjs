/* Netlify Function: forwards only OCR text to translation providers. Never receives video bytes. */
const supported = new Set(['en','pt','pt-BR','es','fr','de','it','ja','ko','zh-CN','ru','tr']);
function utf8(s) { return new TextEncoder().encode(s).length; }
export async function translateText(text, from, to) {
  if(!text || !String(text).trim()) throw new Error('Texto vazio.');
  if(utf8(text)>480) throw new Error('Texto excede o limite de 480 bytes por requisição.');
  if(!supported.has(from) || !supported.has(to)) throw new Error('Par de idiomas inválido.');
  if(from===to || (from==='pt' && to==='pt-BR')) return text;
  let fail = 'Serviço de tradução indisponível';
  if(process.env.DEEPL_API_KEY && ['en','pt','pt-BR','es','fr','de','it','ja','ko','zh-CN','ru'].includes(from) && ['en','pt','pt-BR','es','fr','de','it','ja','ko','zh-CN','ru'].includes(to)) {
    try {
      const endpoint = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate';
      const form = new URLSearchParams({text,source_lang:from.slice(0,2).toUpperCase(),target_lang:to==='pt'?'PT-BR':to==='en'?'EN-US':to.toUpperCase()});
      const response = await fetch(endpoint, {method:'POST',headers:{Authorization:`DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,'Content-Type':'application/x-www-form-urlencoded'},body:form,signal:AbortSignal.timeout(12000)});
      if(!response.ok) throw new Error(`DeepL HTTP ${response.status}`);
      const data=await response.json();
      if(data.translations?.[0]?.text) return data.translations[0].text;
    } catch (e){fail = e.message;}
  }
  // MyMemory free tier: limited requests, unsupported pairs, may return quality-control notices.
  const src = from==='pt-BR'?'pt':from==='zh-CN'?'zh-CN':from;
  const dst = to==='pt-BR'?'pt-BR':to;
  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.set('q',text);url.searchParams.set('langpair',`${src}|${dst}`);
  if(process.env.MYMEMORY_EMAIL) url.searchParams.set('de',process.env.MYMEMORY_EMAIL);
  try {
    const result=await fetch(url, {signal:AbortSignal.timeout(14000)});
    if(!result.ok) throw new Error(`MyMemory HTTP ${result.status}`);
    const json=await result.json();
    const translated=json.responseData?.translatedText;
    if(Number(json.responseStatus)!==200 || !translated || /MYMEMORY WARNING|USAGE LIMIT|QUERY LENGTH LIMIT/i.test(translated))
      throw new Error(json.responseDetails||'Nenhuma tradução retornada.');
    return String(translated).replace(/&quot;/g,'"').replace(/&#39;|&#039;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
  } catch(e) { throw new Error(`${fail}; MyMemory: ${e.message}`); }
}
export const handler = async (event) => {
  if (event.httpMethod!=='POST') return {statusCode:405,headers:{Allow:'POST'},body:'Método não permitido.'};
  let payload;
  try {payload=JSON.parse(event.body || '{}');} catch {return {statusCode:400,body:JSON.stringify({error:'JSON inválido'})};}
  try {const {text,from,to}=payload;
    const translation=await translateText(String(text||''),String(from||''),String(to||''));
    return {statusCode:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify({translation})};
  } catch(e){return {statusCode:422,headers:{'Content-Type':'application/json; charset=utf-8'},body:JSON.stringify({error:e.message})};}
};
