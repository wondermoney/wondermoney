# Security policy

WonderMoney holds people's financial data, so we take reports seriously and are grateful
for them.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately, either:

- through GitHub: the **Security** tab of this repository → **Report a vulnerability**, or
- by email to **security@wonder.money**.

Include what you found, how to reproduce it and what an attacker could do with it. We
aim to acknowledge reports within three working days and to keep you updated until a fix
ships. We will credit you in the release notes unless you would rather we didn't.

## Scope

In scope: this repository's code, and the hosted instance at wonder.money where the
issue lies in that code. Out of scope: findings that need a compromised device or
account, social engineering, denial of service by volume, and missing hardening headers
with no demonstrated impact.

Please test only against your own self-hosted instance or your own account. Never
access, change or delete other people's data.

## Supported versions

Security fixes go into the latest release. Self-hosters should run the most recent
version: `docker compose pull && docker compose up -d`.
