const Contact = require("../models/contact.model");
const { sendMail } = require("../utils/mailer");
const { isPaginationRequested, parsePagination } = require("../utils/pagination");

const parsePhone = (value) => {
  const digits = String(value).replace(/\D/g, "");
  if (!digits) return null;
  const phone = Number(digits);
  if (!Number.isFinite(phone) || phone <= 0) return null;
  return phone;
};

// POST /api/contacts
exports.create = async (req, res) => {
  try {
    const { name, message, phone, subject , email } = req.body;

    if (!name?.trim() || !message?.trim() || !subject?.trim() || !email?.trim() || phone == null || phone === "") {
      return res.status(400).json({
        message: "Name, phone, subject, and message are required",
      });
    }

    const parsedPhone = parsePhone(phone);
    if (!parsedPhone) {
      return res.status(400).json({ message: "Valid phone number is required" });
    }

    const trimmedMessage = String(message).trim();
    if (trimmedMessage.length > 255) {
      return res.status(400).json({ message: "Message must be 255 characters or less" });
    }

    const id = await Contact.create({
      name: String(name).trim(),
      message: trimmedMessage,
      phone: parsedPhone,
      email: email,
      subject: String(subject).trim(),
    });

    const contact = await Contact.findById(id);
    // Send email to admin
    await sendMail({
      to: "support@mytraveltown.com",
      subject: `New Contact Query - ${subject}`,
      html: `
    <h2>New Contact Form Submission</h2>

    <table border="1" cellpadding="8" cellspacing="0">
      <tr>
        <td><strong>Name</strong></td>
        <td>${name}</td>
      </tr>
      <tr>
        <td><strong>Email</strong></td>
        <td>${email}</td>
      </tr>
      <tr>
        <td><strong>Phone</strong></td>
        <td>${phone}</td>
      </tr>
      <tr>
        <td><strong>Subject</strong></td>
        <td>${subject}</td>
      </tr>
      <tr>
        <td><strong>Message</strong></td>
        <td>${message}</td>
      </tr>
    </table>
  `,
    });

    // Send confirmation email to user
    await sendMail({
      to: email,
      subject: "We've received your query | MyTravelTown",
      html: `<h2>Hello ${name},</h2>
            <p>
              Thank you for contacting <strong>MyTravelTown</strong>.
              We have received your query and our support team will get back to you shortly.
            </p>
            <hr>
            <p><strong>Subject:</strong> ${subject}</p>
            <p><strong>Your Message:</strong></p>
            <p>${message}</p>
            <br>
            <p>Regards,<br>
            MyTravelTown Support Team</p> `,
    });

    res.status(201).json(contact);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/contacts
exports.getAll = async (req, res) => {
  try {
    if (isPaginationRequested(req.query)) {
      return res.status(200).json(await Contact.findPaginated(parsePagination(req.query)));
    }
    const contacts = await Contact.findAll();
    res.status(200).json(contacts);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/contacts/:id
exports.getById = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }
    res.status(200).json(contact);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// DELETE /api/contacts/:id
exports.remove = async (req, res) => {
  try {
    const contact = await Contact.findById(req.params.id);
    if (!contact) {
      return res.status(404).json({ message: "Contact not found" });
    }

    await Contact.delete(req.params.id);
    res.status(200).json({ message: "Contact deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
