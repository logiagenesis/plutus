# 19 — Plutus has its own login

Date: 2026-10-28. Requested by Dennis: Plutus must have its own sign-in, not the Cloudflare account login. Allowed user: info@logia.co.za.

## How it works
- Sign-in page at https://plutus.denweb82.workers.dev: email and password. Only info@logia.co.za exists as a user.
- The password is set by Dennis himself on a one-time "Set your password" screen. Claude never typed or stored it. The password Dennis posted in chat on 28 Oct was not used.
- Passwords are stored only as a salted PBKDF2-SHA256 hash (25,000 rounds; the per-user round count is stored so it can be raised if the Cloudflare plan is upgraded from Free, whose 10 ms CPU limit per request caps it).
- Minimum length 12 characters.
- After 5 wrong passwords the login locks for 15 minutes. A wrong email and a wrong password give the same message.
- Sign-in lasts 12 hours (HttpOnly, Secure, SameSite=Strict cookie; only a SHA-256 of the session token is stored).
- Every data request needs a valid sign-in; without one the server returns nothing (401).
- Sign out: bottom of the left sidebar, or More › Sign out on a phone.
- Change password: Settings › Your login. Changing it signs out every other device.
- Sign-ins, lockouts and password changes are recorded in the audit_events table.

## First password (one time)
The "Set your password" screen only works while the request also passes the existing Cloudflare sign-in. After Dennis has set his password and signed in, the Cloudflare sign-in in front of the app is switched off, so from then on Plutus has only its own login.

## If the password is forgotten
There is no email reset yet (email sending is not built). Reset: switch the Cloudflare sign-in back on for the Worker, clear the password in the database (Cloudflare › D1 › plutus › Console: UPDATE users SET password_hash = NULL, password_salt = NULL, password_iterations = NULL WHERE email = 'info@logia.co.za';), then open the app and set a new one.

## Tested (local copy, 28 Oct 2026)
Data without sign-in refused (401); short password refused; setup works once and is refused a second time; cross-site request refused; sign-out ends the session; 5 wrong passwords lock the account; right password signs in (email not case-sensitive); change password rejects a wrong current password, signs out the old session and the old password stops working; browser click-through of sign-in, setup, sign-out and Settings on desktop and phone with no page errors.
