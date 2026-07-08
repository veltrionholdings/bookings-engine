/**
 * Email service for sending booking-related emails via AWS SES.
 *
 * SES must be configured with a verified sender email.
 * In sandbox mode, recipients must also be verified.
 * Request production access in SES console to send to any email.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@veltrion.co.za';

interface BookingConfirmationData {
  customerEmail: string;
  customerName: string;
  serviceName: string;
  date: string; // formatted local date string e.g. "Thursday, 10 July 2025"
  time: string; // e.g. "10:00 – 10:45"
  stylistName: string;
  businessName: string;
  businessAddress: string;
  businessPhone: string;
}

/**
 * Send a booking confirmation email to the customer.
 * Fails silently — a failed email should not block the booking.
 */
export async function sendBookingConfirmationEmail(data: BookingConfirmationData): Promise<void> {
  const subject = `Booking Confirmed — ${data.serviceName} at ${data.businessName}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 24px;">
        <h1 style="color: #7B2D8B; font-size: 24px; margin: 0;">Booking Confirmed ✓</h1>
      </div>

      <p style="color: #333; font-size: 16px;">Hi ${data.customerName},</p>
      <p style="color: #555; font-size: 14px;">Your appointment has been confirmed. Here are the details:</p>

      <div style="background: #f9f5fb; border-left: 4px solid #7B2D8B; padding: 16px; border-radius: 4px; margin: 20px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #888;">Service</td><td style="padding: 6px 0; font-weight: 600;">${data.serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Date</td><td style="padding: 6px 0; font-weight: 600;">${data.date}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0; font-weight: 600;">${data.time}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Stylist</td><td style="padding: 6px 0; font-weight: 600;">${data.stylistName}</td></tr>
        </table>
      </div>

      <div style="margin: 20px 0; padding: 16px; background: #f5f5f5; border-radius: 4px;">
        <p style="margin: 0 0 8px; font-weight: 600; font-size: 14px; color: #333;">${data.businessName}</p>
        <p style="margin: 0 0 4px; font-size: 13px; color: #666;">📍 ${data.businessAddress}</p>
        <p style="margin: 0; font-size: 13px; color: #666;">📞 ${data.businessPhone}</p>
      </div>

      <div style="margin-top: 20px; padding: 12px; background: #fff8e1; border-radius: 4px; font-size: 13px; color: #666;">
        <strong>Reminder:</strong> Please arrive 5 minutes before your appointment. 
        To cancel or reschedule, please do so at least 24 hours in advance.
      </div>

      <p style="margin-top: 24px; font-size: 12px; color: #aaa; text-align: center;">
        This email was sent by ${data.businessName} via Veltrion.
      </p>
    </div>
  `;

  const textBody = `Booking Confirmed

Hi ${data.customerName},

Your appointment has been confirmed:

Service: ${data.serviceName}
Date: ${data.date}
Time: ${data.time}
Stylist: ${data.stylistName}

${data.businessName}
${data.businessAddress}
${data.businessPhone}

Please arrive 5 minutes before your appointment.
To cancel or reschedule, please do so at least 24 hours in advance.
`;

  try {
    await sesClient.send(new SendEmailCommand({
      Source: SENDER_EMAIL,
      Destination: {
        ToAddresses: [data.customerEmail],
      },
      Message: {
        Subject: { Data: subject },
        Body: {
          Html: { Data: htmlBody },
          Text: { Data: textBody },
        },
      },
    }));
    console.log(`Confirmation email sent to ${data.customerEmail}`);
  } catch (err) {
    // Log but don't throw — email failure should not block the booking
    console.error('Failed to send confirmation email:', err);
  }
}
