-- Hourly cron that invokes the charge-due-bookings edge function, which charges
-- saved cards off-session 24h before the rental begins (payment_status
-- 'scheduled', charge_at passed), and sweeps failed charges through the grace
-- window / auto-cancel. Mirrors the release-payouts-hourly job.
--
-- Reuses the same Vault secrets set up for release-payouts (project_url,
-- service_role_key). If those aren't set yet, run once in the SQL editor:
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>',                 'service_role_key');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('charge-due-bookings-hourly')
where exists (select 1 from cron.job where jobname = 'charge-due-bookings-hourly');

select cron.schedule(
  'charge-due-bookings-hourly',
  '30 * * * *',  -- offset 30m from release-payouts so the two don't contend
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/charge-due-bookings',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
