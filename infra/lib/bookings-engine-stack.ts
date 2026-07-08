/**
 * CDK Stack for the Bookings Engine.
 *
 * Creates:
 * - RDS PostgreSQL instance (free tier, publicly accessible with security group)
 * - Lambda functions for each API handler (outside VPC for simplicity)
 * - API Gateway HTTP API with JWT authorizer (Cognito)
 * - Cognito User Pool for authentication
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class BookingsEngineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC (minimal, for RDS only) ──────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'BookingsVpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
      ],
    });

    // ─── Security Group for RDS ───────────────────────────────────────────────
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Allow PostgreSQL access from Lambda and local dev',
    });

    // Allow connections from anywhere on port 5432
    // (RDS credentials + SSL provide the real security layer)
    dbSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(5432),
      'Allow PostgreSQL from Lambda and dev machines'
    );

    // ─── RDS PostgreSQL (Free Tier) ───────────────────────────────────────────
    const database = new rds.DatabaseInstance(this, 'BookingsDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of('16.14', '16'),
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroups: [dbSecurityGroup],
      publiclyAccessible: true,
      databaseName: 'bookings',
      credentials: rds.Credentials.fromGeneratedSecret('bookings_admin', {
        secretName: 'bookings-engine/db-credentials',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      backupRetention: cdk.Duration.days(1),
    });

    // ─── Cognito User Pool ────────────────────────────────────────────────────
    const userPool = new cognito.UserPool(this, 'BookingsUserPool', {
      userPoolName: 'bookings-engine-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      customAttributes: {
        tenant_id: new cognito.StringAttribute({ mutable: true }),
        role: new cognito.StringAttribute({ mutable: true }),
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const userPoolClient = userPool.addClient('BookingsApiClient', {
      authFlows: {
        userPassword: true,
        userSrp: true,
      },
      generateSecret: false,
      idTokenValidity: cdk.Duration.hours(24),
      accessTokenValidity: cdk.Duration.hours(24),
      refreshTokenValidity: cdk.Duration.days(30),
    });

    // ─── Lambda Functions (outside VPC) ───────────────────────────────────────
    const dbSecret = database.secret!;

    const commonNodejsProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_WEEK,
      environment: {
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_PORT: database.dbInstanceEndpointPort,
        DB_NAME: 'bookings',
        DB_USER: 'bookings_admin',
        DB_SECRET_ARN: dbSecret.secretArn,
        DB_SSL: 'true',
        NODE_OPTIONS: '--enable-source-maps',
      },
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node20',
        format: nodejs.OutputFormat.CJS,
        keepNames: true,
        externalModules: [], // Bundle everything
      },
    };

    const createLambda = (name: string, entry: string): nodejs.NodejsFunction => {
      const fn = new nodejs.NodejsFunction(this, name, {
        ...commonNodejsProps,
        functionName: `bookings-${name.toLowerCase()}`,
        entry: `../src/handlers/${entry}`,
        handler: 'handler',
      } as nodejs.NodejsFunctionProps);

      dbSecret.grantRead(fn);
      return fn;
    };

    const tenantFn = createLambda('Tenant', 'tenant.handler.ts');
    const resourceTypesFn = createLambda('ResourceTypes', 'resource-types.handler.ts');
    const resourcesFn = createLambda('Resources', 'resources.handler.ts');
    const servicesFn = createLambda('Services', 'services.handler.ts');
    const availabilityFn = createLambda('Availability', 'availability.handler.ts');
    const customersFn = createLambda('Customers', 'customers.handler.ts');
    const bookingsFn = createLambda('Bookings', 'bookings.handler.ts');

    // ─── API Gateway ──────────────────────────────────────────────────────────
    const httpApi = new apigatewayv2.HttpApi(this, 'BookingsApi', {
      apiName: 'bookings-engine-api',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [
          apigatewayv2.CorsHttpMethod.GET,
          apigatewayv2.CorsHttpMethod.POST,
          apigatewayv2.CorsHttpMethod.PATCH,
          apigatewayv2.CorsHttpMethod.PUT,
          apigatewayv2.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer(
      'CognitoAuthorizer',
      `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`,
      { jwtAudience: [userPoolClient.userPoolClientId] }
    );

    // Helper to add authenticated routes
    const addRoute = (
      method: apigatewayv2.HttpMethod,
      path: string,
      fn: lambda.Function
    ) => {
      httpApi.addRoutes({
        path: `/v1${path}`,
        methods: [method],
        integration: new integrations.HttpLambdaIntegration(`${method}${path.replace(/[\/{}]/g, '-')}`, fn),
        authorizer: jwtAuthorizer,
      });
    };

    // Helper to add public routes (no auth required)
    const addPublicRoute = (
      method: apigatewayv2.HttpMethod,
      path: string,
      fn: lambda.Function
    ) => {
      httpApi.addRoutes({
        path: `/v1${path}`,
        methods: [method],
        integration: new integrations.HttpLambdaIntegration(`${method}${path.replace(/[\/{}]/g, '-')}-public`, fn),
      });
    };

    // Tenant routes
    addRoute(apigatewayv2.HttpMethod.GET, '/tenant', tenantFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/tenant', tenantFn);

    // Resource type routes
    addRoute(apigatewayv2.HttpMethod.GET, '/resource-types', resourceTypesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/resource-types', resourceTypesFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/resource-types/{id}', resourceTypesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/resource-types/{id}', resourceTypesFn);

    // Resource routes (GET is public, write requires auth)
    addPublicRoute(apigatewayv2.HttpMethod.GET, '/resources', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/resources', resourcesFn);
    addPublicRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/resources/{id}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/resources/{id}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}/schedules', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.PUT, '/resources/{id}/schedules', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}/overrides', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/resources/{id}/overrides', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/resources/{id}/overrides/{overrideId}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}/services', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.PUT, '/resources/{id}/services', resourcesFn);

    // Service routes (GET is public, write requires auth)
    addPublicRoute(apigatewayv2.HttpMethod.GET, '/services', servicesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/services', servicesFn);
    addPublicRoute(apigatewayv2.HttpMethod.GET, '/services/{id}', servicesFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/services/{id}', servicesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/services/{id}', servicesFn);

    // Availability (public — customers browse without auth)
    addPublicRoute(apigatewayv2.HttpMethod.GET, '/availability', availabilityFn);

    // Customer routes
    addRoute(apigatewayv2.HttpMethod.GET, '/customers', customersFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/customers', customersFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/customers/{id}', customersFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/customers/{id}', customersFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/customers/{id}', customersFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/customers/{id}/export', customersFn);

    // Booking routes
    addRoute(apigatewayv2.HttpMethod.GET, '/bookings', bookingsFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/bookings', bookingsFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/bookings/{id}', bookingsFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/bookings/{id}', bookingsFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/bookings/{id}/cancel', bookingsFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/bookings/{id}/complete', bookingsFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/bookings/{id}/no-show', bookingsFn);

    // ─── Outputs ──────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: httpApi.apiEndpoint,
      description: 'API Gateway endpoint URL',
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'DatabaseEndpoint', {
      value: database.dbInstanceEndpointAddress,
      description: 'RDS PostgreSQL endpoint',
    });

    new cdk.CfnOutput(this, 'DatabaseSecretArn', {
      value: dbSecret.secretArn,
      description: 'ARN of the secret containing DB credentials',
    });
  }
}
