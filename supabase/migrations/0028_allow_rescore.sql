-- 0028_allow_rescore.sql
-- Safety gate for re-scoring already-scored jobs. By default the manual "Score selected"
-- action on the Jobs page only scores jobs that have no AI score yet (unscored/filtered)
-- and skips ones already scored, so a stray click can't overwrite scores or burn LLM
-- calls. When this flag is ON, "Score selected" will RE-score already-scored jobs too —
-- the deliberate "re-assess" path. The user flips it on in Settings, re-scores, then turns
-- it back off. Default false (locked).
alter table settings add column if not exists allow_rescore boolean not null default false;
