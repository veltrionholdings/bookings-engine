# Deployment Guide

How to deploy the Bookings Engine from scratch or update an existing deployment.

---

## Prerequisites

- **Node.js** 20+
- **AWS CLI** v2 configured (`aws configure` with access key and `eu-west-1` region)
- **AWS CDK** (`npm install -g aws-cdk`)
- **CDK bootstrapped** in the target account/region (`cdk bootstrap aws://{account-id}/eu-west-1`)

---

## Project Setup (First Time)

```bash
# Clone the repository
git clone <repo-url>
cd bookings-engine

# Install application dependencies
npm install

# Install infrastructure dependencies
cd infra
npm install
cd ..
```

---

## Build

```bash
npm run build
```

This compiles TypeScript to JavaScript in `dist/`. The CDK stack uses esbuild via `NodejsFunction` which bundles directly from source, so `npm run build` is mainly for local validation.

---

## Deploy to AWS

### First Deployment

```bash
cd infra
cdk deploy --require-approval never
```

This creates:
- VPC with public subnets
- RDS PostgreSQL instance (db.t4g.micro)
- Cognito User Pool and Client
- 7 Lambda functions
- API Gateway HTTP API with JWT authorizer
- Secrets Manager secret for DB credentials

Deployment takes ~7-10 minutes on first run (RDS creation is slow).

### Subsequent Deployments

Same command. CDK detects changes and only updates what's different. Usually takes 30-60 seconds for code-only changes.

```bash
cd infra
cdk deploy --require-approval never
```

---

## Run Database Migrations

After first deployment (or when new migration files are added):

```bash
# Set environment variables
$env:DB_HOST = "<RDS endpoint from CDK output>"
$env:DB_PORT = "5432"
$env:DB_NAME = "bookings"
$env:DB_USER = "bookings_admin"
$env:DB_PASSWORD = "<password from Secrets Manager>"
$env:DB_SSL = "true"

# Run migrations
npx ts-node src/utils/migrate.ts
```

To get the DB password from Secrets Manager:
```bash
aws secretsmanager get-secret-value --secret-id "bookings-engine/db-credentials" --region eu-west-1 --query "SecretString" --output text
```

---

## Seed Demo Data

After running migrations (one-time for demo environments):

```bash
# Same DB_* environment variables as above
npx ts-node scripts/seed.ts
```

This creates the Tas Hair & Beauty Cafe tenant with all services, a stylist, and a schedule.

---

## Create a Test User

To create a Cognito user for API testing:

```bash
npx ts-node scripts/create-test-user.ts
```

This creates an admin user, sets a permanent password, and prints a JWT token.

---

## Test the API

```bash
# Get a fresh token
$token = aws cognito-idp initiate-auth `
  --auth-flow USER_PASSWORD_AUTH `
  --client-id <client-id> `
  --auth-parameters USERNAME=admin@tashair.test,PASSWORD=TasHair2025! `
  --region eu-west-1 `
  --query "AuthenticationResult.IdToken" `
  --output text

# Test an endpoint
Invoke-WebRequest `
  -Uri "https://<api-id>.execute-api.eu-west-1.amazonaws.com/v1/services" `
  -Headers @{Authorization="Bearer $token"} `
  -TimeoutSec 30
```

---

## CDK Outputs

After deployment, CDK prints these values:

| Output | Description |
|--------|-------------|
| `ApiUrl` | The API Gateway endpoint URL |
| `UserPoolId` | Cognito User Pool ID |
| `UserPoolClientId` | Cognito Client ID (used for auth) |
| `DatabaseEndpoint` | RDS hostname |
| `DatabaseSecretArn` | ARN for the DB credentials secret |

---

## Environment Variables (Lambda)

These are set automatically by CDK — you don't configure them manually:

| Variable | Source |
|----------|--------|
| `DB_HOST` | RDS endpoint address |
| `DB_PORT` | RDS endpoint port |
| `DB_NAME` | `bookings` |
| `DB_USER` | `bookings_admin` |
| `DB_SECRET_ARN` | Secrets Manager ARN |
| `DB_SSL` | `true` |

---

## Destroying the Stack

To tear down all AWS resources (irreversible — will snapshot the database first):

```bash
cd infra
cdk destroy
```

This deletes all Lambda functions, API Gateway, VPC, and takes a final RDS snapshot before deleting the database.

---

## Troubleshooting

### Lambda returns 500
Check CloudWatch Logs:
```bash
aws logs describe-log-streams `
  --log-group-name "/aws/lambda/bookings-services" `
  --order-by LastEventTime --descending --limit 1 `
  --region eu-west-1
```

### Token expired
Tokens expire after 1 hour. Re-authenticate using the `initiate-auth` command above.

### Database connection timeout
Verify the RDS security group allows inbound on port 5432 from `0.0.0.0/0` (for Lambda outside VPC).

### CDK deploy fails
Check if there's a failed stack in `ROLLBACK_COMPLETE` state:
```bash
aws cloudformation delete-stack --stack-name BookingsEngineStack --region eu-west-1
```
Then retry `cdk deploy`.
