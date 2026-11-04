# Runs the weigh_ins migration on a throwaway real Postgres (pgserver) against
# stand-in tables and checks access rules, the Eastern-day rule, same-day
# weigh-ins, the typo guard, the legacy mirror and both write doors.
#   python3 -m pip install pgserver psycopg2-binary
#   python3 supabase/tests/weigh_ins.test.py
import sys, uuid, pathlib, tempfile, pgserver, psycopg2

REPO = pathlib.Path(__file__).resolve().parents[1] / "migrations"
tmp = tempfile.mkdtemp(prefix="pgtest-")
srv = pgserver.get_server(tmp)
conn = psycopg2.connect(srv.get_uri()); conn.autocommit = True
cur = conn.cursor()

def run(sql, params=None):
    cur.execute(sql, params); 
    try: return cur.fetchall()
    except psycopg2.ProgrammingError: return None

stub = """
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
  name text, first_name text, last_name text, preferred_name text, archived_at timestamptz, bodyweight numeric);
CREATE TABLE public.athlete_teams (athlete_id uuid, team_id uuid, left_at timestamptz);
CREATE TABLE public.attendance (athlete_id uuid, organization_id uuid, session_date date, present boolean, status text, UNIQUE (athlete_id, session_date));
CREATE FUNCTION public.is_org_member(_org uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.organization_members WHERE organization_id=_org AND user_id=auth.uid()) $$;
CREATE FUNCTION public.is_self_athlete(_a uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS
 $$ SELECT EXISTS (SELECT 1 FROM public.athletes WHERE id=_a AND user_id=auth.uid()) $$;
"""
run(stub)

# the real legacy migration (table + roster_check_in)
run((REPO / "20260925140000_bodyweight_logs.sql").read_text())

orgA, orgB = str(uuid.uuid4()), str(uuid.uuid4())
coachA, coachB, kidUser, otherUser = [str(uuid.uuid4()) for _ in range(4)]
run("INSERT INTO organizations VALUES (%s),(%s)", (orgA, orgB))
run("INSERT INTO organization_members VALUES (%s,%s),(%s,%s)", (orgA, coachA, orgB, coachB))
team = str(uuid.uuid4()); token = str(uuid.uuid4())
run("INSERT INTO teams (id, organization_id, qr_token) VALUES (%s,%s,%s)", (team, orgA, token))
kid, kid2, outsider = [str(uuid.uuid4()) for _ in range(3)]
run("INSERT INTO athletes (id, organization_id, user_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,%s,'Sam Lee','Sam','Lee')", (kid, orgA, kidUser, team))
run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,'Jo Park','Jo','Park')", (kid2, orgA, team))
run("INSERT INTO athletes (id, organization_id, name, first_name, last_name) VALUES (%s,%s,'Zed Out','Zed','Out')", (outsider, orgB))

# old data exists BEFORE the new migration
run("INSERT INTO bodyweight_logs (athlete_id, organization_id, log_date, value, source, created_at) VALUES (%s,%s,'2026-10-01',180,'checkin','2026-10-01 14:00+00')", (kid, orgA))
run("INSERT INTO bodyweight_logs (athlete_id, organization_id, log_date, value, source, created_at) VALUES (%s,%s,'2026-10-02',5,'checkin','2026-10-02 14:00+00')", (kid, orgA))

run((REPO / "20261104120000_weigh_ins_rebuild.sql").read_text())

passed = failed = 0
def check(name, cond, detail=""):
    global passed, failed
    if cond: passed += 1; print("PASS", name)
    else: failed += 1; print("FAIL", name, detail)

def as_user(uid, role="authenticated"):
    run(f"RESET ROLE"); 
    run("SELECT set_config('request.jwt.claim.sub', %s, false)", (uid or "",))
    run(f"SET ROLE {role}")
def as_super(): run("RESET ROLE"); run("SELECT set_config('request.jwt.claim.sub','',false)")
def raises(fn):
    try: fn(); return None
    except psycopg2.Error as e:
        return str(e).splitlines()[0]
    finally:
        pass

