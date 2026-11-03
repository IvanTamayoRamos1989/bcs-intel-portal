(function(){
  var en=function(){return document.documentElement.getAttribute('data-lang')==='en';};
  var newButton=document.getElementById('conversation-new');
  var composer=document.getElementById('bcs-chat-input'),draftKey='bcs-question-draft';
  function clearDraft(){try{sessionStorage.removeItem(draftKey);}catch(_){}}
  if(composer){
    try{if(!composer.value)composer.value=(sessionStorage.getItem(draftKey)||'').slice(0,2000);}catch(_){}
    composer.addEventListener('input',function(){try{if(composer.value)sessionStorage.setItem(draftKey,composer.value.slice(0,2000));else clearDraft();}catch(_){}});
    document.addEventListener('bcs:chat-start',clearDraft);
    newButton.addEventListener('click',function(){clearDraft();composer.value='';});
  }
  var starters=[['Agua en La Paz','Water in La Paz','¿De dónde viene el agua de La Paz?','Where does La Paz get its water?'],['Áreas naturales','Natural areas','¿Qué áreas naturales protegidas hay en Baja California Sur?','Which protected natural areas are in Baja California Sur?'],['Población por municipio','Population by municipality','¿Cuántas personas viven en cada municipio?','How many people live in each municipality?'],['Presupuesto público','Public budget','¿Qué información hay sobre el presupuesto y el gasto público de Baja California Sur?','What information is available about the public budget and spending in Baja California Sur?']];
  document.querySelectorAll('#bcs-chat-sugg>button').forEach(function(b,i){if(!starters[i])return;var s=starters[i];b.setAttribute('data-q-es',s[2]);b.setAttribute('data-q-en',s[3]);var es=b.querySelector('.bcs-sugg-q [data-lang-es]'),eng=b.querySelector('.bcs-sugg-q [data-lang-en]');if(es)es.textContent=s[0];if(eng)eng.textContent=s[1];});
  function active(){document.body.classList.add('has-conversation');newButton.hidden=false;}
  function connect(d){
    active();
    if(!d.bubble)return;
    var id='c'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
    try{var keys=Object.keys(sessionStorage).filter(function(k){return k.indexOf('bcs-map-')===0;}).sort();while(keys.length>=30)sessionStorage.removeItem(keys.shift());sessionStorage.setItem('bcs-map-'+id,JSON.stringify({question:d.question,answer:d.answer,sources:d.sources,grounded:d.grounded}));sessionStorage.setItem('bcs-last-map',id);}catch(_){return;}
    var mapLink=document.querySelector('[data-destination="map"]');if(mapLink)mapLink.href='/consulta/?context='+id;
    d.bubble.querySelectorAll('a[href]').forEach(function(a){var href=a.getAttribute('href');if(/^\/(explorar|mapas|consulta)\/?(?:[?#]|$)/.test(href))a.href='/consulta/?context='+id;});
    var mapped=(d.blocks||[]).some(function(b){return b.type==='map';})||d.place||/municipio|localidad|territorio|baja california sur|la paz|los cabos|loreto|muleg[eé]|comond[uú]/i.test(d.question||'');
    if(!mapped||d.grounded===false)return;
    var details=document.createElement('details');details.className='conversation-map';
    var summary=document.createElement('summary');summary.textContent=en()?'Explore this question on the map':'Explorar esta consulta en el mapa';details.appendChild(summary);
    var full=document.createElement('a');full.href='/consulta/?context='+id;full.textContent=en()?'Open full 3D map →':'Abrir mapa 3D completo →';details.appendChild(full);
    details.addEventListener('toggle',function(){if(!details.open||details.querySelector('iframe'))return;var frame=document.createElement('iframe');frame.src='/consulta/?embed=1&context='+id;frame.title=en()?'Map related to this question':'Mapa relacionado con esta consulta';frame.loading='lazy';details.insertBefore(frame,full);});
    d.bubble.appendChild(details);
  }
  document.addEventListener('bcs:chat-start',function(){active();newButton.disabled=true;});
  document.addEventListener('bcs:chat-error',function(){newButton.disabled=false;});
  document.addEventListener('bcs:chat-answer',function(e){newButton.disabled=false;if(e.detail.ok!==false)connect(e.detail);});
  document.addEventListener('bcs:chat-restored',function(e){active();(e.detail||[]).forEach(connect);});
  newButton.addEventListener('click',function(){if(window.BCSChat&&window.BCSChat.reset)window.BCSChat.reset();document.body.classList.remove('has-conversation');newButton.hidden=true;document.getElementById('bcs-chat').classList.remove('has-msgs');document.querySelector('[data-destination="map"]').href='/consulta/';document.querySelector('[data-destination="docs"]').href='/catalogo/';});
})();
