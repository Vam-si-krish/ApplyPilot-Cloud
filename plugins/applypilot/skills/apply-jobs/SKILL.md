---
name: apply-jobs
description: Apply to jobs assigned in ApplyPilot using Chrome, extension-first autofill, grounded candidate facts for missed fields, and automatic queue status updates.
---

# Apply assigned jobs

Use this skill when the user asks to apply, continue applying, or work through jobs in the ApplyPilot **Assign to AI** queue.

## Workflow

1. If ApplyPilot is not connected, ask the user for the single-use pairing code shown after choosing **Pair Codex** in the AI Apply tab, then call `connect_applypilot`. Never ask for or display a bearer token.
2. Call `list_assigned_jobs`. Work in the returned order, one application at a time.
3. If its status is `assigned`, call `start_application` immediately before opening it.
   If it is already `in_progress`, resume it without starting it again.
4. Use `@Chrome` to open the returned `targetUrl` in a new tab.
5. Before filling, check for visible status such as **Applied**, **You applied**, **Application submitted**, or **Already applied** for this exact job. If present, do not submit again. Call `mark_application_applied` with `confirmation: "already_applied"`, then continue to the next queue item.
6. Otherwise, let the user’s installed autofill extension act first. Navigate with **Next**, **Continue**, **Review**, or equivalent controls.
7. If a field remains unanswered, call `get_application_context` for that application. Fill the field only when the returned candidate context states the answer.
8. If a required answer is still unknown, the answer needs human judgment, or the site cannot be completed confidently, call `mark_application_needs_review` with the exact missing field or concise blocker. Leave the tab open and continue to the next queue item in a new tab.
9. On the final page, submit the application. After the employer site visibly confirms success, call `mark_application_applied` with `confirmation: "submitted_now"` and continue.

Do not invent candidate facts. Do not mark an application Applied from a button click alone; require visible submitted/already-applied evidence for that exact job. Never expose or repeat the ApplyPilot bearer token.

If a tool reports that the connection is missing, expired, or revoked, tell the user to choose **Pair Codex** and provide a new one-time code. Do not ask for a bearer token, database password, service key, or session cookie.