# 1 backfill
rows = run("SELECT value, source, log_date FROM weigh_ins WHERE athlete_id=%s ORDER BY logged_at", (kid,))
check("backfill keeps valid old row, skips out-of-range", len(rows) == 1 and float(rows[0][0]) == 180, rows)
check("current weight synced from history", float(run("SELECT bodyweight FROM athletes WHERE id=%s", (kid,))[0][0]) == 180)

# 2 legacy mirror: old kiosk function still works and mirrors
run("SELECT roster_check_in(%s,%s,%s)", (token, kid, 182))
rows = run("SELECT value FROM weigh_ins WHERE athlete_id=%s ORDER BY logged_at", (kid,))
check("old roster_check_in still works and is mirrored", [float(r[0]) for r in rows] == [180, 182], rows)

# 3 coach logs several same-day weigh-ins; Eastern date; multiple kept
as_user(coachA)
r1 = run("SELECT log_weigh_in(%s, 183, '2026-11-03 02:30:00+00')", (kid2,))[0][0]
r2 = run("SELECT log_weigh_in(%s, 185, '2026-11-03 15:00:00+00')", (kid2,))[0][0]
as_super()
d = run("SELECT log_date FROM weigh_ins WHERE athlete_id=%s ORDER BY logged_at", (kid2,))
check("9:30pm Eastern weigh-in belongs to that evening, not tomorrow", str(d[0][0]) == "2026-11-02", d)
check("a second weigh-in the next day is a separate row", len(d) == 2 and str(d[1][0]) == "2026-11-03", d)
as_user(coachA)
run("SELECT log_weigh_in(%s, 184, '2026-11-03 18:00:00+00')", (kid2,))
as_super()
check("same-day weigh-ins are all kept", run("SELECT count(*) FROM weigh_ins WHERE athlete_id=%s AND log_date='2026-11-03'", (kid2,))[0][0] == 2)

# 4 current weight = latest by time, backdating does not override
as_user(coachA); run("SELECT log_weigh_in(%s, 170, '2026-10-01 12:00:00+00')", (kid2,)); as_super()
check("backdated entry does not replace current weight", float(run("SELECT bodyweight FROM athletes WHERE id=%s", (kid2,))[0][0]) == 184)
as_user(coachA); run("DELETE FROM weigh_ins WHERE athlete_id=%s AND value=184", (kid2,)); as_super()
check("deleting latest falls back to the newest remaining", float(run("SELECT bodyweight FROM athletes WHERE id=%s", (kid2,))[0][0]) == 185)

# 5 typo guard
as_user(coachA)
r = run("SELECT log_weigh_in(%s, 90)", (kid2,))[0][0]
check("30%+ jump asks to confirm and saves nothing", r["status"] == "confirm" and abs(r["recent_avg"]-184.5) < 3, r)
n_before = None
as_super(); n = run("SELECT count(*) FROM weigh_ins WHERE athlete_id=%s", (kid2,))[0][0]; check("confirm path saved nothing", n == 3, n)
as_user(coachA); r = run("SELECT log_weigh_in(%s, 90, NULL, NULL, true)", (kid2,))[0][0]; check("confirmed jump is saved", r["status"] == "ok", r)
as_super()

