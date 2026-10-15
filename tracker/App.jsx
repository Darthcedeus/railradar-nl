'use client';
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { MapContainer, TileLayer, Marker, Popup, Circle, CircleMarker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import RailInfrastructure from './RailInfrastructure.jsx';
import { trainIcon } from './train-icons.js';
import { withHeadings, directionIndex } from './train-sprites.mjs';
import { trainStyle, journeyGeometry } from './map-helpers.mjs';
import { nextCall, platform } from './journey-helpers.mjs';
import { compass } from './i18n.mjs';
import { LanguageContext, useLanguage, useT, useTheme } from './settings.js';
import International from './International.jsx';
import Alerts from './Alerts.jsx';
import { TrainFront, MapPin, History, LocateFixed, Info, RefreshCw, Sun, Moon, SunMoon, Crosshair } from 'lucide-react';
import { HAGUE, normalizeVehicles, distance } from './data.mjs';

const stationIcon = L.divIcon({ className: 'station-icon', html: '<span>●</span>', iconSize: [18, 18] });
const FILTERS = [['All', 'All'], ['Intercity', 'Intercity'], ['Sprinter', 'Sprinter'], ['International', 'International'], ['Other passenger', 'Other']];
const GLIDE_MS = 2500;
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const time = value => value ? new Date(value).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' }) : '—';
async function api(path, signal) {
  const response = await fetch(path, { signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}
function MapActions({ center, radius, follow, viewport, onDrag }) {
  const map = useMap();
  // Zoom so the whole search circle (3, 12 or 30 km) is visible. While following,
  // the map already tracks the train, so moving the search area must not re-zoom it.
  useEffect(() => { if (!follow) map.flyToBounds(L.latLng(center).toBounds(radius * 2), { padding: [10, 10], maxZoom: 15 }); }, [map, center, radius]);
  // Zoom buckets let CSS scale sprites down when zoomed out and show number labels when zoomed in.
  const setZoomBucket = () => { const z = map.getZoom(); map.getContainer().dataset.zoom = z <= 10 ? 'far' : z <= 11 ? 'mid' : z <= 12 ? 'normal' : 'near'; };
  useEffect(setZoomBucket, [map]);
  useMapEvents({
    moveend: () => { const c = map.getCenter(); viewport.current = [c.lat, c.lng]; },
    zoomend: setZoomBucket,
    dragstart: onDrag,
  });
  return null;
}
// Glides between reported positions instead of jumping, and pans the map along when following.
function TrainMarker({ train, selected, following, live, t, onSelect, headingText }) {
  const map = useMap(), ref = useRef(null), frame = useRef(0);
  const [initial] = useState(train.pos);
  const [lat, lng] = train.pos;
  useEffect(() => {
    const marker = ref.current; if (!marker) return;
    const from = marker.getLatLng(), to = L.latLng(lat, lng), gap = from.distanceTo(to);
    cancelAnimationFrame(frame.current);
    const place = position => { marker.setLatLng(position); if (following) map.panTo(position, { animate: false }); };
    // Skip the glide for tiny moves, implausible jumps, hidden tabs and reduced-motion users.
    if (gap < 2 || gap > 6000 || document.hidden || reducedMotion()) { place(to); return; }
    const start = performance.now();
    const step = now => {
      const k = Math.min(1, (now - start) / GLIDE_MS), e = k < .5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      place(L.latLng(from.lat + (to.lat - from.lat) * e, from.lng + (to.lng - from.lng) * e));
      if (k < 1) frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [lat, lng]);
  // Centre on the train as soon as following starts.
  useEffect(() => { if (following && ref.current) map.panTo(ref.current.getLatLng()); }, [following]);
  const label = t(trainStyle(train.type).label);
  return <Marker ref={ref} position={initial} icon={trainIcon(train, selected)} title={`${train.name} — ${label} · ${headingText(train.heading)}`} alt={`${train.name} — ${label}`} zIndexOffset={selected ? 1000 : 100} opacity={live ? 1 : .45} eventHandlers={{ click: () => onSelect(train) }}>
    <Popup><b>{train.name}</b><br/>{speedText(train.speed, t)}<br/>{live ? t('NS-reported position') : t('Last known position — stale')}<br/>{headingText(train.heading)}<br/><button onClick={() => onSelect(train)}>{t('View route details')}</button></Popup>
  </Marker>;
}
function speedText(speed, t, unknown = 'Speed unknown') { return speed === null ? t(unknown) : `${Math.round(speed)} km/h`; }
function RouteLayer({ geometry, color, fitRequest, dark }) {
  const map = useMap();
  useEffect(() => {
    if (fitRequest && geometry.points.length > 1) map.fitBounds(geometry.points.map(p => p.pos), { padding: [45, 65], maxZoom: 13 });
  }, [map, fitRequest]);
  const casing = dark ? '#0b1726' : '#fff';
  return <>
    <Polyline positions={geometry.segments} pathOptions={{ color: casing, weight: 8, opacity: .95 }} interactive={false}/>
    <Polyline positions={geometry.segments} pathOptions={{ color, weight: 4, opacity: .95, dashArray: '10 5' }} interactive={false}/>
    {geometry.points.filter(p => !p.passing).map((p, i) => <CircleMarker key={i} center={p.pos} radius={4} pathOptions={{ color, weight: 2, fillColor: casing, fillOpacity: 1 }}><Popup>{p.name}</Popup></CircleMarker>)}
  </>;
}
function Journey({ train, stations, state, onClose, onFit, hasRoute, upcoming, canFollow, follow, onFollow, positioned }) {
  const { t } = useT();
  const names = new Map(stations.map(s => [String(s.UICCode), s.namen?.lang || s.namen?.middel]));
  const stopName = s => names.get(String(s?.stop?.uicCode)) || s?.stop?.name || s?.stop?.code || t('Unknown station');
  const track = platform(upcoming?.event);
  const following = upcoming?.action === 'Departs' ? nextCall(state.stops?.slice(upcoming.index + 1)) : null;
  return <section className="journey" aria-label={t('Train details')}><div className="trainhead"><h2>{train.name}</h2><button onClick={onClose} aria-label={t('Close train details')}>×</button></div><p>{t('Speed: {speed} · {source}', { speed: speedText(train.speed, t, 'Unknown'), source: train.source })}</p>
    {canFollow && <div className="follow-row"><button className={`follow ${follow ? 'active' : ''}`} aria-pressed={follow} onClick={onFollow}><Crosshair size={15}/> {follow ? t('Stop following') : t('Follow train')}</button>{follow && <small>{positioned ? t('The map follows this train. Drag the map to stop.') : t('Waiting for a new position report…')}</small>}</div>}
    {upcoming && <div className="next-stop" aria-live="polite"><small>{t(upcoming.label)}{state.error ? t(' · stale data') : ''}</small><h3>{stopName(upcoming.stop)}</h3><div className="next-stop-meta"><span>{t(upcoming.action)} <b>{time(upcoming.event.actualTime || upcoming.event.plannedTime)}</b></span><span className={track.changed ? 'track-changed' : ''}>{t('Platform')} <b>{t(track.value)}</b>{track.changed && <small>{t('Changed from {track}', { track: track.planned })}</small>}</span></div><p>{t('Based on reported times, not confirmed by GPS.')}{state.updated && ` ${t('Checked {time}.', { time: time(state.updated) })}`}</p></div>}
    {!upcoming && state.stops?.length > 0 && <p>{t('No upcoming timed stop reported. The journey may have ended or its timing data may be incomplete.')}</p>}
    {following && <p><strong>{t('Then: {stop}', { stop: stopName(following.stop) })}</strong> · {t(following.action.toLowerCase())} {time(following.event.actualTime || following.event.plannedTime)} · {t('Platform')} {t(platform(following.event).value)}</p>}
    {train.departure && <p>{train.departure.cancelled ? `${t('This departure is cancelled.')} ` : ''}{t('Departure-board service from {station} toward {direction}. Its station marker is not the train’s location.', { station: train.stationName, direction: train.departure.direction })}</p>}
    {hasRoute && <p className="route-description">{t('Dashed line: approximate route through NS-reported stops and passing points.')} <button className="fit-route" onClick={onFit}>{t('Fit route on map')}</button></p>}{state.stops && !hasRoute && <p>{t('Not enough location data to draw this route.')}</p>}{state.loading && <p role="status">{t('Loading route…')}</p>}{state.error && <p role="alert">{t(state.error)}</p>}
    {state.stops?.length === 0 && <p>{t('No stops reported for this service.')}</p>}
    {state.stops && <details className="full-route"><summary>{t('Full route · {count} reported points', { count: state.stops.length })}</summary><ol className="stops">{state.stops.map((s, i) => {
      const arrival = s.arrivals?.[0], departure = s.departures?.[0];
      const event = departure || arrival;
      const name = names.get(String(s.stop?.uicCode)) || s.stop?.name || s.stop?.code || `Station ${s.stop?.uicCode || i + 1}`;
      const track = event?.actualTrack || event?.plannedTrack;
      return <li className={upcoming?.index === i ? 'upcoming-call' : ''} key={`${s.id || s.stop?.uicCode}-${i}`}><span><strong>{name}{upcoming?.index === i ? t(' · Upcoming') : ''}</strong><small>{event?.cancelled ? t('Cancelled') : event ? `${t(departure ? 'Departs' : 'Arrives')} ${time(event.actualTime || event.plannedTime)}` : s.status === 'PASSING' ? t('Passes through') : t('No time reported')}{track ? ` · ${t('Platform')} ${track}` : ''}{platform(event).changed ? ` ${t('(changed from {track})', { track: event.plannedTrack })}` : ''}{s.status ? ` · ${s.status}` : ''}</small></span></li>;
    })}</ol></details>}
  </section>;
}
export default function App() {
  const language = useLanguage(), { lang, t } = language;
  const theme = useTheme();
  const sidebar = useRef(null);
  const [clock, setClock] = useState(Date.now);
  const [showInternational, setShowInternational] = useState(true);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const [showTracks, setShowTracks] = useState(true), [showCrossings, setShowCrossings] = useState(false);
  const [railStatus, setRailStatus] = useState('loading');
  const [area, setArea] = useState({ center: HAGUE, label: 'Den Haag' });
  const viewport = useRef(HAGUE), [radius, setRadius] = useState(12000);
  const [location, setLocation] = useState(null), [notice, setNotice] = useState('');
  const [filter, setFilter] = useState('All'), [search, setSearch] = useState('');
  const [feed, setFeed] = useState({ status: 'connecting', trains: [], updated: null, error: '' });
  const [refresh, setRefresh] = useState(0), [selected, setSelected] = useState(null);
  const [follow, setFollow] = useState(false);
  const [journey, setJourney] = useState({ loading: false });
  const [fitRequest, setFitRequest] = useState(0);
  const selectedNumber = selected?.number;
  useEffect(() => { setFollow(false); }, [selected?.id]);
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
    // When the search area moves along with a followed train, keep the trains and selection on screen.
    if (!area.follow) { setFeed({ status: 'connecting', trains: [], updated: null, error: '' }); setSelected(null); }
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
  const followed = follow ? feed.trains.find(tr => tr.id === selected?.id) : null;
  // Move the search area along once the train is well away from its centre, so it stays in the feed.
  useEffect(() => {
    if (followed && distance(area.center, followed.pos) > radius * .4 && followed.pos[0] >= 50 && followed.pos[0] <= 54 && followed.pos[1] >= 3 && followed.pos[1] <= 8) setArea({ center: followed.pos, label: followed.name, follow: true });
  }, [followed?.pos]);
  const headingText = heading => Number.isFinite(heading) ? t('Last movement: {direction} (estimated)', { direction: compass(lang, directionIndex(heading)) }) : t('Direction not yet known');
  const visible = feed.trains.filter(tr => tr.id === selected?.id || ((filter === 'All' || trainStyle(tr.type).label === filter) && tr.name.toLowerCase().includes(search.toLowerCase())));
  const nearbyStations = useMemo(() => stations.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng) && distance(area.center, [s.lat, s.lng]) <= radius), [stations, area.center, radius]);
  const stationOptions = useMemo(() => stations.filter(s => s.land === 'NL' && Number.isFinite(s.lat) && Number.isFinite(s.lng)).sort((a, b) => (a.namen?.lang || '').localeCompare(b.namen?.lang || '')), [stations]);
  const selectedTrain = feed.trains.find(tr => tr.id === selected?.id) || selected;
  const live = feed.status === 'live';
  const routeState = journey.number === selectedNumber ? journey : { loading: Boolean(selectedNumber) };
  const geometry = journeyGeometry(routeState.stops, stations);
  const routeColor = trainStyle(selectedTrain?.type).color;
  const upcoming = nextCall(routeState.stops, clock);
  const ThemeIcon = { auto: SunMoon, light: Sun, dark: Moon }[theme.mode];
  const status = live ? 'NS LIVE' : feed.status === 'connecting' ? 'CONNECTING' : feed.status === 'stale' ? 'STALE POSITIONS' : 'FEED UNAVAILABLE';
  return <LanguageContext.Provider value={language}><div className="app"><header><div className="brand"><TrainFront size={25}/><div><b>RailRadar <span>NL</span></b><small>{t('Netherlands · passenger train tracker')}</small></div></div>
    <div className="header-actions"><span className={`status ${live ? 'live' : ''}`} role="status">● {t(status)}</span>
      <button className="icon-button" onClick={() => language.setLang(lang === 'en' ? 'nl' : 'en')} aria-label={t('Switch to Dutch')} title={t('Switch to Dutch')}>{lang === 'en' ? 'NL' : 'EN'}</button>
      <button className="icon-button" onClick={theme.cycle} aria-label={t({ auto: 'Theme: automatic (follows your device)', light: 'Theme: light', dark: 'Theme: dark' }[theme.mode])} title={t({ auto: 'Theme: automatic (follows your device)', light: 'Theme: light', dark: 'Theme: dark' }[theme.mode])}><ThemeIcon size={17}/></button></div></header>
    <main><section className="map" aria-label={t('Train map')}><MapContainer center={HAGUE} zoom={12} style={{ height: '100%', width: '100%' }}><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" referrerPolicy="strict-origin-when-cross-origin"/><MapActions center={area.center} radius={radius} follow={follow} viewport={viewport} onDrag={() => setFollow(false)}/>
      {(showTracks || showCrossings) && <RailInfrastructure tracks={showTracks} crossings={showCrossings} onStatus={setRailStatus}/>}
      {showInternational && <International stations={stations} onSelect={setSelected}/>}
      <Circle center={area.center} radius={radius} pathOptions={{ color: theme.dark ? '#4fc3b0' : '#137e80', fillOpacity: .025, weight: 1, dashArray: '5 6' }}/>
      {selectedTrain && <RouteLayer key={selectedTrain.id} geometry={geometry} color={routeColor} fitRequest={fitRequest} dark={theme.dark}/>}
      {nearbyStations.map(s => <Marker key={s.code} position={[s.lat, s.lng]} icon={stationIcon}><Popup>{s.namen?.lang || s.code}</Popup></Marker>)}
      {visible.map(tr => <TrainMarker key={tr.id} train={tr} selected={selected?.id === tr.id} following={follow && selected?.id === tr.id} live={live} t={t} onSelect={setSelected} headingText={headingText}/>)}
      {location && <CircleMarker center={location} radius={7} pathOptions={{ color: '#fff', fillColor: '#2563eb', fillOpacity: 1 }}><Popup>{t('Your location')}</Popup></CircleMarker>}
    </MapContainer><button className="search-map" onClick={() => changeArea(viewport.current, 'selected map area')}><MapPin size={15}/> {t('Search this map area')}</button><div className="maptag">{live ? t('NS-reported positions · updated {time}', { time: time(feed.updated) }) : feed.updated ? t('Stale positions · last update {time}', { time: time(feed.updated) }) : t('No live data · no sample trains shown')}</div></section>
    <aside ref={sidebar}>
      <Alerts area={area}/>
      {selectedTrain && <Journey key={selectedTrain.id} train={selectedTrain} stations={stations} state={routeState} upcoming={upcoming} hasRoute={geometry.segments.length > 0} onFit={() => setFitRequest(n => n + 1)} onClose={() => setSelected(null)} canFollow={Boolean(selectedTrain.pos)} follow={follow} positioned={Boolean(followed)} onFollow={() => setFollow(f => !f)}/>}
      <div className="intro"><h1>{t('Trains around {place}', { place: t(area.label) })}</h1><p>{t('Explore passenger trains, inspect their stops, and see recent observations near your chosen location.')}</p></div>
      <fieldset className="rail-layers international-controls"><legend>{t('International services')}</legend><label><input type="checkbox" checked={showInternational} onChange={e => setShowInternational(e.target.checked)}/> {t('International departure stations')}</label><p>{t('Red INT badges show departures, not live train positions. Coverage: Amsterdam Centraal, Amsterdam Zuid, Schiphol Airport, Rotterdam Centraal and Arnhem Centraal. Select a departure to open its route.')}</p><div className="controls"><button onClick={() => { setShowInternational(true); changeArea([51.9244, 4.4697], 'Rotterdam Centraal'); }}>Rotterdam</button><button onClick={() => { setShowInternational(true); changeArea([52.378, 4.9003], 'Amsterdam Centraal'); }}>Amsterdam</button></div><p>{t('International GPS coverage is incomplete. No train positions are estimated or invented.')}</p></fieldset>
      <label className="field">{t('Jump to a station')}<select value="" onChange={e => { const s = stations.find(s => s.code === e.target.value); if (s) changeArea([s.lat, s.lng], s.namen?.lang || s.code); }} disabled={!stations.length}><option value="">{stations.length ? t('Choose a station…') : t('Station list unavailable')}</option>{stationOptions.map(s => <option key={s.code} value={s.code}>{s.namen?.lang || s.code}</option>)}</select></label>
      {stationError && <p className="muted">{t('Station lookup unavailable; you can still search the map.')}</p>}
      <div className="controls"><button onClick={locate}><LocateFixed size={16}/> {t('My location')}</button><button onClick={() => changeArea(HAGUE, 'Den Haag')}><MapPin size={16}/> Den Haag</button></div>
      <fieldset className="rail-layers"><legend>{t('Railway map · ProRail / PDOK')}</legend><label><input type="checkbox" checked={showTracks} onChange={e => { setShowTracks(e.target.checked); setRailStatus('loading'); }}/> {t('Railway tracks')}</label><label><input type="checkbox" checked={showCrossings} onChange={e => { setShowCrossings(e.target.checked); setRailStatus('loading'); }}/> {t('Level crossings')} <small>{t('Zoom in to see')}</small></label><p>{t('Track detail increases as you zoom in. Infrastructure only; no live freight positions.')}</p>{(showTracks || showCrossings) && railStatus === 'error' && <p className="rail-error" role="status">{t('Some railway tiles could not load. Train tracking remains available. Toggle the layer to retry.')}</p>}<a href="https://www.pdok.nl/introductie/-/article/spoorwegen" target="_blank" rel="noopener noreferrer">{t('About this data ↗')}</a></fieldset>
      <label className="field">{t('Search radius')}<select value={radius} onChange={e => setRadius(Number(e.target.value))}><option value={3000}>3 km</option><option value={12000}>12 km</option><option value={30000}>30 km</option></select></label>
      {notice && <p className="notice" role="status">{t(notice)}</p>}{feed.error && <div className="notice error" role="alert">{t(feed.error)}<button onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14}/> {t('Retry')}</button></div>}
      <div className="marker-legend" aria-label={t('Train marker colors')}><span className="ic">Intercity</span><span className="spr">Sprinter</span><span className="intl">{t('International')}</span><span className="regional">{t('Other')}</span></div><div className="sectiontitle"><TrainFront size={17}/> {t('Positioned trains')} <span>{t('{count} in area', { count: visible.length })}</span></div><div className="filters">{FILTERS.map(([f, label]) => <button key={f} className={filter === f ? 'active' : ''} aria-pressed={filter === f} onClick={() => setFilter(f)}>{t(label)}</button>)}</div>
      <label className="field">{t('Find a train')}<input value={search} onChange={e => setSearch(e.target.value)} placeholder={t('Train number or type')} type="search"/></label>
      {filter === 'International' && <p className="muted">{t('This filter shows international services with reported coordinates. For additional services, use the red INT departure-station badges.')}</p>}
      <div className="trainlist">{visible.map(tr => <button className={`traincard ${selected?.id === tr.id ? 'selected' : ''}`} key={tr.id} onClick={() => setSelected(tr)}><span className="trainhead"><strong>{tr.name}</strong><span>{live ? tr.type : t('Stale')}</span></span><span className="details"><span>{speedText(tr.speed, t)}</span><span>{t('View stops →')}</span></span></button>)}</div>
      {!visible.length && <p className="empty">{feed.status === 'connecting' ? t('Connecting to NS…') : feed.status === 'error' ? t('Train positions are unavailable. Automatic retry runs every 15 seconds.') : search ? t('No trains match your search.') : t('No matching trains reported in this area.')}</p>}
      <button className="history" aria-expanded={showHistory} onClick={() => setShowHistory(v => !v)}><History size={19}/> {t('Recent sightings')} <span>{showHistory ? '−' : '+'}</span></button>
      {showHistory && <section className="historytext"><b>{t('Observed within 3 km · last 30 minutes')}</b><p>{t('Collected from map requests and enabled background alert locations. Sightings do not confirm an exact passing time. This temporary history resets when the server restarts; saved alert settings do not.')}</p>{historyError && <p role="alert">{t(historyError)}</p>}{!historyError && !history.sightings.length && <p>{t('No nearby sightings recorded yet.')}</p>}{history.sightings.map(s => <div className="sighting" key={s.id}><strong>{s.name}</strong><span>{t('{time} · closest {km} km', { time: time(s.lastSeen), km: (s.closestMeters / 1000).toFixed(1) })}</span></div>)}{history.limited && <p>{t('High activity: older observations may have been trimmed.')}</p>}</section>}
      <div className="foot"><Info size={16}/><span>{t('NS positions may be delayed or inaccurate. Map refreshes every 15 seconds after each response. Background alerts monitor only enabled saved locations. Freight is not connected. Never use for railway operations.')}</span></div>
    </aside></main></div></LanguageContext.Provider>;
}
