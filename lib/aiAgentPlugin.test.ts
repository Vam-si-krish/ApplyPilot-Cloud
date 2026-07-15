import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function text(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
}

const migration = text('../supabase/migrations/0051_ai_agent_runs.sql');
const middleware = text('../middleware.ts');
const runRoute = text('../app/api/ai-agent/runs/route.ts');
const queueRoute = text('../app/api/ai-agent/mcp/queue/route.ts');
const contextRoute = text('../app/api/ai-agent/mcp/applications/[id]/route.ts');
const pluginRoot = fileURLToPath(new URL('../plugins/applypilot/', import.meta.url));
const mcpScript = fileURLToPath(new URL('../plugins/applypilot/scripts/applypilot-mcp.mjs', import.meta.url));

describe('ApplyPilot plugin boundary', () => {
  it('keeps run authorization revocable and forced-RLS user owned', () => {
    expect(migration).toContain('create table if not exists public.ai_agent_runs');
    expect(migration).toContain('alter table public.ai_agent_runs force row level security');
    expect(migration).toContain('user_id = public.request_user_id()');
    expect(migration).toContain('revoked_at');
    expect(runRoute).toContain('currentUserId()');
    expect(runRoute).toContain('AI_AGENT_RUN_TTL_MS');
  });

  it('self-authenticates only the MCP prefix and re-enters the UUID-scoped gateway', () => {
    expect(middleware).toContain("const SELF_AUTH_PREFIXES = ['/api/ai-agent/mcp/']");
    expect(queueRoute).toContain('authenticateAiAgentRequest(req)');
    expect(queueRoute).toContain('supabaseAdmin(identity.userId)');
    expect(contextRoute).toContain('supabaseAdmin(identity.userId)');
    expect(contextRoute).toContain("const MCP_ACTIONS: AiApplyAction[] = ['start', 'block', 'submitted']");
    expect(contextRoute).not.toContain('api_keys');
  });

  it('advertises the five queue tools through a dependency-free MCP handshake', () => {
    const input = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      '',
    ].join('\n');
    const result = spawnSync(process.execPath, [mcpScript], { cwd: pluginRoot, input, encoding: 'utf8' });
    expect(result.status).toBe(0);
    const messages = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(messages.find((message) => message.id === 1)?.result.serverInfo.name).toBe('applypilot-mcp');
    expect(messages.find((message) => message.id === 2)?.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
      'list_assigned_jobs',
      'get_application_context',
      'start_application',
      'mark_application_needs_review',
      'mark_application_submitted',
    ]);
  });
});
