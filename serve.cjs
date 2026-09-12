const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.resolve(process.argv[2] || __dirname);
const port = Number(process.env.PORT || process.argv[3] || 4173);
const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".wasm":"application/wasm", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".jpeg":"image/jpeg", ".webp":"image/webp", ".woff":"font/woff", ".woff2":"font/woff2", ".ttf":"font/ttf", ".mp3":"audio/mpeg", ".ogg":"audio/ogg" };
http.createServer((req,res)=>{
  let pathname; try{pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);}catch{res.writeHead(400);return res.end("Bad request");}
  let file=path.resolve(root,"."+pathname);if(!file.startsWith(root+path.sep)&&file!==root){res.writeHead(403);return res.end("Forbidden");}
  try{if(fs.statSync(file).isDirectory())file=path.join(file,"index.html");}catch{res.writeHead(404);return res.end("Not found");}
  fs.readFile(file,(error,data)=>{if(error){res.writeHead(error.code==="ENOENT"?404:500);return res.end("Not found");}res.writeHead(200,{"Content-Type":types[path.extname(file).toLowerCase()]||"application/octet-stream","Cache-Control":"no-cache"});res.end(data);});
}).listen(port,"127.0.0.1",()=>console.log(`HikisTrack website: http://127.0.0.1:${port}`));
