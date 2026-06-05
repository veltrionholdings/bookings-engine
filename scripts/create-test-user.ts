/**
 * Creates a test admin user in Cognito with the correct tenant_id and role attributes.
 * Then authenticates and prints a valid JWT token for API testing.
 *
 * Usage: npx ts-node scripts/create-test-user.ts
 */

import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminSetUserPasswordCommand,
  AdminUpdateUserAttributesCommand,
  InitiateAuthCommand,
} from '@aws-sdk/client-cognito-identity-provider';

const REGION = 'eu-west-1';
const USER_POOL_ID = 'eu-west-1_kzwL1VhJr';
const CLIENT_ID = 'm535i5660f5harvfu6fou0cu9';
const TENANT_ID = 'da8e5df8-f070-4671-a176-590a76c574b2';

const TEST_EMAIL = 'admin@tashair.test';
const TEST_PASSWORD = 'TasHair2025!';

async function createTestUser() {
  const client = new CognitoIdentityProviderClient({ region: REGION });

  console.log('Creating test admin user...\n');

  // Step 1: Create the user
  try {
    await client.send(new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: TEST_EMAIL,
      UserAttributes: [
        { Name: 'email', Value: TEST_EMAIL },
        { Name: 'email_verified', Value: 'true' },
        { Name: 'custom:tenant_id', Value: TENANT_ID },
        { Name: 'custom:role', Value: 'admin' },
      ],
      MessageAction: 'SUPPRESS', // Don't send welcome email
    }));
    console.log('✓ User created');
  } catch (error: any) {
    if (error.name === 'UsernameExistsException') {
      console.log('✓ User already exists, continuing...');
    } else {
      throw error;
    }
  }

  // Step 2: Set a permanent password (skip the force-change flow)
  await client.send(new AdminSetUserPasswordCommand({
    UserPoolId: USER_POOL_ID,
    Username: TEST_EMAIL,
    Password: TEST_PASSWORD,
    Permanent: true,
  }));
  console.log('✓ Password set');

  // Step 3: Ensure custom attributes are set
  await client.send(new AdminUpdateUserAttributesCommand({
    UserPoolId: USER_POOL_ID,
    Username: TEST_EMAIL,
    UserAttributes: [
      { Name: 'custom:tenant_id', Value: TENANT_ID },
      { Name: 'custom:role', Value: 'admin' },
    ],
  }));
  console.log('✓ Attributes set (tenant_id, role)');

  // Step 4: Authenticate to get a JWT token
  const authResult = await client.send(new InitiateAuthCommand({
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: TEST_EMAIL,
      PASSWORD: TEST_PASSWORD,
    },
  }));

  const idToken = authResult.AuthenticationResult?.IdToken;
  const accessToken = authResult.AuthenticationResult?.AccessToken;

  console.log('\n────────────────────────────────────────');
  console.log('🎉 Authentication successful!\n');
  console.log(`Email: ${TEST_EMAIL}`);
  console.log(`Password: ${TEST_PASSWORD}`);
  console.log(`Tenant ID: ${TENANT_ID}`);
  console.log('\n── ID Token (use this for API calls) ──\n');
  console.log(idToken);
  console.log('\n────────────────────────────────────────\n');
  console.log('Test your API with:');
  console.log(`curl -H "Authorization: Bearer <token>" https://hdh82zlkzb.execute-api.eu-west-1.amazonaws.com/v1/services`);
}

createTestUser().catch(err => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
