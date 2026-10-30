import { chromium } from 'playwright';
const B='https://bajacaliforniasur2050.com';const b=await chromium.launch();
const ctx=await b.newContext({viewport:{width:1440,height:1000}});await ctx.request.post(B+'/api/auth',{data:{password:'BCS2050'}});
const p=await ctx.newPage();await p.goto(B+'/biblioteca/?tema='+process.argv[2],{waitUntil:'networkidle'});await p.waitForTimeout(1200);
const t=p.locator('table');await t.scrollIntoViewIfNeeded();await p.evaluate(()=>window.scrollBy(0,-200));
console.log('rows',await p.locator('table tbody tr').count());
await p.screenshot({path:'ux_redesign_shots/library_desktop_filtered.png'});await b.close();
