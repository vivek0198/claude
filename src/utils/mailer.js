import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

const transport = config.mail.host
  ? nodemailer.createTransport({
      host: config.mail.host,
      port: config.mail.port,
      secure: config.mail.port === 465,
      auth: config.mail.user ? { user: config.mail.user, pass: config.mail.password } : undefined,
    })
  : null;

/** In the test environment, sent emails are collected here instead of printed. */
const sentMail = [];

/** Sends an email over SMTP, or prints it to the console when SMTP isn't configured. */
async function sendMail({ to, subject, text }) {
  if (config.env === 'test') {
    sentMail.push({ to, subject, text });
    return;
  }
  if (!transport) {
    console.log(
      `\n--- EMAIL (SMTP not configured) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n-----------------------------------\n`
    );
    return;
  }
  await transport.sendMail({ from: config.mail.from, to, subject, text });
}

export { sendMail, sentMail };
