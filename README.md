# Bookings Engine

A generic, multi-tenant booking API designed to serve service-based businesses: gyms, restaurants, hair salons, nail bars, and spas.

## Overview

Rather than building separate booking systems for each business type, this engine abstracts the common patterns into a single configurable service. All service businesses share the same fundamental flow:

1. A **resource** (person, room, table) has limited **availability**
2. A **customer** requests a **time window** for a specific **service**
3. The system checks for **conflicts** and confirms or rejects
4. The booking follows a lifecycle: pending → confirmed → completed/cancelled/no-show

The differences between business types (gym classes vs. restaurant tables vs. salon appointments) are handled through **configuration**, not code branches.

## Key Concepts

| Concept | Description | Examples |
|---------|-------------|----------|
| **Tenant** | A business using the platform | "FitLife Gym", "Bella Salon" |
| **Resource** | Something that can be booked | Stylist, trainer, table, room |
| **Service** | A procedure/activity with a defined duration | Haircut (30min), yoga class (60min), dinner seating (90min) |
| **Booking** | A confirmed reservation of a resource for a service at a time | Jane booked with Sarah for a balayage at 10:00 |
| **Schedule** | Recurring availability pattern for a resource | "Jane works Mon/Wed/Fri 9am–5pm" |

## Business Types Supported

| Business | Resource | Service Examples | Capacity Model |
|----------|----------|-----------------|----------------|
| Gym | Instructor / Studio | HIIT class, Yoga, Spin | Multi-person (class capacity) |
| Restaurant | Table | Lunch seating, Tasting menu | Single-party per table |
| Hair Salon | Stylist | Cut, Colour, Balayage | One client per stylist |
| Nail Bar | Technician | Manicure, Pedicure, Gel set | One client per tech |
| Spa | Therapist / Room | Massage, Facial, Body wrap | One client per therapist |

## Architecture

- **Runtime**: AWS Lambda (Node.js / TypeScript)
- **API**: API Gateway (HTTP API)
- **Database**: PostgreSQL (RDS)
- **Auth**: AWS Cognito (multi-tenant)
- **Infrastructure**: AWS CDK (TypeScript)

## Project Structure

```
bookings-engine/
├── docs/                    # Documentation
│   ├── data-model.md        # Database schema and relationships
│   ├── api-spec.md          # API contract and endpoint reference
│   └── business-rules.md   # Configurable rules and scheduling logic
├── infra/                   # AWS CDK infrastructure code
├── src/                     # Application source code
│   ├── handlers/            # Lambda function handlers
│   ├── services/            # Business logic layer
│   ├── repositories/        # Database access layer
│   ├── models/              # TypeScript types and interfaces
│   └── utils/               # Shared utilities
├── migrations/              # Database migration scripts
├── tests/                   # Test suites
├── openapi.yaml             # OpenAPI 3.0 specification
└── package.json
```

## Design Principles

1. **Generic over specific** — The API deals in resources, services, and bookings. Domain-specific language (tables, stylists, classes) lives in the PWA layer.
2. **Configuration over code** — Business rules (capacity, duration, buffer times, cancellation policies) are tenant-level config, not hardcoded logic.
3. **Multi-tenant from day one** — Every record is scoped by `tenant_id`. Shared database, row-level isolation.
4. **Service-driven duration** — The service defines how long a booking takes, not a fixed time grid.
5. **Timezone-aware** — All storage in UTC. All availability queries resolved in the tenant's local timezone.

## Getting Started

See individual docs for details:
- [Data Model](docs/data-model.md) — Database schema and entity relationships
- [API Specification](docs/api-spec.md) — Endpoints, request/response formats
- [Business Rules](docs/business-rules.md) — Scheduling logic, conflict detection, configuration options
