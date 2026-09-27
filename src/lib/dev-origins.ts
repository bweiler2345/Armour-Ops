// Parses DEV_LAN_HOSTS (development only): a comma-separated list of exact
// hostnames or IP addresses, such as "192.168.1.20". Anything that could
// match more than one host (wildcards) or isn't a plain hostname is ignored,
// so a typo can never open the dev server to arbitrary origins.

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

export function parseDevLanHosts(value: string | undefined): string[] {
  if (!value) return [];
  const hosts = new Set<string>();
  for (const raw of value.split(",")) {
    let host = raw.trim().toLowerCase();
    if (!host || host.includes("*")) continue;
    // Accept "http://192.168.1.20:3000" too; only the hostname is used.
    host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "");
    // Numbers-only hosts must be valid IPv4 addresses.
    if (/^[\d.]+$/.test(host) ? IPV4.test(host) : HOSTNAME.test(host)) hosts.add(host);
  }
  return [...hosts];
}
