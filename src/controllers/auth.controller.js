const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const User = require("../models/user.model");
const Agent = require("../models/agent.model");
const jwt = require("jsonwebtoken");
const otpService = require("../services/otp.service");
const sanitizeUser = (user) => {
  if (!user) return null;
  const { password, ...safeUser } = user;
  return safeUser;
};

const signToken = (user) =>
  jwt.sign(
    { id: user.id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRATION }
  );

const normalizePhone = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};

const isGuestAccountEmail = (email) =>
  /^guest_\d{10}@mytraveltown\.local$/i.test(String(email || "").trim());

const resolveUserByPhone = async (phone) => {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    return { error: "Valid phone number is required" };
  }

  const user = await User.findByPhone(normalized);
  if (!user) return { error: "No account found with this phone number" };

  return {
    user,
    channel: "phone",
    identifier: user.phone || normalized,
  };
};

const findOrCreateGuestByPhone = async (phone) => {
  const normalized = normalizePhone(phone);
  if (normalized.length < 10) {
    return { error: "Valid phone number is required" };
  }

  let user = await User.findByPhone(normalized);
  if (user) {
    if (!user.phone) {
      await User.update(user.id, { phone: normalized });
      user = await User.findById(user.id);
    }
    return {
      user,
      channel: "phone",
      identifier: user.phone || normalized,
      isNew: false,
    };
  }

  const placeholderEmail = `guest_${normalized}@mytraveltown.local`;
  const existingEmail = await User.findByEmail(placeholderEmail);
  if (existingEmail) {
    user = existingEmail;
    if (!user.phone) {
      await User.update(user.id, { phone: normalized });
      user = await User.findById(user.id);
    }
    return {
      user,
      channel: "phone",
      identifier: user.phone || normalized,
      isNew: false,
    };
  }

  const hashedPassword = await bcrypt.hash(crypto.randomUUID(), 10);
  const userId = await User.create({
    name: "Guest User",
    email: placeholderEmail,
    phone: normalized,
    password: hashedPassword,
    role: "user",
  });

  user = await User.findById(userId);
  return {
    user,
    channel: "phone",
    identifier: normalized,
    isNew: true,
  };
};

