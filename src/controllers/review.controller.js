const Review = require("../models/review.model");
const ReviewReply = require("../models/reviewReply.model");
const TravelPackage = require("../models/package.model");
const Booking = require("../models/booking.model");
const Agent = require("../models/agent.model");
const User = require("../models/user.model");
const { attachUploads, deleteStoredFiles } = require("../services/media.service");
const { parseUploadList } = require("../utils/mediaPath");
const { parsePagination, buildPaginationMeta } = require("../utils/pagination");

const MIN_COMMENT_LENGTH = 10;
const MAX_COMMENT_LENGTH = 2000;
const MIN_REPLY_LENGTH = 2;
const MAX_REPLY_LENGTH = 1000;

const parseId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const isAdminUser = async (reqUser) => {
  // Uses the DB role since the JWT role can be stale.
  const user = await User.findById(reqUser.id);
  return user?.role === "admin";
};

/** Authors manage their own content; admins can moderate anyone's. */
const canManage = async (ownerId, reqUser) => {
  if (ownerId !== null && ownerId === reqUser.id) return true;
  return isAdminUser(reqUser);
};

/** Replies are limited to admins and the agent who listed the package. */
const canReplyOnPackage = async (pkg, reqUser) => {
  if (await isAdminUser(reqUser)) return true;
  const agent = await Agent.findByUserId(reqUser.id);
  return Boolean(agent && pkg && agent.id === pkg.agent_id);
};

const validateReviewInput = ({ rating, comment }) => {
  const parsedRating = Number(rating);
  if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return { error: "Rating must be a whole number between 1 and 5" };
  }
  const trimmedComment = typeof comment === "string" ? comment.trim() : "";
  if (trimmedComment.length < MIN_COMMENT_LENGTH) {
    return { error: `Review must be at least ${MIN_COMMENT_LENGTH} characters` };
  }
  if (trimmedComment.length > MAX_COMMENT_LENGTH) {
    return { error: `Review must be at most ${MAX_COMMENT_LENGTH} characters` };
  }
  return { rating: parsedRating, comment: trimmedComment };
};

// GET /api/reviews/package/:packageId?page=&limit=
exports.getByPackage = async (req, res) => {
  try {
    const packageId = parseId(req.params.packageId);
    if (!packageId) {
      return res.status(400).json({ message: "Invalid package id" });
    }

    const pkg = await TravelPackage.findById(packageId);
    if (!pkg) {
      return res.status(404).json({ message: "Package not found" });
    }

    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 5, maxLimit: 20 });
    const [summary, reviews, myReview, hasBooked, canReply] = await Promise.all([
      Review.getSummary(packageId),
      Review.findByPackageId(packageId, { limit, offset }),
      Review.findByUserAndPackage(req.user.id, packageId),
      Booking.hasPaidBookingForPackage(req.user.id, packageId),
      canReplyOnPackage(pkg, req.user),
    ]);

    res.status(200).json({
      summary,
      reviews,
      my_review: myReview,
      permissions: {
        can_review: hasBooked && !myReview,
        can_reply: canReply,
      },
      pagination: buildPaginationMeta({ page, limit, total: summary.total }),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/reviews/:id
exports.getById = async (req, res) => {
  try {
    const reviewId = parseId(req.params.id);
    if (!reviewId) {
      return res.status(400).json({ message: "Invalid review id" });
    }

    const review = await Review.findFullById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    res.status(200).json({ review });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// POST /api/reviews/package/:packageId
// Body: rating, comment, media (JSON array of "/media/..." paths from /api/uploads/presign).
// Requires a paid booking. Media sent with a rejected review stays unattached and S3 expires it.
exports.create = async (req, res) => {
  try {
    const packageId = parseId(req.params.packageId);
    if (!packageId) {
      return res.status(400).json({ message: "Invalid package id" });
    }

    const input = validateReviewInput(req.body);
    if (input.error) {
      return res.status(400).json({ message: input.error });
    }

    const mediaPaths = parseUploadList(req.body.media);
    if (!mediaPaths) {
      return res.status(400).json({ message: "media must be a list of uploaded file paths" });
    }

    const userId = req.user.id;

    const pkg = await TravelPackage.findById(packageId);
    if (!pkg || pkg.status !== "published") {
      return res.status(404).json({ message: "Package not found" });
    }

    if (!(await Booking.hasPaidBookingForPackage(userId, packageId))) {
      return res.status(403).json({ message: "Only travellers who booked this package can review it" });
    }

    if (await Review.findByUserAndPackage(userId, packageId)) {
      return res.status(409).json({ message: "You have already reviewed this package" });
    }

    const media = await attachUploads(mediaPaths, { scope: "review-media", userId });

    const reviewId = await Review.create({
      packageId,
      userId,
      guestName: null,
      rating: input.rating,
      comment: input.comment,
      media: media.map((item) => ({
        media_type: item.kind === "video" ? "video" : "image",
        file_path: item.path,
      })),
    });

    const review = await Review.findFullById(reviewId);
    res.status(201).json({ message: "Review submitted", review });
  } catch (err) {
    if (err.statusCode) {
      return res.status(err.statusCode).json({ message: err.message });
    }
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ message: "You have already reviewed this package" });
    }
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// DELETE /api/reviews/:id  (review author or admin)
exports.remove = async (req, res) => {
  try {
    const reviewId = parseId(req.params.id);
    if (!reviewId) {
      return res.status(400).json({ message: "Invalid review id" });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    if (!(await canManage(review.user_id, req.user))) {
      return res.status(403).json({ message: "Access denied" });
    }

    const media = await Review.getMediaByReviewId(reviewId);
    await Review.delete(reviewId);
    await deleteStoredFiles(media.map((item) => item.file_path));

    res.status(200).json({ message: "Review deleted", id: reviewId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// POST /api/reviews/:id/replies  (JSON: comment; admin or the package's agent only)
exports.createReply = async (req, res) => {
  try {
    const reviewId = parseId(req.params.id);
    if (!reviewId) {
      return res.status(400).json({ message: "Invalid review id" });
    }

    const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";
    if (comment.length < MIN_REPLY_LENGTH || comment.length > MAX_REPLY_LENGTH) {
      return res
        .status(400)
        .json({ message: `Reply must be between ${MIN_REPLY_LENGTH} and ${MAX_REPLY_LENGTH} characters` });
    }

    const review = await Review.findById(reviewId);
    if (!review) {
      return res.status(404).json({ message: "Review not found" });
    }

    const pkg = await TravelPackage.findById(review.package_id);
    if (!(await canReplyOnPackage(pkg, req.user))) {
      return res.status(403).json({ message: "Only the admin or the package's travel partner can reply" });
    }

    const replyId = await ReviewReply.create({ reviewId, userId: req.user.id, guestName: null, comment });
    const reply = await ReviewReply.findFullById(replyId);
    res.status(201).json({ message: "Reply posted", reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// DELETE /api/reviews/replies/:replyId  (reply author or admin)
exports.removeReply = async (req, res) => {
  try {
    const replyId = parseId(req.params.replyId);
    if (!replyId) {
      return res.status(400).json({ message: "Invalid reply id" });
    }

    const reply = await ReviewReply.findById(replyId);
    if (!reply) {
      return res.status(404).json({ message: "Reply not found" });
    }

    if (!(await canManage(reply.user_id, req.user))) {
      return res.status(403).json({ message: "Access denied" });
    }

    await ReviewReply.delete(replyId);
    res.status(200).json({ message: "Reply deleted", id: replyId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
