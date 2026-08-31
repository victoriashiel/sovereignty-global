const qs=(s)=>document.querySelector(s);
const show=(el,text)=>{if(!el)return;el.textContent=text;el.classList.add('is-visible')};

const inviteToken=qs('#invite-token');
if(inviteToken){
  const token=new URLSearchParams(location.search).get('invite')||'';
  inviteToken.value=token;
  const form=qs('#activate-form');
  const msg=qs('#activate-message');
  if(!token){
    form.querySelectorAll('input,button').forEach(el=>el.disabled=true);
    show(msg,'This activation page requires a valid private invitation link. Contact accounts@sovereigntyglobal.org if you need a new invitation.');
  }
  form.addEventListener('submit',async(e)=>{
    e.preventDefault();
    const password=qs('#activate-password').value;
    const confirm=qs('#activate-confirm').value;
    if(password!==confirm){show(msg,'The passwords do not match.');return}
    show(msg,'Invitation recognised. Secure account activation will complete once the Cloudflare client database is connected.');
  });
}

const loginForm=qs('#login-form');
if(loginForm){
  loginForm.addEventListener('submit',(e)=>{
    e.preventDefault();
    show(qs('#login-message'),'The login interface is ready. Production authentication is awaiting the secure Cloudflare client-account binding; no credentials are stored in the browser.');
  });
}

const requestForm=qs('#document-request-form');
if(requestForm){
  requestForm.addEventListener('submit',(e)=>{
    e.preventDefault();
    show(qs('#request-message'),'Request prepared. When the client database is connected, this will submit directly to your Sovereignty Global account team.');
    requestForm.reset();
  });
}
