import L from 'leaflet';
import { trainStyle } from './map-helpers.mjs';
import { trainSprite, directionIndex } from './train-sprites.mjs';
const cache = new Map();
export function trainIcon(type, selected = false, heading = null) {
  const { key } = trainStyle(type), id = `${key}-${selected}-${directionIndex(heading)}`;
  if (cache.has(id)) return cache.get(id);
  const icon = L.divIcon({ className: `rail-marker ${selected ? 'is-selected' : ''}`, html: `<div class="train-art ${key}">${trainSprite(type, heading, selected)}</div>`, iconSize: [84, 74], iconAnchor: [42, 43], popupAnchor: [0, -34] });
  cache.set(id, icon); return icon;
}
