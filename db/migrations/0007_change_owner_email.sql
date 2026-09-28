-- Move the DeanOS login from deano@heya.team to dean@justimagineconsulting.co.za.
-- ensureOwner() looks the owner up by DEANOS_EMAIL, so the existing user row is
-- renamed in place (keeping every user_id reference) rather than letting a new,
-- empty user be created. Skipped if a row for the new address already exists.

update users
set email = 'dean@justimagineconsulting.co.za'
where email = 'deano@heya.team'
  and not exists (select 1 from users where email = 'dean@justimagineconsulting.co.za');
