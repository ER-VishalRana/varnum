// Sign up / sign in screen for Varnum (website and Android app).
// Accounts live on the Varnum server (Jarvis), so they work on every device and saved letters sync.
// A copy (salted PBKDF2 hash) is kept in this browser, so signing in still works without internet.
// Accounts made before the server existed are moved to it the first time their owner signs in.
(function () {
  const USERS = "anuvad-users", SESSION = "anuvad-session";
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  const normEmail = e => e.trim().toLowerCase();

  const API = (document.querySelector('meta[name="varnum-api"]') || {}).content || "https://varnum-api.alvvintechnology.com";
  // Calls the Varnum server. Returns the JSON reply, or null when the server can't be reached.
  async function api(path, { method = "GET", body, token } = {}) {
    try {
      const r = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) }, body: body ? JSON.stringify(body) : undefined, keepalive: method !== "GET" && JSON.stringify(body || {}).length < 60000 });
      if (r.status >= 500) return null; // server down: treat like no internet
      const j = await r.json().catch(() => ({}));
      return { status: r.status, ...j };
    } catch { return null; }
  }
  const session = () => read(SESSION, null);
  window.varnumAuth = {
    token: () => (session() || {}).token || null,
    api: (path, opts = {}) => api(path, { ...opts, token: (session() || {}).token }),
    dropToken: () => { const s = session(); if (s) { delete s.token; write(SESSION, s); } },
  };

  async function hash(password, saltHex) {
    const salt = new Uint8Array(saltHex.match(/../g).map(h => parseInt(h, 16)));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, key, 256));
  }

  const css = `
#authGate{position:fixed;inset:0;z-index:50;background:radial-gradient(900px 500px at 10% 0%,rgba(100,116,139,.16),transparent 60%),radial-gradient(800px 500px at 100% 100%,rgba(148,163,184,.16),transparent 60%),#f6f7f9;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
#authGate .card{background:rgba(255,255,255,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);color:var(--ink,#141a33);border:1px solid rgba(71,85,105,.18);border-radius:22px;padding:30px 26px;width:100%;max-width:390px;box-shadow:0 30px 60px -24px rgba(30,41,59,.35);position:relative;overflow:hidden}
#authGate .card::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:var(--grad,linear-gradient(120deg,#1e293b,#334155,#64748b))}
#authGate h1{margin:0;font-size:1.6rem;font-family:var(--head,sans-serif);letter-spacing:-.02em}
#authGate h1{display:flex;align-items:center;gap:12px}
#authGate h1 img{border-radius:12px;box-shadow:0 6px 16px -6px rgba(30,41,59,.55)}
#authGate h1 b{background:linear-gradient(120deg,#1e293b,#475569 60%,#64748b);-webkit-background-clip:text;background-clip:text;color:transparent}
#authGate h1 span{font-family:var(--letter,serif);color:var(--accent,#334155);font-weight:400;margin-left:8px;font-size:1.2rem}
#authGate p.sub{margin:4px 0 18px;color:var(--muted,#5d6778);font-size:.92rem}
#authGate .switch{display:flex;background:rgba(51,65,85,.07);border-radius:12px;padding:3px;margin-bottom:16px}
#authGate .switch button{flex:1;border:0;background:none;padding:8px;border-radius:7px;font:inherit;cursor:pointer;color:var(--ink,#1a2130)}
#authGate .switch button[aria-pressed="true"]{background:var(--grad,#334155);color:#fff;box-shadow:0 8px 20px -8px rgba(51,65,85,.6)}
#authGate label{display:block;font-size:.88rem;margin-bottom:12px;color:var(--muted,#5d6778)}
#authGate input{display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:10px 12px;border:1px solid var(--line,#d5d9e2);border-radius:12px;background:#fff;color:var(--ink,#141a33);font:inherit}
#authGate input:focus{outline:2px solid var(--accent,#334155);outline-offset:1px}
#authGate .go{width:100%;padding:12px;border:0;border-radius:12px;box-shadow:0 10px 24px -10px rgba(51,65,85,.7);background:var(--grad,#334155);color:var(--accent-ink,#fff);font:inherit;font-weight:600;cursor:pointer;margin-top:4px}
#authGate .go:disabled{opacity:.6;cursor:wait}
#authGate .err{color:var(--warn,#a4501b);font-size:.88rem;min-height:1.2em;margin:4px 0 8px}
#authGate .note{color:var(--muted,#5d6778);font-size:.78rem;margin:14px 0 0}
.userchip{display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--muted,#5d6778);margin-left:auto}
.userchip b{color:var(--ink,#1a2130);font-weight:600}
.userchip button{border:1px solid var(--line,#d5d9e2);background:var(--surface,#fff);color:var(--ink,#1a2130);border-radius:8px;padding:4px 10px;font:inherit;font-size:.85rem;cursor:pointer}
body.locked .wrap{visibility:hidden}`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  function currentUser() {
    const s = read(SESSION, null);
    if (!s) return null;
    return read(USERS, {})[s.email] || null;
  }

  function showChip(user) {
    let chip = document.getElementById("userChip");
    const bar = document.querySelector("header.bar");
    if (!bar) return;
    if (!chip) {
      chip = document.createElement("div");
      chip.className = "userchip";
      chip.id = "userChip";
      bar.appendChild(chip);
    }
    chip.textContent = "";
    const who = document.createElement("span");
    who.append("Hi, ");
    const b = document.createElement("b");
    b.textContent = user.name.split(" ")[0];
    b.title = user.email;
    who.append(b);
    const out = document.createElement("button");
    out.type = "button";
    out.textContent = "Sign out";
    out.onclick = () => { const t = window.varnumAuth.token(); if (t) api("/api/logout", { method: "POST", token: t }); localStorage.removeItem(SESSION); chip.remove(); showGate("signin"); };
    chip.append(who, out);
  }

  function showGate(mode) {
    document.body.classList.add("locked");
    let gate = document.getElementById("authGate");
    if (gate) gate.remove();
    gate = document.createElement("div");
    gate.id = "authGate";
    gate.innerHTML = `
<form class="card" novalidate>
  <h1><img src="logo.svg?v=26" width="44" height="44" alt=""><b>Varnum</b></h1>
  <p class="sub">Write in English, get it in Hindi or any language.</p>
  <div class="switch" role="group" aria-label="Account">
    <button type="button" data-m="signin">Sign in</button>
    <button type="button" data-m="signup">Create account</button>
  </div>
  <label class="f-name">Full name<input name="name" autocomplete="name" maxlength="80"></label>
  <label>Email<input name="email" type="email" autocomplete="email" maxlength="120"></label>
  <label>Password<input name="password" type="password" maxlength="100"></label>
  <label class="f-confirm">Confirm password<input name="confirm" type="password" autocomplete="new-password" maxlength="100"></label>
  <div class="err" role="alert"></div>
  <button class="go" type="submit"></button>
  <p class="note">Your saved letters follow you to every device you sign in on. · <a href="https://varnum.alvvintechnology.com/guide.html">How to write a letter in Hindi</a></p>
</form>`;
    document.body.appendChild(gate);
    const form = gate.querySelector("form"), err = gate.querySelector(".err"), go = gate.querySelector(".go");
    const f = n => form.elements[n];

    function setMode(m) {
      mode = m;
      gate.querySelectorAll(".switch button").forEach(b => b.setAttribute("aria-pressed", b.dataset.m === m));
      gate.querySelector(".f-name").hidden = m !== "signup";
      gate.querySelector(".f-confirm").hidden = m !== "signup";
      f("password").autocomplete = m === "signup" ? "new-password" : "current-password";
      go.textContent = m === "signup" ? "Create account" : "Sign in";
      err.textContent = "";
      (m === "signup" ? f("name") : f("email")).focus();
    }
    gate.querySelectorAll(".switch button").forEach(b => b.onclick = () => setMode(b.dataset.m));
    if (!Object.keys(read(USERS, {})).length && mode === "signin") mode = "signup";
    setMode(mode);

    form.onsubmit = async e => {
      e.preventDefault();
      err.textContent = "";
      const email = normEmail(f("email").value), password = f("password").value;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err.textContent = "Enter a valid email address.";
      const users = read(USERS, {});
      go.disabled = true;
      try {
        const keepLocal = async (name) => { const salt = hex(crypto.getRandomValues(new Uint8Array(16))); users[email] = { ...(users[email] || {}), name, email, salt, hash: await hash(password, salt), created: (users[email] || {}).created || new Date().toISOString() }; write(USERS, users); };
        let token = null, name = null;
        if (mode === "signup") {
          name = f("name").value.trim().replace(/\s+/g, " ");
          if (name.length < 2) return err.textContent = "Enter your name.";
          if (password.length < 6) return err.textContent = "Password must be at least 6 characters.";
          if (password !== f("confirm").value) return err.textContent = "The two passwords do not match.";
          const r = await api("/api/signup", { method: "POST", body: { name, email, password } });
          if (r && !r.ok) return err.textContent = r.error || "Could not create the account.";
          if (!r && users[email]) return err.textContent = "An account with this email already exists. Sign in instead.";
          if (r) token = r.token;
          await keepLocal(name);
        } else {
          const u = users[email];
          const localOk = !!u && await hash(password, u.salt) === u.hash;
          let r = await api("/api/login", { method: "POST", body: { email, password } });
          if (r && r.code === "no_account" && localOk) r = await api("/api/signup", { method: "POST", body: { name: u.name, email, password } }); // move an older browser-only account to the server
          if (r && !r.ok) return err.textContent = r.error || "Could not sign in.";
          if (!r && !u) return err.textContent = "No internet, and this account is not on this device yet. Connect to the internet and try again.";
          if (!r && !localOk) return err.textContent = "Wrong password.";
          if (r) { token = r.token; name = r.user.name; await keepLocal(name); } else name = u.name;
        }
        write(SESSION, { email, at: new Date().toISOString(), ...(token ? { token } : {}) });
        gate.remove();
        document.body.classList.remove("locked");
        showChip(read(USERS, {})[email]);
        window.dispatchEvent(new Event("varnum-signed-in"));
      } finally { go.disabled = false; }
    };
  }

  function start() {
    if (!window.crypto || !crypto.subtle) {
      // Web Crypto needs https (or localhost); without it, let the app open rather than lock the user out.
      return;
    }
    const u = currentUser();
    if (u) showChip(u); else showGate("signin");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
