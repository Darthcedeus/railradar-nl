import React, { useEffect, useState } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import { internationalDeparture } from './journey-helpers.mjs';

import { INTERNATIONAL_HUBS as HUBS } from './international-hubs.mjs';
const icon = L.divIcon({ className: 'international-hub', html: '<span>INT</span>', iconSize: [38, 28], iconAnchor: [19, 14] });
const time = value => new Date(value).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Amsterdam' });
export default function International({ stations, onSelect }) {
  const [boards, setBoards] = useState({});
  useEffect(() => {
    const controller = new AbortController(); let timer;
    async function load() {
      await Promise.all(HUBS.map(async code => {
        try {
          const response = await fetch(`/api/departures?station=${code}`, { signal: controller.signal });
          const data = await response.json();
          if (!response.ok || !Array.isArray(data.payload?.departures)) throw new Error(data.error || 'Departure board unavailable.');
          const services = data.payload.departures.filter(internationalDeparture).filter(d => /^\d{1,8}$/.test(d.product?.number || '')).slice(0, 12);
          if (!controller.signal.aborted) setBoards(previous => ({ ...previous, [code]: { services, updated: Date.now() } }));
        } catch (error) {
          if (!controller.signal.aborted) setBoards(previous => ({ ...previous, [code]: { error: error.message } }));
        }
      }));
      if (!controller.signal.aborted) timer = setTimeout(load, 60000);
    }
    load(); return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return HUBS.map(code => {
    const station = stations.find(s => s.code?.toLowerCase() === code);
    if (!station || !Number.isFinite(station.lat) || !Number.isFinite(station.lng)) return null;
    const board = boards[code], name = station.namen?.lang || code;
    return <Marker key={code} position={[station.lat, station.lng]} icon={icon} zIndexOffset={200} title={`International departures · ${name}`}><Popup minWidth={250} maxWidth={310}>
      <div className="international-board"><strong>{name} · International</strong><p>Departure station, not a live train position. Select a service to see its route.</p>
      {!board && <p role="status">Loading departures…</p>}{board?.error && <p role="alert">{board.error} Retrying in one minute.</p>}
      {board?.services?.length === 0 && <p>No international departures in the returned board.</p>}
      {board?.services?.map(d => <button key={`${d.product.number}-${d.plannedDateTime}`} onClick={() => onSelect({ id: `intl:${d.product.number}:${code}`, number: String(d.product.number), type: d.product.categoryCode, name: `${d.product.longCategoryName || d.product.categoryCode} ${d.product.number}`, speed: null, source: `Departure board · ${name} · not live GPS`, departure: d, stationName: name })}>
        <strong>{d.product.categoryCode} {d.product.number} → {d.direction}</strong><span>{d.cancelled ? 'Cancelled' : time(d.actualDateTime || d.plannedDateTime)} · Platform {d.actualTrack || d.plannedTrack || 'unknown'}{d.actualTrack && d.plannedTrack && d.actualTrack !== d.plannedTrack ? ` (was ${d.plannedTrack})` : ''}</span>
      </button>)}{board?.updated && <small>Updated {time(board.updated)} · refreshed every minute</small>}
      </div>
    </Popup></Marker>;
  });
}
