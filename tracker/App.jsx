'use client';
import React, { useEffect, useRef, useState } from 'react';

import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import RailInfrastructure from './RailInfrastructure.jsx';
import { trainIcon } from './train-icons.js';
import { withHeadings, headingLabel } from './train-sprites.mjs';
import { trainStyle, journeyGeometry } from './map-helpers.mjs';
import { nextCall, platform } from './journey-helpers.mjs';
import International from './International.jsx';
import Alerts from './Alerts.jsx';
import { TrainFront, MapPin, History, LocateFixed, Info, RefreshCw } from 'lucide-react';
import { HAGUE, normalizeVehicles, distance } from './data.mjs';



const stationIcon = L.divIcon({ className: 'station-icon', html: '<span>●</span>', iconSize: [18, 18] });

const time = value => value ? new Date(value).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : '—';
async function api(path, signal) {
  const response = await fetch(path, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function MapActions({ center, onSearchHere }) {
  const map = useMap();
  useEffect(() => { map.flyTo(center, 12); }, [map, center]);
  useMapEvents({ moveend: () => { const c = map.getCenter(); onSearchHere([c.lat, c.lng]); } });
  return null;
}
function RouteLayer({ geometry, color, fitRequest }) {
  const map = useMap();
  useEffect(() => {
    if (fitRequest && geometry.points.length > 1) map.fitBounds(geometry.points.map(p => p.pos), { padding: [45, 65], maxZoom: 13 });
  }, [map, fitRequest]);
  return <>
    <Polyline positions={geometry.segments} pathOptions={{ color: '#fff', weight: 8, opacity: .95 }} interactive={false}/>
    <Polyline positions={geometry.segments} pathOptions={{ color, weight: 4, opacity: .95, dashArray: '10 5' }} interactive={false}/>
    {geometry.points.filter(p => !p.passing).map((p, i) => <CircleMarker key={i} center={p.pos} radius={4} pathOptions={{ color, weight: 2, fillColor: '#fff', fillOpacity: 1 }}><Popup>{p.name}</Popup></CircleMarker>)}
  </>;
}
function Journey({ train, stations, state, onClose, onFit, hasRoute, upcoming }) {
  const names = new Map(stations.map(s => [String(s.UICCode), s.namen?.lang || s.namen?.middel]));
  const stopName = s => names.get(String(s?.stop?.uicCode)) || s?.stop?.name || s?.stop?.code || 'Unknown station';
  const track = platform(upcoming?.event);
  const following = upcoming?.action === 'Departs' ? nextCall(state.stops?.slice(upcoming.index + 1)) : null;
  return <section className="journey" aria-label="Train details"><div className="trainhead"><h2>{train.name}</h2><button onClick={onClose} aria-label="Close train details">×</button></div><p>Speed: {train.speed === null ? 'Unknown' : `${train.speed} km/h`} · {train.source}</p>
    {upcoming && <div className="next-stop" aria-live="polite"><small>{upcoming.label}{state.error ? ' · stale data' : ''}</small><h3>{stopName(upcoming.stop)}</h3><div className="next-stop-meta"><span>{upcoming.action} <b>{time(upcoming.event.actualTime || upcoming.event.plannedTime)}</b></span><span className={track.changed ? 'track-changed' : ''}>Platform / spoor <b>{track.value}</b>{track.changed && <small>Changed from {track.planned}</small>}</span></div><p>Based on reported times, not confirmed by GPS.{state.updated && ` Checked ${time(state.updated)}.`}</p></div>}
    {!upcoming && state.stops?.length > 0 && <p>No upcoming timed stop reported. The journey may have ended or its timing data may be incomplete.</p>}
    {following && <p><strong>Then: {stopName(following.stop)}</strong> · {following.action.toLowerCase()} {time(following.event.actualTime || following.event.plannedTime)} · Platform / spoor {platform(following.event).value}</p>}
    {train.departure && <p>{train.departure.cancelled ? 'This departure is cancelled. ' : ''}Departure-board service from {train.stationName} toward {train.departure.direction}. Its station marker is not the train’s location.</p>}
    {hasRoute && <p className="route-description">Dashed line: approximate route through NS-reported stops and passing points. <button className="fit-route" onClick={onFit}>Fit route on map</button></p>}{state.stops && !hasRoute && <p>Not enough location data to draw this route.</p>}{state.loading && <p role="status">Loading route…</p>}{state.error && <p role="alert">{state.error}</p>}
    {state.stops?.length === 0 && <p>No stops reported for this service.</p>}
    {state.stops && <details className="full-route"><summary>Full route · {state.stops.length} reported points</summary><ol className="stops">{state.stops.map((s, i) => {
      const arrival = s.arrivals?.[0], departure = s.departures?.[0];
      const event = departure || arrival;
      const name = names.get(String(s.stop?.uicCode)) || s.stop?.name || s.stop?.code || `Station ${s.stop?.uicCode || i + 1}`;
      return <li className={upcoming?.index === i ? 'upcoming-call' : ''} key={`${s.id || s.stop?.uicCode}-${i}`}><span><strong>{name}{upcoming?.index === i ? ' · Upcoming' : ''}</strong><small>{event?.cancelled ? 'Cancelled' : event ? `${departure ? 'Departs' : 'Arrives'} ${time(event.actualTime || event.plannedTime)}` : s.status === 'PASSING' ? 'Passes through' : 'No time reported'}{event?.actualTrack || event?.plannedTrack ? ` · Platform / spoor ${event.actualTrack || event.plannedTrack}` : ''}{platform(event).changed ? ` (changed from ${event.plannedTrack})` : ''}{s.status ? ` · ${s.status}` : ''}</small></span></li>;
    })}</ol></details>}
  </section>;
}
export default function App() {
  const sidebar = useRef(null);
  const [clock, setClock] = useState(Date.now);
  const [showInternational, setShowInternational] = useState(true);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const [showTracks, setShowTracks] = useState(true), [showCrossings, setShowCrossings] = useState(false);
  const [railStatus, setRailStatus] = useState('loading');
  const [area, setArea] = useState({ center: HAGUE, label: 'Den Haag' });
  const [viewport, setViewport] = useState(HAGUE), [radius, setRadius] = useState(12000);
  const [location, setLocation] = useState(null), [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('All'), [search, setSearch] = useState('');
  const [feed, setFeed] = useState({ status: 'connecting', trains: [], updated: null, error: '' });
  const [refresh, setRefresh] = useState(0), [selected, setSelected] = useState(null);
  const [journey, setJourney] = useState({ loading: false });
  const [fitRequest, setFitRequest] = useState(0);
  const selectedNumber = selected?.number;
  useEffect(() => {
    const controller = new AbortController(); let timer;
    if (!selectedNumber) { setJourney({ loading: false }); return () => controller.abort(); }
    setJourney({ loading: true, number: selectedNumber });
    sidebar.current?.scrollTo({ top: 0, behavior: 'smooth' });
    if (window.matchMedia('(max-width: 760px)').matches) sidebar.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    async function load() {
      try {
        const data = await api(`/api/journey?train=${encodeURIComponent(selectedNumber)}`, controller.signal);
        if (!Array.isArray(data?.payload?.stops)) throw new Error('No route details available for this service.');
        if (!controller.signal.aborted) setJourney({ number: selectedNumber, stops: data.payload.stops, updated: Date.now() });
      } catch (error) { if (!controller.signal.aborted) setJourney(previous => ({ ...previous, loading: false, error: error.message })); }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 60000); }
    }
    load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [selectedNumber]);
  const [stations, setStations] = useState([]), [stationError, setStationError] = useState('');
  const [showHistory, setShowHistory] = useState(false), [history, setHistory] = useState({ sightings: [] });
  const [historyError, setHistoryError] = useState('');
  const [lat, lng] = area.center;
  useEffect(() => {
    const controller = new AbortController();
    api('/api/stations', controller.signal).then(data => {
      if (!Array.isArray(data.payload)) throw new Error('Station names are unavailable.');
      setStations(data.payload);
    }).catch(error => { if (!controller.signal.aborted) setStationError(error.message); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const controller = new AbortController(); let timer;
    setFeed({ status: 'connecting', trains: [], updated: null, error: '' }); setSelected(null);
    async function load() {
      try {
        const data = await api(`/api/vehicles?lat=${lat}&lng=${lng}&radius=${radius}`, controller.signal);
        const trains = normalizeVehicles(data).filter(t => distance([lat, lng], t.pos) <= radius);
        if (!controller.signal.aborted) { const updated = data.observedAt || new Date().toISOString(); setFeed(previous => ({ status: 'live', trains: withHeadings(trains, previous.trains, Date.parse(updated) - Date.parse(previous.updated)), updated, error: '' })); }
      } catch (error) {
        if (!controller.signal.aborted) setFeed(previous => ({ ...previous, status: previous.updated ? 'stale' : 'error', error: error.message }));
      } finally { if (!controller.signal.aborted) timer = setTimeout(load, 15000); }
    }
    load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [lat, lng, radius, refresh]);
  useEffect(() => {
    if (!showHistory) return;
    const controller = new AbortController(); let timer;
    setHistory({ sightings: [] }); setHistoryError('');
    async function load() {
      try {
        const result = await api(`/api/history?lat=${lat}&lng=${lng}&radius=3000`, controller.signal);
        if (!controller.signal.aborted) { setHistory(result); setHistoryError(''); }
      } catch (error) { if (!controller.signal.aborted) setHistoryError(error.message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 15000); }
    }
    load(); return () => { controller.abort(); clearTimeout(timer); };
  }, [showHistory, lat, lng, refresh]);
  function changeArea(center, label) {
    if (center[0] < 50 || center[0] > 54 || center[1] < 3 || center[1] > 8) { setNotice('Choose a location within the Netherlands.'); return; }
    setArea({ center, label }); setNotice('');
  }
  function locate() {
    if (!navigator.geolocation) { setNotice('Geolocation is unavailable in this browser.'); return; }
    setNotice('Finding your location…');
    navigator.geolocation.getCurrentPosition(p => { const center = [p.coords.latitude, p.coords.longitude]; setLocation(center); changeArea(center, 'your location'); }, () => setNotice('Could not access your location. Choose a station or move the map instead.'), { timeout: 10000, maximumAge: 60000 });
  }
  const visible = feed.trains.filter(t => (filter === 'All' || trainStyle(t.type).label === filter) && t.name.toLowerCase().includes(search.toLowerCase()));
  const nearbyStations = stations.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && distance(area.center, [s.lat, s.lng]) <= radius);
  const selectedTrain = feed.trains.find(t => t.id === selected?.id) || selected;
  const live = feed.status === 'live';
  const routeState = journey.number === selectedNumber ? journey : { loading: Boolean(selectedNumber) };
  const geometry = journeyGeometry(routeState.stops, stations);
  const routeColor = trainStyle(selectedTrain?.type).color;
  const upcoming = nextCall(routeState.stops, clock);
  return <div className="app"><header><div className="brand"><TrainFront size={25}/><div><b>RailRadar <span>NL</span></b><small>Netherlands · passenger train tracker</small></div></div><span className={`status ${live ? 'live' : ''}`} role="status">{live ? '● NS LIVE FEED' : feed.status === 'connecting' ? '● CONNECTING' : feed.status === 'stale' ? '● STALE POSITIONS' : '● FEED UNAVAILABLE'}</span></header>
    <main><section className="map" aria-label="Train map"><MapContainer center={HAGUE} zoom={12} style={{ height: '100%', width: '100%' }}><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" referrerPolicy="strict-origin-when-cross-origin"/><MapActions center={area.center} onSearchHere={setViewport}/>
      {(showTracks || showCrossings) && <RailInfrastructure tracks={showTracks} crossings={showCrossings} onStatus={setRailStatus}/>}
      {showInternational && <International stations={stations} onSelect={setSelected}/>}
      <Circle center={area.center} radius={radius} pathOptions={{ color: '#137e80', fillOpacity: .025, weight: 1, dashArray: '5 6' }}/>
      {selectedTrain && <RouteLayer key={selectedTrain.id} geometry={geometry} color={routeColor} fitRequest={fitRequest}/>}
      {nearbyStations.map(s => <Marker key={s.code} position={[s.lat, s.lng]} icon={stationIcon}><Popup>{s.namen?.lang || s.code}</Popup></Marker>)}
      {visible.map(t => <Marker key={t.id} position={t.pos} icon={trainIcon(t.type, selected?.id === t.id, t.heading)} title={`${t.name} — ${trainStyle(t.type).label} · ${headingLabel(t.heading)}`} alt={`${t.name} — ${trainStyle(t.type).label}`} zIndexOffset={selected?.id === t.id ? 1000 : 100} opacity={live ? 1 : .45} eventHandlers={{ click: () => setSelected(t) }}><Popup><b>{t.name}</b><br/>{t.speed === null ? 'Speed unknown' : `${t.speed} km/h`}<br/>{live ? 'NS-reported position' : 'Last known position — stale'}<br/>{headingLabel(t.heading)}<br/><button onClick={() => setSelected(t)}>View route details</button></Popup></Marker>)}
      {location && <CircleMarker center={location} radius={7} pathOptions={{ color: '#fff', fillColor: '#2563eb', fillOpacity: 1 }}><Popup>Your location</Popup></CircleMarker>}
    </MapContainer><button className="search-map" onClick={() => changeArea(viewport, 'selected map area')}><MapPin size={15}/> Search this map area</button><div className="maptag">{live ? `NS-reported positions · updated ${time(feed.updated)}` : feed.updated ? `Stale positions · last update ${time(feed.updated)}` : 'No live data · no sample trains shown'}</div></section>
    <aside ref={sidebar}>
      <Alerts area={area}/>
      {selectedTrain && <Journey key={selectedTrain.id} train={selectedTrain} stations={stations} state={routeState} upcoming={upcoming} hasRoute={geometry.segments.length > 0} onFit={() => setFitRequest(n => n + 1)} onClose={() => setSelected(null)}/>}
      <div className="intro"><h1>Trains around {area.label}</h1><p>Explore passenger trains, inspect their stops, and see recent observations near your chosen location.</p></div>
      <fieldset className="rail-layers international-controls"><legend>International services</legend><label><input type="checkbox" checked={showInternational} onChange={e => setShowInternational(e.target.checked)}/> International departure stations</label><p>Red INT badges show departures, not live train positions. Coverage: Amsterdam Centraal, Amsterdam Zuid, Schiphol Airport, Rotterdam Centraal and Arnhem Centraal. Select a departure to open its route.</p><div className="controls"><button onClick={() => { setShowInternational(true); changeArea([51.9244, 4.4697], 'Rotterdam Centraal'); }}>Rotterdam</button><button onClick={() => { setShowInternational(true); changeArea([52.378, 4.9003], 'Amsterdam Centraal'); }}>Amsterdam</button></div><p>International GPS coverage is incomplete. No train positions are estimated or invented.</p></fieldset>
      <label className="field">Jump to a station<select value="" onChange={e => { const s = stations.find(s => s.code === e.target.value); if (s) changeArea([s.lat, s.lng], s.namen?.lang || s.code); }} disabled={!stations.length}><option value="">{stations.length ? 'Choose a station…' : 'Station list unavailable'}</option>{stations.filter(s => s.land === 'NL' && Number.isFinite(s.lat) && Number.isFinite(s.lng)).sort((a,b) => (a.namen?.lang || '').localeCompare(b.namen?.lang || '')).map(s => <option key={s.code} value={s.code}>{s.namen?.lang || s.code}</option>)}</select></label>
      {stationError && <p className="muted">Station lookup unavailable; you can still search the map.</p>}
      <div className="controls"><button onClick={locate}><LocateFixed size={16}/> My location</button><button onClick={() => changeArea(HAGUE, 'Den Haag')}><MapPin size={16}/> Den Haag</button></div>
      <fieldset className="rail-layers"><legend>Railway map · ProRail / PDOK</legend><label><input type="checkbox" checked={showTracks} onChange={e => { setShowTracks(e.target.checked); setRailStatus('loading'); }}/> Railway tracks</label><label><input type="checkbox" checked={showCrossings} onChange={e => { setShowCrossings(e.target.checked); setRailStatus('loading'); }}/> Level crossings <small>Zoom in to see</small></label><p>Track detail increases as you zoom in. Infrastructure only; no live freight positions.</p>{(showTracks || showCrossings) && railStatus === 'error' && <p className="rail-error" role="status">Some railway tiles could not load. Train tracking remains available. Toggle the layer to retry.</p>}<a href="https://www.pdok.nl/introductie/-/article/spoorwegen" target="_blank" rel="noopener noreferrer">About this data ↗</a></fieldset>
      <label className="field">Search radius<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={3000}>3 km</option><option value={12000}>12 km</option><option value={30000}>30 km</option></select></label>
      {notice && <p className="notice" role="status">{notice}</p>}{feed.error && <div className="notice error" role="alert">{feed.error}<button onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14}/> Retry</button></div>}
      <div className="marker-legend" aria-label="Train marker colors"><span className="ic">Intercity</span><span className="spr">Sprinter</span><span className="intl">International</span><span className="regional">Other</span></div><div className="sectiontitle"><TrainFront size={17}/> Positioned trains <span>{visible.length} in area</span></div><div className="filters">{['All','Intercity','Sprinter','International','Freight'].map(f => <button key={f} className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}</div>
      <label className="field">Find a train<input value={search} onChange={e => setSearch(e.target.value)} placeholder="Train number or type" type="search"/></label>
      {filter === 'International' && <p className="muted">This filter shows international services with reported coordinates. For additional services, use the red INT departure-station badges.</p>}
      <div className="trainlist">{visible.map(t => <button className={`traincard ${selected?.id === t.id ? 'selected' : ''}`} key={t.id} onClick={() => setSelected(t)}><span className="trainhead"><strong>{t.name}</strong><span>{live ? t.type : 'Stale'}</span></span><span className="details"><span>{t.speed === null ? 'Speed unknown' : `${t.speed} km/h`}</span><span>View stops →</span></span></button>)}</div>
      {!visible.length && <p className="empty">{filter === 'Freight' ? 'Freight tracking is not connected. The current feed provides passenger trains.' : feed.status === 'connecting' ? 'Connecting to NS…' : feed.status === 'error' ? 'Train positions are unavailable. Automatic retry runs every 15 seconds.' : search ? 'No trains match your search.' : 'No matching trains reported in this area.'}</p>}
      <button className="history" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}><History size={19}/> Recent sightings <span>{showHistory ? '−' : '+'}</span></button>
      {showHistory && <section className="historytext"><b>Observed within 3 km · last 30 minutes</b><p>Collected from map requests and enabled background alert locations. Sightings do not confirm an exact passing time. This temporary history resets when the server restarts; saved alert settings do not.</p>{historyError && <p role="alert">{historyError}</p>}{!historyError && !history.sightings.length && <p>No nearby sightings recorded yet.</p>}{history.sightings.map(t => <div className="sighting" key={t.id}><strong>{t.name}</strong><span>{time(t.lastSeen)} · closest {(t.closestMeters / 1000).toFixed(1)} km</span></div>)}{history.limited && <p>High activity: older observations may have been trimmed.</p>}</section>}
      <div className="foot"><Info size={16}/><span>NS positions may be delayed or inaccurate. Map refreshes every 15 seconds after each response. Background alerts monitor only enabled saved locations. Freight is not connected. Never use for railway operations.</span></div>
    </aside></main></div>;
}

