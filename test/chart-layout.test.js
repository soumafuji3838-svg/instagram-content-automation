const test = require('node:test');
const assert = require('node:assert/strict');
const { quantitativeSvg, coverSvg } = require('../src/renderer');
const { demoContent } = require('../src/generator');
const { getDesign } = require('../src/designs');
const account = require('../config/accounts.json')[0];
test('numeric cards isolate labels, values and mini bars', () => {
 const content = demoContent({topic:'証券',account,contentType:'company_report'});
 content.quantitative.metrics.forEach((m,i)=>{m.value=[100,150,-10][i];m.displayValue='123,456億円';});
 const svg=quantitativeSvg({content,account,design:getDesign(account.designId)});
 const widths=[...svg.matchAll(/y="620" width="([\d.]+)"/g)].map(m=>Number(m[1]));
 assert.equal(widths.length,6);assert.ok(widths.every(w=>w>=0&&w<=300));
 assert.ok(svg.includes("font-weight=\"700\""));
 assert.ok(svg.replace(/<[^>]*>/g,'').includes('123,456億円'));
});
test('cover places company logo to the right of title',()=>{
 const content=demoContent({topic:'企業',account,contentType:'company_report'});
 content.subject.domain='example.com';
 const svg=coverSvg({content,account,design:getDesign(account.designId),contentType:'company_report',logos:{'example.com':{buffer:Buffer.from('test')}}});
 assert.match(svg,/<image x="800" y="915"/);
 assert.match(svg,/<text x="54" y="955"/);
});
