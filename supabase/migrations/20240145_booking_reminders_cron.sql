-- Hourly cron that invokes the booking-reminders edge function, which sends the
-- rental reminders (day-before start, morning-of start, and return-due) via push +
-- in-app notifications to both the renter and the owner.
--
-- Reuses the same Vault secrets as release-payouts / charge-due-bookings
-- (project_url, service_role_key). If those aren't set yet, run once in SQL editor:
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<SERVICE_ROLE_KEY>',                 'service_role_key');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('booking-reminders-hourly')
where exists (select 1 from cron.job where jobname = 'booking-reminders-hourly');

select cron.schedule(
  'booking-reminders-hourly',
  '15 * * * *',  -- offset from release-payouts (:00) and charge-due (:30)
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/booking-reminders',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key'),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);
