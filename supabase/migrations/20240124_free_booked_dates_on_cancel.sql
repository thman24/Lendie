-- When a booking_request is cancelled or declined, release the dates it held
-- back onto the listing's calendar. Must run SECURITY DEFINER because renters
-- cannot UPDATE listings under RLS (listings_update_owner: auth.uid() = user_id),
-- yet a renter cancelling their own accepted booking must free those dates.
-- Listing link is item_json->>'id' (no listing_id column). booked is jsonb of
-- 'YYYY-MM-DD' strings; start_date/end_date are text 'YYYY-MM-DD'.

create or replace function public.free_booked_dates_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id int8;
  v_remove text[];
begin
  if new.status in ('cancelled','declined')
     and new.status is distinct from old.status
     and new.start_date is not null then

    v_listing_id := (new.item_json->>'id')::int8;
    if v_listing_id is null then
      return new;
    end if;

    select array_agg(to_char(gs, 'YYYY-MM-DD'))
      into v_remove
    from generate_series(new.start_date::date,
                         coalesce(new.end_date, new.start_date)::date,
                         interval '1 day') gs;

    if v_remove is null then
      return new;
    end if;

    update listings l
       set booked = coalesce((
             select jsonb_agg(elem)
             from jsonb_array_elements_text(l.booked) elem
             where elem <> all(v_remove)
           ), '[]'::jsonb)
     where l.id = v_listing_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_free_booked_dates_on_cancel on public.booking_requests;
create trigger trg_free_booked_dates_on_cancel
  after update on public.booking_requests
  for each row
  execute function public.free_booked_dates_on_cancel();
