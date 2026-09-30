# Tas Hair & Beauty Cafe — App Testing Guide

Thank you for taking the time to test your new booking app before it goes live.
This guide gives you everything you need: where to go, the test logins, what each
type of user can do, and what to expect from the booking emails.

This is a **test version**. Nothing here affects real customers yet — it's a safe
space to click around, make test bookings, and tell us what you think.

---

## Where to go

Open this link on your phone or computer (Chrome or Safari recommended):

**https://tas-hair-app.vercel.app**

Tip: on your phone you can "Add to Home Screen" so it behaves like a real app.

---

## Your test logins

There are three kinds of users. Use the logins below to explore each one.

### 1. Admin (the owner's view) — full control
- **Login:** `admin@tashair.test`
- **Password:** `TasHair2025!`

**What the admin can do:**
- See the **dashboard** (overview of bookings and the day)
- View and manage **all bookings** (confirm, cancel, reschedule, mark no-show)
- Manage the **services menu** (add/edit services, prices, durations, categories)
- Manage **staff** (add stylists/receptionists, set their working hours)
- Manage **stylists** and which services each one offers
- Create a **new booking** on behalf of a customer
- Look up **customers** and view their history
- See **reports** and **business profile / settings**

**Flows this affects:** everything. When the admin cancels or reschedules a
booking, the customer gets an email about it.

### 2. Employee (a stylist / receptionist) — day-to-day work
- **Login:** `jane.stylist@tashair.test`
- **Password:** `TasHair2025!`

**What an employee can do:**
- See **their day** and their own **schedule**
- View the **bookings** assigned to them
- Capture a **walk-in** customer
- Create a **new booking**
- Look up **customers**

**Flows this affects:** an employee managing a booking triggers the same customer
emails as the admin.

### 3. Customer (your clients' view) — booking appointments
For the customer experience, please **create your own account** so you also get to
try the sign-up + email flow:

- On the app, tap **Sign up** and register using **`tasmotswako@gmail.com`**
- You'll receive a **verification code by email** — enter it to confirm the account
- Then sign in and book an appointment

> Please use **tasmotswako@gmail.com** for customer testing. During this test
> phase, booking emails can only be delivered to approved addresses, and that one
> is approved. Bookings made with any other email address will still work, but the
> email won't arrive.

**What a customer can do:**
- Browse **services** (now grouped: Relaxer, Treatment, Wig, Cut)
- **Book** an appointment (pick a service, stylist, date and time)
- See **My Bookings** and **cancel** if needed
- Manage their **profile** and marketing-email preference

**Flows this affects:** making, and cancelling, their own bookings — each sends
the customer an email.

---

## What to expect from the emails

When a booking is **made, cancelled, rescheduled, or marked as a no-show**, the
customer receives an email. During this test phase:

- Emails are delivered to **tasmotswako@gmail.com** (and other approved test
  addresses). This is a testing safeguard and will be lifted when you go live.
- The email shows **your Tas Hair logo** and branding, and the sender name reads
  **"Tas Hair & Beauty Cafe"**.
- The sender **address** currently shows a temporary Veltrion email. When you go
  live with your own domain (e.g. `tashair.co.za`), emails will come from your own
  address (e.g. `bookings@tashair.co.za`). This is part of the go-live setup.
- If the logo doesn't show at first, tap **"Display images below"** in Gmail — some
  email apps hide images from new senders until you allow them.

Things to try:
1. As the customer, **make a booking** → check for the confirmation email.
2. As the customer, **cancel** that booking → check for the cancellation email.
3. As the admin, **reschedule** a customer booking → check for the reschedule email.

---

## What is NOT part of this test yet

So there are no surprises, these are intentionally switched on **only at go-live**:

- **"Continue with Google" sign-in** — built, but turned on at go-live.
- **Emails from your own domain** — currently a temporary sender; switches to your
  domain once it's registered and set up.
- **Emails to any customer** — during testing, only approved addresses receive
  email. After go-live, every customer receives theirs automatically.
- Your own **web address / custom domain** for the app.

These are covered in the go-live setup once you're happy with the app.

---

## How to give feedback

As you test, note anything that's confusing, missing, or that you'd like changed —
prices, service names, wording, the booking steps, anything. Send the list back and
we'll work through it before go-live.
