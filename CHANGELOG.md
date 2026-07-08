# Changelog

All notable changes to the Bookings Engine are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [1.0.0] - 2026-06-05

### Added
- Multi-tenant booking engine with PostgreSQL backend
- Tenant management (`GET /tenant`, `PATCH /tenant`)
- Resource types CRUD (`/resource-types`)
- Resources CRUD with schedules and overrides (`/resources`)
- Services CRUD (`/services`)
- Resource-service linking (`/resources/{id}/services`)
- Availability calculation (`GET /availability`) with service-driven duration, buffer times, and slot interval snapping
- Booking lifecycle (`POST /bookings`, `PATCH /bookings/{id}`, cancel, complete, no-show)
- Customer management (`/customers`)
- Cognito JWT authentication via API Gateway HTTP API authorizer
- Conflict detection with buffer-inclusive time range overlap
- Configurable tenant settings (slot interval, assignment strategy, cancellation window, min advance, max advance days)
- Recurring weekly schedules with exception overrides
- "Any available" resource assignment (first_available strategy)
- Timezone-aware availability (UTC storage, tenant-local display)
- AWS CDK infrastructure (Lambda, API Gateway, RDS PostgreSQL, Cognito, Secrets Manager)
- Seed script for Tas Hair & Beauty Cafe demo data
- OpenAPI 3.0 specification
- Full documentation (data model, API spec, business rules)

### Known Limitations
- `round_robin` and `least_busy` assignment strategies not yet implemented (defaults to `first_available`)
- No `DELETE /customers/{id}` endpoint (POPIA compliance — planned)
- No customer data export endpoint (POPIA compliance — planned)
- No CI/CD pipeline (manual deployment via `cdk deploy`)
