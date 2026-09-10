// Container-relative SVG layout. No content is silently truncated.
function escape(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'); }
function units(value) { return [...String(value)].reduce((n,c)=>n+(/[\x00-\x7f]/.test(c)?0.65:1),0); }
function grid(box, count, gap=16) {
 if (!Number.isInteger(count)||count<1) throw new Error('Invalid grid count');
 const width=(box.width-gap*(count-1))/count;
 if(width<=0)throw new Error('Grid overflow');
 return Array.from({length:count},(_,i)=>({...box,x:box.x+i*(width+gap),width}));
}
function fitText(value, box, {size=30,minSize=20,color='#062A55',weight=500,anchor='middle'}={}) {
 const text=String(value); if(!text.trim())throw new Error('Layout: empty required text');
 for(let font=size;font>=minSize;font--) {
  const capacity=box.width/(font*1.04),lines=[];let line='';
  for(const char of text) {if(char==='\n'){lines.push(line);line='';continue;}if(line&&units(line+char)>capacity){lines.push(line);line='';}line+=char;}
  if(line)lines.push(line);
  const lineHeight=font*1.35;
  if(lines.length*lineHeight>box.height)continue;
  const x=anchor==='middle'?box.x+box.width/2:box.x;
  return lines.map((line,i)=>`<text x="${x}" y="${box.y+font+i*lineHeight}" font-size="${font}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}" textLength="${Math.min(box.width,units(line)*font)}" lengthAdjust="spacingAndGlyphs">${escape(line)}</text>`).join('');
 }
 throw new Error(`Layout overflow: ${text.slice(0,40)}`);
}
function assertSeries(content) {
 const metrics=content.quantitative?.metrics||[], columns=content.comparison?.columns||[];
 if(metrics.length<3||metrics.length>5||columns.length<3||columns.length>5)throw new Error('比較データは3〜5件必要です。');
 if(new Set(metrics.map(m=>m.label)).size!==metrics.length)throw new Error('グラフラベルが重複しています。');
 if((content.comparison.rows||[]).some(r=>r.values.length!==columns.length))throw new Error('比較対象とセル数が一致しません。');
 if(content.postType==='company_comparison' && (metrics.length!==columns.length || metrics.some((m,i)=>m.entityType!=='company'||m.label!==columns[i].name||m.companyDomain!==columns[i].domain)))throw new Error('企業比較のグラフと比較表の企業・順序・ドメインが一致しません。');
}
module.exports={grid,fitText,assertSeries};
