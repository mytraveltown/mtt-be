const Faq = require("../models/faq.model");

exports.getByPage = async (req, res) => {
  try {
    const page = req.query.page;
    if (!page || !Faq.isValidPage(page)) {
      return res.status(400).json({ message: "Valid page query is required (about, contact, become_agent)" });
    }

    const faqs = await Faq.findByPage(page, { activeOnly: true });
    res.status(200).json(faqs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getAll = async (req, res) => {
  try {
    const page = req.query.page || null;
    const faqs = await Faq.findAll({ page });
    res.status(200).json(faqs);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    const { page, question, answer, sort_order, is_active } = req.body;

    if (!page || !Faq.isValidPage(page)) {
      return res.status(400).json({ message: "Valid page is required (about, contact, become_agent)" });
    }
    if (!question?.trim() || !answer?.trim()) {
      return res.status(400).json({ message: "Question and answer are required" });
    }

    const id = await Faq.create({
      page,
      question: question.trim(),
      answer: answer.trim(),
      sort_order: sort_order != null ? Number(sort_order) : 0,
      is_active: is_active === false || is_active === 0 ? 0 : 1,
    });

    const faq = await Faq.findById(id);
    res.status(201).json(faq);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const existing = await Faq.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "FAQ not found" });
    }

    const { page, question, answer, sort_order, is_active } = req.body;
    const updates = {};

    if (page != null) {
      if (!Faq.isValidPage(page)) {
        return res.status(400).json({ message: "Invalid page value" });
      }
      updates.page = page;
    }
    if (question != null) updates.question = String(question).trim();
    if (answer != null) updates.answer = String(answer).trim();
    if (sort_order != null) updates.sort_order = Number(sort_order);
    if (is_active != null) updates.is_active = is_active === false || is_active === 0 ? 0 : 1;

    await Faq.update(req.params.id, updates);
    const faq = await Faq.findById(req.params.id);
    res.status(200).json(faq);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const existing = await Faq.findById(req.params.id);
    if (!existing) {
      return res.status(404).json({ message: "FAQ not found" });
    }

    await Faq.delete(req.params.id);
    res.status(200).json({ message: "FAQ deleted" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
