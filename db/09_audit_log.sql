-- =====================================================================
-- FORESTY MANAGEMENT — LOG PERUBAHAN (menu Log akun lab)
-- Jalankan setelah 01–08. Aman dijalankan ulang.
--
-- Setiap tambah, ubah, dan hapus di tabel data lab dicatat oleh trigger
-- di database, lengkap dengan siapa pelakunya. Karena dicatat di server,
-- perubahan lewat API langsung atau Table Editor Supabase juga ikut
-- tercatat — bukan hanya yang lewat tampilan web.
--
-- Yang membaca: HANYA akun lab. Tidak ada yang bisa menulis, mengubah,
-- atau menghapus log dari aplikasi; hanya trigger yang mengisinya.
--
-- Tidak dicatat: notif_read (status baca), push_subs (kunci perangkat),
-- push_log, dan activity_log — bukan perubahan data lab.
-- =====================================================================

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       uuid,                 -- null: SQL Editor, cron, atau Edge Function
  actor_email text,
  actor_name  text,
  tbl         text not null,
  op          text not null check (op in ('INSERT','UPDATE','DELETE')),
  row_id      text,
  old_data    jsonb,
  new_data    jsonb,
  -- teks gabungan untuk kolom pencarian di menu Log
  search      text generated always as (lower(
                coalesce(actor_name, '') || ' ' || coalesce(actor_email, '') || ' ' ||
                case op when 'INSERT' then 'add added create created new'
                        when 'UPDATE' then 'edit edited change changed update updated'
                        else 'delete deleted remove removed' end || ' ' ||
                case tbl when 'tasks'            then 'division task'
                         when 'checklist'        then 'checklist item program'
                         when 'programs'         then 'program'
                         when 'program_pics'     then 'program pic'
                         when 'meetings'         then 'meeting minutes'
                         when 'profiles'         then 'account registration approval'
                         when 'members'          then 'member'
                         when 'divisions'        then 'division'
                         when 'division_members' then 'division member'
                         else tbl end || ' ' ||
                coalesce(new_data::text, '') || ' ' || coalesce(old_data::text, ''))) stored
);
create index if not exists audit_log_at_idx on public.audit_log(at desc);

alter table public.audit_log enable row level security;

drop policy if exists audit_read_lab on public.audit_log;
create policy audit_read_lab on public.audit_log
  for select to authenticated using (public.is_lab());

-- ---------------------------------------------------------------------
-- Trigger pencatat. security definer supaya bisa menulis ke audit_log
-- walau klien sendiri tidak punya izin menulis.
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  uid  uuid := auth.uid();
  o    jsonb := case when TG_OP <> 'INSERT' then to_jsonb(old) end;
  n    jsonb := case when TG_OP <> 'DELETE' then to_jsonb(new) end;
  r    jsonb := coalesce(n, o);
  em   text;
  nm   text;
begin
  -- ubahan yang hanya menyentuh updated_at bukan perubahan sungguhan
  if TG_OP = 'UPDATE' and (o - 'updated_at') = (n - 'updated_at') then
    return null;
  end if;

  if uid is not null then
    select u.email into em from auth.users u where u.id = uid;
    select m.name into nm from public.profiles p
      join public.members m on m.id = p.member_id
      where p.user_id = uid;
  end if;

  insert into public.audit_log (actor, actor_email, actor_name, tbl, op, row_id, old_data, new_data)
  values (uid, em, nm, TG_TABLE_NAME, TG_OP,
          coalesce(r->>'id', r->>'user_id',
                   concat_ws(':', r->>'program_id', r->>'division_id', r->>'member_id')),
          o, n);
  return null;
exception when others then
  -- pencatatan gagal tidak boleh membatalkan perubahan datanya
  raise warning 'audit_trigger %: %', TG_TABLE_NAME, sqlerrm;
  return null;
end
$$;

do $$
declare t text;
begin
  foreach t in array array['programs','program_pics','checklist','tasks','meetings',
                           'profiles','members','divisions','division_members'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%1$s on public.%1$I', t);
      execute format('create trigger audit_%1$s after insert or update or delete on public.%1$I
                      for each row execute function public.audit_trigger()', t);
    end if;
  end loop;
end $$;
