const enc = new TextEncoder();
const SESSION_COOKIE = 'sg_session';
const STAFF_SESSION_COOKIE = 'sg_staff_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const STAFF_SESSION_SECONDS = 60 * 60 * 12;
const PASSWORD_ITERATIONS = 100000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith('/api/')) {
        if (!env.DB) return json({ error: 'Client database is not bound yet.' }, 503);
        await ensureSchema(env.DB);
        return handleApi(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(error);
      return json({ error: 'Unexpected server error.' }, 500);
    }
  },
};

async function handleApi(request, env, url) {
  const { pathname } = url;
  if (pathname === '/api/health' && request.method === 'GET') return json({ ok: true, database: !!env.DB, files: !!env.CLIENT_FILES });

  if (pathname === '/api/auth/invite' && request.method === 'GET') {
    const invite = await getValidInvite(env.DB, url.searchParams.get('token') || '');
    if (!invite) return json({ error: 'Invitation is invalid or expired.' }, 404);
    return json({ email: invite.email, clientName: invite.client_name, expiresAt: invite.expires_at });
  }

  if (pathname === '/api/auth/activate' && request.method === 'POST') {
    const body = await readJson(request), email = normalizeEmail(body.email), password = String(body.password || ''), token = String(body.invite || '');
    if (!email || password.length < 12 || !token) return json({ error: 'Invalid activation details.' }, 400);
    const invite = await getValidInvite(env.DB, token);
    if (!invite || normalizeEmail(invite.email) !== email) return json({ error: 'Invitation is invalid or does not match this email.' }, 400);
    if (await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first()) return json({ error: 'An account already exists for this email.' }, 409);
    const userId = crypto.randomUUID(), salt = randomToken(16), passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS), now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id,email,name,password_hash,password_salt,password_iterations,status,created_at,activated_at) VALUES (?,?,?,?,?,?, 'active', ?, ?)`).bind(userId,email,invite.client_name||'',passwordHash,salt,PASSWORD_ITERATIONS,now,now),
      env.DB.prepare(`INSERT INTO client_profiles (user_id,onboarding_status,created_at,updated_at) VALUES (?, 'active', ?, ?)`).bind(userId,now,now),
      env.DB.prepare('UPDATE invitations SET used_at=? WHERE id=?').bind(now,invite.id),
    ]);
    const session = await createSession(env.DB,userId);
    return json({ ok:true, redirect:'/portal.html' },200,{ 'Set-Cookie': clientSessionCookie(session.token) });
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const body=await readJson(request), email=normalizeEmail(body.email), password=String(body.password||'');
    const user=await env.DB.prepare('SELECT * FROM users WHERE email=? AND status=?').bind(email,'active').first();
    if (!user) return json({ error:'Email or password is incorrect.' },401);
    const candidate=await hashPassword(password,user.password_salt,user.password_iterations||PASSWORD_ITERATIONS);
    if (!constantTimeEqual(candidate,user.password_hash)) return json({ error:'Email or password is incorrect.' },401);
    const session=await createSession(env.DB,user.id);
    return json({ ok:true, redirect:'/portal.html' },200,{ 'Set-Cookie':clientSessionCookie(session.token) });
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    const token=getCookie(request,SESSION_COOKIE); if(token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ok:true},200,{ 'Set-Cookie':clearCookie(SESSION_COOKIE) });
  }

  if (pathname === '/api/staff/auth/login' && request.method === 'POST') {
    const body=await readJson(request), email=normalizeEmail(body.email), password=String(body.password||'');
    const staff=await env.DB.prepare('SELECT * FROM staff_users WHERE email=? AND status=?').bind(email,'active').first();
    if(!staff) return json({error:'Email or password is incorrect.'},401);
    const candidate=await hashPassword(password,staff.password_salt,staff.password_iterations||PASSWORD_ITERATIONS);
    if(!constantTimeEqual(candidate,staff.password_hash)) return json({error:'Email or password is incorrect.'},401);
    const session=await createStaffSession(env.DB,staff.id);
    return json({ok:true,redirect:'/staff.html'},200,{ 'Set-Cookie':staffSessionCookie(session.token) });
  }
  if (pathname === '/api/staff/auth/logout' && request.method === 'POST') {
    const token=getCookie(request,STAFF_SESSION_COOKIE); if(token) await env.DB.prepare('DELETE FROM staff_sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ok:true},200,{ 'Set-Cookie':clearCookie(STAFF_SESSION_COOKIE) });
  }

  if (pathname.startsWith('/api/admin/')) return handleAdmin(request,env,url);
  if (pathname.startsWith('/api/staff/')) return handleStaff(request,env,url);

  const user=await requireUser(request,env.DB); if(!user) return json({error:'Authentication required.'},401);
  if (pathname === '/api/me' && request.method === 'GET') {
    const profile=await env.DB.prepare('SELECT * FROM client_profiles WHERE user_id=?').bind(user.id).first();
    return json({id:user.id,email:user.email,name:user.name,status:user.status,activatedAt:user.activated_at,profile:profile||{}});
  }
  if (pathname === '/api/documents' && request.method === 'GET') {
    const results=await env.DB.prepare('SELECT id,title,category,mime_type,file_size,created_at FROM documents WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all(); return json({documents:results.results||[]});
  }
  const downloadMatch=pathname.match(/^\/api\/documents\/([^/]+)\/download$/);
  if(downloadMatch&&request.method==='GET'){
    if(!env.CLIENT_FILES) return json({error:'Document storage is not bound yet.'},503);
    const doc=await env.DB.prepare('SELECT * FROM documents WHERE id=? AND user_id=?').bind(downloadMatch[1],user.id).first(); if(!doc)return json({error:'Document not found.'},404);
    const object=await env.CLIENT_FILES.get(doc.r2_key); if(!object)return json({error:'Document file is unavailable.'},404);
    return new Response(object.body,{headers:{'Content-Type':doc.mime_type||'application/octet-stream','Content-Disposition':`attachment; filename="${safeFilename(doc.title,doc.mime_type)}"`,'Cache-Control':'private, no-store'}});
  }
  if(pathname==='/api/requests'&&request.method==='GET'){const results=await env.DB.prepare('SELECT id,request_type,notes,status,created_at,updated_at FROM document_requests WHERE user_id=? ORDER BY created_at DESC').bind(user.id).all();return json({requests:results.results||[]})}
  if(pathname==='/api/requests'&&request.method==='POST'){
    const body=await readJson(request),requestType=String(body.requestType||'').trim(),notes=String(body.notes||'').trim().slice(0,4000);if(!requestType)return json({error:'Select the document you need.'},400);
    const id=crypto.randomUUID(),now=new Date().toISOString();await env.DB.prepare(`INSERT INTO document_requests (id,user_id,request_type,notes,status,created_at,updated_at) VALUES (?,?,?,?, 'new', ?, ?)`).bind(id,user.id,requestType,notes,now,now).run();return json({ok:true,id,status:'new',createdAt:now},201);
  }
  return json({error:'API route not found.'},404);
}

async function handleAdmin(request,env,url){
  if(!env.ADMIN_API_KEY)return json({error:'Admin API secret is not configured.'},503);const auth=request.headers.get('Authorization')||'';if(!constantTimeEqual(auth,`Bearer ${env.ADMIN_API_KEY}`))return json({error:'Admin authentication required.'},401);const {pathname}=url;
  if(pathname==='/api/admin/staff/bootstrap'&&request.method==='POST'){
    const existing=await env.DB.prepare('SELECT id FROM staff_users WHERE email=?').bind('legal@sovereigntyglobal.org').first();if(existing)return json({error:'The staff account already exists.'},409);
    const body=await readJson(request),password=String(body.password||'');if(password.length<12)return json({error:'Staff password must be at least 12 characters.'},400);
    const id=crypto.randomUUID(),salt=randomToken(16),hash=await hashPassword(password,salt,PASSWORD_ITERATIONS),now=new Date().toISOString();await env.DB.prepare(`INSERT INTO staff_users (id,email,name,password_hash,password_salt,password_iterations,status,created_at) VALUES (?,?,?,?,?,?, 'active', ?)`).bind(id,'legal@sovereigntyglobal.org','Sovereignty Global Legal',hash,salt,PASSWORD_ITERATIONS,now).run();return json({ok:true,email:'legal@sovereigntyglobal.org'},201);
  }
  if(pathname==='/api/admin/invitations'&&request.method==='POST')return createInvitation(request,env.DB,url.origin);
  if(pathname==='/api/admin/documents'&&request.method==='POST')return uploadDocument(request,env,null);
  if(pathname==='/api/admin/requests'&&request.method==='GET')return listRequests(env.DB);
  const m=pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);if(m&&request.method==='PATCH')return updateRequestStatus(request,env.DB,m[1]);
  return json({error:'Admin route not found.'},404);
}

async function handleStaff(request,env,url){
  const staff=await requireStaff(request,env.DB);if(!staff)return json({error:'Staff authentication required.'},401);const {pathname}=url;
  if(pathname==='/api/staff/me'&&request.method==='GET')return json({id:staff.id,email:staff.email,name:staff.name});
  if(pathname==='/api/staff/clients'&&request.method==='GET'){
    const r=await env.DB.prepare(`SELECT u.id,u.email,u.name,u.status,u.created_at,u.activated_at,COALESCE(p.onboarding_status,'active') onboarding_status,(SELECT COUNT(*) FROM documents d WHERE d.user_id=u.id) document_count,(SELECT COUNT(*) FROM document_requests q WHERE q.user_id=u.id AND q.status NOT IN ('completed','declined')) open_request_count FROM users u LEFT JOIN client_profiles p ON p.user_id=u.id ORDER BY u.created_at DESC`).all();return json({clients:r.results||[]});
  }
  const cm=pathname.match(/^\/api\/staff\/clients\/([^/]+)$/);if(cm&&request.method==='GET'){
    const client=await env.DB.prepare('SELECT id,email,name,status,created_at,activated_at FROM users WHERE id=?').bind(cm[1]).first();if(!client)return json({error:'Client not found.'},404);
    const [profile,docs,reqs]=await Promise.all([env.DB.prepare('SELECT * FROM client_profiles WHERE user_id=?').bind(cm[1]).first(),env.DB.prepare('SELECT id,title,category,mime_type,file_size,created_at FROM documents WHERE user_id=? ORDER BY created_at DESC').bind(cm[1]).all(),env.DB.prepare('SELECT id,request_type,notes,status,created_at,updated_at FROM document_requests WHERE user_id=? ORDER BY created_at DESC').bind(cm[1]).all()]);return json({client,profile:profile||{},documents:docs.results||[],requests:reqs.results||[]});
  }
  const pm=pathname.match(/^\/api\/staff\/clients\/([^/]+)\/profile$/);if(pm&&request.method==='PATCH'){
    const body=await readJson(request),now=new Date().toISOString();const fields={phone:clean(body.phone,80),nationality:clean(body.nationality,120),country_of_residence:clean(body.countryOfResidence,120),tax_residence:clean(body.taxResidence,120),client_reference:clean(body.clientReference,120),address:clean(body.address,1000),onboarding_status:['active','onboarding','paused'].includes(body.onboardingStatus)?body.onboardingStatus:'active'};
    await env.DB.prepare(`INSERT INTO client_profiles (user_id,phone,nationality,country_of_residence,tax_residence,client_reference,address,onboarding_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET phone=excluded.phone,nationality=excluded.nationality,country_of_residence=excluded.country_of_residence,tax_residence=excluded.tax_residence,client_reference=excluded.client_reference,address=excluded.address,onboarding_status=excluded.onboarding_status,updated_at=excluded.updated_at`).bind(pm[1],fields.phone,fields.nationality,fields.country_of_residence,fields.tax_residence,fields.client_reference,fields.address,fields.onboarding_status,now,now).run();return json({ok:true});
  }
  if(pathname==='/api/staff/invitations'&&request.method==='POST')return createInvitation(request,env.DB,url.origin);
  if(pathname==='/api/staff/documents'&&request.method==='POST')return uploadDocument(request,env,staff.id);
  if(pathname==='/api/staff/requests'&&request.method==='GET')return listRequests(env.DB);
  const rm=pathname.match(/^\/api\/staff\/requests\/([^/]+)$/);if(rm&&request.method==='PATCH')return updateRequestStatus(request,env.DB,rm[1]);
  return json({error:'Staff route not found.'},404);
}

async function createInvitation(request,db,origin){const body=await readJson(request),email=normalizeEmail(body.email),clientName=clean(body.clientName,200),validDays=Math.max(1,Math.min(30,Number(body.validDays||7)));if(!email)return json({error:'A valid client email is required.'},400);if(await db.prepare('SELECT id FROM users WHERE email=?').bind(email).first())return json({error:'This client already has an account.'},409);const rawToken=randomToken(32),tokenHash=await sha256(rawToken),id=crypto.randomUUID(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+validDays*86400000).toISOString();await db.prepare('INSERT INTO invitations (id,email,client_name,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)').bind(id,email,clientName,tokenHash,expiresAt,createdAt).run();return json({ok:true,activationUrl:`${origin}/activate.html?invite=${encodeURIComponent(rawToken)}`,expiresAt},201)}
async function uploadDocument(request,env,staffId){if(!env.CLIENT_FILES)return json({error:'R2 document storage is not bound yet.'},503);const form=await request.formData(),clientId=String(form.get('clientId')||''),email=normalizeEmail(form.get('email')),title=clean(form.get('title'),250),category=clean(form.get('category')||'General',100),file=form.get('file');if(!title||!(file instanceof File)||file.size===0)return json({error:'Client, title and file are required.'},400);if(file.size>25*1024*1024)return json({error:'Files must be 25 MiB or smaller.'},413);const user=clientId?await env.DB.prepare('SELECT id FROM users WHERE id=? AND status=?').bind(clientId,'active').first():await env.DB.prepare('SELECT id FROM users WHERE email=? AND status=?').bind(email,'active').first();if(!user)return json({error:'No active client account was found.'},404);const id=crypto.randomUUID(),ext=extensionFromName(file.name),r2Key=`clients/${user.id}/${id}${ext}`,now=new Date().toISOString();await env.CLIENT_FILES.put(r2Key,file.stream(),{httpMetadata:{contentType:file.type||'application/octet-stream'}});await env.DB.prepare('INSERT INTO documents (id,user_id,title,category,r2_key,mime_type,file_size,created_at,uploaded_by_staff_id) VALUES (?,?,?,?,?,?,?,?,?)').bind(id,user.id,title,category,r2Key,file.type||'application/octet-stream',file.size,now,staffId).run();return json({ok:true,id,createdAt:now},201)}
async function listRequests(db){const r=await db.prepare(`SELECT q.id,q.request_type,q.notes,q.status,q.created_at,q.updated_at,u.email,u.name FROM document_requests q JOIN users u ON u.id=q.user_id ORDER BY q.created_at DESC`).all();return json({requests:r.results||[]})}
async function updateRequestStatus(request,db,id){const body=await readJson(request),status=String(body.status||''),allowed=new Set(['new','in_progress','completed','declined']);if(!allowed.has(status))return json({error:'Invalid request status.'},400);await db.prepare('UPDATE document_requests SET status=?,updated_at=? WHERE id=?').bind(status,new Date().toISOString(),id).run();return json({ok:true})}

async function requireUser(request,db){const raw=getCookie(request,SESSION_COOKIE);if(!raw)return null;const hash=await sha256(raw),row=await db.prepare('SELECT u.*,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').bind(hash).first();if(!row)return null;if(Date.parse(row.expires_at)<=Date.now()){await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(hash).run();return null}return row}
async function requireStaff(request,db){const raw=getCookie(request,STAFF_SESSION_COOKIE);if(!raw)return null;const hash=await sha256(raw),row=await db.prepare('SELECT u.*,s.expires_at FROM staff_sessions s JOIN staff_users u ON u.id=s.staff_user_id WHERE s.token_hash=?').bind(hash).first();if(!row)return null;if(Date.parse(row.expires_at)<=Date.now()){await db.prepare('DELETE FROM staff_sessions WHERE token_hash=?').bind(hash).run();return null}return row}
async function createSession(db,userId){const token=randomToken(32),hash=await sha256(token),now=new Date().toISOString(),expires=new Date(Date.now()+SESSION_SECONDS*1000).toISOString();await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(hash,userId,expires,now).run();await db.prepare('DELETE FROM sessions WHERE expires_at<?').bind(now).run();return{token,expiresAt:expires}}
async function createStaffSession(db,staffId){const token=randomToken(32),hash=await sha256(token),now=new Date().toISOString(),expires=new Date(Date.now()+STAFF_SESSION_SECONDS*1000).toISOString();await db.prepare('INSERT INTO staff_sessions (token_hash,staff_user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(hash,staffId,expires,now).run();await db.prepare('DELETE FROM staff_sessions WHERE expires_at<?').bind(now).run();return{token,expiresAt:expires}}
async function getValidInvite(db,raw){if(!raw)return null;const hash=await sha256(raw),row=await db.prepare('SELECT * FROM invitations WHERE token_hash=? AND used_at IS NULL').bind(hash).first();if(!row||Date.parse(row.expires_at)<=Date.now())return null;return row}

async function ensureSchema(db){await db.batch([
 db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,password_iterations INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,activated_at TEXT)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY,email TEXT NOT NULL,client_name TEXT,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,category TEXT,r2_key TEXT NOT NULL,mime_type TEXT,file_size INTEGER,created_at TEXT NOT NULL,uploaded_by_staff_id TEXT)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS document_requests (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_type TEXT NOT NULL,notes TEXT,status TEXT NOT NULL DEFAULT 'new',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS staff_users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,password_iterations INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS staff_sessions (token_hash TEXT PRIMARY KEY,staff_user_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL)`),
 db.prepare(`CREATE TABLE IF NOT EXISTS client_profiles (user_id TEXT PRIMARY KEY,phone TEXT,nationality TEXT,country_of_residence TEXT,tax_residence TEXT,client_reference TEXT,address TEXT,onboarding_status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`),
 db.prepare('CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)'),db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_user ON document_requests(user_id)'),db.prepare('CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)'),db.prepare('CREATE INDEX IF NOT EXISTS idx_staff_email ON staff_users(email)')]);
 const cols=await db.prepare(`PRAGMA table_info(documents)`).all();if(!(cols.results||[]).some(c=>c.name==='uploaded_by_staff_id'))await db.prepare('ALTER TABLE documents ADD COLUMN uploaded_by_staff_id TEXT').run();}

