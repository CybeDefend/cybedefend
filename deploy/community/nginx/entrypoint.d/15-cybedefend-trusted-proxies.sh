#!/bin/sh
# CybeDefend Community Edition: the front's trusted proxies.
#
# Run by the nginx image's /docker-entrypoint.sh before nginx starts (the
# compose mounts it into /docker-entrypoint.d). It renders
# CYBEDEFEND_TRUSTED_PROXIES, a comma-separated list of IPv4/IPv6 addresses or
# CIDRs, into the real-ip directives the server block includes:
#
#   set_real_ip_from <each value>;
#   real_ip_header X-Forwarded-For;
#   real_ip_recursive on;
#
# Behind a TLS proxy listed there, nginx takes the client address from the
# X-Forwarded-For that proxy appended, and hands only that address on to the
# gateway, whose per-address limits then count each user apart. Empty (the
# default): no proxy is trusted, and every client is the address nginx sees.
#
# Beside it, trusted-proxy.conf, included at http level: a geo block that sets
# $cd_trusted_proxy to 1 when the connection itself comes from one of those
# proxies ($realip_remote_addr, the peer's address before real-ip). Only then
# does the front believe the X-Forwarded-Proto it carries.
#
#   geo $realip_remote_addr $cd_trusted_proxy { default 0; <each value> 1; }
#
# A value that is not an address or a CIDR (a host name, a prefix of 0, a
# stray character) stops the start with a message, and nothing is rendered:
# nginx then has no file to include and does not start either.
#
# Argument: the file to write (default /tmp/cybedefend/real-ip.conf); the geo
# block goes to trusted-proxy.conf in the same directory.
set -eu

out="${1:-/tmp/cybedefend/real-ip.conf}"
geo_out="$(dirname -- "$out")/trusted-proxy.conf"

rm -f -- "$out" "$geo_out"
mkdir -p -- "$(dirname -- "$out")"
list=$(mktemp "$out.XXXXXX")
tmp=$(mktemp "$out.XXXXXX")
geo_tmp=$(mktemp "$out.XXXXXX")
trap 'rm -f -- "$list" "$tmp" "$geo_tmp"' EXIT

if ! CD_TRUSTED_PROXIES="${CYBEDEFEND_TRUSTED_PROXIES:-}" awk '
function fail(entry, why) {
    printf "cybedefend: CYBEDEFEND_TRUSTED_PROXIES: \"%s\" %s; expected IPv4 or IPv6 addresses or CIDRs separated by commas, for example 10.0.0.0/8,fd00::/8. The front does not start.\n", entry, why > "/dev/stderr"
    exit 1
}
function decimal(s, max) {
    if (s !~ /^[0-9]+$/ || length(s) > 3) return 0
    if (length(s) > 1 && substr(s, 1, 1) == "0") return 0
    return (s + 0) <= max
}
function ipv4(s,    n, p, i) {
    if (s !~ /^[0-9.]+$/) return 0
    n = split(s, p, ".")
    if (n != 4) return 0
    for (i = 1; i <= 4; i++) if (!decimal(p[i], 255)) return 0
    return 1
}
# Number of 16-bit groups in one side of an IPv6 address, -1 when invalid.
# tail: this side ends the address, so its last field may be an IPv4 address.
function groups(side, tail,    n, p, i, count) {
    if (side == "") return 0
    n = split(side, p, ":")
    count = 0
    for (i = 1; i <= n; i++) {
        if (i == n && tail && index(p[i], ".")) {
            if (!ipv4(p[i])) return -1
            count += 2
        } else if (p[i] ~ /^[0-9A-Fa-f]+$/ && length(p[i]) <= 4) {
            count++
        } else {
            return -1
        }
    }
    return count
}
function ipv6(s,    dbl, left, right, l, r) {
    if (s !~ /^[0-9A-Fa-f:.]+$/ || index(s, ":") == 0) return 0
    dbl = index(s, "::")
    if (dbl == 0) return groups(s, 1) == 8
    if (index(substr(s, dbl + 1), "::")) return 0
    left = substr(s, 1, dbl - 1)
    right = substr(s, dbl + 2)
    l = groups(left, 0)
    r = groups(right, 1)
    return l >= 0 && r >= 0 && l + r <= 7
}
BEGIN {
    value = ENVIRON["CD_TRUSTED_PROXIES"]
    if (value ~ /^[ \t]*$/) exit 0
    n = split(value, entries, ",")
    for (i = 1; i <= n; i++) {
        entry = entries[i]
        gsub(/^[ \t]+|[ \t]+$/, "", entry)
        if (entry == "") fail(entry, "is an empty entry")
        slash = index(entry, "/")
        address = entry
        prefix = ""
        if (slash) {
            address = substr(entry, 1, slash - 1)
            prefix = substr(entry, slash + 1)
            if (prefix == "") fail(entry, "has an empty prefix length")
        }
        if (ipv4(address)) max = 32
        else if (ipv6(address)) max = 128
        else fail(entry, "is not an IPv4 or IPv6 address")
        if (slash) {
            if (!decimal(prefix, max)) fail(entry, "has an invalid prefix length")
            if (prefix + 0 == 0) fail(entry, "would trust every address, so any client could choose its own")
        }
        trusted[++count] = entry
    }
    # One validated entry per line: no space, no semicolon, no newline in any.
    for (i = 1; i <= count; i++) print trusted[i]
    exit 0
}' > "$list"; then
    exit 1
fi

{
    echo "# Rendered at start from CYBEDEFEND_TRUSTED_PROXIES: the proxies whose X-Forwarded-Proto is believed."
    echo 'geo $realip_remote_addr $cd_trusted_proxy {'
    echo "    default 0;"
    while IFS= read -r entry; do echo "    $entry 1;"; done < "$list"
    echo "}"
} > "$geo_tmp"

if [ -s "$list" ]; then
    {
        echo "# Rendered at start from CYBEDEFEND_TRUSTED_PROXIES."
        while IFS= read -r entry; do echo "set_real_ip_from $entry;"; done < "$list"
        echo "real_ip_header X-Forwarded-For;"
        echo "real_ip_recursive on;"
    } > "$tmp"
else
    echo "# CYBEDEFEND_TRUSTED_PROXIES is empty: no proxy is trusted." > "$tmp"
fi
mv -- "$geo_tmp" "$geo_out"
mv -- "$tmp" "$out"
