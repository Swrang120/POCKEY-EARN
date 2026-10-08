# Pockey Earn

Initial reward-dashboard foundation for the POCKEY-EARN repository.

## Included now
- Login with Gmail/email + password
- Signup fields: mobile number, Gmail/email, full name, password, confirm password
- Unique referral code for every user
- Shareable invite URL using ?ref=CODE
- ₹150 qualified referral ledger
- Dashboard showing invited-user count and earnings
- Withdrawal page/UI with UPI field
- Daily tasks page
- Daily bonus/spin placeholder for non-cash points
- Rewarded-ad placeholder ready for server verification
- Supabase tables, trigger and RLS policies

## Setup
1. Run supabase/schema.sql in the Supabase SQL Editor.
2. Open app.js and replace YOUR_SUPABASE_URL and YOUR_SUPABASE_PUBLISHABLE_KEY.
3. Configure Supabase Auth email confirmation and the production redirect URL.
4. Deploy the repository as a static website.

This first version uses email/password as the login credential and stores the mobile number in the profile. Phone OTP can be added later.

## Important security
Never expose a Supabase service-role key in browser code. The browser must not directly increase wallet balances.

Referral qualification, rewarded-ad verification, balance changes and payout approval should be handled server-side/Edge Functions.

The daily spin is intentionally non-cash. A random cash-paying spin would turn the feature into a gambling-style mechanism, so the initial build uses a non-cash bonus/points concept.

The requested ₹5 per 30-second ad should only be enabled after a real rewarded-ad provider confirms the completed ad event and its policies allow the incentive.
