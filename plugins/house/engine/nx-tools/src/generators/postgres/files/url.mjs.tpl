// Validating a URL the launcher did not compute: only `deploy` ever sees one. GENERATOR-OWNED.
//
// Pure, and done here rather than left to a client, because clients are generous in the worst direction: an empty port
// silently becomes 5432, a URL with no host goes to whatever PGHOST says or to the local socket, a second host is tried when
// the first refuses, and a `host=` parameter overrides the host you were reading. Each of those is a deploy that reaches a
// server nobody named. So a URL here names exactly one host, and says it where it can be read.
const SHAPE = /^(postgres|postgresql):\/\/([^/?#]*)(\/[^?#]*)?(\?[^#]*)?$/;
const REROUTING = new Set(['host', 'hostaddr', 'port', 'service', 'servicefile', 'passfile', 'dbname', 'user']);

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
  const database = decodeURIComponent(path.replace(/^\//, ''));
  if (!database) throw new Error('it names no database.');
  const parameters = new URLSearchParams(query.replace(/^\?/, ''));
  for (const name of parameters.keys()) {
    if (REROUTING.has(name)) throw new Error(`its \`${name}\` parameter would override what the URL says. Put it in the URL itself.`);
  }
  const colon = userinfo.indexOf(':');
  const password = colon < 0 ? '' : userinfo.slice(colon + 1);
  const pooled = parameters.get('pgbouncer') === 'true' || port === '6543' || /-pooler\./.test(host);
  return { host, port: port ?? '5432', database, password, pooled, display: `${host}:${port ?? '5432'}/${database}` };
}
