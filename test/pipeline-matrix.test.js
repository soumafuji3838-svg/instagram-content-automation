const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs/promises');const path=require('node:path');const sharp=require('sharp');
const {contentTypes}=require('../src/content-types');const {demoContent,validateContent}=require('../src/generator');const {getDesign}=require('../src/designs');const {coverSvg,quantitativeSvg,qualitativeSvg,comparisonSvg,ctaSvg}=require('../src/renderer');const {assertCompanyLogos}=require('../src/logo');const {assertSeries,fitText}=require('../src/layout');const account=require('../config/accounts.json')[0];
const output=path.join(process.cwd(),'validation-v0.9.15');
test('all five types and 3, 4, 5 company layouts render complete PNGs',async()=>{
 await fs.mkdir(output,{recursive:true});
 const logo=await sharp({create:{width:100,height:50,channels:4,background:'#226699'}}).png().toBuffer();
 for(const type of contentTypes)for(const count of type.id==='company_comparison'?[3,4,5]:[3]){
  let content=demoContent({topic:'検証用テーマ',account,contentType:type.id});
  const company=type.comparisonEntityType==='company';
  content.comparison.columns=Array.from({length:count},(_,i)=>({name:company?`テスト国際金融グループ${i+1}`:`検証業界${i+1}`,entityType:company?'company':'industry',domain:company?`test${i}.example.com`:''}));
  content.comparison.rows.forEach(r=>{r.values=Array.from({length:count},()=> '公開資料に基づく比較');r.sourceIds=['S1'];});
  content.quantitative.metrics=Array.from({length:count},(_,i)=>({label:company?content.comparison.columns[i].name:`項目${i+1}`,entityType:company?'company':'other',companyDomain:company?content.comparison.columns[i].domain:'',value:100-i*15,displayValue:['1億円','12,345億円','999,999億円','0.01億円','123億円'][i],sourceIds:['S1']}));
  content.subject.domain=type.subjectEntityType==='company'?'test0.example.com':'';
  content=validateContent(content,type.id);assertSeries(content);
  const logos=Object.fromEntries(Array.from({length:count},(_,i)=>[`test${i}.example.com`,{buffer:logo}]));assertCompanyLogos(content,logos);
  const args={content,contentType:type.id,account,design:getDesign(account.designId),logos};
  const svgs=[coverSvg(args),quantitativeSvg(args),qualitativeSvg(args),comparisonSvg(args),ctaSvg(args)];
  for(let i=0;i<svgs.length;i++){const file=path.join(output,`${type.id}-${count}-${i+1}.png`);await sharp(Buffer.from(svgs[i])).png().toFile(file);const meta=await sharp(file).metadata();assert.equal(meta.width,1080);assert.equal(meta.height,1350);}
 }
});
test('missing logo, wrong association and overflowing text fail closed',()=>{
 const c=demoContent({topic:'企業',account,contentType:'company_comparison'});
 assert.throws(()=>assertCompanyLogos(c,{}),/ロゴ/);
 c.quantitative.metrics[0].label='別会社';assert.throws(()=>assertSeries(c),/一致/);
 assert.throws(()=>fitText('長'.repeat(500),{x:0,y:0,width:100,height:50}),/overflow/);
});
test('registry logo is restored before any discovery fallback',async()=>{
 const dir=await fs.mkdtemp(require('node:os').tmpdir()+'/logo-registry-');const previous=global.fetch;let calls=0;
 const buffer=await sharp({create:{width:80,height:40,channels:3,background:'blue'}}).png().toBuffer();
 await fs.writeFile(path.join(dir,'logos.json'),JSON.stringify({'example.com':{sourceUrl:'https://example.com/brand.png'}}));
 global.fetch=async(url)=>{calls++;assert.equal(String(url),'https://example.com/brand.png');return new Response(buffer);};
 try {const logos=await require('../src/logo').prepareCompanyLogos({subject:{entityType:'company',domain:'example.com'}},dir);assert.ok(logos['example.com'].buffer.length);assert.equal(calls,1);}finally{global.fetch=previous;await fs.rm(dir,{recursive:true,force:true});}
});
