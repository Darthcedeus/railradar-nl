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

// Orthographic, elevated views of a coupled two-car train. All geometry is local
// to the train; its roof remains upright as the eight bearing views change.
export function trainSprite(type, heading, selected = false) {
  const { key } = trainStyle(type);
  const [body, dark, roof, stripe] = {
    intercity: ['#ffca28', '#c38b13', '#fff1aa', '#1556a0'],
    sprinter: ['#f3f7fb', '#a9becd', '#ffffff', '#1978bb'],
    international: ['#eff1f4', '#a4b2c1', '#ffffff', '#d72f46'],
    regional: ['#e6f5ef', '#89b8aa', '#f7fffb', '#128879']
  }[key];
  const angle = directionIndex(heading) * Math.PI / 4;
  const dx = Math.sin(angle), dy = -Math.cos(angle);
  const px = Math.cos(angle), py = Math.sin(angle);
  const height = key === 'intercity' ? 17 : 13;
  const half = 5.8, nose = key === 'international' ? 12 : 7;
  const point = (x, y, z = 0) => [64 + dx*x + px*y, 65 + (dy*x + py*y)*.68 - z];
  const coords = ps => ps.map(p => p.map(n => n.toFixed(2)).join(',')).join(' ');
  const poly = (ps, fill, stroke = '#35495a', width = .55) =>
    `<polygon points="${coords(ps)}" fill="${fill}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  const line = (ps, stroke, width = .65) =>
    `<polyline points="${coords(ps)}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dot = (p, r, fill) => `<circle cx="${p[0]}" cy="${p[1]}" r="${r}" fill="${fill}"/>`;
  const lerp = (a,b,t) => a.map((v,i)=>v+(b[i]-v)*t);
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 112" width="128" height="112" aria-hidden="true">';
  if (selected) svg += '<ellipse cx="64" cy="65" rx="55" ry="38" fill="#e4fbff" fill-opacity=".65" stroke="#128c99" stroke-width="1.6" stroke-dasharray="3 4"/>';
  // Shadow and the flexible gangway join the cars into one train silhouette.
  svg += '<g opacity=".18">' + poly([point(-49,-7),point(49,-7),point(49,7),point(-49,7)].map(([x,y])=>[x+2,y+4]), '#20374d','none') + '</g>';
  svg += poly([point(-3,-4,3),point(3,-4,3),point(3,4,3),point(-3,4,3)],'#243645');
  svg += poly([point(-3,-4,height-2),point(3,-4,height-2),point(3,4,height-2),point(-3,4,height-2)],'#4b5b66');
  // Draw the further carriage first so the nearer carriage correctly occludes it.
  const cars = [{a:-47,b:-2,cab:false},{a:2,b:47,cab:true}]
    .sort((a,b)=>dy*((a.a+a.b)-(b.a+b.b)));
  for (const car of cars) {
    const {a,b,cab} = car;
    const shoulder = cab ? b-nose : b-2;
    const footprint = [[a,-half],[shoulder,-half],[b,-half*.45],[b,half*.45],[shoulder,half],[a,half]];
    const topZ = i => cab && (i===2||i===3) ? 7.5 : height;
    const ground = footprint.map(([x,y])=>point(x,y,3));
    const top = footprint.map(([x,y],i)=>point(x,y,topZ(i)));
    // Bogies: two pairs of small steel wheels beneath each carriage, not bus tyres.
    for (const x of [a+8,b-10]) {
      svg += poly([point(x-4,-4,2),point(x+4,-4,2),point(x+4,4,2),point(x-4,4,2)],'#1b2b39');
      for (const side of [-1,1]) for (const offset of [-2.5,2.5]) {
        const p=point(x+offset,side*half,1.7);
        svg += `<ellipse cx="${p[0]}" cy="${p[1]}" rx="1.6" ry="1.7" fill="#283747" stroke="#8b9ba8" stroke-width=".45"/>`;
      }
    }
    const faces = footprint.map((_,i)=>({i,j:(i+1)%6}))
      .filter(({i,j})=>ground[j][0]-ground[i][0]<-.001)
      .sort((a,b)=>(ground[a.i][1]+ground[a.j][1])-(ground[b.i][1]+ground[b.j][1]));
    for (const {i,j} of faces) {
      const wall=(t,z)=>lerp(lerp(ground[i],ground[j],t),lerp(top[i],top[j],t),z);
      svg += poly([ground[i],ground[j],top[j],top[i]], i===4||i===5 ? dark : body);
      const band=(lo,hi,fill)=>poly([wall(0,lo),wall(1,lo),wall(1,hi),wall(0,hi)],fill,'none');
      svg += band(0,.13,'#445767');
      svg += band(.23,key==='intercity'?.52:.35,stripe);
      if(i===0||i===4) {
        // Continuous rows of narrow rail windows and inset double doors.
        for(const t of [.10,.24,.38,.52,.66,.80]) {
          const win=(lo,hi)=>poly([wall(t,lo),wall(t+.085,lo),wall(t+.085,hi),wall(t,hi)],'#16354c','#7bafc4',.25);
          svg += win(key==='intercity'?.66:.52,.87);
          if(key==='intercity') svg += win(.29,.47);
        }
        for(const t of [.025,.91]) {
          svg += poly([wall(t,.15),wall(t+.065,.15),wall(t+.065,.88),wall(t,.88)],body,'#687e88',.35);
          svg += line([wall(t+.033,.16),wall(t+.033,.85)],'#687e88',.3);
        }
        svg += line([wall(0,.95),wall(1,.95)],roof,.65);
      } else if(cab && i!==5) {
        for(const t of [.18,.82]) svg += dot(wall(t,.35),.85,'#fff7cc');
      } else {
        svg += poly([wall(.18,.15),wall(.82,.15),wall(.82,.85),wall(.18,.85)],'#394d5e');
        if(!cab && i===5) for(const t of [.12,.88]) svg += dot(wall(t,.32),.7,'#f76b62');
      }
    }
    // Crown and bevels give the roof actual volume, rather than a flat bus roof.
    const crown=footprint.map(([x,y],i)=>point(x,y*.68,topZ(i)+1.5));
    svg += poly(top,roof);
    for(let i=0;i<6;i++) svg += poly([top[i],top[(i+1)%6],crown[(i+1)%6],crown[i]],i<3?roof:body,'#7d8b91',.25);
    svg += poly(crown,roof,'#87959c',.35);
    const roofEnd=cab?shoulder-2:b-4;
    svg += line([point(a+3,0,height+1.7),point(roofEnd,0,height+1.7)],'#c3cdd1',.6);
    // HVAC housing plus a raised diamond pantograph are recognisable rail details.
    const vent=a+7;
    svg += poly([point(vent,-3,height+1.6),point(vent+8,-3,height+1.6),point(vent+8,3,height+1.6),point(vent,3,height+1.6)],'#8f9fa9','#677b89',.4);
    for(let x=vent+1;x<vent+8;x+=1.5) svg+=line([point(x,-2.3,height+1.7),point(x,2.3,height+1.7)],'#dae2e6',.4);
    if(!cab) {
      const x=b-11, z=height+2;
      svg += line([point(x-4,0,z),point(x,0,z+5),point(x+5,0,z+2),point(x,0,z),point(x-4,0,z)],'#374755',.9);
      svg += line([point(x,-4,z+5),point(x,4,z+5)],'#263847',1.1);
    }
    if(cab) {
      // Slanted panoramic cab glass, tapered nose, and a central coupler.
      svg += poly([point(shoulder-1,-4,height+1.7),point(b-3,-2.9,9.7),point(b-3,2.9,9.7),point(shoulder-1,4,height+1.7)],'#17394f','#86b5c9',.6);
      svg += line([point(shoulder,0,height+1.8),point(b-3,0,9.8)],'#789ead',.4);
      svg += line([point(b-3,-2.6,8.7),point(b-1,0,7.9),point(b-3,2.6,8.7)],stripe,1.5);
      svg += line([point(b,0,3.5),point(b+2,0,3.5)],'#263847',1.5);
    }
  }
  return svg+'</svg>';
}
