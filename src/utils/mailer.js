const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    secure: process.env.SMTP_SECURE === "true",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const sendMail = async ({ to, subject, html, text }) => {
    await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to,
        subject,
        text,
        html,
    });
};

module.exports = { sendMail };