exports.register = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    const existingUser = await User.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = await User.create({
      name,
      email,
      password: hashedPassword,
      role: "user",
    });

    const user = await User.findById(userId);
    res.status(201).json(sanitizeUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.myProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.status(200).json(sanitizeUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, phone, age, gender } = req.body;

    const existingUser = await User.findById(userId);
    if (!existingUser) return res.status(404).json({ message: "User not found" });

    const updates = {
      name,
      email,
      phone,
      age: age === "" || age == null ? null : age,
      gender: gender === "" || gender == null ? null : gender,
    };

    if (req.file) {
      if (existingUser.profile?.startsWith("/uploads/users/")) {
        const oldPath = path.join(
          __dirname,
          "../..",
          existingUser.profile.replace(/^\//, "")
        );
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      updates.profile = `/uploads/users/${req.file.filename}`;
    }

    await User.update(userId, updates);

    if(existingUser.role == 'agent' && existingUser.name != name){
      await Agent.updateByUserId(existingUser.id, { verification_status : 'pending' });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    res.status(200).json(sanitizeUser(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured" });
    }

    const user = await User.findByEmail(email);
    if (!user) return res.status(400).json({ message: "Email not found" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Incorrect password" });

    const token = signToken(user);

    res.json({
      token,
      user: sanitizeUser(user),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

exports.sendLoginOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const resolved = await findOrCreateGuestByPhone(phone);

    if (resolved.error) {
      return res.status(400).json({ message: resolved.error });
    }

    const result = await otpService.createAndSend({
      userId: resolved.user.id,
      channel: resolved.channel,
      identifier: resolved.identifier,
    });

    res.status(200).json({
      message: resolved.isNew
        ? "Welcome! We created your guest account. OTP sent to your phone."
        : "OTP sent to your phone",
      channel: resolved.channel,
      isNew: resolved.isNew,
      expiresIn: result.expiresIn,
      ...(result.debugOtp ? { debugOtp: result.debugOtp } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send OTP", err: err.message });
  }
};

exports.phoneUpdate = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({
        message: "Phone number is required.",
      });
    }

    // Check if phone already belongs to another user
    const existingUser = await User.findByPhone(phone);

    if (existingUser && existingUser.id !== req.user.id) {
      return res.status(400).json({
        message: "Phone already exists in another account.",
      });
    }

    const user = req.user;

    const result = await otpService.createAndSend({
      userId: user.id,
      channel: "phone",
      identifier: phone,
    });

    return res.status(200).json({
      message: "OTP sent successfully.",
      channel: "phone",
      expiresIn: result.expiresIn,
      ...(result.debugOtp && { debugOtp: result.debugOtp }),
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Failed to send OTP",
      error: err.message,
    });
  }
};

exports.verifyPhoneUpdate = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    const user = req.user;

    const isValid = await otpService.verify(user.id, String(otp).trim());
    if (!isValid) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    await User.update(user.id, { phone });

    const updatedUser = await User.findById(user.id);

    res.json({
      message: "Phone number updated successfully.",
      user: updatedUser,
    });

  } catch (err) {
    res.status(400).json({
      message: err.message,
    });
  }
};

exports.verifyLoginOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }

    const resolved = await resolveUserByPhone(phone);
    if (resolved.error) {
      return res.status(404).json({ message: resolved.error });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured" });
    }

    const isValid = await otpService.verify(resolved.user.id, String(otp).trim());
    if (!isValid) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const user = await User.findById(resolved.user.id);
    const token = signToken(user);

    res.json({
      token,
      user: sanitizeUser(user),
      message: "Login successful",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to verify OTP", err: err.message });
  }
};

exports.sendResetOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const resolved = await resolveUserByPhone(phone);

    if (resolved.error) {
      return res
        .status(404)
        .json({ message: "No account found with this phone number" });
    }

    const result = await otpService.createAndSend({
      userId: resolved.user.id,
      channel: resolved.channel,
      identifier: resolved.identifier,
      purpose: "reset",
    });

    res.status(200).json({
      message: "OTP sent to your phone for password reset",
      channel: resolved.channel,
      expiresIn: result.expiresIn,
      ...(result.debugOtp ? { debugOtp: result.debugOtp } : {}),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to send OTP", err: err.message });
  }
};

exports.resetPasswordWithOtp = async (req, res) => {
  try {
    const { phone, otp, newPassword } = req.body;

    if (!otp) {
      return res.status(400).json({ message: "OTP is required" });
    }
    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }
    if (String(newPassword).length < 8) {
      return res
        .status(400)
        .json({ message: "Password must be at least 8 characters" });
    }

    const resolved = await resolveUserByPhone(phone);
    if (resolved.error) {
      return res
        .status(404)
        .json({ message: "No account found with this phone number" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured" });
    }

    const isValid = await otpService.verify(
      resolved.user.id,
      String(otp).trim()
    );
    if (!isValid) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updatePassword(resolved.user.id, hashedPassword);

    const user = await User.findById(resolved.user.id);
    const token = signToken(user);

    res.json({
      token,
      user: sanitizeUser(user),
      message: "Password reset successful",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Failed to reset password", err: err.message });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!newPassword) {
      return res.status(400).json({ message: "New password is required" });
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    const isGuestAccount = isGuestAccountEmail(user.email);

    if (!isGuestAccount) {
      if (!oldPassword) {
        return res
          .status(400)
          .json({ message: "Both old and new password required" });
      }

      const isMatch = await bcrypt.compare(oldPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: "Old password is incorrect" });
      }
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await User.updatePassword(user.id, hashedPassword);

    res.json({
      message: isGuestAccount
        ? "Password set successfully"
        : "Password changed successfully",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", error: err });
  }
};