async function hashPassword(password,saltB64,iterations){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const salt=base64UrlToBytes(saltB64),bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt,iterations},key,256);return bytesToBase64Url(new Uint8Array(bits))}
async function sha256(value){const digest=await crypto.subtle.digest('SHA-256',enc.encode(value));return bytesToBase64Url(new Uint8Array(digest))}
function randomToken(bytes){const a=new Uint8Array(bytes);crypto.getRandomValues(a);return bytesToBase64Url(a)}function bytesToBase64Url(bytes){let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}function base64UrlToBytes(value){const s=value.replace(/-/g,'+').replace(/_/g,'/'),p=s+'='.repeat((4-s.length%4)%4),bin=atob(p);return Uint8Array.from(bin,c=>c.charCodeAt(0))}function constantTimeEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}function normalizeEmail(v){const s=String(v||'').trim().toLowerCase();return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)?s:''}function clean(v,n){return String(v??'').trim().slice(0,n)}function extensionFromName(name){const m=String(name||'').match(/(\.[a-z0-9]{1,8})$/i);return m?m[1].toLowerCase():''}function safeFilename(title,mime){let s=String(title||'document').replace(/["\r\n\\/]/g,'_').trim()||'document';if(!/\.[a-z0-9]{1,8}$/i.test(s)){if(String(mime).includes('pdf'))s+='.pdf';else if(String(mime).includes('word'))s+='.docx'}return s}function getCookie(request,name){const cookie=request.headers.get('Cookie')||'';for(const part of cookie.split(';')){const[k,...v]=part.trim().split('=');if(k===name)return decodeURIComponent(v.join('='))}return''}function clientSessionCookie(token){return`${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`}function staffSessionCookie(token){return`${STAFF_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${STAFF_SESSION_SECONDS}`}function clearCookie(name){return`${name}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`}async function readJson(request){try{return await request.json()}catch{return{}}}function json(data,status=200,extraHeaders={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extraHeaders}})}