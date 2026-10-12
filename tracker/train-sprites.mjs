import { distance } from './data.mjs';
import { trainStyle } from './map-helpers.mjs';

// Bearings are clockwise from north. Small/no movement keeps the last estimate.
export function withHeadings(trains, previous = [], elapsedMs) {
  const lookup = new Map(previous.map(t => [t.id, t]));
  return trains.map(train => {
    const before = lookup.get(train.id);
    let heading = null;
    if (before && elapsedMs > 0 && elapsedMs <= 90000) {
      const metres = distance(before.pos, train.pos);
      if (metres < 25) heading = before.heading ?? null;
      else if (metres / (elapsedMs / 1000) <= 112) {
        const rad = Math.PI / 180, a = before.pos[0] * rad, b = train.pos[0] * rad;
        const delta = (train.pos[1] - before.pos[1]) * rad;
        heading = (Math.atan2(Math.sin(delta) * Math.cos(b), Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)) / rad + 360) % 360;
      }
    }
    return { ...train, heading };
  });
}
export const directionIndex = heading => Number.isFinite(heading) ? Math.round(((heading % 360) + 360) % 360 / 45) % 8 : 3;
export const headingLabel = heading => Number.isFinite(heading) ? `Last movement: ${['N','NE','E','SE','S','SW','W','NW'][directionIndex(heading)]} (estimated)` : 'Direction not yet known';

// Eight separately projected views, not a rotated flat image: the roof stays on top.
export function trainSprite(type, heading, selected = false) {
  const { key } = trainStyle(type);
  const palette = {
    intercity: ['#ffd43b','#fff0a6','#dba719','#0960a0'],
    sprinter: ['#f0f7fc','#ffffff','#bacbdc','#1678bb'],
    international: ['#e4e9f0','#ffffff','#a9b7c7','#c73150'],
    regional: ['#def4ed','#f4fff9','#8cc4b3','#137b68']
  }[key];
  const [body, roof, shade, stripe] = palette, angle = directionIndex(heading) * Math.PI / 4;
  const dx = Math.sin(angle), dy = -Math.cos(angle), px = Math.cos(angle), py = Math.sin(angle);
  const height = key === 'intercity' ? 17 : 13, length = key === 'international' ? 29 : 26, half = 8;
  const point = (along, across, z = 0) => [40 + dx * along + px * across, 40 + dy * along + py * across - z];
  const coords = points => points.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');
  const poly = (points, fill, stroke = '#29425b', width = .8) => `<polygon points="${coords(points)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  const nose = key === 'international' ? 9 : 4;
  const footprint = [[-length,-half],[length-nose,-half],[length, -half*.52],[length,half*.52],[length-nose,half],[-length,half]];
  const ground = footprint.map(([x,y]) => point(x,y)), top = footprint.map(([x,y],i) => point(x,y,(i===2||i===3)?height-4:height));
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80" width="80" height="80" aria-hidden="true">`;
  if (selected) svg += '<ellipse cx="40" cy="43" rx="35" ry="29" fill="#fff" fill-opacity=".7" stroke="#128c99" stroke-width="2" stroke-dasharray="3 3"/>';
  svg += poly(ground.map(([x,y])=>[x+2,y+4]), '#132a46', 'none').replace('fill="#132a46"', 'fill="#132a46" fill-opacity=".2"');
  const faces = footprint.map((p,i)=>({i,j:(i+1)%footprint.length})).filter(({i,j}) => ground[j][0]-ground[i][0] < -.01).sort((a,b)=>(ground[a.i][1]+ground[a.j][1])-(ground[b.i][1]+ground[b.j][1]));
  for (const {i,j} of faces) {
    svg += poly([ground[i],ground[j],top[j],top[i]], i===5?shade:body);
    const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    const wall=(t,z)=>lerp(lerp(ground[i],ground[j],t),lerp(top[i],top[j],t),z);
    svg += poly([wall(0,.18),wall(1,.18),wall(1,.36),wall(0,.36)],stripe,'none');
    if (i===0||i===4) {
      for(const t of [.18,.72]) {const p=wall(t,0);svg+=`<ellipse cx="${p[0]}" cy="${p[1]+1}" rx="3.4" ry="2.4" fill="#203247" stroke="#718193" stroke-width=".8"/>`;}
      for(const t of [.12,.3,.48,.66,.84]) {
        const row=(low,high)=>poly([wall(t,low),wall(t+.10,low),wall(t+.10,high),wall(t,high)],'#183e5d','#8ad0e3',.4);
        svg+=row(key==='intercity'?.62:.5,.86);
        if(key==='intercity')svg+=row(.27,.5);
      }
    } else {
      svg+=poly([wall(.15,.5),wall(.85,.5),wall(.85,.85),wall(.15,.85)],'#183e5d','#82c8da',.4);
      for(const t of [.2,.8]) {const p=wall(t,.22);svg+=`<circle cx="${p[0]}" cy="${p[1]}" r="1.2" fill="${i===5?'#fa5b61':'#fff6b0'}"/>`;}
    }
  }
  svg += poly(top,roof,'#38536c',.8);
  // Roof stripe and equipment add depth without external raster assets.
  svg += poly([point(-length+5,-2,height+.2),point(length-nose-3,-2,height+.2),point(length-nose-3,2,height+.2),point(-length+5,2,height+.2)],body,'none');
  svg += poly([point(-7,-3,height+.5),point(3,-3,height+.5),point(3,3,height+.5),point(-7,3,height+.5)],'#92a8b8','#627d91',.5);
  // Sloping cab windshield is part of the roof and always points toward the nose.
  svg += poly([point(length-nose-2,-5,height+.4),point(length-1,-3,height-3.4),point(length-1,3,height-3.4),point(length-nose-2,5,height+.4)],'#214a67','#92d6e5',.6);
  return svg+'</svg>';
}
