// Code-native train pictogram: no remote assets or image-generation dependency.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
const crc = buffer => { let c=0xffffffff;for(const b of buffer){c^=b;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0; };
function chunk(type,data){const tag=Buffer.from(type),size=Buffer.alloc(4),sum=Buffer.alloc(4);size.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,sum]);}
for(const size of [192,512]){
 const raw=Buffer.alloc(size*(1+size*4));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const a=x/size,b=y/size;let color=[16,36,60];
  if(a>.24&&a<.76&&b>.16&&b<.76)color=[109,217,195];
  if(a>.3&&a<.7&&b>.25&&b<.48)color=[16,36,60];
  if(((a-.35)**2+(b-.63)**2<.002)||((a-.65)**2+(b-.63)**2<.002))color=[255,255,255];
  if(b>.76&&b<.88&&(Math.abs(a-(.33-(b-.76)*.5))<.022||Math.abs(a-(.67+(b-.76)*.5))<.022))color=[255,255,255];
  const i=y*(1+size*4)+1+x*4;raw.set([...color,255],i);
 }
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
 writeFileSync(`public/icon-${size}.png`,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
