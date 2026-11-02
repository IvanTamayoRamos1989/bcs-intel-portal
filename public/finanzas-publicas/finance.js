(() => {
 'use strict';
 const $=id=>document.getElementById(id), data=window.BCS_FINANZAS;
 if(!data){$('resultCount').textContent='No se pudo cargar el catálogo. Vuelve a abrir la página o consulta la fuente oficial.';return;}
 const records=data.records, number=n=>n.toLocaleString('es-MX'), normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
 let page=0, filtered=[];const size=25;
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
 const link=(text,url)=>{const a=el('a',text);a.href=url;a.target='_blank';a.rel='noopener';return a;};
 const budget=window.BCS_BUDGET;
 if(budget){
  const currency=n=>'$'+n.toLocaleString('es-MX');
  for(const [key,label] of [['approved','Aprobado anual'],['modified','Modificado anual'],['accrued','Devengado al corte'],['paid','Pagado al corte']]){
   const row=el('div',undefined,'budget-row'),caption=el('div',undefined,'budget-caption'),track=el('div',undefined,'budget-track'),bar=el('div',undefined,'budget-bar');
   caption.append(el('span',label),el('strong',currency(budget[key])));bar.style.width=(100*budget[key]/budget.modified)+'%';track.append(bar);row.append(caption,track);$('budgetRows').append(row);
  }
  $('budgetRatio').textContent=(100*budget.accrued/budget.modified).toLocaleString('es-MX',{maximumFractionDigits:1})+'% devengado del presupuesto modificado · '+currency(budget.unspent)+' de subejercicio reportado al corte.';
  $('budgetSource').href=budget.source_url+'#page=2';
 }
 $('documents').textContent=number(records.filter(r=>r.kind==='document').length);
 $('downloaded').textContent=number(data.archived_documents??records.filter(r=>r.kind==='document'&&r.status==='ok').length);
 $('pages').textContent=number(data.archived_pages??records.filter(r=>r.kind==='page'&&r.status==='ok').length);
 $('pending').textContent=number((data.counts.pending||0)+(data.counts.running||0)+(data.counts.error||0));
 $('updated').textContent='Catálogo: '+new Date(data.generated_at).toLocaleString('es-MX',{timeZone:'America/Mazatlan'})+' · hora de BCS';
 $('scope').textContent=data.scope;
 $('coverage').textContent=data.complete?'Recorrido registrado sin descargas pendientes. Esto no garantiza cobertura de documentos no enlazados.':'Copia parcial: hay recursos pendientes o con error. El catálogo refleja únicamente el estado de la fecha indicada.';
 for(const [id,values] of [['category',records.map(r=>r.category)],['year',records.flatMap(r=>r.years)],['format',records.map(r=>r.format)]]){
   const items=[...new Set(values)].filter(Boolean).sort();if(id==='year')items.reverse();for(const value of items){const o=el('option',value);o.value=value;$(id).append(o);}
 }
 const statusNames={ok:'Copia disponible',error:'Error de descarga',pending:'Pendiente',running:'Descargando'};
 function draw(){
  const start=page*size;$('results').replaceChildren();
  $('resultCount').textContent=number(filtered.length)+' resultados';
  for(const r of filtered.slice(start,start+size)){
   const article=el('article',undefined,'record'),body=el('div'),actions=el('div',undefined,'actions');
   article.append(el('div',r.format||'ARCHIVO','format'));body.append(el('h3',r.title));
   const meta=el('p');meta.append(el('span',r.category,'tag'),document.createTextNode(r.years.length?'Años detectados: '+r.years.join(', '):'Año sin identificar'));body.append(meta);
   body.append(el('p',statusNames[r.status]||r.status));
   if(r.excerpt)body.append(el('p','Incluye extracto de la primera página. La lectura automática puede contener errores; consulta el original.','source-excerpt'));
   const details=el('details');details.append(el('summary','Procedencia y límites'));
   details.append(el('p','Origen: '+r.url));
   if(r.sha256)details.append(el('p','SHA-256: '+r.sha256));
   if(r.downloaded_at)details.append(el('p','Consulta: '+new Date(r.downloaded_at).toLocaleString('es-MX')+(r.bytes?' · '+(r.bytes/1048576).toFixed(2)+' MB':'')));
   details.append(el('p',r.territorial_status+'. Importes: '+r.amounts_status.toLowerCase()+'.'));
   if(r.error)details.append(el('p','Incidencia: '+r.error));
   if(r.excerpt){details.append(el('p',r.excerpt_method),el('p',r.excerpt));}
   const sources=r.source_pages.filter(p=>p.parent!==r.url);for(const p of sources.slice(0,8)){const line=el('p');line.append(link(p.label||'Página de procedencia',p.parent));details.append(line);}
   if(sources.length>8)details.append(el('p','Todas las referencias están disponibles en el catálogo JSON.'));
   body.append(details);actions.append(link('Fuente oficial ↗',r.url));
   // The archive is only linked when running from the local workspace layout.
   if(r.status==='ok'&&r.kind==='document'&&r.local_path&&/\/ux_prototype\/finanzas\//.test(location.pathname))actions.append(link('Copia local ↓','../../portal_data/finanzas_publicas/'+r.local_path));
   article.append(body,actions);$('results').append(article);
  }
  if(!filtered.length)$('results').append(el('p','No hay coincidencias. Prueba otro término o limpia los filtros.'));
  $('previous').disabled=page===0;$('next').disabled=start+size>=filtered.length;
  $('pageNumber').textContent=filtered.length?`${page+1} / ${Math.ceil(filtered.length/size)}`:'0 / 0';
 }
 function filter(){
  const q=normalize($('query').value.trim());
  filtered=records.filter(r=>($('includePages').checked||r.kind==='document')&&(!$('category').value||r.category===$('category').value)&&(!$('year').value||r.years.includes($('year').value))&&(!$('format').value||r.format===$('format').value)&&(!$('status').value||r.status===$('status').value||($('status').value==='pending'&&r.status==='running'))&&(!q||normalize(r.title+' '+decodeURIComponent(r.url)+' '+r.category+' '+(r.excerpt||'')).includes(q)));
  page=0;draw();
 }
 let debounce;
 $('filters').addEventListener('submit',e=>e.preventDefault());$('filters').addEventListener('input',()=>{clearTimeout(debounce);debounce=setTimeout(filter,140);});$('includePages').addEventListener('change',filter);
 $('filters').addEventListener('reset',()=>{setTimeout(()=>{$('includePages').checked=false;filter();},0);});
 $('previous').onclick=()=>{page--;draw();};$('next').onclick=()=>{page++;draw();};filter();
})();
