/**
 * Email service for sending booking-related emails via AWS SES.
 *
 * SES must be configured with a verified sender email.
 * In sandbox mode, recipients must also be verified.
 * Request production access in SES console to send to any email.
 */

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const sesClient = new SESClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const DEFAULT_SENDER_EMAIL = process.env.SENDER_EMAIL || 'noreply@veltrion.co.za';

/**
 * Per-tenant sender identity, passed through from the tenant's settings.email.
 * Any field left unset falls back to the platform default.
 */
interface SenderConfig {
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  logoUrl?: string;
  showPlatformFooter?: boolean;
}

/**
 * Renders the email header: the tenant's hosted logo if configured, otherwise
 * the given text title. `titleColor` matches each email type's accent colour.
 */
function emailHeaderHtml(title: string, titleColor: string, sender: SenderConfig): string {
  const logo = sender.logoUrl
    ? `<img src="${sender.logoUrl}" alt="${sender.fromName || ''}" style="max-height: 64px; max-width: 200px; margin: 0 auto 12px; display: block;" />`
    : '';
  return `
      <div style="text-align: center; margin-bottom: 24px;">
        ${logo}
        <h1 style="color: ${titleColor}; font-size: 24px; margin: 0;">${title}</h1>
      </div>`;
}

/**
 * Build the SES `Source` header: "Display Name <address>" when a name is given.
 * RFC 5322 requires the display name be quoted if it contains special chars;
 * we quote unconditionally when present, which is always valid.
 */
function buildSource(sender: SenderConfig): string {
  const email = sender.fromEmail || DEFAULT_SENDER_EMAIL;
  if (sender.fromName) {
    const safeName = sender.fromName.replace(/"/g, '');
    return `"${safeName}" <${email}>`;
  }
  return email;
}

/** The optional "sent via Veltrion" footer line — hidden for white-label tenants. */
function platformFooterHtml(businessName: string, sender: SenderConfig): string {
  if (sender.showPlatformFooter === false) {
    return `<p style="margin-top: 24px; font-size: 12px; color: #aaa; text-align: center;">This email was sent by ${businessName}.</p>`;
  }
  return `<p style="margin-top: 24px; font-size: 12px; color: #aaa; text-align: center;">This email was sent by ${businessName} via Veltrion.</p>`;
}

function platformFooterText(businessName: string, sender: SenderConfig): string {
  return sender.showPlatformFooter === false
    ? `\nThis email was sent by ${businessName}.`
    : `\nThis email was sent by ${businessName} via Veltrion.`;
}

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
  sender?: SenderConfig;
}

/**
 * Send a booking confirmation email to the customer.
 * Fails silently — a failed email should not block the booking.
 */
