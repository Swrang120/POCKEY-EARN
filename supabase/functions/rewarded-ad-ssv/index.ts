import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function base64ToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const raw = atob(normalized);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s/g, "");
  return base64ToBytes(body).buffer;
}

// AdMob uses DER-encoded ECDSA signatures. WebCrypto expects the IEEE P1363 form.
function derSignatureToP1363(derBytes) {
  let i = 0;
  if (derBytes[i++] !== 0x30) throw new Error("INVALID_SIGNATURE_DER");
  let sequenceLength = derBytes[i++];
  if (sequenceLength & 0x80) {
    const n = sequenceLength & 0x7f;
    sequenceLength = 0;
    for (let j = 0; j < n; j++) sequenceLength = (sequenceLength << 8) | derBytes[i++];
  }
  const end = i + sequenceLength;
  if (derBytes[i++] !== 0x02) throw new Error("INVALID_SIGNATURE_DER");
  const rLen = derBytes[i++];
  const r = derBytes.slice(i, i + rLen); i += rLen;
  if (derBytes[i++] !== 0x02) throw new Error("INVALID_SIGNATURE_DER");
  const sLen = derBytes[i++];
  const s = derBytes.slice(i, i + sLen); i += sLen;
  if (i !== end || r.length > 33 || s.length > 33) throw new Error("INVALID_SIGNATURE_DER");

  const out = new Uint8Array(64);
  out.set(r.slice(Math.max(0, r.length - 32)), 32 - Math.min(32, r.length));
  out.set(s.slice(Math.max(0, s.length - 32)), 64 - Math.min(32, s.length));
  return out;
}

async function verifyAdMobSignature(requestUrl) {
  const url = new URL(requestUrl);
  const raw = url.search.slice(1);
  const parts = raw.split("&");
  if (parts.length < 3) throw new Error("INVALID_SSV_QUERY");

  const signatureIndex = parts.findIndex(p => p.startsWith("signature="));
  const keyIndex = parts.findIndex(p => p.startsWith("key_id="));
  if (signatureIndex !== parts.length - 2 || keyIndex !== parts.length - 1) {
    throw new Error("INVALID_SSV_ORDER");
  }

  const signedQuery = parts.slice(0, signatureIndex).join("&");
  const signature = decodeURIComponent(parts[signatureIndex].slice("signature=".length));
  const keyId = Number(decodeURIComponent(parts[keyIndex].slice("key_id=".length)));
  if (!Number.isFinite(keyId) || !signature) throw new Error("INVALID_SSV_FIELDS");

  const keysResponse = await fetch(KEYS_URL, { headers: { Accept: "application/json" } });
  if (!keysResponse.ok) throw new Error("KEY_FETCH_FAILED");
  const keys = await keysResponse.json();
  const match = (keys.keys ?? []).find(k => Number(k.keyId) === keyId);
  if (!match?.pem) throw new Error("UNKNOWN_KEY_ID");

  const cryptoKey = await crypto.subtle.importKey(
    "spki", pemToDer(match.pem),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]
  );

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    cryptoKey,
    derSignatureToP1363(base64ToBytes(signature)),
    new TextEncoder().encode(signedQuery)
  );
  if (!ok) throw new Error("INVALID_SSV_SIGNATURE");

  const params = new URLSearchParams(raw);
  const timestamp = Number(params.get("timestamp"));
  if (!Number.isFinite(timestamp)) throw new Error("INVALID_TIMESTAMP");
  if (Math.abs(Date.now() - timestamp) > MAX_CLOCK_SKEW_MS) {
    throw new Error("SSV_TIMESTAMP_OUT_OF_RANGE");
  }
  return params;
}

Deno.serve(async (req) => {
  if (req.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

  try {
    const params = await verifyAdMobSignature(req.url);
    const transactionId = params.get("transaction_id");
    const customData = params.get("custom_data");
    const rewardAmount = Number(params.get("reward_amount"));
    if (!transactionId || !customData) throw new Error("MISSING_CLAIM_DATA");
    if (rewardAmount !== 5) throw new Error("INVALID_REWARD_AMOUNT");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRole) throw new Error("SUPABASE_CONFIG_MISSING");

    const admin = createClient(supabaseUrl, serviceRole);
    const { error } = await admin.schema("private").rpc("complete_rewarded_ad", {
      p_claim_id: customData,
      p_transaction_id: transactionId,
      p_reward_amount: 5,
    });
    if (error) throw new Error(error.message);

    return new Response("OK", { status: 200 });
  } catch (error) {
    console.error(error);
    return new Response("Rejected", { status: 400 });
  }
});
