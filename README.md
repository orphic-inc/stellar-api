# Stellar API
[![Codacy Badge](https://app.codacy.com/project/badge/Grade/ddbd8663fbd640aa96f4a89770a387d6)](https://app.codacy.com/gh/orphic-inc/stellar-ui/dashboard?utm_source=gh&utm_medium=referral&utm_content=&utm_campaign=Badge_grade)

This is a Node-based API for Stellar, the next generation mirage.

## Quick Start

See the [compose](https://github.com/orphic-inc/stellar-compose) repository for the fastest way to spin up an instance of Stellar.

## Requirements

* Node.js (only LTS version supported)

## Development Environment

    git clone https://github.com/orphic-inc/stellar-api.git api
    cd api
    npm i
    npm start

## Claude Code

This project supports [Claude Code](https://claude.ai/code). The `CLAUDE.md` file is gitignored since it may contain personal workflow preferences. To create one:

1. Run `/init` inside Claude Code, or
2. Copy `CLAUDE.md.example` from a teammate

If you make changes to `CLAUDE.md` that should be shared, commit it with `git add -f CLAUDE.md`.

## Configuration

| Variable              | Description                  | Default   |
|-----------------------|------------------------------|-----------|
| STELLAR_AUTH_JWT_SECRET  | Secret for signing JWTs      | undefined |
| STELLAR_LOG_LEVEL        | Winston log level            | info      |
| STELLAR_LOG_TIME_FMT     | Winston log timestamp format | undefined |
| STELLAR_HTTP_PORT        | API listening port           | 8080      |
| STELLAR_HTTP_CORS_ORIGIN | API CORS origin to whitelist | undefined |
