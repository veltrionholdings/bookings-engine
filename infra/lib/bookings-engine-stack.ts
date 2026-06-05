/**
 * CDK Stack for the Bookings Engine.
 *
 * Creates:
 * - RDS PostgreSQL instance (free tier eligible)
 * - Lambda functions for each API handler
 * - API Gateway HTTP API with JWT authorizer (Cognito)
 * - Cognito User Pool for authentication
 * - VPC for RDS connectivity
 */

import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as authorizers from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';

export class BookingsEngineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC ──────────────────────────────────────────────────────────────────
    const vpc = new ec2.Vpc(this, 'BookingsVpc', {
      maxAzs: 2,
      natGateways: 0, // Save cost — use VPC endpoints or public subnets
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ─── Security Groups ──────────────────────────────────────────────────────
    const dbSecurityGroup = new ec2.SecurityGroup(this, 'DbSecurityGroup', {
      vpc,
      description: 'Security group for RDS PostgreSQL',
    });

    const lambdaSecurityGroup = new ec2.SecurityGroup(this, 'LambdaSecurityGroup', {
      vpc,
      description: 'Security group for Lambda functions',
    });

    dbSecurityGroup.addIngressRule(
      lambdaSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow Lambda to connect to RDS'
    );

    // ─── RDS PostgreSQL ───────────────────────────────────────────────────────
    const database = new rds.DatabaseInstance(this, 'BookingsDb', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_16_3,
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSecurityGroup],
      databaseName: 'bookings',
      credentials: rds.Credentials.fromGeneratedSecret('bookings_admin', {
        secretName: 'bookings-engine/db-credentials',
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 50,
      multiAz: false,
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
      backupRetention: cdk.Duration.days(7),
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
    });

    // ─── Lambda Functions ─────────────────────────────────────────────────────
    const commonLambdaProps: Partial<lambda.FunctionProps> = {
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [lambdaSecurityGroup],
      environment: {
        DB_HOST: database.dbInstanceEndpointAddress,
        DB_PORT: database.dbInstanceEndpointPort,
        DB_NAME: 'bookings',
        DB_USER: 'bookings_admin',
        DB_SSL: 'true',
        NODE_OPTIONS: '--enable-source-maps',
      },
    };

    // Grant Lambda access to the DB secret for password retrieval
    const dbSecret = database.secret!;

    const createLambda = (name: string, handlerPath: string): lambda.Function => {
      const fn = new lambda.Function(this, name, {
        ...commonLambdaProps,
        functionName: `bookings-${name.toLowerCase()}`,
        handler: handlerPath,
        code: lambda.Code.fromAsset('../dist'),
      } as lambda.FunctionProps);

      dbSecret.grantRead(fn);
      return fn;
    };

    const tenantFn = createLambda('Tenant', 'handlers/tenant.handler.handler');
    const resourceTypesFn = createLambda('ResourceTypes', 'handlers/resource-types.handler.handler');
    const resourcesFn = createLambda('Resources', 'handlers/resources.handler.handler');
    const servicesFn = createLambda('Services', 'handlers/services.handler.handler');
    const availabilityFn = createLambda('Availability', 'handlers/availability.handler.handler');
    const customersFn = createLambda('Customers', 'handlers/customers.handler.handler');
    const bookingsFn = createLambda('Bookings', 'handlers/bookings.handler.handler');

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

    const jwtAuthorizer = new authorizers.HttpJwtAuthorizer('CognitoAuthorizer', `https://cognito-idp.${this.region}.amazonaws.com/${userPool.userPoolId}`, {
      jwtAudience: [userPoolClient.userPoolClientId],
    });

    // Helper to add routes
    const addRoute = (
      method: apigatewayv2.HttpMethod,
      path: string,
      fn: lambda.Function
    ) => {
      httpApi.addRoutes({
        path: `/v1${path}`,
        methods: [method],
        integration: new integrations.HttpLambdaIntegration(`${method}${path}`, fn),
        authorizer: jwtAuthorizer,
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

    // Resource routes
    addRoute(apigatewayv2.HttpMethod.GET, '/resources', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/resources', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/resources/{id}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/resources/{id}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}/schedules', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.PUT, '/resources/{id}/schedules', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}/overrides', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/resources/{id}/overrides', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/resources/{id}/overrides/{overrideId}', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/resources/{id}/services', resourcesFn);
    addRoute(apigatewayv2.HttpMethod.PUT, '/resources/{id}/services', resourcesFn);

    // Service routes
    addRoute(apigatewayv2.HttpMethod.GET, '/services', servicesFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/services', servicesFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/services/{id}', servicesFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/services/{id}', servicesFn);
    addRoute(apigatewayv2.HttpMethod.DELETE, '/services/{id}', servicesFn);

    // Availability
    addRoute(apigatewayv2.HttpMethod.GET, '/availability', availabilityFn);

    // Customer routes
    addRoute(apigatewayv2.HttpMethod.GET, '/customers', customersFn);
    addRoute(apigatewayv2.HttpMethod.POST, '/customers', customersFn);
    addRoute(apigatewayv2.HttpMethod.GET, '/customers/{id}', customersFn);
    addRoute(apigatewayv2.HttpMethod.PATCH, '/customers/{id}', customersFn);

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
  }
}
