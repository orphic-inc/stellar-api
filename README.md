# Stellar API

[![Codacy Badge](https://app.codacy.com/project/badge/Grade/ddbd8663fbd640aa96f4a89770a387d6)](https://app.codacy.com/gh/orphic-inc/stellar-api/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

This is the Node.js API backend for **Stellar**, a modern, next-generation community content tracker and forum software.

## Tech Stack
- **Runtime**: Node.js (LTS)
- **Framework**: Express.js
- **Database**: PostgreSQL with Prisma ORM
- **Validation**: Zod (with OpenAPI generation)
- **Testing**: Jest & Supertest

## Quick Start

See the [stellar-compose](https://github.com/orphic-inc/stellar-compose) repository for the fastest way to spin up a full instance of Stellar (API, UI, and Database) using Docker.

## Local Development Setup

If you prefer to run the API directly on your local machine for development:

### 1. Prerequisites
- Node.js (LTS version)
- A running PostgreSQL instance

### 2. Installation
```bash
git clone https://github.com/orphic-inc/stellar-api.git
cd stellar-api
npm install
```

### 3. Environment Variables
Copy `.env.example` to `.env` (or create one) and configure the following variables:

| Variable                   | Description                                    | Default                 |
|----------------------------|------------------------------------------------|-------------------------|
| `DATABASE_URL`             | Prisma connection string to your Postgres DB   | `postgresql://...`      |
| `STELLAR_AUTH_JWT_SECRET`  | Secret for signing JWTs (must be securely set) | *undefined*             |
| `STELLAR_LOG_LEVEL`        | Winston log level (e.g., debug, info, error)   | `info`                  |
| `STELLAR_HTTP_PORT`        | API listening port                             | `8080`                  |
| `STELLAR_HTTP_CORS_ORIGIN` | Allowed CORS origin (usually the UI url)       | `http://localhost:3000` |

### 4. Database Setup
Before running the app, ensure your database schema is initialized and the Prisma Client is generated:
```bash
npx prisma migrate dev
npx prisma generate
```

### 5. Running the API
Start the server in development mode (with hot-reloading):
```bash
npm run dev
```

## OpenAPI Synchronization

Stellar relies on an OpenAPI specification to maintain type-safety between the API and the UI.
When you make changes to Zod schemas or API routes, you must export the new OpenAPI spec:
```bash
npm run openapi:export
```
This generates an `openapi.json` file in the project root. The `stellar-ui` repository will read this file to generate its frontend TypeScript types.

## Testing

Run the test suite:
```bash
npm run test
```

Run integration tests (requires a `stellar_test` database and `.env.test` file):
```bash
npm run test:integration
```
