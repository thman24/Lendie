-- Hourly cron that invokes the release-payouts edge function, which transfers
-- any held owner payouts whose payout_release_at has passed.
--
-- ONE-TIME SETUP (run once in the Supabase SQL editor, NOT committed here so the
-- service-role key never lands in git):
--
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>',                 'service_role_key');
--
-- The job reads both back from Vault at run time.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Idempotent: drop a prior definition before recreating.
select cron.unschedule('release-payouts-hourly')
where exists (select 1 from cron.job where jobname = 'release-payouts-hourly');

select cron.schedule(
  'release-payouts-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/release-payouts',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
