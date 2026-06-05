#!/usr/bin/env node
/**
 * CDK entry point for the Bookings Engine infrastructure.
 */

import * as cdk from 'aws-cdk-lib';
import { BookingsEngineStack } from '../lib/bookings-engine-stack';

const app = new cdk.App();

new BookingsEngineStack(app, 'BookingsEngineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1',
  },
  description: 'Generic multi-tenant booking API for service businesses',
});
