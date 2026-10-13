import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {handler} from './netlify/functions/translate.mjs';
const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'public');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mp4':'video/mp4','.ico':'image/x-icon','.svg':'image/svg+xml','.webm':'video/webm'};
const server=http.createServer(async (req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/translate'||u.pathname==='/.netlify/functions/translate'){
  let body='';for await(const chunk of req){body+=chunk;if(body.length>15000){res.writeHead(413).end();return;}}
  const out=await handler({httpMethod:req.method,body});res.writeHead(out.statusCode,out.headers||{}).end(out.body);return;
 }
 const name=decodeURIComponent(u.pathname)==='/'?'/index.html':decodeURIComponent(u.pathname);
 const filename=path.resolve(dir,'.'+name);
 if(!filename.startsWith(dir+path.sep)){res.writeHead(403).end();return;}
 try{
  const stat=await fs.stat(filename);const isVideo=/\.(mp4|webm)$/i.test(filename);
  if(isVideo && req.headers.range){const match=/bytes=(\d+)-(\d*)/.exec(req.headers.range);
   if(match){const start=Number(match[1]),end=match[2]?Number(match[2]):stat.size-1;const fh=await fs.open(filename,'r');
     const length=end-start+1;const b=Buffer.alloc(length);await fh.read(b,0,length,start);await fh.close();res.writeHead(206,{'Content-Type':types[path.extname(filename)],'Content-Length':length,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes'}).end(b);return;}}
  const content=await fs.readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream'}).end(content);
 }catch{res.writeHead(404).end('Não encontrado');}
});
const port=Number(process.env.PORT||3000);server.listen(port,()=>console.log(`FrameLens Studio: http://localhost:${port}`));
