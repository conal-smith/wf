# Security

Please report a vulnerability privately, not in a public issue: use
**Report a vulnerability** on this repository's
[Security tab](https://github.com/sprintengine/wingfoil/security/advisories/new).
Say what you found, how to reproduce it, and what it lets someone do. You will
get an answer within a week.

What is in scope: the site at wingfoil.ie, the forecast worker image and its
publishing to the data bucket, the marketplace and community APIs, and the MCP
endpoint. Forecast accuracy is not a security issue; open an ordinary issue.

No credential belongs in this repository. Bucket keys, API tokens and the like
live in the deploying machine's environment or in GitHub's encrypted secrets
(docs/RELEASES.md). If you spot one committed, report it as above.
