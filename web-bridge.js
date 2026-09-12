(function () {
  "use strict";
  if (window.electron) return;

  var listeners = Object.create(null);
  var fullscreenListeners = [];
  var state = { encoded:"", decoded:"", ghosts:{names:[],visibility:[],selected:-1}, trigger:null, history:[], historyIndex:-1 };
  var tasWindow = null, backend = null, drivePayload = null, driveId = 0, measure = null;

  function on(name, cb, replace) { if (replace || !listeners[name]) listeners[name] = []; listeners[name].push(cb); }
  function emit(name, payload) { (listeners[name] || []).slice().forEach(function (cb) { try { cb(payload); } catch (e) { console.error(e); } }); }
  function send(name, payload) {
    if (tasWindow && !tasWindow.closed && typeof tasWindow.__hikisTasReceive === "function") {
      try { tasWindow.__hikisTasReceive(name, payload); } catch (e) { console.error(e); }
    }
  }
  function bytesToBase64(bytes) {
    var out = "", step = 0x8000;
    for (var i=0;i<bytes.length;i+=step) out += String.fromCharCode.apply(null, bytes.subarray(i, i+step));
    return btoa(out);
  }
  function encodeText(text) {
    var tools = window.__misoLiveInputs;
    if (!tools || !tools.buildClipFromInputSet || !tools.recordingFromClip) throw Error("The recording tools are still loading.");
    var clip = tools.buildClipFromInputSet("TAS", String(text || ""), 1000);
    var recording = tools.recordingFromClip(clip);
    if (!recording || !recording.serialize) throw Error("The TAS text could not be encoded.");
    return recording.serialize();
  }
  function decodeRecording(encoded) {
    try {
      var raw = window.__misoClipApi.base64ToBytes(encoded);
      var pako = window.__clipPako && (window.__clipPako.Ay || window.__clipPako);
      var inflated = pako.inflate(raw);
      var events = window.MisoClipTools.eventsFromRecordingBytes(inflated, 0xffffff);
      return window.MisoClipTools.formatInputEvents(events, "compact", 1000).replace(/,-(?=\r?$)/gm, ",");
    } catch (_) { return ""; }
  }
  function updateRecording(encoded, decoded) {
    state.encoded = encoded || "";
    state.decoded = decoded == null ? decodeRecording(state.encoded) : String(decoded);
    send("recording", {encoded:state.encoded, decoded:state.decoded});
  }
  function download(text) {
    var blob = new Blob([String(text || "")], {type:"text/plain;charset=utf-8"});
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "hikistrack.tas"; a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
    return Promise.resolve({canceled:false});
  }
  function upload() {
    return new Promise(function(resolve){
      var input=document.createElement("input"); input.type="file"; input.accept=".tas,.txt,text/plain";
      input.onchange=function(){ var f=input.files && input.files[0]; if(!f)return resolve({canceled:true}); var r=new FileReader(); r.onload=function(){resolve({canceled:false,filePath:f.name,content:String(r.result||"")});}; r.onerror=function(){resolve({canceled:true,error:"Could not read file."});}; r.readAsText(f); };
      input.click();
    });
  }
  function parseDrive(text, payload) {
    var entries=[];
    String(text||"").split(/\r?\n/).forEach(function(line){ var clean=line.split("#")[0].trim(), comma=clean.indexOf(","); if(comma<0)return; var frame=parseInt(clean.slice(0,comma),10); if(!Number.isFinite(frame))return; var set=new Set(clean.slice(comma+1).trim().toLowerCase().split("")); entries.push({frame:frame,keys:["w","a","s","d","r"].filter(function(k){return set.has(k);}).join("")}); });
    entries.sort(function(a,b){return a.frame-b.frame;});
    var last=entries.reduce(function(m,x){return Math.max(m,x.frame);},0), takeover=payload.takeoverFrame == null ? last : Math.max(0,Math.floor(Number(payload.takeoverFrame)||0)), keys="";
    entries.forEach(function(x){if(x.frame<=takeover)keys=x.keys;});
    return Object.assign({},payload,{text:text,encoded:encodeText(text),sessionId:++driveId,takeoverFrame:takeover,initialKeys:typeof payload.initialKeys==="string"?payload.initialKeys:keys});
  }
  function dispatchEval(message) {
    message.candidates = (message.candidates || []).map(function(c){ return Object.assign({},c,{recording:encodeText(c.text)}); });
    emit("vanillaEval", message);
  }
  function startSearch(payload) {
    try {
      if (backend) backend.cancel();
      var runId=payload.runId || ("web-"+Date.now());
      backend=new window.HikisWebSearch.RendererBackend({
        runId:runId, baseText:payload.baseText || "", settings:Object.assign({},payload.settings||{},{backend:"vanilla"}),
        send:function(channel,message){ if(channel.indexOf("cancel")>=0) emit("vanillaCancel",message); else dispatchEval(message); },
        onProgress:function(p){send("bfProgress",p);},
        onResult:function(p){send("bfResult",p);}
      });
      backend.start();
    } catch(e) { send("bfResult",{runId:payload.runId,status:"error",error:String(e.message||e)}); }
  }
  function measureRun(payload) {
    return new Promise(function(resolve){
      if(measure) return resolve({error:"A measurement is already running."});
      var runId="measure-"+Date.now()+"-"+Math.random().toString(36).slice(2), timer=setTimeout(function(){ if(measure&&measure.runId===runId){measure=null;resolve({error:"The replay simulation timed out."});}},30000);
      measure={runId:runId,resolve:function(result){clearTimeout(timer);measure=null;resolve(result);}};
      try { dispatchEval({runId:runId,batchId:1,isBaseline:true,evalFrame:180000,startFrame:0,objective:"finish",distanceWeight:1,candidates:[{text:payload.baseText||"",label:"Current TAS"}]}); }
      catch(e){clearTimeout(timer);measure=null;resolve({error:String(e.message||e)});}
    });
  }
  function receive(type,payload) {
    switch(type) {
      case "apply": try { var enc=encodeText(payload); updateRecording(enc,payload); emit("apply",enc); } catch(e){send("bridgeError",String(e.message||e));} break;
      case "applyBest": try { var enc2=encodeText(payload.text||""); updateRecording(enc2,payload.text||""); emit("applyBest",Object.assign({},payload,{encoded:enc2})); emit("apply",enc2); } catch(e){send("bridgeError",String(e.message||e));} break;
      case "visibility": emit("setVisibility",payload); break;
      case "requestLoad": emit("requestLoad",payload); break;
      case "history": state.history=payload.history||[]; state.historyIndex=payload.historyIndex|0; break;
      case "trigger": state.trigger=payload||null; emit("triggerUpdate",payload||null); break;
      case "freecamToggle": emit("toggleFreeCam"); break;
      case "slowmoRate": emit("slowMoRate",payload); break;
      case "driveRate": emit("driveRate",payload); break;
      case "driveStart": try { drivePayload=parseDrive(payload.text||"",payload||{}); emit("driveStart",drivePayload); send("driveStatus",{status:"starting",sessionId:drivePayload.sessionId,takeoverFrame:drivePayload.takeoverFrame,initialKeys:drivePayload.initialKeys}); } catch(e){send("driveStatus",{status:"error",message:String(e.message||e)});} break;
      case "driveRestart": if(drivePayload){drivePayload=Object.assign({},drivePayload,{sessionId:++driveId});emit("driveStart",drivePayload);} break;
      case "driveStop": emit("driveStop",payload||{}); break;
      case "bfRun": startSearch(payload||{}); break;
      case "bfCancel": if(backend)backend.cancel(); emit("vanillaCancel",payload||{}); break;
    }
  }

  window.__hikisWebHost={
    state:state,
    receive:receive,
    measureRun:measureRun,
    backendSnapshot:function(){return backend?backend.snapshot():null;}
  };
  window.electron={
    webMode:true, testMode:false, log:function(x){console.log(x);}, getArgv:function(){return [];}, quit:function(){history.back();},
    indexPage:async function(args){ var p=new URLSearchParams(); Object.keys(args||{}).forEach(function(k){if(args[k]!=null)p.set(k,args[k]);}); var res=await fetch("https://vps.kodub.com/v6/leaderboard?"+p); if(!res.ok)throw Error("Leaderboard request failed ("+res.status+")"); return res.json(); },
    addFullscreenChangeListener:function(cb){fullscreenListeners.push(cb);}, isFullscreen:function(){return !!document.fullscreenElement;}, setFullscreen:function(v){if(v){document.documentElement.requestFullscreen().catch(function(){});}else if(document.fullscreenElement){document.exitFullscreen().catch(function(){});}},
    openTasTool:function(){tasWindow=window.open("electron/tas-tool.html?web=1","hikistrack-tas","popup,width=1280,height=820,resizable=yes"); if(!tasWindow)alert("Allow pop-ups for HikisTrack to open the TAS Editor.");},
    setTasRecording:function(v){var enc=typeof v==="string"?v:(v&&v.serialize?v.serialize():"");updateRecording(enc);},
    setTasGhosts:function(p){state.ghosts=p||state.ghosts;send("ghosts",state.ghosts);},
    tasToolFreeCamCoords:function(p){send("freecam",p||{});}, tasToolDriveStatus:function(p){if(p&&p.encoded)updateRecording(p.encoded);send("driveStatus",p||{});},
    tasToolVanillaResult:function(p){if(measure&&p&&p.runId===measure.runId){var r=p.results&&p.results[0];measure.resolve(p.error?{error:p.error}:{finishFrames:r&&r.state&&r.state.finishFrames!=null?r.state.finishFrames:null,simulatedFrames:p.physicsFrames||0,limit:180000});return;} if(backend)backend.handleResults(p);},
    onTasToolApply:function(cb){listeners.apply=[];on("apply",cb);}, offTasToolApply:function(){listeners.apply=[];}, onTasToolApplyBestState:function(cb){listeners.applyBest=[];on("applyBest",cb);},
    onTasToolSetVisibility:function(cb){listeners.setVisibility=[];on("setVisibility",cb);}, onTasToolRequestLoad:function(cb){listeners.requestLoad=[];on("requestLoad",cb);},
    onTasToolDriveStart:function(cb){listeners.driveStart=[];on("driveStart",cb);}, onTasToolDriveStop:function(cb){listeners.driveStop=[];on("driveStop",cb);}, onTasToolDriveRate:function(cb){listeners.driveRate=[];on("driveRate",cb);}, onTasToolSlowMoRate:function(cb){listeners.slowMoRate=[];on("slowMoRate",cb);},
    onTasToolTriggerUpdate:function(cb){listeners.triggerUpdate=[];on("triggerUpdate",cb);}, onTasToolToggleFreeCam:function(cb){listeners.toggleFreeCam=[];on("toggleFreeCam",cb);}, onTasToolVanillaEval:function(cb){listeners.vanillaEval=[];on("vanillaEval",cb);}, onTasToolVanillaCancel:function(cb){listeners.vanillaCancel=[];on("vanillaCancel",cb);},
    onTasToolBruteforceContextRequest:function(cb){listeners.bfContext=[];on("bfContext",cb);}, tasToolBruteforceContext:function(){},
    tasToolTriggerRequest:function(){return state.trigger;}
  };
  document.addEventListener("fullscreenchange",function(){fullscreenListeners.forEach(function(cb){try{cb();}catch(_){}});});
})();
