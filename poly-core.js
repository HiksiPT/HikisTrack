(function(root,factory){const api=factory();if(typeof module==='object')module.exports=api;else root.PolyModCore=api;})(globalThis,function(){
  'use strict';
  function utf8Field(value){let s=String(value);while(new TextEncoder().encode(s).length>255)s=Array.from(s).slice(0,-1).join('');return new TextEncoder().encode(s);}
  function packTrack(track){
    const bytes=new Uint8Array(track.numberOfParts*19),v=new DataView(bytes.buffer);let p=0;
    track.forEachPart((x,y,z,id,rotation,shape,unused,checkpoint)=>{v.setUint8(p++,id);for(const n of [x,y,z]){v.setInt32(p,n,true);p+=4;}v.setUint8(p++,rotation);v.setUint8(p++,shape);v.setInt32(p,checkpoint??-1,true);p+=4;});
    const start=track.getStartTransform();if(!start)throw Error('Map has no start.');
    return {trackBytes:Array.from(bytes),startPosition:[start.position.x,start.position.y,start.position.z],startQuaternion:[start.quaternion.x,start.quaternion.y,start.quaternion.z,start.quaternion.w]};
  }
  function folders(clips,resolveName){const result=new Map();for(const clip of clips){const name=clip.trackName||resolveName(clip.trackId);const id=name&&clip.trackId?clip.trackId:'unknown';if(!result.has(id))result.set(id,{id,name:id==='unknown'?'Unknown maps':name,clips:[]});result.get(id).clips.push(clip);}return [...result.values()].sort((a,b)=>a.id==='unknown'?1:b.id==='unknown'?-1:a.name.localeCompare(b.name));}
  function filter(items,query,field='name'){const q=query.trim().toLocaleLowerCase();return items.filter(x=>String(x[field]||'').toLocaleLowerCase().includes(q));}
  function soundGate(threshold){const down=new Map();return {reset(){down.clear();},edge(key,pressed,ms){if(pressed){down.set(key,ms);return true;}const at=down.get(key);down.delete(key);return at!==undefined&&Number.isFinite(ms)&&ms-at>=threshold();}};}
  function clampFrame(value,max){const n=Number(value);if(!Number.isFinite(n))throw Error('Choose a valid time.');return Math.min(Math.max(0,Math.trunc(n)),Math.max(0,Math.trunc(max)-1));}
  return {utf8Field,packTrack,folders,filter,soundGate,clampFrame};
});
