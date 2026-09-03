/**
 * WHY THIS FILE EXISTS AT ALL: the dev server refused its own scripts.
 *
 * Next treats a dev request whose Origin is not the one it expects as
 * cross-origin and answers 403 -- for the JavaScript chunks as well as the
 * page. The page itself is plain HTML and still returns 200, so the symptom is
 * a document that loads, titles itself correctly, and then never hydrates:
 * React never takes over, no effect ever runs, and the screen stays white with
 * no error on it. Opening the console is the only way to see that anything
 * failed.
 *
 * `localhost` and `127.0.0.1` are the same machine and DIFFERENT origins, and
 * DEV-LOOP.md sends people to `127.0.0.1` for every service -- correctly, for
 * the server-to-server reasons written there. Somebody following it and then
 * typing the same address into a browser got the blank page.
 *
 * DEV ONLY. `allowedDevOrigins` is read by the dev server and has no effect on
 * a build, so this widens nothing in production.
 *
 * SIGNING IN STILL REQUIRES `localhost`, and this file does not change that.
 * The Keycloak client registers `localhost` redirect URIs and web origins only,
 * and KEYCLOAK_PUBLIC_ISSUER is compared against the token's `iss` as a string
 * (CRITICAL-ISSUES.md section 4). Registering a second browser origin is an
 * auth decision, not a dev-server one. What this fixes is the FAILURE MODE: the
 * page now renders and offers its sign-in prompt instead of showing nothing.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: ['127.0.0.1'],
};

export default nextConfig;
