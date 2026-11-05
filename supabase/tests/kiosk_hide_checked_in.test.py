# Runs the kiosk "hide checked-in names" migration on a throwaway real Postgres
# (pgserver) and checks the roster list and the coach "bring name back" flag.
#   python3 -m pip install pgserver psycopg2-binary
#   python3 supabase/tests/kiosk_hide_checked_in.test.py
import sys, uuid, pathlib, tempfile, pgserver, psycopg2

REPO = pathlib.Path(__file__).resolve().parents[1] / "migrations"
srv = pgserver.get_server(tempfile.mkdtemp(prefix="pgtest-"))
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()
def run(sql, params=None):
    cur.execute(sql, params)
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None

run("""
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated;
CREATE PUBLICATION supabase_realtime;
CREATE TABLE public.organizations (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.organization_members (organization_id uuid, user_id uuid);
CREATE TABLE public.teams (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, qr_token uuid DEFAULT gen_random_uuid());
CREATE TABLE public.athletes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid, user_id uuid, team_id uuid,
  name text, first_name text, last_name text, preferred_name text, archived_at timestamptz, bodyweight numeric,
  grade smallint, class_period text, position text, photo_url text);
CREATE TABLE public.athlete_teams (athlete_id uuid, team_id uuid, left_at timestamptz);
CREATE TABLE public.attendance (athlete_id uuid, organization_id uuid, session_date date, present boolean, status text, UNIQUE (athlete_id, session_date));
CREATE FUNCTION public.is_org_member(_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=_org AND user_id=auth.uid()) $$;
CREATE FUNCTION public.is_self_athlete(_a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.athletes WHERE id=_a AND user_id=auth.uid()) $$;
""")
for f in ["20260925140000_bodyweight_logs.sql",
          "20261104120000_weigh_ins_rebuild.sql", "20261105120000_kiosk_hide_checked_in.sql"]:
    run((REPO / f).read_text())

passed = failed = 0
def check(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1; print("PASS", name)
    else: failed += 1; print("FAIL", name, detail)

org = str(uuid.uuid4()); team = str(uuid.uuid4()); token = str(uuid.uuid4())
run("INSERT INTO organizations VALUES (%s)", (org,))
run("INSERT INTO teams (id, organization_id, qr_token) VALUES (%s,%s,%s)", (team, org, token))
sam, jo, tom = [str(uuid.uuid4()) for _ in range(3)]
for i, (n, f, l) in zip([sam, jo, tom], [("Sam Lee","Sam","Lee"),("Jo Park","Jo","Park"),("Tom Ray","Tom","Ray")]):
    run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,%s,%s,%s)", (i, org, team, n, f, l))
today = "(now() AT TIME ZONE 'America/New_York')::date"
def names(): return sorted(r[1] for r in run("SELECT * FROM get_roster_by_qr_token(%s)", (token,)))

check("everyone is listed at the start", names() == ["Jo Park", "Sam Lee", "Tom Ray"], names())

as_anon = lambda: (run("RESET ROLE"), run("SET ROLE anon"))
as_super = lambda: run("RESET ROLE")

as_anon(); run("SELECT kiosk_check_in(%s,%s,190)", (token, sam)); as_super()
check("a checked-in kid leaves the list", names() == ["Jo Park", "Tom Ray"], names())
check("check-in still marks present for today",
      run(f"SELECT present FROM attendance WHERE athlete_id=%s AND session_date={today}", (sam,))[0][0] is True)

# kiosk works for anonymous callers and returns the same list
as_anon(); got = sorted(r[1] for r in run("SELECT * FROM get_roster_by_qr_token(%s)", (token,))); as_super()
check("anonymous kiosk sees the shortened list", got == ["Jo Park", "Tom Ray"], got)

# an absent mark does not hide a name; a present mark from the coach board does
run(f"INSERT INTO attendance (athlete_id, organization_id, session_date, present, status) VALUES (%s,%s,{today},false,'absent')", (jo, org))
check("marked absent stays on the list", "Jo Park" in names())
run(f"UPDATE attendance SET present=true, status='present' WHERE athlete_id=%s AND session_date={today}", (jo,))
check("marked present by a coach leaves the list", "Jo Park" not in names())

# yesterday's attendance never hides anyone
run("INSERT INTO attendance (athlete_id, organization_id, session_date, present, status) VALUES (%s,%s,(now() AT TIME ZONE 'America/New_York')::date - 1,true,'present')", (tom, org))
check("yesterday's check-in does not hide today", "Tom Ray" in names())

# coach brings a name back
run(f"UPDATE attendance SET kiosk_reopened=true WHERE athlete_id=%s AND session_date={today}", (sam,))
check("bring-back puts the name on the list", "Sam Lee" in names())
check("bring-back keeps them present",
      run(f"SELECT present FROM attendance WHERE athlete_id=%s AND session_date={today}", (sam,))[0][0] is True)

# the kid checks in again, name goes away again
as_anon(); run("SELECT kiosk_check_in(%s,%s,191)", (token, sam)); as_super()
check("checking in again removes it again", "Sam Lee" not in names())
check("flag is cleared after check-in",
      run(f"SELECT kiosk_reopened FROM attendance WHERE athlete_id=%s AND session_date={today}", (sam,))[0][0] is False)

# a weight-typo question must not hide anyone (nothing was saved)
ana = str(uuid.uuid4())
run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,'Ana Diaz','Ana','Diaz')", (ana, org, team))
run("SELECT record_weigh_in(%s,%s,190,now() - interval '2 days','manual',NULL,false)", (ana, org))
as_anon(); res = run("SELECT kiosk_check_in(%s,%s,60)", (token, ana))[0][0]; as_super()
check("typo question does not take the name off", res.get("status") == "confirm" and "Ana Diaz" in names(), (res, names()))

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
