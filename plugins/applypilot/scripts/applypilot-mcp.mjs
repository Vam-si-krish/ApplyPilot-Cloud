#!/usr/bin/env node

const SERVER = { name: 'applypilot-mcp', version: '0.1.0' };
const baseUrl = (process.env.APPLYPILOT_URL || 'http://localhost:3000').replace(/\/+$/, '');
const token = process.env.APPLYPILOT_AI_TOKEN || '';

const tools = [
  {
    name: 'list_assigned_jobs',
    description: 'List active jobs assigned to the signed-in user’s ApplyPilot AI queue, in queue order.',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 } },
      additionalProperties: false,
    },
  },
  {
    name: 'get_application_context',
    description: 'Get one assigned job plus grounded candidate facts. Call only when autofill leaves a field unanswered.',
    inputSchema: {
      type: 'object',
      properties: { application_id: { type: 'string', description: 'ApplyPilot application UUID.' } },
      required: ['application_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'start_application',
    description: 'Move an assigned application to in progress immediately before opening and working on it.',
    inputSchema: {
      type: 'object',
      properties: { application_id: { type: 'string' } },
      required: ['application_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_application_needs_review',
    description: 'Set aside an active application when a required fact is unknown or the site cannot be completed; records a concise reason.',
    inputSchema: {
      type: 'object',
      properties: {
        application_id: { type: 'string' },
        reason: { type: 'string', minLength: 1, maxLength: 500 },
      },
      required: ['application_id', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'mark_application_submitted',
    description: 'Record an in-progress application as submitted only after the employer site visibly confirms submission success.',
    inputSchema: {
      type: 'object',
      properties: { application_id: { type: 'string' } },
      required: ['application_id'],
      additionalProperties: false,
    },
  },
];

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value });
}

function error(id, code, message, data) {
  send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });
}

function toolText(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], ...(isError ? { isError: true } : {}) };
}

async function callApi(path, init = {}) {
  if (!token) throw new Error('APPLYPILOT_AI_TOKEN is not configured. Create a short-lived plugin run in ApplyPilot first.');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers || {}),
    },
  });
  const body = await response.json().catch(() => ({ error: `ApplyPilot returned HTTP ${response.status}` }));
  if (!response.ok) throw new Error(body.error || `ApplyPilot returned HTTP ${response.status}`);
  return body;
}

function requiredString(args, name) {
  const value = args?.[name];
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

async function callTool(name, args) {
  if (name === 'list_assigned_jobs') {
    const requested = Number(args?.limit ?? 20);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(Math.floor(requested), 50)) : 20;
    return callApi(`/api/ai-agent/mcp/queue?limit=${limit}`);
  }
  const applicationId = encodeURIComponent(requiredString(args, 'application_id'));
  if (name === 'get_application_context') return callApi(`/api/ai-agent/mcp/applications/${applicationId}`);
  const action = name === 'start_application' ? 'start'
    : name === 'mark_application_needs_review' ? 'block'
      : name === 'mark_application_submitted' ? 'submitted'
        : null;
  if (!action) throw new Error(`Unknown tool: ${name}`);
  const reason = action === 'block' ? requiredString(args, 'reason').slice(0, 500) : undefined;
  return callApi(`/api/ai-agent/mcp/applications/${applicationId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action, ...(reason ? { reason } : {}) }),
  });
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === 'initialize') {
    result(id, {
      protocolVersion: params?.protocolVersion || '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER,
      instructions: 'Use the ApplyPilot tools with the bundled apply-jobs skill and Chrome. Never invent candidate facts.',
    });
    return;
  }
  if (method === 'ping') {
    result(id, {});
    return;
  }
  if (method === 'tools/list') {
    result(id, { tools });
    return;
  }
  if (method === 'tools/call') {
    try {
      result(id, toolText(await callTool(params?.name, params?.arguments || {})));
    } catch (cause) {
      result(id, toolText({ error: cause instanceof Error ? cause.message : String(cause) }, true));
    }
    return;
  }
  if (id !== undefined) error(id, -32601, `Method not found: ${method}`);
}

let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  pending += chunk;
  const lines = pending.split('\n');
  pending = lines.pop() || '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      void handle(JSON.parse(line));
    } catch (cause) {
      error(null, -32700, 'Parse error', cause instanceof Error ? cause.message : String(cause));
    }
  }
});
