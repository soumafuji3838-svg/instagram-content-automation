const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchCoverPhoto } = require('../src/photo');
const { needsResearch } = require('../src/quality-repair');
const { comparisonEvidenceIssues } = require('../src/quality');
test('missing comparison facts trigger research even with high scores', () => {
 const content = { comparison: { rows: [{ label: '主要事業', values: ['確認できず', '銀行', '証券'] }] } };
 assert.equal(comparisonEvidenceIssues(content).length, 1);
 assert.equal(needsResearch({content, quality: {overallScore: 100}}), true);
});
test('photo selection rejects unsafe candidates and stops after eight reviews', async () => {
 const previous = global.fetch, pexels = process.env.PEXELS_API_KEY, openai = process.env.OPENAI_API_KEY;
 process.env.PEXELS_API_KEY = 'test'; process.env.OPENAI_API_KEY = 'test';
 let reviews = 0;
 global.fetch = async url => {
  if (String(url).includes('pexels.com/v1')) return new Response(JSON.stringify({photos:Array.from({length:12}, (_,i)=>({id:i,src:{landscape:'https://example.com/photo.jpg'}}))}));
  if (String(url).includes('api.openai.com')) { reviews++; return new Response(JSON.stringify({output_text:JSON.stringify({safe:false,reason:'Visible people'})})); }
  return new Response('mock image bytes');
 };
 try { const result = await fetchCoverPhoto('office'); assert.equal(result.buffer,null); assert.equal(result.metadata.status,'failed'); assert.equal(reviews,8); }
 finally {global.fetch=previous; for(const [key,value] of [['PEXELS_API_KEY',pexels],['OPENAI_API_KEY',openai]]) {if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
