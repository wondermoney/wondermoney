# WonderMoney API

The HTTP API and worker that manage tenant-scoped financial information.

## Language

**Tenant**:
The isolation scope for financial information and membership. A Tenant can contain multiple people and is distinct from an individual user.
_Avoid_: User, account

**Budget Allocation**:
An amount assigned by a Budget to a category, optionally associated with one or more accounts.
_Avoid_: Budget line, budget row

**Portfolio**:
A tenant-scoped collection of investment holdings, transactions, prices, and snapshots.
_Avoid_: Account, investment account

**Portfolio Import Session**:
A tracked intake of portfolio data from preview through confirmed or failed processing.
_Avoid_: Upload, import job
