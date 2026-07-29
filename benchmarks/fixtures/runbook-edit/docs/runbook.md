# Payments API — on-call runbook

Last reviewed: 2025-11-04 · Owner: Payments Platform

## Overview

The Payments API takes card and wallet authorizations from the storefront,
writes them to the `payments` Postgres cluster, and hands settlement work to
the `settle` worker pool over the job queue. Three services matter when you
are paged:

- **payments-api** — the HTTP service. Stateless, six replicas, behind the
  shared ingress. This is the thing that pages you.
- **settle-worker** — pulls settlement jobs off the queue. Slow is normal;
  stopped is not.
- **payments-db** — the Postgres primary plus one read replica. Failover is
  managed, not manual.

Everything below assumes you have production access and are on the VPN. If
you do not, stop reading and escalate — see the contacts table.

## Health checks

Start here before you touch anything. All three should answer in under a
second from a bastion host.

```bash
curl -s https://payments-api.internal/healthz
curl -s http://payments-api.internal:8081/admin/status | jq .queueDepth
curl -s https://payments-api.internal/metrics | grep payment_auth_latency
```

What good looks like:

| Signal | Healthy | Paging threshold |
|---|---|---|
| `/healthz` | `{"ok":true}` | anything else for 60s |
| `queueDepth` | under 500 | over 5000 for 5 minutes |
| `payment_auth_latency` p99 | under 400ms | over 1200ms for 5 minutes |
| replica count | 6 | under 4 |

If `/healthz` is fine but latency is bad, the problem is almost always
downstream — check the database dashboard before you blame the service.

## Deploying

Deploys are rolling, two replicas at a time, and take about four minutes end
to end. There is no deploy freeze outside of the December peak window.

1. Merge to `main`. CI builds and pushes the image tag.
2. Watch the pipeline until the `canary` stage goes green. The canary takes
   5% of traffic for six minutes.
3. Promote with `payctl deploy promote <tag>`. Promotion is not automatic and
   never happens outside working hours without a second pair of eyes.
4. Watch `payment_auth_latency` and the error rate for ten minutes. A deploy
   that is going to fail almost always fails inside that window.

Never deploy and run a database migration in the same change. Migrations ship
in their own release, ahead of the code that needs them.

## Rolling back

A rollback is always safe to start. When in doubt, roll back first and work
out why afterwards — a five minute rollback beats a thirty minute debug with
customers failing checkout.

1. Announce in `#payments-oncall` that you are rolling back, with the tag you
   are rolling back from.
2. Run `payctl deploy rollback` — this pins the previous image tag and starts
   a rolling replace.
3. Restart the API replicas with `payctl restart payments-api`.
4. Confirm `/healthz` is green on every replica and that `queueDepth` is
   falling rather than climbing.
5. Post the outcome in the incident channel and open a follow-up ticket
   before you go back to sleep.

Rollbacks do not revert database migrations. If the release you are rolling
back included a migration, page the database on-call before step 2.

## Escalation contacts

Page in this order. Everyone below is on the paging rota and expects to be
woken up; do not sit on an incident because it feels rude.

| Area | Name | Handle | Channel |
|---|---|---|---|
| Payments API | Dana Okafor | @dana | #payments-oncall |
| Settlement | Miguel Serrano | @miguel | #settle-oncall |
| Database | Wei Zhang | @wei | #db-oncall |
| Ingress / network | Aisha Bello | @aisha | #net-oncall |
| Incident command | Tom Lindqvist | @tom | #incident |

If nobody answers within ten minutes, page incident command directly. That is
what the role is for.

## Known issues

- **Duplicate authorization emails.** A retry storm can send a customer two
  authorization emails for one payment. Cosmetic, ticket PAY-4412, fix is
  waiting on the notification service.
- **Admin status endpoint is unauthenticated inside the VPC.** The admin port
  8081 is reachable from any pod in the cluster. Tracked as SEC-233; do not
  expose it at the ingress.
- **Slow settlement after a queue drain.** The first two minutes after a
  drain look like a stall. Give it five minutes before escalating.
- **Read replica lag spikes on the hour.** The hourly reporting job is the
  cause. It is expected and it is not an incident.

## Appendix — environment reference

| Setting | Production | Staging |
|---|---|---|
| HTTP port | 8080 | 8080 |
| Admin port | 8081 | 8091 |
| Database | `payments-primary.internal` | `payments-staging.internal` |
| Queue | `settle-jobs` | `settle-jobs-staging` |
| Log group | `/payments/api` | `/payments/api-staging` |
| Image registry | `registry.internal/payments` | `registry.internal/payments` |

Configuration lives in the `payments-config` secret. Rotating it needs a
restart of every replica, not just a reload — the service reads it once at
boot and caches it for the process lifetime.
