import app from './worker.js';

const PRIVATE_PAGE_RE = /^\/(?:login|activate|portal(?:-|\.|\/)|staff(?:-|\.|\/))/i;
const STATIC_ASSET_RE = /\.(?:css|js|png|jpe?g|webp|svg|ico|woff2?)$/i;

export default {
  async fetch(request, env, ctx) {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
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
    return decorated;
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runMaintenance(env, controller));
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

function logError(event, error, fields = {}) {
  console.error({
    event,
    ...fields,
    errorName: error?.name || 'Error',
    errorMessage: String(error?.message || error || 'Unknown error').slice(0, 500),
  });
}
