const $=(s)=>document.querySelector(s);
let adminKey='';
const show=(el,text,type='info')=>{if(!el)return;el.textContent=text;el.dataset.type=type;el.classList.add('is-visible')};
const clear=(el)=>{if(!el)return;el.textContent='';el.classList.remove('is-visible')};
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtDate=(v)=>{try{return new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return''}};

async function adminApi(path,options={}){
  if(!adminKey) throw new Error('Enter the admin API key first.');
  const headers={Authorization:`Bearer ${adminKey}`,...(options.headers||{})};
  if(options.body && !(options.body instanceof FormData) && !headers['Content-Type']) headers['Content-Type']='application/json';
  const res=await fetch(path,{...options,headers});
  let data={};try{data=await res.json()}catch{}
  if(!res.ok) throw new Error(data.error||`Request failed (${res.status})`);
  return data;
}

$('#admin-connect')?.addEventListener('click',async()=>{
  adminKey=$('#admin-key').value.trim();
  const msg=$('#admin-message');clear(msg);
  try{await loadRequests();show(msg,'Admin connection verified for this browser session.','success')}catch(err){adminKey='';show(msg,err.message,'error')}
});

$('#invite-form')?.addEventListener('submit',async(e)=>{
  e.preventDefault();const msg=$('#invite-message');clear(msg);$('#invite-result').innerHTML='';
  try{
    const data=await adminApi('/api/admin/invitations',{method:'POST',body:JSON.stringify({clientName:$('#invite-name').value,email:$('#invite-email').value,validDays:Number($('#invite-days').value)})});
    show(msg,'Invitation created. Copy the private activation link below.','success');
    $('#invite-result').innerHTML=`<label>Activation link</label><div class="copy-row"><input value="${esc(data.activationUrl)}" readonly><button type="button" class="login-link" id="copy-invite">Copy</button></div><small>Expires ${fmtDate(data.expiresAt)}</small>`;
    $('#copy-invite').addEventListener('click',async()=>{await navigator.clipboard.writeText(data.activationUrl);$('#copy-invite').textContent='Copied'});
    e.currentTarget.reset();
  }catch(err){show(msg,err.message,'error')}
});

$('#upload-form')?.addEventListener('submit',async(e)=>{
  e.preventDefault();const msg=$('#upload-message');clear(msg);
  const btn=e.currentTarget.querySelector('button');btn.disabled=true;btn.textContent='Uploading…';
  try{
    const fd=new FormData();
    fd.append('email',$('#upload-email').value);
    fd.append('title',$('#upload-title').value);
    fd.append('category',$('#upload-category').value);
    fd.append('file',$('#upload-file').files[0]);
    await adminApi('/api/admin/documents',{method:'POST',body:fd});
    show(msg,'Document uploaded to the client portal.','success');e.currentTarget.reset();
  }catch(err){show(msg,err.message,'error')}finally{btn.disabled=false;btn.textContent='Upload to client portal'}
});

$('#refresh-requests')?.addEventListener('click',()=>loadRequests().catch(err=>show($('#admin-message'),err.message,'error')));

async function loadRequests(){
  const data=await adminApi('/api/admin/requests');
  const list=$('#admin-requests-list');
  const reqs=data.requests||[];
  if(!reqs.length){list.innerHTML='<div class="empty-card">No client document requests yet.</div>';return}
  list.innerHTML=reqs.map(r=>`<article class="admin-request"><div><span class="mini-label">${esc(r.status.replace('_',' '))}</span><h3>${esc(r.request_type)}</h3><p>${esc(r.name||'Client')} · ${esc(r.email)}</p>${r.notes?`<p>${esc(r.notes)}</p>`:''}<small>${fmtDate(r.created_at)}</small></div><div class="request-actions"><select data-request-status="${esc(r.id)}"><option value="new" ${r.status==='new'?'selected':''}>New</option><option value="in_progress" ${r.status==='in_progress'?'selected':''}>In progress</option><option value="completed" ${r.status==='completed'?'selected':''}>Completed</option><option value="declined" ${r.status==='declined'?'selected':''}>Declined</option></select></div></article>`).join('');
  list.querySelectorAll('[data-request-status]').forEach(select=>select.addEventListener('change',async()=>{
    const value=select.value;select.disabled=true;
    try{await adminApi(`/api/admin/requests/${encodeURIComponent(select.dataset.requestStatus)}`,{method:'PATCH',body:JSON.stringify({status:value})})}catch(err){alert(err.message)}finally{select.disabled=false}
  }));
}
