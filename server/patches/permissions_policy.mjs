/**
 * server/patches/permissions_policy.mjs
 * Injects a Permissions-Policy header so if your app is embedded in an <iframe>,
 * Chrome/Android is allowed to use the microphone without reprompting per click.
 *
 * Usage in server/index.mjs (AFTER app.use(cors/json/cookies), BEFORE routes):
 *   import registerPermissionsPolicy from './patches/permissions_policy.mjs';
 *   registerPermissionsPolicy(app, {
 *     origins: [
 *       'self',
 *       'https://localhost:5173',
 *       // add your production origin here:
 *       'https://your-domain.example'
 *     ]
 *   });
 */
export default function registerPermissionsPolicy(app, { origins = [] } = {}){
  const value = buildHeader(origins);
  app.use((req, res, next) => {
    try { res.set('Permissions-Policy', value); } catch {}
    next();
  });
  console.log('[perm-policy] header set:', value);
}

function buildHeader(origins){
  // Translate 'self' and plain URLs into the new Permissions-Policy syntax
  const parts = [];
  for (const o of origins){
    if (!o) continue;
    if (o === 'self') { parts.push('self'); continue; }
    parts.push(`"${o}"`);
  }
  const allowList = parts.length ? parts.join(' ') : 'self';
  return `microphone=(${allowList})`;
}
