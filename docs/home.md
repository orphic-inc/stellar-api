## Stellar Documentation

## Introduction

Greetings and salutations! This in-progress document contains guidance for developing and maintaining Stellar.

## Connecting to the Database

To connect to the production Stellar database, you need Google Cloud SQL Proxy and IAM access for a service account with the Cloud SQL Client role.

Use this service account's JSON file as the environment variable for `GOOGLE_APPLICATION_CREDENTIALS`.
