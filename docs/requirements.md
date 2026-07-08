# Requirements

## Domain & Purpose

The Bookings Engine solves appointment and resource scheduling for service-based businesses. It is generic and multi-tenant — any type of service business (salon, gym, restaurant, spa, nail bar) can use it without code changes.

**Consumers**: PWA clients, mobile apps, WhatsApp bots, and eventually external developers via public API (PaaS model).

**Core entities**: Tenant, Resource, Service, Booking, Customer, Schedule

**Core operations**: Check availability, create booking, cancel booking, manage resources and schedules

---

## Multi-Tenancy

- A tenant is a single business (e.g. "Tas Hair & Beauty Cafe")
- Tenant data is isolated via `tenant_id` column on all tables (shared database)
- One tenant's operation can never affect another tenant's data
- New tenants are onboarded via seed script (Phase 1); self-serve onboarding planned for Phase 3

---

## Authentication & Authorisation

| Actor | Auth Method | Permissions |
|-------|-------------|------------|
| Admin (business owner/staff) | Cognito JWT with `custom:role=admin` | Full CRUD on all resources in their tenant |
| Customer | Cognito JWT with `custom:role=customer` | View services, check availability, create/cancel own bookings |
| External developer (future) | API key | Scoped per tenant, rate-limited |

- All endpoints require authentication (JWT verified by API Gateway)
- No public endpoints currently (services list will be made public in a future iteration)
- API keys for PaaS consumers planned for Phase 3

---

## Data

| Data Type | Sensitivity | Notes |
|-----------|-------------|-------|
| Customer name, email, phone | PII | Subject to POPIA — must support deletion and export |
| Booking records | Internal | Contains customer reference — anonymise on customer deletion |
| Tenant settings | Internal | No PII |
| Resource/service data | Internal | No PII |

**Encryption**: RDS encryption at rest (AWS default), all traffic over HTTPS
**Retention**: Customer PII retained for duration of relationship + 1 year. Booking records retained 3 years.
**Regulatory**: POPIA applies. Delete and export endpoints required.

---

## Integrations

- No external API dependencies in v1
- The engine emits no events in v1 (event-driven notifications planned as a separate engine)
- The engine does not consume events from other services in v1

---

## Non-Functional Requirements

| Metric | Target |
|--------|--------|
| Request volume at launch | < 1,000 requests/day |
| Expected peak | < 100 requests/minute |
| Read response time (p95) | < 500ms |
| Write response time (p95) | < 1000ms |
| Monthly uptime | 99.5% (< 3.6 hours downtime) |
| Geographic constraints | None (deployed in eu-west-1 for cost, users in South Africa) |

---

## Monitoring & Observability

| Condition | Action |
|-----------|--------|
| Error rate > 5% for 5 minutes | Alert (P2) |
| Any Lambda invocation error | Logged to CloudWatch |
| p95 latency > 2 seconds for 5 minutes | Alert (P3) |
| RDS CPU > 80% for 10 minutes | Alert (P3) |
| Who gets notified | Veltrion admin (email) |

**Business metrics to track** (future): Bookings created per day per tenant, active tenants, cancellation rate
**Operational metrics**: Error rate, latency p95, Lambda cold start rate, DB connection count

---

## MVP Scope

### In Scope (v1.0.0 — shipped)
- Tenant profile and settings management
- Resource types, resources, schedules, and overrides (full CRUD)
- Services (full CRUD)
- Resource-service linking
- Availability calculation (service-driven duration, conflict detection, buffer times)
- Booking creation with conflict checking
- Booking lifecycle (cancel, complete, no-show)
- Customer management
- "Any available" resource assignment (first_available strategy)
- Cognito JWT authentication
- Multi-tenant data isolation
- Timezone-aware availability (Africa/Johannesburg)

### Out of Scope (post-MVP)
- `round_robin` and `least_busy` assignment strategies
- Customer data deletion endpoint (POPIA — next iteration)
- Customer data export endpoint (POPIA — next iteration)
- Event emission (booking.created, booking.cancelled, etc.)
- Notifications (email, SMS, WhatsApp confirmations/reminders)
- Payments and deposits
- Recurring bookings (e.g. "every Tuesday at 10am")
- Waitlist / queue management
- Public (unauthenticated) service listing endpoint
- API key authentication for PaaS consumers
- Rate limiting
- Multi-language support

---

## MVP Acceptance Criteria

```
GIVEN a tenant has a stylist with a Monday 9:00-17:00 schedule
WHEN a customer requests availability for a Pixie Cut (45min + 10min buffer) on Monday
THEN the API returns slots from 09:00 to 16:15 in 15-minute intervals

GIVEN a booking exists for a stylist from 10:00-11:00
WHEN a customer requests availability for the same stylist on the same day
THEN the 10:00-10:45 slot is not returned (conflict detected)

GIVEN a customer creates a booking for a Pixie Cut at 10:00
WHEN another customer tries to book the same stylist at 10:00
THEN the second booking returns 409 Conflict

GIVEN a tenant has cancellation_window_minutes = 1440
WHEN a customer tries to cancel a booking starting in 12 hours
THEN the cancellation is denied with 403 Forbidden

GIVEN a customer selects "any available" stylist
WHEN they request availability for a service
THEN available slots are returned with the available stylists for each slot

GIVEN a resource has a schedule override (is_available = false) on a date
WHEN availability is checked for that date
THEN no slots are returned for that resource
```
