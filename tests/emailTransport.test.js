import nodemailer from "nodemailer";
import { jest } from "@jest/globals";
import {
  resetEmailTransport,
  sendVerificationEmail,
  sendPasswordResetEmail,
} from "../src/utils/email.js";

test("Nodemailer composes both transactional messages with the upgraded transport", async () => {
  const keys = [
    "EMAIL_PROVIDER",
    "RESEND_API_KEY",
    "SMTP_HOST",
    "EMAIL_FROM",
    "EMAIL_REPLY_TO",
  ];
  const previous = Object.fromEntries(
    keys.map((key) => [key, process.env[key]]),
  );
  process.env.EMAIL_PROVIDER = "smtp";
  delete process.env.RESEND_API_KEY;
  process.env.SMTP_HOST = "smtp.example.invalid";
  process.env.EMAIL_FROM = "RIRFIT <sender@example.invalid>";
  process.env.EMAIL_REPLY_TO = "support@example.invalid";
  const transport = nodemailer.createTransport({
    streamTransport: true,
    buffer: true,
    newline: "unix",
  });
  jest.spyOn(nodemailer, "createTransport").mockReturnValue(transport);
  resetEmailTransport();
  try {
    const messages = [
      await sendVerificationEmail({
        email: "athlete@example.invalid",
        name: "Ana",
        verifyUrl: "https://example.invalid/verify?token=test",
      }),
      await sendPasswordResetEmail({
        email: "athlete@example.invalid",
        name: "Ana",
        resetUrl: "https://example.invalid/reset?token=test",
      }),
    ];
    for (const result of messages) {
      expect(result.envelope).toEqual({
        from: "sender@example.invalid",
        to: ["athlete@example.invalid"],
      });
      const mime = result.message.toString();
      expect(mime).toContain("Reply-To: support@example.invalid");
      expect(mime).toContain("Content-Type: multipart/alternative");
      expect(mime).toContain("https://example.invalid/");
    }
  } finally {
    resetEmailTransport();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
