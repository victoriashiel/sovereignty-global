import app from './worker.js';
export { ClientOnboardingWorkflow } from './onboarding-workflow.js';

const PRIVATE_PAGE_RE = /^\/(?:login|activate|portal(?:-|\.|\/)|staff(?:-|\.|\/))/i;
const STATIC_ASSET_RE = /\.(?:css|js|png|jpe?g|webp|svg|ico|woff2?)$/i;
const SESSION_COOKIE = 'sg_session';

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const eventRequest = request.clone();
    let response;

    try {
      response = await app.fetch(request, env, ctx);
    } catch (error) {
      logError('http.unhandled_error', error, { requestId, method: request.method, path: url.pathname });
      response = new Response(JSON.stringify({ error: 'Unexpected server error.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    const decorated = decorateResponse(response, request, url, requestId);
    console.log({
      event: 'http.request',
      requestId,
      method: request.method,
      path: url.pathname,
      status: decorated.status,
      durationMs: Date.now() - startedAt,
      cfRay: request.headers.get('cf-ray') || undefined,
      country: request.cf?.country || undefined,
      colo: request.cf?.colo || undefined,
    });

    if (url.pathname.startsWith('/api/')) {
      ctx.waitUntil(captureOperationalEvent(eventRequest, env, url, decorated.status, requestId));
    }
    return decorated;
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMaintenance(env, controller));
  },

  async queue(batch, env) {
    let firstError;
    for (const message of batch.messages) {
      try {
        await consumeOperationalEvent(message.body, env);
      } catch (error) {
        firstError ||= error;
        logError('queue.message_failed', error, { messageId: message.id });
      }
    }
    if (firstError) throw firstError;
  },
};

function decorateResponse(response, request, url, requestId) {
  const headers = new Headers(response.headers);
  headers.set('X-Request-ID', requestId);

  if (url.pathname.startsWith('/api/') || PRIVATE_PAGE_RE.test(url.pathname)) {
    headers.set('Cache-Control', 'private, no-store');
  } else if (request.method === 'GET' || request.method === 'HEAD') {
    if (STATIC_ASSET_RE.test(url.pathname)) {
      headers.set('Cache-Control', 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
    } else if (response.ok) {
      headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, must-revalidate');
    }
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function captureOperationalEvent(request, env, url, status, requestId) {
  try {
    const base = {
      id: crypto.randomUUID(),
      occurredAt: new Date().toISOString(),
      requestId,
      method: request.method,
      path: url.pathname,
      status,
      country: request.cf?.country || null,
      colo: request.cf?.colo || null,
      cfRay: request.headers.get('cf-ray') || null,
    };

    let event = null;
    if (url.pathname === '/api/auth/activate' && request.method === 'POST' && status >= 200 && status < 300) {
      const body = await safeJson(request);
      const email = normalizeEmail(body.email);
      const user = email && env.DB ? await env.DB.prepare('SELECT id,email FROM users WHERE email=?').bind(email).first() : null;
      event = { ...base, type: 'client.activated', userId: user?.id || null };
      if (user?.id && env.ONBOARDING_WORKFLOW) {
        const workflowId = `onboarding-${user.id}`;
        try {
          await env.ONBOARDING_WORKFLOW.create({
            id: workflowId,
            params: { userId: user.id, workflowId, startedAt: base.occurredAt },
          });
        } catch (error) {
          logError('onboarding.workflow_start_failed', error, { requestId, userId: user.id });
        }
      }
    } else if (url.pathname === '/api/auth/login' && request.method === 'POST' && status >= 200 && status < 300) {
      const body = await safeJson(request);
      const email = normalizeEmail(body.email);
      const user = email && env.DB ? await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first() : null;
      event = { ...base, type: 'auth.login.succeeded', userId: user?.id || null };
    } else if (url.pathname === '/api/auth/login' && request.method === 'POST' && status === 401) {
      event = { ...base, type: 'auth.login.failed', userId: null };
    } else if (url.pathname === '/api/requests' && request.method === 'POST' && status === 201) {
      event = { ...base, type: 'client.request.created', userId: await resolveClientId(request, env.DB) };
    } else if (/^\/api\/documents\/[^/]+\/download$/.test(url.pathname) && request.method === 'GET' && status === 200) {
      event = { ...base, type: 'client.document.downloaded', userId: await resolveClientId(request, env.DB) };
    } else if (status === 429) {
      event = { ...base, type: 'security.rate_limited', userId: await resolveClientId(request, env.DB) };
    } else if (status >= 500) {
      event = { ...base, type: 'security.server_error', userId: await resolveClientId(request, env.DB) };
    }

    if (!event) return;
    await publishOperationalEvent(env, event);
  } catch (error) {
    logError('operations.capture_failed', error, { requestId, path: url.pathname });
  }
}

async function publishOperationalEvent(env, event) {
  if (env.OPERATIONS_QUEUE) {
    await env.OPERATIONS_QUEUE.send(event);
    return;
  }
  console.log({ event: 'operations.queue_unavailable', operationalEvent: event.type, eventId: event.id });
}

async function consumeOperationalEvent(event, env) {
  if (!event || typeof event !== 'object' || !event.id || !event.type || !env.DB) return;
  const createdAt = event.occurredAt || new Date().toISOString();
  const metadata = JSON.stringify({
    method: event.method || null,
    path: event.path || null,
    status: event.status || null,
    country: event.country || null,
    colo: event.colo || null,
    cfRay: event.cfRay || null,
  });

  await env.DB.prepare(
    'INSERT OR IGNORE INTO activity_events(id,event_type,user_id,request_id,metadata,created_at) VALUES(?,?,?,?,?,?)'
  ).bind(event.id, event.type, event.userId || null, event.requestId || null, metadata, createdAt).run();

  const alert = alertForEvent(event);
  if (!alert) return;

  await env.DB.prepare(
    "INSERT OR IGNORE INTO notification_outbox(id,event_id,kind,severity,subject,body,status,attempts,created_at,updated_at) VALUES(?,?,?,?,?,?, 'pending',0,?,?)"
  ).bind(event.id, event.id, alert.kind, alert.severity, alert.subject, alert.body, createdAt, createdAt).run();

  if (env.OPERATIONS_WEBHOOK_URL) {
    const response = await fetch(env.OPERATIONS_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'Sovereignty Global Worker',
        eventId: event.id,
        type: event.type,
        severity: alert.severity,
        subject: alert.subject,
        body: alert.body,
        requestId: event.requestId || null,
        occurredAt: createdAt,
      }),
    });
    if (!response.ok) throw new Error(`Operations webhook returned ${response.status}`);
    await env.DB.prepare("UPDATE notification_outbox SET status='sent',attempts=attempts+1,sent_at=?,updated_at=? WHERE id=?")
      .bind(new Date().toISOString(), new Date().toISOString(), event.id).run();
  }
}

function alertForEvent(event) {
  if (event.type === 'security.rate_limited') {
    return {
      kind: 'security', severity: 'medium', subject: 'Rate limit triggered',
      body: `${event.method || 'Request'} ${event.path || '/api'} returned HTTP 429. Request ID: ${event.requestId || 'unknown'}.`,
    };
  }
  if (event.type === 'security.server_error') {
    return {
      kind: 'security', severity: 'high', subject: 'Worker API server error',
      body: `${event.method || 'Request'} ${event.path || '/api'} returned HTTP ${event.status || 500}. Request ID: ${event.requestId || 'unknown'}.`,
    };
  }
  if (event.type === 'onboarding.review_due') {
    return {
      kind: 'client_onboarding', severity: event.reviewNumber >= 2 ? 'medium' : 'low', subject: 'Client onboarding review due',
      body: `Client ${event.userId || 'unknown'} remains in onboarding after review ${event.reviewNumber || 1}.`,
    };
  }
  return null;
}

async function resolveClientId(request, db) {
  if (!db) return null;
  const raw = getCookie(request, SESSION_COOKIE);
  if (!raw) return null;
  const hash = await sha256(raw);
  const row = await db.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(hash, new Date().toISOString()).first();
  return row?.user_id || null;
}

async function runMaintenance(env, controller) {
  const startedAt = Date.now();
  const runId = crypto.randomUUID();
  if (!env.DB) {
    console.warn({ event: 'maintenance.skipped', runId, reason: 'missing_db_binding' });
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const failureCutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const invitationCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const failedDocumentCutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const activityCutoff = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const sentNotificationCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const failedDocs = await env.DB.prepare(
      "SELECT id,r2_key FROM documents WHERE object_status='failed' AND created_at<? ORDER BY created_at ASC LIMIT 100"
    ).bind(failedDocumentCutoff).all();

    if (env.CLIENT_FILES) {
      for (const doc of failedDocs.results || []) {
        if (!doc.r2_key) continue;
        try {
          await env.CLIENT_FILES.delete(doc.r2_key);
        } catch (error) {
          logError('maintenance.r2_delete_failed', error, { runId, documentId: doc.id });
        }
      }
    }

    const statements = [
      env.DB.prepare('DELETE FROM sessions WHERE expires_at<?').bind(nowIso),
      env.DB.prepare('DELETE FROM login_failures WHERE updated_at<?').bind(failureCutoff),
      env.DB.prepare('DELETE FROM invitations WHERE expires_at<?').bind(invitationCutoff),
      env.DB.prepare('DELETE FROM activity_events WHERE created_at<?').bind(activityCutoff),
      env.DB.prepare("DELETE FROM notification_outbox WHERE status='sent' AND created_at<?").bind(sentNotificationCutoff),
    ];
    for (const doc of failedDocs.results || []) {
      statements.push(env.DB.prepare("DELETE FROM documents WHERE id=? AND object_status='failed'").bind(doc.id));
    }

    const results = await env.DB.batch(statements);
    const changes = results.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0);
    console.log({
      event: 'maintenance.completed',
      runId,
      cron: controller?.cron || undefined,
      scheduledTime: controller?.scheduledTime || undefined,
      changes,
      failedDocumentsExamined: (failedDocs.results || []).length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logError('maintenance.failed', error, { runId, durationMs: Date.now() - startedAt });
    throw error;
  }
}

async function safeJson(request) {
  try { return await request.json(); } catch { return {}; }
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return '';
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  let binary = '';
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function logError(event, error, fields = {}) {
  console.error({
    event,
    ...fields,
    errorName: error?.name || 'Error',
    errorMessage: String(error?.message || error || 'Unknown error').slice(0, 500),
  });
}
