'use client';
import { useRef, useState } from 'react';
import { Pane, WMSTileLayer, useMap, useMapEvents } from 'react-leaflet';

const URL = 'https://service.pdok.nl/prorail/spoorwegen/wms/v1_0';
const ATTRIBUTION = '<a href="https://www.pdok.nl/introductie/-/article/spoorwegen" target="_blank" rel="noopener noreferrer">ProRail / PDOK</a> · CC0';
const BOUNDS = [[50.2, 2.5], [55.8, 7.5]];
function RailwayTiles({ layers, onStatus }) {
  const failed = useRef(false);
  return <WMSTileLayer url={URL} layers={layers} version="1.1.1" format="image/png" transparent attribution={ATTRIBUTION} bounds={BOUNDS} noWrap opacity={.85} updateWhenIdle keepBuffer={1} eventHandlers={{
    loading: () => { failed.current = false; onStatus('loading'); },
    tileerror: () => { failed.current = true; onStatus('error'); },
    load: () => { if (!failed.current) onStatus('ready'); },
  }}/>;
}
export default function RailInfrastructure({ tracks, crossings, onStatus }) {
  const map = useMap(), [zoom, setZoom] = useState(map.getZoom());
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) });
  const layers = [tracks ? (zoom >= 14 ? 'spooras' : 'trace') : null, crossings && zoom >= 14 ? 'overweg' : null].filter(Boolean).join(',');
  if (!layers) return null;
  return <Pane name="rail-infrastructure" style={{ zIndex: 350, pointerEvents: 'none' }}><RailwayTiles key={layers} layers={layers} onStatus={onStatus}/></Pane>;
}
