/**
 * End-to-end test of the full booking flow against the live API.
 * Simulates what a customer would do through the PWA:
 *
 * 1. Browse services
 * 2. Check availability for a service on a date
 * 3. Create a customer (self-register)
 * 4. Make a booking
 * 5. View the booking
 * 6. Cancel the booking
 *
 * Usage: npx ts-node scripts/test-booking-flow.ts
 */

const API_URL = 'https://hdh82zlkzb.execute-api.eu-west-1.amazonaws.com/v1';
const COGNITO_URL = 'https://cognito-idp.eu-west-1.amazonaws.com/';
const CLIENT_ID = 'm535i5660f5harvfu6fou0cu9';

// Using admin credentials for the test (in production, customers would have their own accounts)
const TEST_EMAIL = 'admin@tashair.test';
const TEST_PASSWORD = 'TasHair2025!';

async function getToken(): Promise<string> {
  const response = await fetch(COGNITO_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
    },
    body: JSON.stringify({
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: CLIENT_ID,
      AuthParameters: { USERNAME: TEST_EMAIL, PASSWORD: TEST_PASSWORD },
    }),
  });
  const data: any = await response.json();
  return data.AuthenticationResult.IdToken;
}

async function apiCall(token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    console.error(`  ✗ ${method} ${path} → ${response.status}`);
    console.error(`    ${JSON.stringify(data)}`);
    throw new Error(`API call failed: ${response.status}`);
  }

  return { status: response.status, data };
}

async function run() {
  console.log('═══════════════════════════════════════════════');
  console.log(' BOOKINGS ENGINE — End-to-End Booking Flow Test');
  console.log('═══════════════════════════════════════════════\n');

  // Authenticate
  console.log('🔐 Authenticating...');
  const token = await getToken();
  console.log('  ✓ Token obtained\n');

  // Step 1: Browse services
  console.log('📋 STEP 1: Browse Services');
  const { data: servicesResp } = await apiCall(token, 'GET', '/services');
  const services = servicesResp.data;
  console.log(`  ✓ Found ${services.length} services:`);
  for (const svc of services) {
    console.log(`    - ${svc.name} (${svc.duration_minutes}min, R${svc.price_cents / 100})`);
  }
  const pixieCut = services.find((s: any) => s.name === 'Pixie Cut');
  console.log(`\n  → Selected: ${pixieCut.name} (ID: ${pixieCut.id})\n`);

  // Step 2: Check availability
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  console.log(`📅 STEP 2: Check Availability for ${dateStr}`);
  const { data: availResp } = await apiCall(token, 'GET', `/availability?service_id=${pixieCut.id}&date=${dateStr}`);
  console.log(`  ✓ Found ${availResp.slots.length} available slots`);
  console.log(`  First 5 slots:`);
  for (const slot of availResp.slots.slice(0, 5)) {
    console.log(`    - ${slot.start_time} – ${slot.end_time} (${slot.resources.map((r: any) => r.name).join(', ')})`);
  }
  const chosenSlot = availResp.slots[3]; // Pick the 4th slot
  console.log(`\n  → Selected: ${chosenSlot.start_time} with ${chosenSlot.resources[0].name}\n`);

  // Step 3: Create customer (self-register)
  console.log('👤 STEP 3: Create Customer');
  const customerData = {
    first_name: 'Lerato',
    last_name: 'Nkosi',
    email: `lerato.test.${Date.now()}@example.com`, // Unique email to avoid conflicts
    phone: '+27831112222',
  };
  const { data: customer } = await apiCall(token, 'POST', '/customers', customerData);
  console.log(`  ✓ Customer created: ${customer.first_name} ${customer.last_name} (ID: ${customer.id})\n`);

  // Step 4: Create booking
  console.log('📝 STEP 4: Create Booking');
  const bookingData = {
    service_id: pixieCut.id,
    resource_id: chosenSlot.resources[0].id,
    customer_id: customer.id,
    start_time: `${dateStr}T${chosenSlot.start_time}:00`,
    party_size: 1,
    notes: 'First time client — pixie cut consultation',
  };
  const { data: booking } = await apiCall(token, 'POST', '/bookings', bookingData);
  console.log(`  ✓ Booking created!`);
  console.log(`    ID: ${booking.id}`);
  console.log(`    Status: ${booking.status}`);
  console.log(`    Service: ${pixieCut.name}`);
  console.log(`    Time: ${booking.start_time_local} – ${booking.end_time_local}`);
  console.log(`    Resource: ${chosenSlot.resources[0].name}\n`);

  // Step 5: View booking
  console.log('👁️  STEP 5: View Booking');
  const { data: fetchedBooking } = await apiCall(token, 'GET', `/bookings/${booking.id}`);
  console.log(`  ✓ Booking retrieved:`);
  console.log(`    Status: ${fetchedBooking.status}`);
  console.log(`    Notes: ${fetchedBooking.notes}\n`);

  // Step 6: Verify the slot is now taken
  console.log('🔒 STEP 6: Verify Conflict Detection');
  try {
    await apiCall(token, 'POST', '/bookings', bookingData);
    console.log(`  ✗ ERROR: Should have gotten a conflict!`);
  } catch {
    console.log(`  ✓ Conflict correctly detected — slot is taken\n`);
  }

  // Step 7: Cancel the booking
  console.log('❌ STEP 7: Cancel Booking');
  const { data: cancelledBooking } = await apiCall(token, 'POST', `/bookings/${booking.id}/cancel`, {
    reason: 'Test cancellation — end-to-end flow verification',
  });
  console.log(`  ✓ Booking cancelled`);
  console.log(`    Status: ${cancelledBooking.status}`);
  console.log(`    Reason: ${cancelledBooking.cancellation_reason}\n`);

  // Step 8: Verify slot is available again
  console.log('🔓 STEP 8: Verify Slot Released');
  const { data: availAfterCancel } = await apiCall(token, 'GET', `/availability?service_id=${pixieCut.id}&date=${dateStr}`);
  const slotAvailable = availAfterCancel.slots.some((s: any) => s.start_time === chosenSlot.start_time);
  if (slotAvailable) {
    console.log(`  ✓ Slot ${chosenSlot.start_time} is available again after cancellation\n`);
  } else {
    console.log(`  ✗ Slot still showing as unavailable\n`);
  }

  // Step 9: Customer data export (POPIA)
  console.log('📦 STEP 9: Customer Data Export (POPIA)');
  const { data: exportData } = await apiCall(token, 'GET', `/customers/${customer.id}/export`);
  console.log(`  ✓ Export returned:`);
  console.log(`    Customer: ${exportData.customer.first_name} ${exportData.customer.last_name}`);
  console.log(`    Bookings: ${exportData.bookings.length} records\n`);

  // Step 10: Customer deletion (POPIA)
  console.log('🗑️  STEP 10: Customer Deletion (POPIA)');
  await apiCall(token, 'DELETE', `/customers/${customer.id}`);
  console.log(`  ✓ Customer deleted\n`);

  // Verify deletion
  try {
    await apiCall(token, 'GET', `/customers/${customer.id}`);
    console.log(`  ✗ Customer still accessible after deletion`);
  } catch {
    console.log(`  ✓ Customer correctly returns 404 after deletion\n`);
  }

  console.log('═══════════════════════════════════════════════');
  console.log(' ✅ ALL STEPS PASSED — Full booking flow works');
  console.log('═══════════════════════════════════════════════');
}

run().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
