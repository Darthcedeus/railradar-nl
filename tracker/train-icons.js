import L from 'leaflet';
import { trainStyle } from './map-helpers.mjs';
import { trainSprite, viewIndex, paceBand } from './train-sprites.mjs';
const cache = new Map();
// Train numbers are validated as 1–8 digits before they reach the map.
export function trainIcon(train, selected = false) {
  const { key } = trainStyle(train.type), view = viewIndex(train.heading), pace = paceBand(train.speed, train.heading);
  const id = `${key}-${selected}-${view}-${pace}-${train.number}`;
  if (cache.has(id)) return cache.get(id);
  if (cache.size > 600) cache.clear();
  const icon = L.divIcon({
    className: `rail-marker ${selected ? 'is-selected' : ''}`,
    html: `<div class="train-art ${key}">${trainSprite(train.type, train.heading, selected, pace)}</div><span class="train-label ${key}">${String(train.number).replace(/\D/g, '')}</span>`,
    iconSize: [84, 74], iconAnchor: [42, 43], popupAnchor: [0, -34]
  });
  cache.set(id, icon); return icon;
}
