#!/usr/bin/env bash
# End-to-end tests for Phase 2a email, over real HTTP.
#
# Covers webhooks (signatures, replay, routing, bounce mapping, opt-out) and the
# compose-link path.
#
#   pnpm db:reset && pnpm dev     # in one terminal
#   bash scripts/test-webhooks.sh # in another
#
# Covers what the SQL suites cannot: signature verification, replay windows,
# routing, and the GET-must-not-unsubscribe rule. Reads secrets from .env.local.
set -uo pipefail

BASE="${BASE:-http://localhost:3100}"
DB="${DB:-i3-portal-db}"
cd "$(dirname "$0")/.."
set -a; . ./.env.local; set +a

pass=0; fail=0
ok()   { printf '  \033[32mPASS\033[0m %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  \033[31mFAIL\033[0m %s  (got: %s)\n' "$1" "$2"; fail=$((fail+1)); }
check(){ [ "$2" = "$3" ] && ok "$1" || bad "$1" "$2 != $3"; }
q()    { docker exec -i "$DB" psql -U postgres -d i3 -q -t -A -c "$1"; }

# Admin session cookie, signed the same way src/lib/session.ts does.
ADMIN_COOKIE=$(node -e '
  const c=require("crypto"); const id="a0000000-0000-0000-0000-000000000001";
  console.log("i3_session="+id+"."+c.createHmac("sha256",process.env.SESSION_SECRET).update(id).digest("hex"));
')

post() {  # kind path json  -> prints HTTP status
  node -e '
    const crypto=require("crypto");
    // node -e has no script path in argv, so args start at index 1 (not 2).
    const [kind,path,body]=process.argv.slice(1);
    const h={"Content-Type":"application/json"};
    const ts=Math.floor(Date.now()/1000)+Number(process.env.SKEW||0);
    if(kind==="inbound"){
      h["x-i3-timestamp"]=String(ts);
      h["x-i3-signature"]=crypto.createHmac("sha256",process.env.INBOUND_WEBHOOK_SECRET)
        .update(ts+"."+body).digest("hex");
    } else {
      const id=process.env.SVIX_ID||("msg_"+crypto.randomBytes(6).toString("hex"));
      const sec=Buffer.from(process.env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/,""),"base64");
      h["svix-id"]=id; h["svix-timestamp"]=String(ts);
      h["svix-signature"]="v1,"+crypto.createHmac("sha256",sec)
        .update(id+"."+ts+"."+body).digest("base64");
    }
    fetch(process.env.BASE+path,{method:"POST",headers:h,body})
      .then(r=>console.log(r.status))
      .catch(e=>{ console.error("post failed:", e.message); console.log("000"); });
  ' "$1" "$2" "$3"
}
export BASE

echo "== auth must fail closed =="
check "inbound: no signature rejected" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' $BASE/api/inbound)" 401
check "inbound: bad signature rejected" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "x-i3-timestamp: $(date +%s)" -H 'x-i3-signature: bad' -d '{}' $BASE/api/inbound)" 401
check "resend: no svix headers rejected" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d '{}' $BASE/api/webhooks/resend)" 401
check "resend: bad signature rejected" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'svix-id: m1' -H "svix-timestamp: $(date +%s)" -H 'svix-signature: v1,AA' -d '{}' $BASE/api/webhooks/resend)" 401
check "inbound: valid signature 10min old rejected (replay)" \
  "$(SKEW=-600 post inbound /api/inbound '{"to":"r+x@y"}')" 401
check "resend: valid signature 10min old rejected (replay)" \
  "$(SKEW=-600 post resend /api/webhooks/resend '{"type":"email.delivered"}')" 401

echo "== inbound reply routing =="
TOK=$(q "select reply_token from outreach_threads where id='c0000000-0000-0000-0000-000000000001';")
before=$(q "select count(*) from messages where thread_id='c0000000-0000-0000-0000-000000000001' and direction='inbound';")
SVIX_ID=x post inbound /api/inbound "{\"to\":\"r+$TOK@mail.i3competition.com\",\"from\":\"rosa@rosaspan.example\",\"subject\":\"Re: hi\",\"text\":\"Yes please.\",\"messageId\":\"<wh-test-1@x>\"}" >/dev/null
after=$(q "select count(*) from messages where thread_id='c0000000-0000-0000-0000-000000000001' and direction='inbound';")
check "reply attached to the right thread" "$after" "$((before+1))"
post inbound /api/inbound "{\"to\":\"r+$TOK@mail.i3competition.com\",\"from\":\"rosa@rosaspan.example\",\"text\":\"Yes please.\",\"messageId\":\"<wh-test-1@x>\"}" >/dev/null
check "replayed delivery does not duplicate" \
  "$(q "select count(*) from messages where thread_id='c0000000-0000-0000-0000-000000000001' and direction='inbound';")" "$after"
check "unknown token accepted but unrouted" \
  "$(post inbound /api/inbound '{"to":"r+ffffffffffffffff@m","from":"a@b","messageId":"<unk@x>"}')" 200