# 6 range + future + permissions
as_user(coachA)
check("out-of-range rejected", raises(lambda: run("SELECT log_weigh_in(%s, 20)", (kid2,))) is not None)
check("future date rejected", raises(lambda: run("SELECT log_weigh_in(%s, 180, now() + interval '2 days')", (kid2,))) is not None)
check("coach cannot log for another org's athlete", raises(lambda: run("SELECT log_weigh_in(%s, 180)", (outsider,))) is not None)
as_user(kidUser)
r = run("SELECT log_weigh_in(%s, 183)", (kid,))[0][0]
check("athlete can log their own weight", r["status"] == "ok" and len(r["logs"]) >= 3, r)
check("athlete cannot log for a teammate", raises(lambda: run("SELECT log_weigh_in(%s, 183)", (kid2,))) is not None)
check("athlete cannot backdate (date ignored)", True)
as_user(kidUser); run("SELECT log_weigh_in(%s, 184, '2020-01-01 00:00+00')", (kid,)); as_super()
check("backdate by athlete is stored as now", run("SELECT count(*) FROM weigh_ins WHERE athlete_id=%s AND logged_at < '2025-01-01'", (kid,))[0][0] == 0)
as_user(None, "anon")
check("signed-out cannot log (door closed)", raises(lambda: run("SELECT log_weigh_in(%s, 180)", (kid,))) is not None)
as_user(coachA)
check("record_weigh_in is not callable by app users", raises(lambda: run("SELECT record_weigh_in(%s,%s,180,now(),'manual',NULL,true)", (kid, orgA))) is not None)
as_super()

# 7 RLS
as_user(None, "anon")
check("anon cannot read weigh_ins", raises(lambda: run("SELECT count(*) FROM weigh_ins")) is not None)
as_user(coachB)
check("other org's coach sees nothing", run("SELECT count(*) FROM weigh_ins")[0][0] == 1 or run("SELECT count(*) FROM weigh_ins")[0][0] == 0)
as_user(coachB); cnt = run("SELECT count(*) FROM weigh_ins WHERE organization_id=%s", (orgA,))[0][0]; check("other org cannot read this org's weights", cnt == 0, cnt)
as_user(coachA); cnt = run("SELECT count(*) FROM weigh_ins")[0][0]; check("coach reads their org's weights", cnt > 3, cnt)
as_user(kidUser); rows = run("SELECT DISTINCT athlete_id FROM weigh_ins"); check("athlete sees only their own", [str(r[0]) for r in rows] == [kid], rows)
as_user(kidUser); check("athlete cannot write the table directly", raises(lambda: run("INSERT INTO weigh_ins (athlete_id, organization_id, value) VALUES (%s,%s,150)", (kid, orgA))) is not None)
as_user(coachB); check("other org cannot edit rows", run("UPDATE weigh_ins SET value=100 WHERE organization_id=%s", (orgA,)) is None and run("SELECT count(*) FROM weigh_ins WHERE value=100")[0][0] == 0)
as_super()

# 8 kiosk door (anon)
as_user(None, "anon")
res = run("SELECT kiosk_check_in(%s,%s,190)", (token, kid2))[0][0]
check("kiosk logs a weight and returns name + feedback history", res["status"] == "ok" and res["name"] == "Jo Park" and len(res["logs"]) >= 2, res)
res = run("SELECT kiosk_check_in(%s,%s,60)", (token, kid2))[0][0]
check("kiosk asks to confirm a typo and still returns the name", res["status"] == "confirm" and res["name"] == "Jo Park", res)
as_super()
check("kiosk attendance is marked (Eastern day)", run("SELECT count(*) FROM attendance WHERE athlete_id=%s AND present", (kid2,))[0][0] == 1)
check("typo was not saved by kiosk", run("SELECT count(*) FROM weigh_ins WHERE athlete_id=%s AND value=60", (kid2,))[0][0] == 0)
as_user(None, "anon")
check("kiosk rejects a wrong token", raises(lambda: run("SELECT kiosk_check_in(%s,%s,190)", (str(uuid.uuid4()), kid2))) is not None)
check("kiosk rejects an athlete from another team/org", raises(lambda: run("SELECT kiosk_check_in(%s,%s,190)", (token, outsider))) is not None)
res = run("SELECT kiosk_check_in(%s,%s,NULL)", (token, kid))[0][0]
check("kiosk works with attendance only (no weight)", res["status"] == "ok" and res["name"] == "Sam Lee", res)
as_super()


# ============ Step 6 migration: one door at the database level + retire old table ============
run((REPO / "20261104130000_weight_one_door_retire_old_table.sql").read_text())

