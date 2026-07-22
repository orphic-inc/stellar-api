An interface is any client or tool that talks to the site on your behalf. Golden Rule 3 requires that yours is on this whitelist and is unmodified.

==The rule, before the list==

[b]Whitelisted means the specific published build.[/b] A client on this list, patched or rebuilt with changes, is not whitelisted — it is an unapproved interface that shares a name with an approved one.

[b]Automated access goes through the API.[/b] The API is rate-limited and documented. Scripting the web interface — scraping pages, replaying form submissions, driving a browser — is not automated access through an approved route, whatever it is written in.

[b]Absence from this list is not permission.[/b] If your client is not listed, it is not approved. There is no default-allow.

==The list==

The whitelist is maintained by staff. Its current contents are published on the site rather than in this page, so that a client can be added or withdrawn without a documentation change lagging behind it.

If you cannot find the current list, send a Staff PM and ask. Do not guess, and do not rely on a list you saw elsewhere or previously — entries are withdrawn when a client starts misbehaving, and using a withdrawn client is a rule breach even though it was fine last month.

==Developing an interface==

Developers are welcome, and this is not intended to shut the door on new clients.

If you are building or testing something that is not yet approved, get staff approval [b]before[/b] pointing it at the site. Approval for testing is routine and is usually granted; running an unapproved client against production first and asking afterwards is not, and the fact that you intended to submit it does not retroactively make it approved.

What staff will want to know: what it does, how it authenticates, what it requests and how often, and how it backs off when rate-limited.

==Why this exists==

An interface acts with your credentials and your ratio. A client that requests too aggressively degrades the site for everyone; one that mishandles credentials exposes your account; one that reports inaccurate data corrupts the ledger, which is the same offence as manipulating it by hand.

The whitelist is not gatekeeping for its own sake — it is the only practical way to know what is talking to the site.
