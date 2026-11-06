# Security

Do not disclose credentials, quiz answer keys, attendee data, or exploitable
issues in public GitHub issues. Use this repository's private vulnerability
reporting feature when the publisher has enabled it. If it is unavailable,
contact the repository owner privately before sharing details.

The publisher controls Fabric tenant settings, workspace/item access, database
principals, retention, capacity, abuse protection, and deployment. The runtime
app owner is trusted and can access the private SQL database. Attendees must
never receive database credentials, workspace contributor access, or direct
SQL/API permissions.

See [deployment and release gates](docs/deployment.md) and
[architecture](docs/architecture.md). Local tests do not establish that Fabric
enforces authorization. Public attendance is not release-ready until the
live negative-authorization matrix passes in the destination tenant.
