-- When a user registers (public.users row created on first login by AuthContext),
-- attach them to any pending trip invites addressed to their email and create
-- the in-app invite notifications so the invites appear in their Inbox.
-- Needed because inviteTripMember only creates the notification for users who
-- were ALREADY registered at invite time; people invited before signing up
-- previously had no in-app entry point to accept.

create or replace function public.link_pending_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.email is null then
    return NEW;
  end if;

  -- 1) claim pending invites addressed to this email
  update public.trip_members m
     set user_id = NEW.id
   where m.user_id is null
     and m.status = 'pending'
     and lower(m.invite_email) = lower(NEW.email);

  -- 2) surface them in the Inbox (notifications are keyed by user_id)
  insert into public.notifications
    (user_id, type, i18n_title_key, i18n_message_key, i18n_params,
     title, message, trip_id, trip_member_id, read, created_by)
  select NEW.id, 'trip_invite', 'notif.tpl_invite_title', 'notif.tpl_invite_msg',
         jsonb_build_object(
           'trip', t.title,
           'inviter', coalesce(iu.full_name, ''),
           'role_key', case when m.role = 'admin' then 'notif.role_admin' else 'notif.role_viewer' end
         ),
         'Trip invitation', '', m.trip_id, m.id, false, m.invited_by
    from public.trip_members m
    join public.trips t on t.id = m.trip_id
    left join public.users iu on iu.id = m.invited_by
   where m.user_id = NEW.id and m.status = 'pending';

  return NEW;
end $$;

drop trigger if exists trg_link_pending_invites on public.users;
create trigger trg_link_pending_invites
after insert on public.users
for each row execute function public.link_pending_invites();
