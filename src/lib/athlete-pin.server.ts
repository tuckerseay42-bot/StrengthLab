function hexToBytes(hex: string): Uint8Array {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return new Uint8Array(pairs.map((byte) => parseInt(byte, 16)));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function hashPin(pin: string, saltHex: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = toArrayBuffer(hexToBytes(saltHex));
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(enc.encode(pin)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function savePinForUser(userId: string, pin: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const salt = randomSaltHex();
  const hash = await hashPin(pin, salt);
  const { error } = await supabaseAdmin.from("athlete_pins").upsert({
    user_id: userId,
    pin_hash: hash,
    pin_salt: salt,
    failed_attempts: 0,
    locked_until: null,
  });
  if (error) throw new Error(error.message);
}

export async function linkAthleteByEmailAndSavePin({
  userId,
  sessionEmail,
  enteredEmail,
  pin,
}: {
  userId: string;
  sessionEmail: string | null | undefined;
  enteredEmail: string;
  pin: string;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let normalizedSessionEmail = String(sessionEmail ?? "").trim().toLowerCase();
  if (!normalizedSessionEmail) {
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (error) throw new Error(error.message);
    normalizedSessionEmail = String(data.user?.email ?? "").trim().toLowerCase();
  }
  const normalizedEnteredEmail = enteredEmail.trim().toLowerCase();

  if (!normalizedSessionEmail) throw new Error("Open the setup link from your email first.");
  if (normalizedSessionEmail !== normalizedEnteredEmail) {
    throw new Error("Use the same email address that received this setup link.");
  }

  const { data: rows, error: athleteError } = await supabaseAdmin
    .from("athletes")
    .select("id, user_id")
    .ilike("athlete_email", normalizedEnteredEmail)
    .limit(2);

  if (athleteError) throw new Error(athleteError.message);
  if (!rows?.length) throw new Error("No athlete profile was found for this email. Ask your coach to check your email on the roster.");
  if (rows.length > 1) throw new Error("This email is on more than one athlete profile. Ask your coach to update the roster email.");

  const athlete = rows[0];
  if (!athlete) throw new Error("No athlete profile was found for this email. Ask your coach to check your email on the roster.");
  if (athlete.user_id && athlete.user_id !== userId) {
    throw new Error("This athlete profile is already linked to another sign-in. Ask your coach to send a new setup link.");
  }

  const { error: linkError } = await supabaseAdmin
    .from("athletes")
    .update({ user_id: userId })
    .eq("id", athlete.id);
  if (linkError) throw new Error(linkError.message);

  const { error: roleError } = await supabaseAdmin
    .from("user_roles")
    .upsert({ user_id: userId, role: "athlete" }, { onConflict: "user_id,role" });
  if (roleError) throw new Error(roleError.message);

  await savePinForUser(userId, pin);

  const { error: statusError } = await supabaseAdmin
    .from("athletes")
    .update({ invite_status: "pin_set", invite_error: null })
    .eq("id", athlete.id);
  if (statusError) throw new Error(statusError.message);

  return { ok: true };
}