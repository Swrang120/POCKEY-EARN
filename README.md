# Pockey Earn

POCKEY-EARN is a Supabase-backed reward dashboard with referrals and a **10 rewarded-ad slots per user per India calendar day** system.

## Current features
- Email/password login
- Signup: mobile number, email, full name, password, confirm password
- Unique referral code and shareable `?ref=CODE` link
- Referral ledger and dashboard counters
- Rewarded-ad daily task UI: **10 maximum slots/day**
- ₹5 configured reward per verified rewarded-ad completion
- Daily counter uses Asia/Kolkata date
- Server-created ad claims
- Duplicate transaction protection
- 15-minute claim expiry
- AdMob SSV verification Edge Function
- Wallet + earning transaction credited only by the trusted server callback
- Daily spin remains non-cash/points only

## Repository structure
```
/
├─ index.html
├─ styles.css
├─ app.js
└─ supabase/
   ├─ config.toml
   ├─ migrations/
   │  └─ 20261008_rewarded_ads.sql
   └─ functions/
      ├─ start-rewarded-ad/index.ts
      └─ rewarded-ad-ssv/index.ts
```

## How the 10-ad limit works

1. User presses **Watch rewarded ad**.
2. Supabase creates a unique claim only if the user has fewer than 10 completed/active ad slots for the India day.
3. The app passes that claim ID as rewarded-ad custom data.
4. The ad provider sends its server-side callback.
5. The Edge Function verifies the provider signature.
6. The private database function checks the claim, transaction ID, 15-minute expiry and the 10/day limit.
7. Only then are ₹5 added to the wallet and an `earning_transactions` row created.
8. A new India calendar day starts a fresh limit.

The browser never has permission to call the privileged wallet-credit function.

## Supabase setup

1. Run the existing `supabase/schema.sql` first.
2. Run `supabase/migrations/20261008_rewarded_ads.sql` in the Supabase SQL Editor.
3. Deploy the two Edge Functions.
4. Set the Edge Function secrets required by Supabase:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-side only)
5. Configure the rewarded-ad provider's server callback to:
   `https://<your-project-ref>.supabase.co/functions/v1/rewarded-ad-ssv`
6. The SSV callback must send the claim ID as custom data and use a reward amount of 5.

For AdMob, server-side verification is configured on the rewarded ad unit and the provider sends parameters including `custom_data`, `reward_amount`, `transaction_id`, `signature`, and `key_id`. The repository's SSV function verifies the callback before crediting the wallet.

## Frontend ad-provider hook

The current repository is a static web frontend. The actual AdMob SDK is a native mobile-app SDK, so this repo does **not** fake an ad or use a JavaScript timer to create money.

When the Android/iOS ad layer is added, it should expose:

```js
window.POCKEY_SHOW_REWARDED_AD = async ({claimId, customData, rewardAmount}) => {
  // Configure the native rewarded-ad SDK.
  // Set its SSV custom data to customData (the claim ID).
  // Show the rewarded ad.
};
```

The frontend waits for the trusted server callback; a client-side callback alone does not credit the wallet.

## Security notes

- Never put the Supabase service-role key in `app.js` or any public repository file.
- Do not credit ₹5 from a frontend timer.
- Keep the SSV endpoint publicly callable because the ad provider cannot send a Supabase user JWT; JWT verification is disabled **only for that callback function**.
- Keep the privileged `private.complete_rewarded_ad` function inaccessible to browser roles.
- The daily spin is intentionally non-cash.
