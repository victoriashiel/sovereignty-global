import { WorkflowEntrypoint } from 'cloudflare:workers';

export class ClientOnboardingWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const payload = event?.payload || {};
    const userId = String(payload.userId || '').trim();
    const workflowId = String(payload.workflowId || '').trim();
    if (!userId || !workflowId) throw new Error('Client onboarding workflow requires userId and workflowId.');

    const started = await step.do('start onboarding', async () => {
      const now = new Date().toISOString();
      const user = await this.env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active'").bind(userId).first();
      if (!user) throw new Error('Client account is unavailable.');

      await this.env.DB.batch([
        this.env.DB.prepare("UPDATE client_profiles SET onboarding_status=CASE WHEN onboarding_status='paused' THEN 'paused' ELSE 'onboarding' END,updated_at=? WHERE user_id=?").bind(now, userId),
        this.env.DB.prepare("INSERT INTO onboarding_workflows(user_id,workflow_id,status,started_at,last_checked_at,completed_at) VALUES(?,?,'running',?,?,NULL) ON CONFLICT(user_id) DO UPDATE SET workflow_id=excluded.workflow_id,status='running',started_at=excluded.started_at,last_checked_at=excluded.last_checked_at,completed_at=NULL").bind(userId, workflowId, now, now),
      ]);
      return { startedAt: now };
    });

    await step.do('record onboarding start', async () => {
      await sendEvent(this.env, {
        id: crypto.randomUUID(),
        type: 'onboarding.started',
        userId,
        workflowId,
        occurredAt: started.startedAt,
      });
    });

    await step.sleep('wait for first review', '7 days');
    const firstReview = await step.do('check onboarding after seven days', async () => checkClient(this.env, userId, workflowId));
    if (firstReview.status !== 'onboarding') {
      return step.do('finish onboarding after first review', async () => finishWorkflow(this.env, userId, workflowId, firstReview.status));
    }

    await step.do('queue first onboarding reminder', async () => {
      await sendEvent(this.env, {
        id: crypto.randomUUID(),
        type: 'onboarding.review_due',
        userId,
        workflowId,
        reviewNumber: 1,
        occurredAt: new Date().toISOString(),
        metadata: { documents: firstReview.documents, openRequests: firstReview.openRequests },
      });
    });

    await step.sleep('wait for second review', '7 days');
    const secondReview = await step.do('check onboarding after fourteen days', async () => checkClient(this.env, userId, workflowId));
    if (secondReview.status !== 'onboarding') {
      return step.do('finish onboarding after second review', async () => finishWorkflow(this.env, userId, workflowId, secondReview.status));
    }

    await step.do('queue second onboarding reminder', async () => {
      const now = new Date().toISOString();
      await sendEvent(this.env, {
        id: crypto.randomUUID(),
        type: 'onboarding.review_due',
        userId,
        workflowId,
        reviewNumber: 2,
        occurredAt: now,
        metadata: { documents: secondReview.documents, openRequests: secondReview.openRequests },
      });
      await this.env.DB.prepare("UPDATE onboarding_workflows SET status='attention',last_checked_at=? WHERE user_id=? AND workflow_id=?")
        .bind(now, userId, workflowId).run();
    });

    return { userId, workflowId, status: 'attention' };
  }
}

async function checkClient(env, userId, workflowId) {
  const now = new Date().toISOString();
  const [profile, documents, requests] = await Promise.all([
    env.DB.prepare('SELECT onboarding_status FROM client_profiles WHERE user_id=?').bind(userId).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM documents WHERE user_id=? AND object_status='available'").bind(userId).first(),
    env.DB.prepare("SELECT COUNT(*) AS count FROM document_requests WHERE user_id=? AND status NOT IN ('completed','declined')").bind(userId).first(),
  ]);
  if (!profile) throw new Error('Client profile is unavailable.');
  await env.DB.prepare('UPDATE onboarding_workflows SET last_checked_at=? WHERE user_id=? AND workflow_id=?').bind(now, userId, workflowId).run();
  return {
    status: profile.onboarding_status,
    documents: Number(documents?.count || 0),
    openRequests: Number(requests?.count || 0),
    checkedAt: now,
  };
}

async function finishWorkflow(env, userId, workflowId, clientStatus) {
  const now = new Date().toISOString();
  const status = clientStatus === 'active' ? 'completed' : clientStatus === 'paused' ? 'paused' : 'closed';
  await env.DB.prepare('UPDATE onboarding_workflows SET status=?,last_checked_at=?,completed_at=? WHERE user_id=? AND workflow_id=?')
    .bind(status, now, now, userId, workflowId).run();
  await sendEvent(env, {
    id: crypto.randomUUID(),
    type: `onboarding.${status}`,
    userId,
    workflowId,
    occurredAt: now,
  });
  return { userId, workflowId, status };
}

async function sendEvent(env, event) {
  if (env.OPERATIONS_QUEUE) {
    await env.OPERATIONS_QUEUE.send(event);
    return;
  }
  console.log({ event: 'onboarding.queue_unavailable', operationalEvent: event.type, eventId: event.id });
}
