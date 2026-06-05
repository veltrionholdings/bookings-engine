-- ============================================================================
-- Bookings Engine: Initial Schema
-- ============================================================================
-- Multi-tenant booking system for service-based businesses.
-- All tables (except tenants) include tenant_id for row-level isolation.
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Tenants ────────────────────────────────────────────────────────────────────

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    business_type   VARCHAR(50) NOT NULL CHECK (business_type IN ('gym', 'restaurant', 'salon', 'nail_bar', 'spa')),
    timezone        VARCHAR(100) NOT NULL DEFAULT 'UTC',
    settings        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Resource Types ─────────────────────────────────────────────────────────────

CREATE TABLE resource_types (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_resource_types_tenant ON resource_types(tenant_id);

-- ─── Resources ──────────────────────────────────────────────────────────────────

CREATE TABLE resources (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    resource_type_id UUID NOT NULL REFERENCES resource_types(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_resources_tenant_type ON resources(tenant_id, resource_type_id);
CREATE INDEX idx_resources_tenant_active ON resources(tenant_id, is_active);

-- ─── Services ───────────────────────────────────────────────────────────────────

CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name            VARCHAR(255) NOT NULL,
    description     TEXT,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes >= 5),
    buffer_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (buffer_minutes >= 0),
    capacity        INTEGER NOT NULL DEFAULT 1 CHECK (capacity >= 1),
    resource_type_id UUID NOT NULL REFERENCES resource_types(id) ON DELETE CASCADE,
    price_cents     INTEGER,
    currency        VARCHAR(3),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_services_tenant_active ON services(tenant_id, is_active);
CREATE INDEX idx_services_tenant_type ON services(tenant_id, resource_type_id);

-- ─── Resource–Service Links ─────────────────────────────────────────────────────

CREATE TABLE resource_service_links (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,

    UNIQUE (resource_id, service_id)
);

CREATE INDEX idx_rsl_resource ON resource_service_links(resource_id);
CREATE INDEX idx_rsl_service ON resource_service_links(service_id);

-- ─── Resource Schedules ─────────────────────────────────────────────────────────

CREATE TABLE resource_schedules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    CHECK (end_time > start_time)
);

CREATE INDEX idx_schedules_resource_day ON resource_schedules(resource_id, day_of_week);

-- ─── Schedule Overrides ─────────────────────────────────────────────────────────

CREATE TABLE schedule_overrides (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    resource_id     UUID NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
    override_date   DATE NOT NULL,
    is_available    BOOLEAN NOT NULL,
    start_time      TIME,
    end_time        TIME,
    reason          VARCHAR(255),

    UNIQUE (resource_id, override_date),
    CHECK (
        (is_available = FALSE AND start_time IS NULL AND end_time IS NULL)
        OR (is_available = TRUE AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)
    )
);

CREATE INDEX idx_overrides_resource_date ON schedule_overrides(resource_id, override_date);

-- ─── Customers ──────────────────────────────────────────────────────────────────

CREATE TABLE customers (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    first_name      VARCHAR(255) NOT NULL,
    last_name       VARCHAR(255) NOT NULL,
    email           VARCHAR(255),
    phone           VARCHAR(50),
    notes           TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_customers_tenant_email ON customers(tenant_id, email) WHERE email IS NOT NULL;
CREATE INDEX idx_customers_tenant_phone ON customers(tenant_id, phone);

-- ─── Bookings ───────────────────────────────────────────────────────────────────

CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_id         UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    service_id          UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    resource_id         UUID REFERENCES resources(id) ON DELETE SET NULL,
    start_time          TIMESTAMPTZ NOT NULL,
    end_time            TIMESTAMPTZ NOT NULL,
    buffer_end_time     TIMESTAMPTZ NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('pending', 'confirmed', 'completed', 'cancelled', 'no_show')),
    party_size          INTEGER NOT NULL DEFAULT 1 CHECK (party_size >= 1),
    notes               TEXT,
    cancelled_at        TIMESTAMPTZ,
    cancellation_reason VARCHAR(255),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CHECK (end_time > start_time),
    CHECK (buffer_end_time >= end_time)
);

-- Primary index for conflict detection: find overlapping bookings for a resource
CREATE INDEX idx_bookings_conflict ON bookings(tenant_id, resource_id, start_time, buffer_end_time)
    WHERE status IN ('pending', 'confirmed');

-- Customer's upcoming bookings
CREATE INDEX idx_bookings_customer ON bookings(tenant_id, customer_id, start_time);

-- Admin listing by status and date
CREATE INDEX idx_bookings_status_date ON bookings(tenant_id, status, start_time);

-- ─── Updated At Trigger ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tenants_updated_at
    BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_resources_updated_at
    BEFORE UPDATE ON resources FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_services_updated_at
    BEFORE UPDATE ON services FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON customers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION update_updated_at();
