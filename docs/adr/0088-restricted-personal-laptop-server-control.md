# ADR 0088: Restricted personal-laptop server control

- Status: accepted
- Date: 2026-07-15
- Builds on: ADRs 0072, 0073, 0075, and 0087

## Context

The server laptop is always powered, connected, and reachable, but using it as the primary
development machine creates avoidable friction and encourages edits in the live checkout.
The owner wants to develop entirely on a personal laptop while still fetching the latest
branch, applying migrations, restarting services, viewing status/logs, and verifying the
deployed commit without opening a remote desktop session.

The server already has three useful boundaries: GitHub/Netlify branch deployment,
`com.jobpilotmulti.autopull` polling every five minutes, and private Tailscale reachability.
It also has macOS SSH listening, but no personal-laptop public key. A public HTTP restart
endpoint would be reachable through Funnel and would add a high-impact secret-bearing
control plane to the application gateway. A general SSH key would solve operations but
grant much more server access than deployment requires. GitHub-hosted runners cannot
directly rely on the private tailnet and should not receive the application's backend,
worker, account, or database secrets.

Local development also needs the same fixed-account and server-route environment used by
the fork. Copying those values through chat, source control, or cloud-synced notes would
create a credential leak.

## Decision

Use GitHub as the normal code handoff and add an optional, restricted Tailscale SSH control
path for the personal laptop:

1. `scripts/jobpilot-server` is the personal-laptop interface. It verifies the active
   branch/clean worktree, pushes `multi-user-fork`, requests an immediate server deploy,
   and waits for the public worker version to report the expected commit. It also exposes
   status, sync, targeted restart, bounded logs, and backup commands.
2. The first `setup-key` pins the server ED25519 host-key fingerprint and creates a
   dedicated ED25519 key on the personal laptop. Installing it requires the server macOS
   password once over Tailscale.
3. The `authorized_keys` entry uses OpenSSH `restrict` and forces every request into
   `backend/scripts/remote-control.sh`. That script never evaluates caller input and
   accepts only exact/validated operations for `com.jobpilotmulti.*`, the fork checkout,
   its existing backup job, and four fixed log files. It cannot operate `com.applypilot.*`.
4. The restricted `dev-env` operation may read only the fork checkout's protected
   `.env.local`. `bootstrap` transfers it over SSH into a temporary file, validates the
   required variable names, installs it as mode `0600`, and never prints its content.
5. Git push remains sufficient when SSH is unavailable. Netlify reacts to the branch,
   while the five-minute launchd autopull remains the server fallback. The server checkout
   continues to reject dirtiness and non-fast-forward updates before migrations/restarts.
6. Do not add a public deploy endpoint, put runtime secrets into GitHub Actions, synchronize
   `.env.local` through cloud storage, or use this key for a general shell/port forwarding.

## Consequences

- Normal coding, tests, commits, deploys, health checks, controlled restarts, logs, and
  backups can be initiated from the personal laptop without remote desktop access.
- Compromise of the dedicated key is still serious: it can restart the fork and retrieve
  its local-development secrets. The private key and `.env.local` must remain mode `0600`
  on the trusted personal laptop, and revocation removes the single forced-command line.
- The restricted key does not grant an interactive recovery shell. Catastrophic OS,
  Tailscale, disk, Docker, or login-session failures still require the existing remote
  desktop/physical recovery path.
- A push deploys the Netlify frontend independently from the server. `/worker/version`
  proves the persistent server commit; the Netlify UI/deploy log remains the authority
  for frontend completion.
- The server's development environment is now a deliberate operator secret source and
  must be protected with mode `0600`; it remains gitignored and included in neither logs
  nor command output.
