(() => {
  "use strict";

  const ADS = window.POCKEY_ADS || {};
  const SUPABASE_URL = window.POCKEY_SUPABASE_URL || "";
  const SUPABASE_KEY = window.POCKEY_SUPABASE_KEY || "";
  const AD_REWARD = Number(ADS.REWARD_AMOUNT || 5);
  const AD_DAILY_LIMIT = Number(ADS.DAILY_LIMIT || 10);

  let sb = null;
  let state = {
    user: null,
    profile: null,
    wallet: null,
    referrals: 0,
    ad: { completed: 0, pending: 0, remaining: AD_DAILY_LIMIT }
  };

  const $ = (id) => document.getElementById(id);
  const money = (n) => "₹" + Number(n || 0).toFixed(2);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));

  function toast(message) {
    const el = $("toast");
    if (!el) return;
    el.textContent = message;
    el.classList.remove("hidden");
    clearTimeout(window.__pockeyToast);
    window.__pockeyToast = setTimeout(() => el.classList.add("hidden"), 3000);
  }

  function renderSetupMessage() {
    const root = $("app");
    root.innerHTML = `
      <div class="auth">
        <div class="card">
          <div class="brand">Pockey <span>Earn</span></div>
          <p class="muted">Invite • Tasks • Rewards</p>
          <div class="setup">
            <h3>App loaded successfully ✅</h3>
            <p class="muted">Supabase is not connected yet, so login and wallet data cannot be loaded.</p>
            <p class="muted small">Add your Supabase project URL and publishable/anon key to the site configuration, then refresh.</p>
          </div>
        </div>
      </div>
    `;
  }

  function authScreen() {
    const root = $("app");
    root.innerHTML = `
      <div class="auth">
        <div class="card">
          <div class="brand">Pockey <span>Earn</span></div>
          <p class="muted">Invite • Tasks • Rewards</p>

          <div class="tabs">
            <button id="loginTab" class="active" type="button">Login</button>
            <button id="signupTab" type="button">Create account</button>
          </div>

          <form id="authForm">
            <div id="signupFields" class="hidden">
              <div class="field">
                <label>Full Name</label>
                <input id="name" autocomplete="name">
              </div>
              <div class="field">
                <label>Mobile Number</label>
                <input id="phone" inputmode="tel" autocomplete="tel">
              </div>
            </div>

            <div class="field">
              <label>Email</label>
              <input id="email" type="email" required autocomplete="email">
            </div>

            <div class="field">
              <label>Password</label>
              <input id="password" type="password" minlength="8" required autocomplete="new-password">
            </div>

            <div id="confirmField" class="hidden field">
              <label>Confirm Password</label>
              <input id="confirm" type="password" minlength="8" autocomplete="new-password">
            </div>

            <div id="authMessage" class="msg"></div>
            <button id="authSubmit" class="primary" type="submit">Login</button>
          </form>

          <p class="muted">Your account is secured by Supabase Auth.</p>
        </div>
      </div>
    `;

    let signup = false;
    const setMode = (value) => {
      signup = value;
      $("loginTab").classList.toggle("active", !value);
      $("signupTab").classList.toggle("active", value);
      $("signupFields").classList.toggle("hidden", !value);
      $("confirmField").classList.toggle("hidden", !value);
      $("authSubmit").textContent = value ? "Create account" : "Login";
      $("authMessage").textContent = "";
    };

    $("loginTab").onclick = () => setMode(false);
    $("signupTab").onclick = () => setMode(true);

    $("authForm").onsubmit = async (event) => {
      event.preventDefault();
      const message = $("authMessage");
      const button = $("authSubmit");
      button.disabled = true;
      message.textContent = "Please wait…";

      try {
        const email = $("email").value.trim();
        const password = $("password").value;

        if (signup) {
          const name = $("name").value.trim();
          const phone = $("phone").value.trim();
          const confirm = $("confirm").value;

          if (!name || !phone) {
            message.textContent = "Enter your full name and mobile number.";
            return;
          }
          if (password !== confirm) {
            message.textContent = "Passwords do not match.";
            return;
          }

          const ref = new URLSearchParams(location.search).get("ref");
          const result = await sb.auth.signUp({
            email,
            password,
            options: {
              data: {
                full_name: name,
                phone,
                referral_code_used: ref || null
              },
              emailRedirectTo: location.origin + location.pathname
            }
          });

          if (result.error) {
            message.textContent = result.error.message;
            return;
          }

          if (result.data.session) {
            await loadUser();
          } else {
            message.textContent = "Account created. Check your email to confirm it.";
          }
        } else {
          const result = await sb.auth.signInWithPassword({ email, password });
          if (result.error) {
            message.textContent = result.error.message;
            return;
          }
          await loadUser();
        }
      } catch (error) {
        console.error(error);
        message.textContent = error?.message || "Something went wrong.";
      } finally {
        button.disabled = false;
      }
    };
  }

  function shell() {
    $("app").innerHTML = `
      <header class="top">
        <div class="brand">Pockey <span>Earn</span></div>
        <button class="logout" id="logoutButton" type="button">Logout</button>
      </header>

      <main class="main">
        <section id="home" class="page active"></section>
        <section id="invite" class="page"></section>
        <section id="tasks" class="page"></section>
        <section id="withdraw" class="page"></section>
      </main>

      <div class="navwrap">
        <nav class="nav">
          <button data-page="home" type="button">🏠<br>Home</button>
          <button data-page="invite" type="button">👥<br>Invite</button>
          <button data-page="tasks" type="button">🎯<br>Tasks</button>
          <button data-page="withdraw" type="button">💸<br>Withdraw</button>
        </nav>
      </div>

      <div id="toast" class="toast hidden"></div>
    `;

    $("logoutButton").onclick = async () => {
      await sb.auth.signOut();
      state = {
        user: null,
        profile: null,
        wallet: null,
        referrals: 0,
        ad: { completed: 0, pending: 0, remaining: AD_DAILY_LIMIT }
      };
      authScreen();
    };

    document.querySelectorAll(".nav button").forEach((button) => {
      button.onclick = () => showPage(button.dataset.page);
    });
  }

  function showPage(page) {
    document.querySelectorAll(".page").forEach((el) => el.classList.remove("active"));
    const target = $(page);
    if (target) target.classList.add("active");
    document.querySelectorAll(".nav button").forEach((el) => {
      el.classList.toggle("active", el.dataset.page === page);
    });
  }

  function indiaDate() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  async function refreshDailyAds() {
    if (!state.user) return;

    const date = indiaDate();
    const [usage, claims] = await Promise.all([
      sb.from("rewarded_ad_daily_usage")
        .select("completed_count,earned_amount")
        .eq("user_id", state.user.id)
        .eq("reward_date", date)
        .maybeSingle(),
      sb.from("rewarded_ad_claims")
        .select("claim_id")
        .eq("user_id", state.user.id)
        .eq("reward_date", date)
        .eq("status", "pending")
    ]);

    const completed = Number(usage.data?.completed_count || 0);
    const pending = Number(claims.data?.length || 0);

    state.ad = {
      completed,
      pending,
      remaining: Math.max(0, AD_DAILY_LIMIT - completed - pending)
    };
  }

  async function loadUser() {
    const result = await sb.auth.getUser();
    if (result.error || !result.data.user) {
      authScreen();
      return;
    }

    state.user = result.data.user;

    const [profile, wallet, referrals] = await Promise.all([
      sb.from("profiles").select("*").eq("id", state.user.id).single(),
      sb.from("wallets").select("*").eq("user_id", state.user.id).single(),
      sb.from("referrals")
        .select("id", { count: "exact", head: true })
        .eq("referrer_id", state.user.id)
        .eq("status", "qualified")
    ]);

    if (profile.error || wallet.error) {
      console.error(profile.error || wallet.error);
      authScreen();
      $("authMessage").textContent = "Account data is not ready. Run the Supabase database schema first.";
      return;
    }

    state.profile = profile.data;
    state.wallet = wallet.data;
    state.referrals = referrals.count || 0;

    try {
      await refreshDailyAds();
    } catch (error) {
      console.warn("Daily ad tables are not ready:", error);
      state.ad = { completed: 0, pending: 0, remaining: AD_DAILY_LIMIT };
    }

    shell();
    render();
  }

  function render() {
    const profile = state.profile || {};
    const wallet = state.wallet || {};

    $("home").innerHTML = `
      <p class="muted">Welcome, ${esc(profile.full_name || "there")} 👋</p>

      <div class="hero">
        <div class="muted">Available balance</div>
        <div class="balance">${money(wallet.available_balance)}</div>
        <button class="primary" id="homeWithdraw" type="button">Request withdrawal</button>
      </div>

      <div class="grid">
        <div class="stat"><span class="muted">Invited</span><b>${state.referrals}</b></div>
        <div class="stat"><span class="muted">Invite earnings</span><b>${money(wallet.referral_earnings)}</b></div>
        <div class="stat"><span class="muted">Ad earnings</span><b>${money(wallet.ad_earnings)}</b></div>
        <div class="stat"><span class="muted">Total earned</span><b>${money(wallet.total_earned)}</b></div>
      </div>

      <div class="section">
        <h3>Earn more</h3>
        <div class="actions">
          <button class="action" id="goInvite" type="button">👥<b>Invite friends</b><span class="muted">₹150 per qualified invite</span></button>
          <button class="action" id="goTasks" type="button">📺<b>Rewarded ads</b><span class="muted">${state.ad.completed}/${AD_DAILY_LIMIT} completed today</span></button>
          <button class="action" id="goBonus" type="button">🎡<b>Daily bonus</b><span class="muted">Non-cash points</span></button>
        </div>
      </div>
    `;

    $("homeWithdraw").onclick = () => showPage("withdraw");
    $("goInvite").onclick = () => showPage("invite");
    $("goTasks").onclick = () => showPage("tasks");
    $("goBonus").onclick = () => showPage("tasks");

    const link = location.origin + location.pathname + "?ref=" + encodeURIComponent(profile.referral_code || "");

    $("invite").innerHTML = `
      <h3>Invite & Earn</h3>
      <div class="card">
        <div class="muted">Your unique invite code</div>
        <h2>${esc(profile.referral_code || "—")}</h2>
        <div class="ref">
          <input id="inviteLink" readonly value="${esc(link)}">
          <button id="copyInvite" type="button">Copy</button>
        </div>
        <p class="muted">Qualified invites: ${state.referrals} · Invite earnings: ${money(wallet.referral_earnings)}</p>
      </div>
    `;

    $("copyInvite").onclick = async () => {
      try {
        await navigator.clipboard.writeText(link);
        toast("Invite link copied ✅");
      } catch {
        $("inviteLink").select();
        document.execCommand("copy");
        toast("Invite link copied ✅");
      }
    };

    renderTasks();

    $("withdraw").innerHTML = `
      <h3>Withdrawal</h3>
      <div class="card">
        <div class="muted">Available</div>
        <div class="balance">${money(wallet.available_balance)}</div>
        <div class="field">
          <label>UPI ID</label>
          <input id="upi" placeholder="name@upi" autocomplete="off">
        </div>
        <button class="primary" id="withdrawButton" type="button">Request withdrawal</button>
        <p class="muted">Withdrawal approval and payout must be handled server-side.</p>
      </div>
    `;

    $("withdrawButton").onclick = withdrawRequest;
  }

  function renderTasks() {
    const left = state.ad.remaining;
    const done = state.ad.completed;
    const percent = Math.min(100, (done / AD_DAILY_LIMIT) * 100);
    const status = left <= 0
      ? "Daily limit reached"
      : "You can start " + left + " more ad slot" + (left === 1 ? "" : "s") + " today";

    $("tasks").innerHTML = `
      <h3>Daily Tasks</h3>
      <div class="card">
        <div class="muted">Rewarded Ads · India day</div>
        <div class="balance">${done}/${AD_DAILY_LIMIT}</div>
        <p class="muted">${status} · ₹${AD_REWARD} after provider verification.</p>
        <div class="progress"><div style="width:${percent}%"></div></div>
        <button class="primary" id="rewardedAdButton" type="button" ${left <= 0 ? "disabled" : ""}>
          ${left <= 0 ? "Limit reached" : "Watch rewarded ad"}
        </button>
        <p class="muted">Ad completion is verified server-side. An unverified callback does not credit the wallet.</p>
      </div>

      <br>

      <div class="card">
        <b>🎡 Daily Spin</b>
        <p class="muted">This placeholder is for non-cash points/bonus only.</p>
        <button class="primary" id="spinButton" type="button">Spin</button>
      </div>
    `;

    $("rewardedAdButton").onclick = watchRewardedAd;
    $("spinButton").onclick = () => toast("Daily bonus is reserved for non-cash points.");
  }

  async function watchRewardedAd() {
    if (state.ad.remaining <= 0) {
      toast("Today's ad limit is reached.");
      return;
    }

    const result = await sb.rpc("start_rewarded_ad");
    if (result.error) {
      await refreshDailyAds();
      renderTasks();
      toast(result.error.message.includes("DAILY_AD_LIMIT_REACHED")
        ? "Today's ad limit is reached."
        : result.error.message);
      return;
    }

    const claim = Array.isArray(result.data) ? result.data[0] : result.data;

    if (!claim?.claim_id) {
      toast("Could not create an ad claim.");
      return;
    }

    if (typeof window.POCKEY_SHOW_REWARDED_AD !== "function") {
      await sb.rpc("cancel_rewarded_ad", { p_claim_id: claim.claim_id });
      await refreshDailyAds();
      renderTasks();
      toast("Rewarded-ad provider is not connected yet.");
      return;
    }

    try {
      await window.POCKEY_SHOW_REWARDED_AD({
        claimId: claim.claim_id,
        customData: claim.claim_id,
        rewardAmount: AD_REWARD
      });
      toast("Ad finished. Reward verification is pending…");
    } catch (error) {
      console.error(error);
      await sb.rpc("cancel_rewarded_ad", { p_claim_id: claim.claim_id });
      toast("Ad could not be completed.");
    }

    setTimeout(async () => {
      try {
        await refreshDailyAds();
        renderTasks();
      } catch (error) {
        console.warn(error);
      }
    }, 2500);
  }

  async function withdrawRequest() {
    const upi = $("upi")?.value.trim();
    if (!upi) {
      toast("Enter UPI ID.");
      return;
    }
    toast("Withdrawal request UI is ready; server-side payout processing is still required.");
  }

  async function boot() {
    try {
      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        renderSetupMessage();
        return;
      }

      if (!SUPABASE_URL || !SUPABASE_KEY || SUPABASE_URL.includes("YOUR_") || SUPABASE_KEY.includes("YOUR_")) {
        renderSetupMessage();
        return;
      }

      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      authScreen();

      const session = await sb.auth.getSession();
      if (session.data?.session) {
        await loadUser();
      }

      sb.auth.onAuthStateChange((event, sessionData) => {
        if (event === "SIGNED_OUT") {
          state.user = null;
          authScreen();
        }
      });
    } catch (error) {
      console.error("Pockey boot error:", error);
      renderSetupMessage();
    }
  }

  window.POCKEY = { showPage, toast };
  boot();
})();