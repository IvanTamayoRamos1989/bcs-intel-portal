import { chromium } from 'playwright';
const B='https://bajacaliforniasur2050.com';
const b=await chromium.launch();
for (const [name,vp] of [['desktop',{width:1440,height:1000}],['mobile',{width:390,height:844}]]) {
  const ctx=await b.newContext({viewport:vp});
  const r=await ctx.request.post(B+'/api/auth',{data:{password:'BCS2050'}});
  const p=await ctx.newPage();
  const resp=await p.goto(B+'/biblioteca/',{waitUntil:'networkidle'});
  await p.waitForTimeout(1500);
  const rows=await p.locator('table tbody tr').count().catch(()=>-1);
  const badge=await p.locator('text=/^Borrador$/i').count();
  await p.screenshot({path:`ux_redesign_shots/library_${name}.png`,fullPage:false});
  await p.screenshot({path:`ux_redesign_shots/library_${name}_full.png`,fullPage:true});
  console.log(name,'auth',r.status(),'page',resp.status(),'rows',rows,'visibleBadge',badge);
  if(name==='desktop'){ await p.goto(B+'/biblioteca/?tema=08_WATER_RESOURCES',{waitUntil:'networkidle'}).catch(()=>{}); await p.waitForTimeout(1200); await p.screenshot({path:'ux_redesign_shots/library_desktop_filtered.png'}); }
  await ctx.close();
}
await b.close();
