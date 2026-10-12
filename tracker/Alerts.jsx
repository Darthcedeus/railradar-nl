import React, { useEffect, useState } from 'react';
async function request(path, method='GET', data) {
  const r = await fetch(path, { method, headers: data ? {'Content-Type':'application/json'} : {}, body: data ? JSON.stringify(data) : undefined });
  const d = await r.json();
  if (!r.ok) throw Error(d.error || 'Request failed.'); return d;
}
const bytes = s => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const idFor = async endpoint => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint))), b=>b.toString(16).padStart(2,'0')).join('');
async function registration() {
  const reg = await navigator.serviceWorker.getRegistration('/') || await navigator.serviceWorker.register('/sw.js');
  return Promise.race([navigator.serviceWorker.ready, new Promise((_, reject)=>setTimeout(()=>reject(Error('Notification setup timed out. Reload and try again.')),10000))]).then(()=>reg);
}
export default function Alerts({ area }) {
  const [config, setConfig] = useState(null), [deviceId, setDeviceId] = useState(null), [message,setMessage]=useState(''), [busy,setBusy]=useState(false);
  const [rule,setRule]=useState({lat:area.center[0],lng:area.center[1],label:area.label,radius:3000,kind:'all'});
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const iphone = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const device = config?.devices.find(d=>d.id===deviceId);
  useEffect(()=>{
    let alive=true, timer;
    async function load(initial=false) {
      try {
        await request('/api/device/session', 'POST', {});
        const d=await request('/api/push');
        if (!alive) return;
        setConfig(d);
        if(initial && supported) {
          const reg=await navigator.serviceWorker.getRegistration('/'); const sub=await reg?.pushManager.getSubscription();
          const id=sub ? await idFor(sub.endpoint) : null;
          if (!alive) return; setDeviceId(id);
          const saved=d.devices.find(x=>x.id===id); if(saved) setRule(saved.rule);
        }
      } catch(e) { if(alive) setMessage(e.message); }
      finally { if(alive) timer=setTimeout(()=>load(),30000); }
    }
    load(true); return ()=>{alive=false;clearTimeout(timer);};
  },[supported]);
  async function save() {
    setBusy(true);setMessage('');
    try {
      // Permission request must originate directly from this button tap on iOS.
      const permission=await Notification.requestPermission();
      if(permission!=='granted') throw Error('Notifications are not allowed. Check iPhone Settings → Notifications → RailRadar.');
      const reg=await registration();
      const sub=await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes(config.publicKey)});
      const result=await request('/api/push','POST',{subscription:sub.toJSON(),rule});
      setDeviceId(result.id);setConfig(await request('/api/push'));setMessage('Saved. Monitoring continues with the app closed. First alerts require two fresh position samples. Send a test to check delivery.');
    } catch(e) {setMessage(e.message);} finally {setBusy(false);}
  }
  async function remove(id) {
    setBusy(true);setMessage('');
    try {
      await request('/api/push','DELETE',{id});
      if(id===deviceId && supported) {const reg=await navigator.serviceWorker.getRegistration('/');await (await reg?.pushManager.getSubscription())?.unsubscribe();setDeviceId(null);}
      setConfig(await request('/api/push'));setMessage('Alerts disabled for this device.');
    }catch(e){setMessage(e.message);}finally{setBusy(false);}
  }
  async function test() {setBusy(true);try{await request('/api/push/test','POST',{id:deviceId});setMessage('Push service accepted the test. Check your phone; Focus or notification settings may silence it.');}catch(e){setMessage(e.message);}finally{setBusy(false);}}
  return <details className="alert-panel"><summary>Phone alerts <span>{device ? 'Enabled' : 'Set up'}</span></summary>
    <p>Receive a notification when a positioned train moves toward your saved area. Not a guaranteed passing time or route prediction.</p>
    {iphone && !standalone && <p className="notice">On iPhone: Safari → Share → Add to Home Screen. Enable “Open as Web App” if shown. Open that icon, then enable alerts here.</p>}
    {!supported && <p className="notice">Push is unavailable in this browser. On iPhone, use the Home Screen app with iOS 16.4 or later.</p>}
    <label className="field">Saved location name<input value={rule.label} maxLength={80} onChange={e=>setRule({...rule,label:e.target.value})}/></label>
    <p>Coordinates: {rule.lat.toFixed(5)}, {rule.lng.toFixed(5)}</p><button onClick={()=>setRule({...rule,lat:area.center[0],lng:area.center[1],label:area.label})}>Use current map search area</button>
    <p className="muted">Move the map and tap “Search this map area” first, then use it here. Your phone location is not tracked in the background.</p>
    <label className="field">Alert radius<select value={rule.radius} onChange={e=>setRule({...rule,radius:Number(e.target.value)})}>{[1000,2000,3000,5000].map(r=><option value={r} key={r}>{r/1000} km</option>)}</select></label>
    <label className="field">Train types<select value={rule.kind} onChange={e=>setRule({...rule,kind:e.target.value})}><option value="all">All positioned passenger trains</option><option value="intercity">Intercity</option><option value="sprinter">Sprinter</option><option value="international">International (GPS only)</option><option value="regional">Other passenger</option></select></label>
    <div className="alert-actions"><button disabled={busy||!config||!supported||(iphone&&!standalone)} onClick={save}>{device?'Save changes':'Enable alerts on this phone'}</button>{device&&<><button disabled={busy} onClick={test}>Send test</button><button disabled={busy} onClick={()=>remove(deviceId)}>Disable this phone</button></>}</div>
    {message&&<p className="notice" role="status">{message}</p>}
    <p className="muted">Checks every {config?.monitor.intervalSeconds||30} seconds after each cycle. One alert per train per 2 hours; maximum 30 per device per hour. Freight and station-only international markers are excluded. Delivery may be delayed; never use for railway safety.</p>
    {config?.monitor.checkedAt&&<p className="muted">Last monitor check: {new Date(config.monitor.checkedAt).toLocaleTimeString()}{config.monitor.error?` · ${config.monitor.error}`:''}</p>}
    {config?.devices.length>0&&<details><summary>This browser’s saved alerts ({config.devices.length})</summary>{config.devices.map(d=><div className="device-row" key={d.id}><span>{d.rule.label} · {d.id.slice(0,6)}{d.id===deviceId?' (this device)':''}</span><button disabled={busy} onClick={()=>remove(d.id)}>Remove</button></div>)}</details>}
    <p>No account needed. Alerts are private to this browser. Disable alerts before clearing browser data. If settings disappear after an upgrade or cookie reset, enable alerts again on the same phone to restore control of its subscription.</p>
  </details>;
}