check "no token at all accepted but unrouted" \
  "$(post inbound /api/inbound '{"to":"hello@m","from":"a@b","messageId":"<notok@x>"}')" 200

echo "== bounce mapping =="
sup() { q "select app.is_suppressed(id,'email') from contacts where email='$1';"; }
post resend /api/webhooks/resend '{"type":"email.bounced","data":{"to":["ralvarez@brookfield.example"],"bounce":{"type":"Transient","subType":"MailboxFull"}}}' >/dev/null
check "Transient bounce does NOT suppress" "$(sup ralvarez@brookfield.example)" "f"
post resend /api/webhooks/resend '{"type":"email.bounced","data":{"to":["careers@brookfield.example"],"bounce":{"type":"Undetermined"}}}' >/dev/null
check "Undetermined bounce does NOT suppress" "$(sup careers@brookfield.example)" "f"
post resend /api/webhooks/resend '{"type":"email.bounced","data":{"to":["tnakamura@brookfield.example"],"bounce":{"type":"Permanent"}}}' >/dev/null
check "Permanent bounce suppresses" "$(sup tnakamura@brookfield.example)" "t"
post resend /api/webhooks/resend '{"type":"email.complained","data":{"to":["kosei@northside.example"]}}' >/dev/null
check "Spam complaint suppresses as unsubscribe" \
  "$(q "select reason from suppressions s join contacts c on c.id=s.contact_id where c.email='kosei@northside.example';")" "unsubscribed"
post resend /api/webhooks/resend '{"type":"email.delivered","data":{"to":["psandoval@eastview.example"]}}' >/dev/null
check "Delivered event suppresses nothing" "$(sup psandoval@eastview.example)" "f"
SVIX_ID=msg_replay post resend /api/webhooks/resend '{"type":"email.bounced","data":{"to":["mquinn@westgate.example"],"bounce":{"type":"Permanent"}}}' >/dev/null
SVIX_ID=msg_replay post resend /api/webhooks/resend '{"type":"email.bounced","data":{"to":["mquinn@westgate.example"],"bounce":{"type":"Permanent"}}}' >/dev/null
check "replayed bounce writes one row" \
  "$(q "select count(*) from suppressions s join contacts c on c.id=s.contact_id where c.email='mquinn@westgate.example';")" "1"

echo "== one-click unsubscribe (RFC 8058) =="
UT=$(q "select unsubscribe_token from contacts where email='tiverson@westgate.example';")
curl -s -o /dev/null "$BASE/api/u/$UT"; curl -s -o /dev/null "$BASE/api/u/$UT"
check "GET does NOT unsubscribe (scanner safety)" \
  "$(q "select count(*) from suppressions s join contacts c on c.id=s.contact_id where c.email='tiverson@westgate.example';")" "0"
curl -s -o /dev/null -X POST -d 'List-Unsubscribe=One-Click' "$BASE/api/u/$UT"
check "POST unsubscribes" "$(sup tiverson@westgate.example)" "t"
curl -s -o /dev/null -X POST -d 'List-Unsubscribe=One-Click' "$BASE/api/u/$UT"
check "POST is idempotent" \
  "$(q "select count(*) from suppressions s join contacts c on c.id=s.contact_id where c.email='tiverson@westgate.example';")" "1"
check "unknown token returns 200 (no enumeration)" \
  "$(curl -s -o /dev/null -w '%{http_code}' -X POST -d 'x' $BASE/api/u/0000deadbeef0000)" 200

echo "== compose links (send from your own email) =="
CLEAN=$(q "select id from contacts where email='ralvarez@brookfield.example';")
SUPC=$(q "select id from contacts where email='mp.sanders@carverton.example';")
PAGE=$(curl -s -H "Cookie: $ADMIN_COOKIE" "$BASE/outreach/new?contact=$CLEAN")
echo "$PAGE" | grep -q 'mail.google.com/mail/?view=cm' \
  && ok "Gmail compose link offered for a contactable person" \
  || bad "Gmail compose link offered for a contactable person" "absent"
echo "$PAGE" | grep -q 'mailto:' \
  && ok "mailto link offered" || bad "mailto link offered" "absent"
echo "$PAGE" | grep -oE 'mailto:[^"\\]*' | head -1 | grep -q 'stop%20receiving' \
  && ok "unsubscribe notice embedded in the mailto body" \
  || bad "unsubscribe notice embedded in the mailto body" "missing"

# An opt-out means nobody emails them -- including from a personal account.
SPAGE=$(curl -s -H "Cookie: $ADMIN_COOKIE" "$BASE/outreach/new?contact=$SUPC")
echo "$SPAGE" | grep -q 'mail.google.com/mail/?view=cm' \
  && bad "compose links withheld for a suppressed contact" "Gmail link present" \
  || ok "compose links withheld for a suppressed contact"
echo "$SPAGE" | grep -qE 'mailto:' \
  && bad "mailto withheld for a suppressed contact" "present" \
  || ok "mailto withheld for a suppressed contact"

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
