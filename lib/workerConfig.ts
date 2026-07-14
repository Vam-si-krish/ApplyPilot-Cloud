/** Trusted résumé-worker resolution.
 *
 * The multi-user fork's worker is deployment infrastructure behind the same
 * gateway trust boundary as the database. A user-owned settings row must never
 * be able to redirect server-side résumé/LLM requests. Legacy single-owner
 * deployments keep the existing UI override until they migrate.
 */
export interface WorkerSettings {
  resume_worker_url?: string | null;
  resume_worker_secret?: string | null;
}

export interface WorkerConfig {
  url: string;
  secret: string;
  managed: boolean;
}

export interface WorkerEnvironment {
  BACKEND_URL?: string;
  RESUME_WORKER_URL?: string;
  RESUME_WORKER_SECRET?: string;
}

export function hasManagedWorker(env: WorkerEnvironment = process.env as WorkerEnvironment): boolean {
  return Boolean((env.BACKEND_URL || '').trim());
}

export function resolveWorkerConfig(
  settings?: WorkerSettings | null,
  env: WorkerEnvironment = process.env as WorkerEnvironment,
): WorkerConfig | null {
  const managed = hasManagedWorker(env);
  const envUrl = (env.RESUME_WORKER_URL || '').trim();
  const envSecret = (env.RESUME_WORKER_SECRET || '').trim();
  const url = managed ? envUrl : (settings?.resume_worker_url || '').trim() || envUrl;
  const secret = managed ? envSecret : (settings?.resume_worker_secret || '').trim() || envSecret;
  return url && secret ? { url: url.replace(/\/$/, ''), secret, managed } : null;
}
