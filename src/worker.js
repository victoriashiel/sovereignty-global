const enc = new TextEncoder();
const dec = new TextDecoder();
const SESSION_COOKIE = 'sg_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const PASSWORD_ITERATIONS = 150000;

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

  if (pathname === '/api/health' && request.method === 'GET') {
    return json({ ok: true, database: !!env.DB, files: !!env.CLIENT_FILES });
  }

  if (pathname === '/api/auth/invite' && request.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    const invite = await getValidInvite(env.DB, token);
    if (!invite) return json({ error: 'Invitation is invalid or expired.' }, 404);
    return json({ email: invite.email, clientName: invite.client_name, expiresAt: invite.expires_at });
  }

  if (pathname === '/api/auth/activate' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const token = String(body.invite || '');
    if (!email || password.length < 12 || !token) return json({ error: 'Invalid activation details.' }, 400);

    const invite = await getValidInvite(env.DB, token);
    if (!invite || normalizeEmail(invite.email) !== email) return json({ error: 'Invitation is invalid or does not match this email.' }, 400);

    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) return json({ error: 'An account already exists for this email.' }, 409);

    const userId = crypto.randomUUID();
    const salt = randomToken(16);
    const passwordHash = await hashPassword(password, salt, PASSWORD_ITERATIONS);
    const now = new Date().toISOString();

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users (id,email,name,password_hash,password_salt,password_iterations,status,created_at,activated_at)
        VALUES (?,?,?,?,?,?, 'active', ?, ?)`).bind(userId, email, invite.client_name || '', passwordHash, salt, PASSWORD_ITERATIONS, now, now),
      env.DB.prepare('UPDATE invitations SET used_at = ? WHERE id = ?').bind(now, invite.id),
    ]);

    const session = await createSession(env.DB, userId);
    return json({ ok: true, redirect: '/portal.html' }, 200, { 'Set-Cookie': sessionCookie(session.token) });
  }

  if (pathname === '/api/auth/login' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const user = await env.DB.prepare('SELECT * FROM users WHERE email = ? AND status = ?').bind(email, 'active').first();
    if (!user) return json({ error: 'Email or password is incorrect.' }, 401);

    const candidate = await hashPassword(password, user.password_salt, user.password_iterations || PASSWORD_ITERATIONS);
    if (!constantTimeEqual(candidate, user.password_hash)) return json({ error: 'Email or password is incorrect.' }, 401);

    const session = await createSession(env.DB, user.id);
    return json({ ok: true, redirect: '/portal.html' }, 200, { 'Set-Cookie': sessionCookie(session.token) });
  }

  if (pathname === '/api/auth/logout' && request.method === 'POST') {
    const token = getCookie(request, SESSION_COOKIE);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
    return json({ ok: true }, 200, { 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0` });
  }

  if (pathname.startsWith('/api/admin/')) return handleAdmin(request, env, url);

  const user = await requireUser(request, env.DB);
  if (!user) return json({ error: 'Authentication required.' }, 401);

  if (pathname === '/api/me' && request.method === 'GET') {
    return json({ id: user.id, email: user.email, name: user.name, status: user.status, activatedAt: user.activated_at });
  }

  if (pathname === '/api/documents' && request.method === 'GET') {
    const results = await env.DB.prepare(`SELECT id,title,category,mime_type,file_size,created_at FROM documents WHERE user_id = ? ORDER BY created_at DESC`).bind(user.id).all();
    return json({ documents: results.results || [] });
  }

  const downloadMatch = pathname.match(/^\/api\/documents\/([^/]+)\/download$/);
  if (downloadMatch && request.method === 'GET') {
    if (!env.CLIENT_FILES) return json({ error: 'Document storage is not bound yet.' }, 503);
    const doc = await env.DB.prepare('SELECT * FROM documents WHERE id = ? AND user_id = ?').bind(downloadMatch[1], user.id).first();
    if (!doc) return json({ error: 'Document not found.' }, 404);
    const object = await env.CLIENT_FILES.get(doc.r2_key);
    if (!object) return json({ error: 'Document file is unavailable.' }, 404);
    return new Response(object.body, { headers: {
      'Content-Type': doc.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename(doc.title)}"`,
      'Cache-Control': 'private, no-store',
    }});
  }

  if (pathname === '/api/requests' && request.method === 'GET') {
    const results = await env.DB.prepare(`SELECT id,request_type,notes,status,created_at,updated_at FROM document_requests WHERE user_id = ? ORDER BY created_at DESC`).bind(user.id).all();
    return json({ requests: results.results || [] });
  }

  if (pathname === '/api/requests' && request.method === 'POST') {
    const body = await readJson(request);
    const requestType = String(body.requestType || '').trim();
    const notes = String(body.notes || '').trim().slice(0, 4000);
    if (!requestType) return json({ error: 'Select the document you need.' }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO document_requests (id,user_id,request_type,notes,status,created_at,updated_at) VALUES (?,?,?,?, 'new', ?, ?)`).bind(id, user.id, requestType, notes, now, now).run();
    return json({ ok: true, id, status: 'new', createdAt: now }, 201);
  }

  return json({ error: 'API route not found.' }, 404);
}

async function handleAdmin(request, env, url) {
  if (!env.ADMIN_API_KEY) return json({ error: 'Admin API secret is not configured.' }, 503);
  const auth = request.headers.get('Authorization') || '';
  if (!constantTimeEqual(auth, `Bearer ${env.ADMIN_API_KEY}`)) return json({ error: 'Admin authentication required.' }, 401);
  const { pathname } = url;

  if (pathname === '/api/admin/invitations' && request.method === 'POST') {
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    const clientName = String(body.clientName || '').trim().slice(0, 200);
    const validDays = Math.max(1, Math.min(30, Number(body.validDays || 7)));
    if (!email) return json({ error: 'A valid client email is required.' }, 400);
    const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
    if (existing) return json({ error: 'This client already has an account.' }, 409);

    const rawToken = randomToken(32);
    const tokenHash = await sha256(rawToken);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + validDays * 86400000).toISOString();
    await env.DB.prepare(`INSERT INTO invitations (id,email,client_name,token_hash,expires_at,created_at) VALUES (?,?,?,?,?,?)`).bind(id,email,clientName,tokenHash,expiresAt,createdAt).run();
    const activationUrl = `${url.origin}/activate.html?invite=${encodeURIComponent(rawToken)}`;
    return json({ ok: true, activationUrl, expiresAt }, 201);
  }

  if (pathname === '/api/admin/documents' && request.method === 'POST') {
    if (!env.CLIENT_FILES) return json({ error: 'R2 document storage is not bound yet.' }, 503);
    const form = await request.formData();
    const email = normalizeEmail(form.get('email'));
    const title = String(form.get('title') || '').trim().slice(0, 250);
    const category = String(form.get('category') || 'General').trim().slice(0, 100);
    const file = form.get('file');
    if (!email || !title || !(file instanceof File) || file.size === 0) return json({ error: 'Client email, title and file are required.' }, 400);
    if (file.size > 25 * 1024 * 1024) return json({ error: 'Files must be 25 MiB or smaller.' }, 413);
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ? AND status = ?').bind(email, 'active').first();
    if (!user) return json({ error: 'No active client account exists for that email.' }, 404);

    const id = crypto.randomUUID();
    const extension = extensionFromName(file.name);
    const r2Key = `clients/${user.id}/${id}${extension}`;
    await env.CLIENT_FILES.put(r2Key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO documents (id,user_id,title,category,r2_key,mime_type,file_size,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(id,user.id,title,category,r2Key,file.type || 'application/octet-stream',file.size,now).run();
    return json({ ok: true, id, createdAt: now }, 201);
  }

  if (pathname === '/api/admin/requests' && request.method === 'GET') {
    const results = await env.DB.prepare(`SELECT r.id,r.request_type,r.notes,r.status,r.created_at,r.updated_at,u.email,u.name FROM document_requests r JOIN users u ON u.id=r.user_id ORDER BY r.created_at DESC`).all();
    return json({ requests: results.results || [] });
  }

  const reqMatch = pathname.match(/^\/api\/admin\/requests\/([^/]+)$/);
  if (reqMatch && request.method === 'PATCH') {
    const body = await readJson(request);
    const allowed = new Set(['new','in_progress','completed','declined']);
    const status = String(body.status || '');
    if (!allowed.has(status)) return json({ error: 'Invalid request status.' }, 400);
    const now = new Date().toISOString();
    await env.DB.prepare('UPDATE document_requests SET status = ?, updated_at = ? WHERE id = ?').bind(status, now, reqMatch[1]).run();
    return json({ ok: true });
  }

  return json({ error: 'Admin route not found.' }, 404);
}

async function requireUser(request, db) {
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  const tokenHash = await sha256(raw);
  const row = await db.prepare(`SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`).bind(tokenHash).first();
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    return null;
  }
  return row;
}

async function createSession(db, userId) {
  const token = randomToken(32);
  const tokenHash = await sha256(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)').bind(tokenHash,userId,expiresAt,createdAt).run();
  await db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(createdAt).run();
  return { token, expiresAt };
}

async function getValidInvite(db, rawToken) {
  if (!rawToken) return null;
  const tokenHash = await sha256(rawToken);
  const row = await db.prepare('SELECT * FROM invitations WHERE token_hash = ? AND used_at IS NULL').bind(tokenHash).first();
  if (!row || Date.parse(row.expires_at) <= Date.now()) return null;
  return row;
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,name TEXT,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,password_iterations INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL,activated_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invitations (id TEXT PRIMARY KEY,email TEXT NOT NULL,client_name TEXT,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,title TEXT NOT NULL,category TEXT,r2_key TEXT NOT NULL,mime_type TEXT,file_size INTEGER,created_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS document_requests (id TEXT PRIMARY KEY,user_id TEXT NOT NULL,request_type TEXT NOT NULL,notes TEXT,status TEXT NOT NULL DEFAULT 'new',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_documents_user ON documents(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_requests_user ON document_requests(user_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email)'),
  ]);
}

async function hashPassword(password, saltB64, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = base64UrlToBytes(saltB64);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return bytesToBase64Url(new Uint8Array(bits));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomToken(bytes) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return bytesToBase64Url(a); }
function bytesToBase64Url(bytes) { let s=''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function base64UrlToBytes(value) { const s=value.replace(/-/g,'+').replace(/_/g,'/'); const padded=s+'='.repeat((4-s.length%4)%4); const bin=atob(padded); return Uint8Array.from(bin,c=>c.charCodeAt(0)); }
function constantTimeEqual(a,b) { if (typeof a!=='string'||typeof b!=='string'||a.length!==b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff |= a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function normalizeEmail(value) { const email=String(value||'').trim().toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : ''; }
function safeFilename(title) { const clean=String(title||'document').replace(/[^a-z0-9._ -]/gi,'').trim()||'document'; return clean.includes('.') ? clean : `${clean}.pdf`; }
function extensionFromName(name) { const m=String(name||'').match(/(\.[a-z0-9]{1,8})$/i); return m ? m[1].toLowerCase() : ''; }
function getCookie(request,name) { const cookie=request.headers.get('Cookie')||''; for(const part of cookie.split(';')){const [k,...v]=part.trim().split('='); if(k===name)return decodeURIComponent(v.join('='));} return ''; }
function sessionCookie(token) { return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`; }
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function json(data,status=200,extraHeaders={}) { return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...extraHeaders}}); }