export async function sendBookingConfirmationEmail(data: BookingConfirmationData): Promise<void> {
  const subject = `Booking Confirmed — ${data.serviceName} at ${data.businessName}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      ${emailHeaderHtml('Booking Confirmed ✓', '#7B2D8B', data.sender || {})}

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

      ${platformFooterHtml(data.businessName, data.sender || {})}
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
${platformFooterText(data.businessName, data.sender || {})}`;

  try {
    const sender = data.sender || {};
    await sesClient.send(new SendEmailCommand({
      Source: buildSource(sender),
      ...(sender.replyTo ? { ReplyToAddresses: [sender.replyTo] } : {}),
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


interface BookingCancellationData {
  customerEmail: string;
  customerName: string;
  serviceName: string;
  date: string;
  time: string;
  businessName: string;
  businessPhone: string;
  cancelledBy: 'customer' | 'admin';
  sender?: SenderConfig;
}

/**
 * Send a cancellation notification email to the customer.
 */
export async function sendBookingCancellationEmail(data: BookingCancellationData): Promise<void> {
  const subject = `Appointment Cancelled — ${data.serviceName} at ${data.businessName}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      ${emailHeaderHtml('Appointment Cancelled', '#E53935', data.sender || {})}

      <p style="color: #333; font-size: 16px;">Hi ${data.customerName},</p>
      <p style="color: #555; font-size: 14px;">
        ${data.cancelledBy === 'admin'
          ? 'Unfortunately, your appointment has been cancelled by the salon.'
          : 'Your appointment has been cancelled as requested.'}
      </p>

      <div style="background: #fef2f2; border-left: 4px solid #E53935; padding: 16px; border-radius: 4px; margin: 20px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #888;">Service</td><td style="padding: 6px 0; text-decoration: line-through;">${data.serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Date</td><td style="padding: 6px 0; text-decoration: line-through;">${data.date}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0; text-decoration: line-through;">${data.time}</td></tr>
        </table>
      </div>

      <p style="font-size: 14px; color: #555;">
        ${data.cancelledBy === 'admin'
          ? 'We apologise for the inconvenience. Please contact us to rebook.'
          : 'You can rebook at any time through the app.'}
      </p>

      <p style="font-size: 13px; color: #888; margin-top: 16px;">📞 ${data.businessPhone}</p>
      ${platformFooterHtml(data.businessName, data.sender || {})}
    </div>
  `;

  const textBody = `Appointment Cancelled\n\nHi ${data.customerName},\n\n${data.cancelledBy === 'admin' ? 'Your appointment has been cancelled by the salon.' : 'Your appointment has been cancelled.'}\n\nService: ${data.serviceName}\nDate: ${data.date}\nTime: ${data.time}\n\n${data.businessPhone}\n${platformFooterText(data.businessName, data.sender || {})}`;

  try {
    const sender = data.sender || {};
    await sesClient.send(new SendEmailCommand({
      Source: buildSource(sender),
      ...(sender.replyTo ? { ReplyToAddresses: [sender.replyTo] } : {}),
      Destination: { ToAddresses: [data.customerEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: htmlBody }, Text: { Data: textBody } },
      },
    }));
    console.log(`Cancellation email sent to ${data.customerEmail}`);
  } catch (err) {
    console.error('Failed to send cancellation email:', err);
  }
}

interface BookingRescheduleData {
  customerEmail: string;
  customerName: string;
  serviceName: string;
  oldDate: string;
  oldTime: string;
  newDate: string;
  newTime: string;
  stylistName: string;
  businessName: string;
  businessPhone: string;
  sender?: SenderConfig;
}

/**
 * Send a reschedule notification email to the customer.
 */
export async function sendBookingRescheduleEmail(data: BookingRescheduleData): Promise<void> {
  const subject = `Appointment Rescheduled — ${data.serviceName} at ${data.businessName}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      ${emailHeaderHtml('Appointment Rescheduled', '#FF9800', data.sender || {})}

      <p style="color: #333; font-size: 16px;">Hi ${data.customerName},</p>
      <p style="color: #555; font-size: 14px;">Your appointment has been rescheduled to a new time.</p>

      <div style="background: #fff3e0; border-left: 4px solid #FF9800; padding: 16px; border-radius: 4px; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; margin: 0 0 8px;">Previously:</p>
        <p style="font-size: 14px; color: #999; text-decoration: line-through; margin: 0;">${data.oldDate} at ${data.oldTime}</p>
      </div>

      <div style="background: #f9f5fb; border-left: 4px solid #7B2D8B; padding: 16px; border-radius: 4px; margin: 20px 0;">
        <p style="font-size: 12px; color: #888; margin: 0 0 8px;">New appointment:</p>
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #888;">Service</td><td style="padding: 6px 0; font-weight: 600;">${data.serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Date</td><td style="padding: 6px 0; font-weight: 600;">${data.newDate}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0; font-weight: 600;">${data.newTime}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Stylist</td><td style="padding: 6px 0; font-weight: 600;">${data.stylistName}</td></tr>
        </table>
      </div>

      <p style="font-size: 13px; color: #666;">If this time doesn't work for you, please contact us to rebook.</p>
      <p style="font-size: 13px; color: #888;">📞 ${data.businessPhone}</p>
      ${platformFooterHtml(data.businessName, data.sender || {})}
    </div>
  `;

  const textBody = `Appointment Rescheduled\n\nHi ${data.customerName},\n\nYour appointment has been moved.\n\nPreviously: ${data.oldDate} at ${data.oldTime}\n\nNew appointment:\nService: ${data.serviceName}\nDate: ${data.newDate}\nTime: ${data.newTime}\nStylist: ${data.stylistName}\n\nIf this doesn't work, contact us: ${data.businessPhone}\n${platformFooterText(data.businessName, data.sender || {})}`;

  try {
    const sender = data.sender || {};
    await sesClient.send(new SendEmailCommand({
      Source: buildSource(sender),
      ...(sender.replyTo ? { ReplyToAddresses: [sender.replyTo] } : {}),
      Destination: { ToAddresses: [data.customerEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: htmlBody }, Text: { Data: textBody } },
      },
    }));
    console.log(`Reschedule email sent to ${data.customerEmail}`);
  } catch (err) {
    console.error('Failed to send reschedule email:', err);
  }
}


interface BookingNoShowData {
  customerEmail: string;
  customerName: string;
  serviceName: string;
  date: string;
  time: string;
  businessName: string;
  businessPhone: string;
  sender?: SenderConfig;
}

/**
 * Send a no-show notification email to the customer.
 */
export async function sendBookingNoShowEmail(data: BookingNoShowData): Promise<void> {
  const subject = `Missed Appointment — ${data.serviceName} at ${data.businessName}`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
      ${emailHeaderHtml('Missed Appointment', '#FF9800', data.sender || {})}

      <p style="color: #333; font-size: 16px;">Hi ${data.customerName},</p>
      <p style="color: #555; font-size: 14px;">
        We noticed you didn't make it to your appointment today. We hope everything is okay.
      </p>

      <div style="background: #fff3e0; border-left: 4px solid #FF9800; padding: 16px; border-radius: 4px; margin: 20px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr><td style="padding: 6px 0; color: #888;">Service</td><td style="padding: 6px 0;">${data.serviceName}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Date</td><td style="padding: 6px 0;">${data.date}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Time</td><td style="padding: 6px 0;">${data.time}</td></tr>
        </table>
      </div>

      <p style="font-size: 14px; color: #555;">
        If you'd like to rebook, you can do so anytime through the app. We'd love to see you!
      </p>

      <p style="font-size: 13px; color: #888; margin-top: 16px;">📞 ${data.businessPhone}</p>
      ${platformFooterHtml(data.businessName, data.sender || {})}
    </div>
  `;

  const textBody = `Missed Appointment\n\nHi ${data.customerName},\n\nWe noticed you didn't make it to your appointment.\n\nService: ${data.serviceName}\nDate: ${data.date}\nTime: ${data.time}\n\nIf you'd like to rebook, you can do so through the app.\n\n${data.businessPhone}\n${platformFooterText(data.businessName, data.sender || {})}`;

  try {
    const sender = data.sender || {};
    await sesClient.send(new SendEmailCommand({
      Source: buildSource(sender),
      ...(sender.replyTo ? { ReplyToAddresses: [sender.replyTo] } : {}),
      Destination: { ToAddresses: [data.customerEmail] },
      Message: {
        Subject: { Data: subject },
        Body: { Html: { Data: htmlBody }, Text: { Data: textBody } },
      },
    }));
    console.log(`No-show email sent to ${data.customerEmail}`);
  } catch (err) {
    console.error('Failed to send no-show email:', err);
  }
}
