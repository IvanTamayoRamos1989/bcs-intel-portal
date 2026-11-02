(function(){
  var input=document.getElementById('map-place-search'),list=document.getElementById('map-place-results');
  if(!input||!list)return;
  var places=[],ready=false;
  function norm(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();}
  function render(){list.innerHTML='';var q=norm(input.value.trim());list.hidden=!q;if(!q)return;
    var matches=places.filter(function(f){return norm(f.properties.name||'').includes(q);}).slice(0,8);
    if(!matches.length){var empty=document.createElement('li');empty.textContent=ready?'No se encontraron lugares. Prueba otro nombre.':'Cargando lugares…';list.appendChild(empty);return;}
    matches.forEach(function(f){var li=document.createElement('li'),b=document.createElement('button');b.type='button';b.textContent=f.properties.name;b.addEventListener('click',function(){var c=f.geometry.coordinates;if(window.Shell)window.Shell.focusPoint(c[0],c[1],f.properties.name);input.value=f.properties.name;list.hidden=true;});li.appendChild(b);list.appendChild(li);});
  }
  fetch('/gis/osm_towns.geojson').then(function(r){if(!r.ok)throw Error();return r.json();}).then(function(data){places=(data.features||[]).filter(function(f){return f.geometry&&f.geometry.type==='Point'&&f.properties&&f.properties.name;});ready=true;render();}).catch(function(){ready=true;list.textContent='No se pudieron cargar los lugares. Recarga la página.';});
  input.addEventListener('input',render);input.addEventListener('keydown',function(e){if(e.key==='Escape')list.hidden=true;if(e.key==='ArrowDown'){var b=list.querySelector('button');if(b){e.preventDefault();b.focus();}}});
})();
