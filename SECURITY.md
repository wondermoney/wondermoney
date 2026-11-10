# Security policy

WonderMoney holds people's financial data, so we take reports seriously and are grateful
for them.

## Supported versions

Security fixes go into the [latest release](https://github.com/wondermoney/wondermoney/releases/latest)
only; older releases do not get backports. Self-hosters should run the most recent version:
`docker compose pull && docker compose up -d` (see
[Updates and backups](https://docs.wonder.money/en/docs/self-hosting/upgrade-and-backup)).

## Reporting a vulnerability

Please **do not open a public issue, discussion or pull request** for a vulnerability.
Report it privately through GitHub's private vulnerability reporting:
[open a report](https://github.com/wondermoney/wondermoney/security/advisories/new)
(or the **Security** tab of this repository → **Report a vulnerability**). If you can't use
GitHub, email **security@wonder.money**.

Helpful things to include:

- what you found and where (file, endpoint or screen);
- the version or commit, and whether it affects self-hosted instances, the hosted
  instance, or both;
- steps to reproduce, or a proof of concept;
- what an attacker could do with it, and anything that limits it;
- any fix you have in mind.

**Never include real financial data, credentials or other people's personal data** in a
report, and never in a public issue. Use your own test account and made-up values.

## What to expect

WonderMoney is a small open-source project, so we can't promise fixed response times. We
read every report, will acknowledge it as soon as we can, and will keep you updated while
we work on a fix. Once a fix has shipped we publish an advisory and credit you, unless you
would rather we didn't. Please give us a reasonable chance to fix the issue before
disclosing it publicly.

## Scope

In scope:

- this repository's code, including self-hosted deployments built from it (the Docker
  Compose setup in `apps/api/deploy/selfhost` and the published images);
- the hosted instance at wonder.money, where the issue lies in this code or its
  configuration.

Out of scope: findings that need a compromised device or account, social engineering,
denial of service by volume, vulnerabilities in a self-hoster's own infrastructure or
modifications, and missing hardening headers with no demonstrated impact.

Please test only against your own self-hosted instance or your own account on the hosted
instance. Never access, change or delete other people's data.