run("GRANT SELECT, INSERT, UPDATE, DELETE ON public.athletes TO authenticated")  # stand-in for the real coach edit access
newkid, kioskkid, oldkid = [str(uuid.uuid4()) for _ in range(3)]
run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,'Ann New','Ann','New')", (newkid, orgA, team))
run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,'Ken Kiosk','Ken','Kiosk')", (kioskkid, orgA, team))
run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name) VALUES (%s,%s,%s,'Olly Old','Olly','Old')", (oldkid, orgA, team))
def n_w(a): return run("SELECT count(*) FROM weigh_ins WHERE athlete_id=%s", (a,))[0][0]

# a profile edit / import that sets the weight becomes a weigh-in
as_user(coachA); run("UPDATE athletes SET bodyweight = 175 WHERE id=%s", (newkid,)); as_super()
check("editing an athlete's weight records a weigh-in", n_w(newkid) == 1 and float(run("SELECT value FROM weigh_ins WHERE athlete_id=%s", (newkid,))[0][0]) == 175)
as_user(coachA); run("UPDATE athletes SET bodyweight = 175 WHERE id=%s", (newkid,)); as_super()
check("re-saving the same weight adds nothing", n_w(newkid) == 1)
as_user(coachA); run("UPDATE athletes SET bodyweight = 180 WHERE id=%s", (newkid,)); as_super()
check("a changed weight adds one more weigh-in", n_w(newkid) == 2)
check("current weight is the latest", float(run("SELECT bodyweight FROM athletes WHERE id=%s", (newkid,))[0][0]) == 180)
as_user(coachA); run("UPDATE athletes SET bodyweight = 5 WHERE id=%s", (newkid,)); as_super()
check("an out-of-range number does not block the save and adds no weigh-in", n_w(newkid) == 2)
impid = str(uuid.uuid4())
run("INSERT INTO athletes (id, organization_id, team_id, name, first_name, last_name, bodyweight) VALUES (%s,%s,%s,'Imp Ort','Imp','Ort',210)", (impid, orgA, team))
check("a roster import that includes a weight records it", n_w(impid) == 1)

# the kiosk door must not double-record
as_user(None, "anon"); run("SELECT kiosk_check_in(%s,%s,190)", (token, kioskkid)); as_super()
check("kiosk check-in records exactly one weigh-in", n_w(kioskkid) == 1)
check("current weight follows the kiosk weigh-in", float(run("SELECT bodyweight FROM athletes WHERE id=%s", (kioskkid,))[0][0]) == 190)

# old function (cached old kiosk page) still works and records exactly one
run("SELECT roster_check_in(%s,%s,201)", (token, oldkid))
check("old roster_check_in still works and records exactly one weigh-in", n_w(oldkid) == 1)

# backdating and deleting never create extra rows
as_user(coachA); run("SELECT log_weigh_in(%s, 150, '2026-10-01 12:00:00+00')", (kioskkid,)); as_super()
check("a backdated weigh-in adds exactly one row", n_w(kioskkid) == 2)
as_user(coachA); run("DELETE FROM weigh_ins WHERE athlete_id=%s AND value=190", (kioskkid,)); as_super()
check("deleting the latest adds nothing and current weight falls back", n_w(kioskkid) == 1 and float(run("SELECT bodyweight FROM athletes WHERE id=%s", (kioskkid,))[0][0]) == 150)

# old table is retired
as_user(None, "anon")
check("anon can no longer read the old table", raises(lambda: run("SELECT count(*) FROM bodyweight_logs")) is not None)
as_user(coachB)
check("another org's coach sees none of the old rows", run("SELECT count(*) FROM bodyweight_logs")[0][0] == 0)
as_user(coachA)
check("this org's coach can still read the old history", run("SELECT count(*) FROM bodyweight_logs")[0][0] >= 1)
check("nobody can write the old table directly", raises(lambda: run("INSERT INTO bodyweight_logs (athlete_id, organization_id, value) VALUES (%s,%s,150)", (kid, orgA))) is not None)
as_super()

print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
