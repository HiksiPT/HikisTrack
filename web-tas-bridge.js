(function(){
  "use strict";
  if(window.electron)return;
  var host;
  try{host=window.opener&&window.opener.__hikisWebHost;}catch(_){}
  if(!host){document.addEventListener("DOMContentLoaded",function(){document.body.innerHTML='<p style="padding:24px;color:#eee;font-family:sans-serif">Open the TAS Editor from HikisTrack. The editor needs its game window to stay open.</p>';});return;}
  window.__tasEncoded=host.state.encoded||"";
  window.__tasDecoded=host.state.decoded||"";
  window.__tasGhosts=host.state.ghosts||{names:[],visibility:[],selected:-1};
  window.__tasHistory=host.state.history||[];
  window.__tasHistoryIndex=host.state.historyIndex==null?-1:host.state.historyIndex;
  var callbacks=Object.create(null);
  function on(type,cb){(callbacks[type]||(callbacks[type]=[])).push(cb);}
  function fire(type,payload){(callbacks[type]||[]).slice().forEach(function(cb){try{cb(payload);}catch(e){console.error(e);}});}
  function tell(type,payload){host.receive(type,payload);}
  window.__hikisTasReceive=function(type,payload){
    if(type==="recording"){
      window.__tasEncoded=payload.encoded||"";window.__tasDecoded=payload.decoded||"";
      var e=document.getElementById("encoded"),d=document.getElementById("decoded");if(e)e.value=window.__tasEncoded;if(d){d.value=window.__tasDecoded;d.dispatchEvent(new Event("input",{bubbles:true}));}
      fire("encoded",window.__tasEncoded);return;
    }
    if(type==="ghosts"){window.__tasGhosts=payload;fire("ghosts",payload);return;}
    fire(type,payload);
  };
  function save(text){var b=new Blob([String(text||"")],{type:"text/plain;charset=utf-8"}),a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="hikistrack.tas";a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);return Promise.resolve({canceled:false});}
  function load(){return new Promise(function(resolve){var i=document.createElement("input");i.type="file";i.accept=".tas,.txt,text/plain";i.onchange=function(){var f=i.files&&i.files[0];if(!f)return resolve({canceled:true});var r=new FileReader();r.onload=function(){resolve({canceled:false,filePath:f.name,content:String(r.result||"")});};r.onerror=function(){resolve({canceled:true,error:"Could not read file."});};r.readAsText(f);};i.click();});}
  window.electron={webMode:true,
    tasToolApply:function(x){tell("apply",x);},tasToolApplyBestState:function(x){tell("applyBest",x||{});},
    onTasToolEncodedUpdate:function(cb){on("encoded",cb);},onTasToolGhostsUpdate:function(cb){on("ghosts",cb);},
    tasToolSetVisibility:function(x){tell("visibility",x);},tasToolRequestLoad:function(x){tell("requestLoad",x);},tasToolHistoryUpdate:function(x){tell("history",x);},
    tasToolSaveToFile:save,tasToolLoadFromFile:load,
    tasToolBruteforceRun:function(x){tell("bfRun",x);},tasToolBruteforceCancel:function(x){tell("bfCancel",x||{});},tasToolBruteforceSnapshot:function(){return Promise.resolve(window.opener.__hikisWebHost.backendSnapshot?window.opener.__hikisWebHost.backendSnapshot():null);},
    onTasToolBruteforceProgress:function(cb){on("bfProgress",cb);},onTasToolBruteforceResult:function(cb){on("bfResult",cb);},tasToolMeasureRun:function(x){return window.opener.__hikisWebHost.measureRun(x||{});},
    tasToolTriggerUpdate:function(x){tell("trigger",x||null);},tasToolTriggerRequest:function(){return host.state.trigger;},tasToolToggleFreeCam:function(){tell("freecamToggle");},onTasToolFreeCamCoords:function(cb){on("freecam",cb);},
    tasToolSlowMoRate:function(x){tell("slowmoRate",x);},tasToolDriveRate:function(x){tell("driveRate",x);},tasToolDriveStart:function(x){tell("driveStart",x||{});},tasToolDriveStop:function(x){tell("driveStop",x||{});},tasToolDriveRestart:function(){tell("driveRestart",{});},onTasToolDriveStatus:function(cb){on("driveStatus",cb);}
  };
  document.addEventListener("DOMContentLoaded",function(){setTimeout(function(){
    var b=document.getElementById("bf-backend");if(b){Array.from(b.options).forEach(function(o){if(o.value!=="vanilla")o.disabled=true;else o.textContent="Browser workers (game physics)";});b.value="vanilla";b.dispatchEvent(new Event("change",{bubbles:true}));}
    var s=document.getElementById("bf-search-mode");if(s){var option=s.querySelector('option[value="surrogate"]');if(option)option.disabled=true;if(s.value==="surrogate"){s.value="genetic";s.dispatchEvent(new Event("change",{bubbles:true}));}}
  },0);});
})();
