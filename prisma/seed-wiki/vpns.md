Golden Rule 5.1 governs how you may reach the site. This page explains what it permits, what it does not, and how to get an arrangement approved before you rely on it.

==What the rule permits==

You may browse through a private server or proxy [b]only if it has a static IP address unique to you[/b], or through your own private or shared VPS.

The operative word is [b]unique[/b]. The test is not whether a connection is encrypted, paid for, or reputable — it is whether the address your traffic arrives from belongs to you and to nobody else. An address you share with strangers fails that test however good the service is.

==What the rule does not permit==

The rule applies to every kind of proxy. That includes commercial VPN services, Tor, and public proxies of any sort.

Commercial VPNs are the common case and the one members most often assume is fine. Almost all of them route many customers through a small pool of shared exit addresses, which is precisely the arrangement the rule excludes. A paid subscription, a privacy-focused provider, or a no-logs policy does not change this — the address is still shared, so the rule still applies.

Tor is excluded for the same reason and more strongly: exit nodes are shared by design and change between circuits.

==Why the site cares==

Every action here is attributed to an account, and the address a connection arrives from is one of the few independent signals that an account is being used by the person it belongs to.

When many accounts share one address, that signal disappears. Staff can no longer distinguish one member using a VPN from several members sharing a login, or from one person operating several accounts — all three look identical. The rule exists so that the address remains meaningful, not because encrypted connections are suspect.

This also means the rule protects you. If your account is accessed by someone else, the address is part of how that gets established.

==Getting approval==

If your situation is not clearly covered above, [b]send a Staff PM and ask before you connect through it[/b], not after.

Approval is a routine request and asking is not treated as suspicious. What staff will want to know: what the service or server is, whether the address is static, and whether anyone else uses it.

Two things worth being clear about. Approval is specific to the arrangement you described — changing provider, server, or address means asking again. And connecting first and seeking approval afterwards is not the same thing as approval, even where the arrangement would have been permitted had you asked.

==If your address changes==

A static address that changes because your provider renumbered, or a VPS you have migrated, is worth a Staff PM. This is housekeeping rather than an accusation, and it is much easier to explain in advance than to explain once an automated check has flagged it.

See also [[ips]], which covers the address itself rather than the route your traffic takes to reach it.
