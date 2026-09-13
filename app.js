(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const catalog = window.GRAMMAR_CATALOG;
  if (!catalog) { $('results').textContent = 'Не удалось загрузить оглавление. Обновите страницу.'; return; }
  const entries = catalog.entries;
  const byId = new Map(entries.map(e => [e.id, e]));
  const parts = new Map(catalog.parts.map(p => [p.id, p]));
  const pageCount = catalog.book.pdfPageCount;
  const reversePages = new Map(Object.entries(catalog.pageMap).map(([book,pdf]) => [pdf, Number(book)]));
  const state = { query:'', part:'', topic:'', all:false, limit:60, printed:null, pdf:null, entry:null, zoom:100, rotation:0 };
  let lastOpener = null;
  let replacingHash = false;
  let imageVersion = 0;
  const norm = text => String(text).toLocaleLowerCase().normalize('NFKC').replace(/ё/g,'е').replace(/[\p{P}\p{S}]/gu,' ').replace(/\s+/g,' ').trim();
  const searchable = new Map(entries.map(e=>[e.id,norm([e.title,e.ru||'',e.code,e.sourceCode||'',e.aliases,parts.get(e.part).title,parts.get(e.part).original,...e.parents,...(e.parentRussian||[])].join(' '))]));
  const singular = token => token.length>5 && /[а-я]/.test(token) ? token.replace(/(ыми|ими|ого|ему|ому|ыми|ими|ий|ый|ой|ая|ое|ые|ие|ам|ям|ах|ях|ов|ев|ы|и)$/,'') : token;
  const tokensFor = query => norm(query).split(' ').filter(Boolean).map(singular);

  function matching() {
    const words=tokensFor(state.query);
    const results=entries.filter(e => (!state.part||e.part===state.part) && (!state.topic||e.topics.includes(state.topic)) &&
      (words.length||state.topic||state.all||e.level<=2) && words.every(w=>searchable.get(e.id).includes(w)));
    if(words.length) results.sort((a,b)=>score(b,words)-score(a,words) || a.page-b.page || a.level-b.level);
    return results;
  }
  function score(e, words) {
    const title=norm(e.title+' '+(e.ru||''));
    return (title===norm(state.query)?100:0)+(words.every(w=>title.includes(w))?60:0)+(words.every(w=>norm(e.ownAliases||'').includes(w))?25:0)+(norm(e.code)===norm(state.query)?50:0)+Math.max(0,10-e.level);
  }
  function updateHash() {
    if(replacingHash)return;
    const p=new URLSearchParams();
    if(state.query)p.set('q',state.query);if(state.part)p.set('part',state.part);if(state.topic)p.set('topic',state.topic);if(state.all)p.set('all','1');
    if($('reader').open){if(state.printed!==null)p.set('page',state.printed);else if(state.pdf!==null){p.set('pdf',state.pdf);p.set('v','2');}if(state.entry)p.set('section',state.entry.id);}
    history.replaceState(null,'',p.toString()?'#'+p.toString():location.pathname+location.search);
  }
  function render() {
    $('search').value=state.query; $('clear-search').hidden=!state.query; $('topic').value=state.topic; $('show-all').checked=state.all;
    document.querySelectorAll('.part-button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===state.part)));
    const found=matching();
    $('results-context').textContent=state.part?parts.get(state.part).title:'Вся книга';
    $('results-heading').textContent=state.query?'Результаты поиска':state.topic?catalog.topics.find(t=>t.id===state.topic).title:state.all?'Все подразделы':'Главы и разделы';
    $('result-count').textContent=`Найдено: ${found.length} · всего ${entries.length} пунктов оглавления`;
    $('results').replaceChildren();
    const fragment=document.createDocumentFragment();
    for(const e of found.slice(0,state.limit)) {
      const row=document.createElement('article');row.className='result-row'+(e.missing?' missing':'');row.dataset.section=e.id;
      const link=document.createElement('a');link.className='result-main';link.href='#page='+e.page+'&section='+encodeURIComponent(e.id);
      const path=document.createElement('div');path.className='result-path';path.textContent=[parts.get(e.part).title,...e.parents.slice(-2)].join(' / ');
      const title=document.createElement('div');title.className='result-title';
      if(e.code){const code=document.createElement('span');code.className='code';code.textContent=(e.sourceCode||e.code)+' ';title.append(code);}
      title.append(document.createTextNode(e.ru||e.title));link.append(path,title);
      if(e.ru){const original=document.createElement('div');original.className='result-translation';original.textContent=e.title;link.append(original);}
      if(e.missing){const note=document.createElement('span');note.className='missing-label';note.textContent='Начальная страница отсутствует в PDF';link.append(note);}
      const page=document.createElement('a');page.className='page-link';page.href=link.href;page.textContent='с. '+e.page+' ↗';page.setAttribute('aria-label',`Открыть ${e.title}, страница ${e.page}`);
      for(const target of [link,page])target.addEventListener('click',ev=>{ev.preventDefault();openPage(e.page,null,e,target);});
      row.append(link,page);fragment.append(row);
    }
    $('results').append(fragment);$('empty').hidden=found.length!==0;$('load-more').hidden=found.length<=state.limit;
    $('empty-query').textContent=state.query?`По запросу «${state.query}»${state.part?' в разделе «'+parts.get(state.part).title+'»':''} ничего не найдено. Очистите поиск, чтобы увидеть содержание выбранного раздела.`:'Попробуйте выбрать другую тему или вернуться к оглавлению.';
    $('empty-clear').hidden=!state.query;
    $('load-more').textContent=`Показать ещё ${Math.min(60,Math.max(0,found.length-state.limit))}`;updateHash();
  }
  function setQuery(query){state.query=query.trim();state.limit=60;render();}
  function reset(){state.query='';state.part='';state.topic='';state.all=false;state.limit=60;render();}
  function openPage(printed,pdf=null,entry=null,opener=null){
    if(printed!==null && (!Number.isInteger(printed)||printed<1||printed>448))return;
    if(printed===null && (!Number.isInteger(pdf)||pdf<1||pdf>pageCount))return;
    state.printed=printed;state.pdf=printed!==null?(catalog.pageMap[String(printed)]??null):pdf;state.entry=entry;state.zoom=100;state.rotation=0;
    if(!$('reader').open){lastOpener=opener||document.activeElement;$('reader').showModal();document.body.style.overflow='hidden';}
    showScan();updateHash();
  }
  function showScan(){
    const image=$('scan'); const currentVersion=++imageVersion;image.onload=null;image.onerror=null;image.hidden=true;image.removeAttribute('src');
    $('missing-page').hidden=state.pdf!==null;$('scan-status').hidden=state.pdf===null;
    $('scan-scroll').scrollTo(0,0);
    const entry=state.entry;
    $('reader-context').textContent=entry?parts.get(entry.part).title+' · '+(entry.sourceCode||entry.code||'Часть '+entry.part):'Оригинал книги';
    $('reader-title').textContent=entry?(entry.ru||entry.title):(state.printed!==null?'Страница '+state.printed:'Страница файла '+state.pdf);
    $('page-position').textContent=state.printed!==null?'Книга · с. '+state.printed:'Скан · '+state.pdf+' / '+pageCount;
    $('scan-caption').textContent=state.pdf!==null?`Скан ${state.pdf} из ${pageCount}${state.printed!==null?' · печатная страница '+state.printed:''}`:'Пропуск в исходном файле';
    $('prev-page').disabled=state.pdf===1;$('next-page').disabled=state.pdf===pageCount;
    for(const id of ['zoom-in','zoom-out','zoom-reset','rotate'])$(id).disabled=state.pdf===null;
    applyView();
    if(state.pdf===null)return;
    $('scan-status').textContent='Загрузка страницы…';
    image.alt=state.printed!==null?`Оригинальный скан: печатная страница ${state.printed}`:`Оригинальный скан: страница PDF ${state.pdf}`;
    image.onload=()=>{if(currentVersion!==imageVersion)return;image.hidden=false;$('scan-status').hidden=true;};
    image.onerror=()=>{if(currentVersion!==imageVersion)return;$('scan-status').hidden=false;$('scan-status').textContent='Не удалось загрузить скан. Обновите страницу или попробуйте открыть её позже.';};
    image.src=`scans/hq-${String(state.pdf).padStart(3,'0')}.webp`;
  }
  function step(direction){
    let target;
    if(state.pdf!==null)target=state.pdf+direction;
    else {let printed=state.printed+direction;while(printed>=1&&printed<=448&&!catalog.pageMap[String(printed)])printed+=direction;target=catalog.pageMap[String(printed)];}
    if(target>=1&&target<=pageCount)openPage(reversePages.get(target)??null,target,null);
  }
  function applyView(){ $('scan').style.width=state.zoom+'%';$('scan').style.transform=`rotate(${state.rotation}deg)`;$('zoom-reset').textContent=state.zoom+'%'; }
  function closeReader(){if($('reader').open)$('reader').close();}
  function readHash(){
    const p=new URLSearchParams(location.hash.slice(1));replacingHash=true;
    state.query=(p.get('q')||'').slice(0,250);state.part=parts.has(p.get('part'))?p.get('part'):'';
    state.topic=catalog.topics.some(t=>t.id===p.get('topic'))?p.get('topic'):'';state.all=p.get('all')==='1';state.limit=60;render();
    const page=p.has('page')?Number(p.get('page')):null;let pdf=p.has('pdf')?Number(p.get('pdf')):null;
    // Keep links to unnumbered pages in the previous 469-page scan set working.
    if(pdf!==null&&p.get('v')!=='2'&&pdf>=349&&pdf<=469)pdf+=4;
    const requested=byId.get(p.get('section'))||null;const entry=requested&&requested.page===page?requested:null;
    if(page!==null)openPage(page,null,entry);else if(pdf!==null)openPage(null,pdf,entry);else closeReader();
    replacingHash=false;
  }
  for(const p of catalog.parts){
    const button=document.createElement('button');button.className='part-button';button.dataset.part=p.id;button.setAttribute('aria-pressed','false');
    const number=document.createElement('span');number.className='roman';number.textContent=p.id;button.append(number,document.createTextNode(p.title));
    button.addEventListener('click',()=>{state.part=state.part===p.id?'':p.id;state.topic='';state.query='';state.limit=60;render();});$('parts').append(button);
  }
  for(const t of catalog.topics){const option=document.createElement('option');option.value=t.id;option.textContent=t.title;$('topic').append(option);}
  $('search').addEventListener('input',()=>{state.query=$('search').value;state.limit=60;render();$('search').focus();});
  $('clear-search').addEventListener('click',()=>{setQuery('');$('search').focus();});
  document.querySelectorAll('[data-query]').forEach(b=>b.addEventListener('click',()=>{state.part='';state.topic='';setQuery(b.dataset.query);}));
  $('topic').addEventListener('change',()=>{state.topic=$('topic').value;state.query='';if(state.topic)state.part=catalog.topics.find(t=>t.id===state.topic).part;state.limit=60;render();});
  $('show-all').addEventListener('change',()=>{state.all=$('show-all').checked;state.limit=60;render();});
  $('reset-filters').addEventListener('click',reset);$('empty-reset').addEventListener('click',reset);
  $('empty-clear').addEventListener('click',()=>setQuery(''));
  $('load-more').addEventListener('click',()=>{state.limit+=60;render();});
  $('jump-form').addEventListener('submit',e=>{e.preventDefault();openPage(Number($('jump-page').value));});
  $('open-toc').addEventListener('click',()=>openPage(null,10));
  $('prev-page').addEventListener('click',()=>step(-1));$('next-page').addEventListener('click',()=>step(1));
  $('zoom-in').addEventListener('click',()=>{state.zoom=Math.min(250,state.zoom+25);applyView();});
  $('zoom-out').addEventListener('click',()=>{state.zoom=Math.max(75,state.zoom-25);applyView();});
  $('zoom-reset').addEventListener('click',()=>{state.zoom=100;applyView();});
  $('rotate').addEventListener('click',()=>{state.rotation=state.rotation?0:180;applyView();});
  $('close-reader').addEventListener('click',closeReader);
  $('reader').addEventListener('close',()=>{document.body.style.overflow='';state.printed=null;state.pdf=null;state.entry=null;imageVersion++;updateHash();if(lastOpener?.isConnected)lastOpener.focus();});
  $('reader').addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='ArrowLeft'){e.preventDefault();step(-1);}if(e.key==='ArrowRight'){e.preventDefault();step(1);}});
  $('copy-link').addEventListener('click',async()=>{
    const button=$('copy-link');try{await navigator.clipboard.writeText(location.href);button.textContent='Скопировано';}
    catch{button.textContent='Ссылка в адресной строке';}setTimeout(()=>{button.textContent='Ссылка';},2500);
  });
  window.addEventListener('hashchange',readHash);
  $('book-stats').textContent=`5 частей · ${entries.length} пунктов оглавления · ${pageCount} скана`;
  readHash();
})();
