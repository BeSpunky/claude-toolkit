// Validating a URL the launcher did not compute: only `deploy` ever sees one. GENERATOR-OWNED.
//
// Pure, and done here rather than left to a client, because clients are generous in the worst direction: an empty port
// silently becomes 5432, a URL with no host goes to whatever PGHOST says or to the local socket, a second host is tried when
// the first refuses, and a `host=` parameter overrides the host you were reading. Each of those is a deploy that reaches a
// server nobody named. So a URL here names exactly one host, and says it where it can be read.
//
// THE QUERY IS AN ALLOWLIST. A list of the parameters that reroute cannot be finished: dbmate reads a `socket` of its own, which
// became the host while the log named another. A parameter this file has not read is refused, and that also keeps `password=`
// out of a URL a client would echo back in an error.
const SHAPE = /^(postgres|postgresql):\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?$/;
const ALLOWED_PARAMETERS = new Set(['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'sslsni', 'channel_binding', 'connect_timeout', 'application_name', 'search_path', 'options', 'pgbouncer']);
/** These send the password and the migration in clear when a server, or anything between, asks them to. */
const CLEARTEXT_SSLMODES = new Set(['disable', 'allow', 'prefer']);
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

/** `{ host, port, database, password, display }`, or throws a sentence that never contains the password. */
export function parseDeployUrl(url) {
  const shape = SHAPE.exec(url);
  if (!shape) throw new Error('it is not a postgres:// or postgresql:// URL.');
  const [, , authority, path = '', query = ''] = shape;
  const at = authority.lastIndexOf('@');
  const userinfo = at < 0 ? '' : authority.slice(0, at);
  const hostPort = authority.slice(at + 1);
  if (hostPort.includes(',')) throw new Error('it names several hosts, and a client would try the next when the first refuses. Name one.');
  const parts = /^(\[[^\]]*\]|[^:]*)(?::(.*))?$/.exec(hostPort);
  const host = parts?.[1] ?? '';
  const port = parts?.[2];
  if (!host) throw new Error('it names no host, so a client would use PGHOST or the local socket.');
  if (port === '') throw new Error(`it has an empty port after ${host}:, which clients silently turn into 5432. Is a variable empty?`);
  if (port !== undefined && (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535)) throw new Error(`its port is not a port number.`);
  if (host.includes('%')) throw new Error('its host holds a percent sign, which no client accepts. Is it part of a password?');
  // An unencoded `/` in a password ends the authority there, so the rest of the password reads as the path, and would be logged.
  if (path.includes('@')) throw new Error('it has an @ after its first /, which is what a password with an unencoded / looks like. Percent-encode the password.');
  const database = decodeURIComponent(path.replace(/^\//, ''));
  if (!database) throw new Error('it names no database.');
  const parameters = new URLSearchParams(query.replace(/^\?/, ''));
  for (const name of parameters.keys()) {
    if (!ALLOWED_PARAMETERS.has(name)) throw new Error(`its \`${/^[\w-]+$/.test(name) ? name : 'unreadable'}\` parameter is not one a deploy takes (${[...ALLOWED_PARAMETERS].join(', ')}): it could aim the deploy somewhere the URL does not say, or carry a secret.`);
  }
  const sslmode = parameters.get('sslmode');
  if (CLEARTEXT_SSLMODES.has(sslmode) && !LOOPBACK.test(host)) throw new Error(`its sslmode=${sslmode} can send the password and the migration in clear to ${host}. Use require or stricter.`);
  const colon = userinfo.indexOf(':');
  const password = colon < 0 ? '' : userinfo.slice(colon + 1);
  const pooled = parameters.get('pgbouncer') === 'true' || port === '6543' || /-pooler\./.test(host);
  return { host, port: port ?? '5432', database, password, pooled, sslmode, display: `${host}:${port ?? '5432'}/${database}` };
}
