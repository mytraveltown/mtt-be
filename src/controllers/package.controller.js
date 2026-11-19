const Agent = require("../models/agent.model");
const TravelPackage = require("../models/package.model");
const { deletePackageFull } = require("../services/delete.service");
const { isPaginationRequested, parsePagination } = require("../utils/pagination");
const { LOCATION_DESCRIPTION_MAX_WORDS, countWords } = require("../utils/wordLimit");
const { INTERNATIONAL_MIN_PRICE } = require("../utils/pricing");
const { prepareTextForSave } = require("../services/textRefiner.service");
const { attachUploads, deleteStoredFile } = require("../services/media.service");
const { parseUploadList } = require("../utils/mediaPath");

/**
 * On publish, the location description is polished with AI just like the "Improve with AI" button,
 * so travellers always see clean copy. Drafts are saved as typed. `previous` is the stored text when
 * the package was already published (and so already polished); it lets an unchanged text skip the AI.
 */
const polishDescriptionOnPublish = async (payload, previous = null) => {
  if (payload.status !== "published" || !payload.location_description) return payload;
  const polished = await prepareTextForSave(payload.location_description, "location_description", previous);
  return { ...payload, location_description: polished || null };
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  return ["true", "1", "yes", "on"].includes(String(value).toLowerCase());
};

const parseItinerary = (value) => {
  if (!value) return [];
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.map((day, index) => ({
    day_number: Number(day.day_number ?? index + 1),
    description: day.description || "",
    activities: Array.isArray(day.activities)
      ? day.activities.filter(Boolean)
      : [],
    activity_count: Number(
      day.activity_count ??
        (Array.isArray(day.activities) ? day.activities.filter(Boolean).length : 0)
    ),
    hotel_stars: Number(day.hotel_stars ?? 3),
    meals: day.meals || "",
  }));
};

const GALLERY_FORMAT_ERROR = "gallery must be a list of uploaded file paths";

/**
 * Attaches the gallery paths sent with the form ("/media/..." from /api/uploads/presign)
 * and returns media rows numbered from `startOrder`.
 */
const attachGallery = async (paths, userId, startOrder = 0) => {
  const attached = await attachUploads(paths, { scope: "package-media", userId });
  return attached.map((item, index) => ({
    file_path: item.path,
    media_type: item.kind === "video" ? "video" : "image",
    sort_order: startOrder + index,
  }));
};

const sendError = (res, err) => {
  if (err.statusCode) return res.status(err.statusCode).json({ message: err.message });
  console.error(err);
  return res.status(500).json({ message: "Server error", err: err.message });
};

const buildPackagePayload = (body, statusOverride = null) => {
  const {
    package_type,
    package_name,
    from_location,
    to_location,
    days,
    nights,
    location_description,
    flight_option,
    cab_to_hotel_from,
    cab_from_hotel_to,
  } = body;

  if (!package_name || !from_location || !to_location || days == null || nights == null) {
    return {
      error: "package_name, from_location, to_location, days and nights are required",
    };
  }

  if (countWords(location_description) > LOCATION_DESCRIPTION_MAX_WORDS) {
    return {
      error: `location_description must be ${LOCATION_DESCRIPTION_MAX_WORDS} words or fewer`,
    };
  }

  const packageType = package_type === "international" ? "international" : "domestic";
  const status = statusOverride || (body.status === "published" ? "published" : "draft");
  const price = body.price != null && body.price !== "" ? Number(body.price) : null;

  if (price !== null && (!Number.isFinite(price) || price < 0)) {
    return { error: "price must be a number of 0 or more" };
  }

  // Drafts may be saved without a price, but an international price is never allowed below the minimum.
  if (
    packageType === "international" &&
    ((price !== null && price < INTERNATIONAL_MIN_PRICE) || (price === null && status === "published"))
  ) {
    return {
      error: `International packages must be priced at least ₹${INTERNATIONAL_MIN_PRICE.toLocaleString("en-IN")}`,
    };
  }

  return {
    payload: {
      package_type: packageType,
      visa_required:
        packageType === "international"
          ? parseBoolean(body.visa_required, false)
          : false,
      package_name: String(package_name).trim(),
      from_location: String(from_location).trim(),
      to_location: String(to_location).trim(),
      days: Number(days),
      nights: Number(nights),
      location_description: location_description || null,
      flight_option: flight_option === "included" ? "included" : "excluded",
      cab_to_hotel: parseBoolean(body.cab_to_hotel, true),
      cab_to_hotel_from: ["railway", "airport", "both"].includes(cab_to_hotel_from)
        ? cab_to_hotel_from
        : "both",
      cab_from_hotel: parseBoolean(body.cab_from_hotel, true),
      cab_from_hotel_to: ["railway", "airport", "both"].includes(cab_from_hotel_to)
        ? cab_from_hotel_to
        : "both",
      price,
      status,
    },
  };
};

const getAgentForUser = async (userId) => {
  const agent = await Agent.findByUserId(userId);
  if (!agent) return null;
  return agent;
};

const ensurePackageOwner = async (packageId, user) => {
  const pkg = await TravelPackage.findById(packageId);
  if (!pkg) return { error: "Package not found", status: 404 };

  if (user.role === "admin") {
    return { pkg };
  }

  const agent = await Agent.findByUserId(user.id);
  if (!agent || pkg.agent_id !== agent.id) {
    return { error: "Access denied", status: 403 };
  }

  return { pkg, agent };
};

const attachThumbnails = (packages) => TravelPackage.attachImages(packages);

const parsePrice = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
};

const FLIGHT_OPTIONS = ["included", "excluded"];
const TRANSFER_MODES = ["airport", "railway"];
const VISA_OPTIONS = { required: true, not_required: false };
const AGENT_EXPERIENCE_OPTIONS = [5, 10];

/** Returns `value` when it is one of `allowed`, otherwise null (unknown values are ignored, not errors). */
const pickAllowed = (value, allowed) => (allowed.includes(value) ? value : null);

const parseDurationRange = (duration) => {
  if (duration === "1-3") return { minDays: 1, maxDays: 3 };
  if (duration === "4-7") return { minDays: 4, maxDays: 7 };
  if (duration === "8+") return { minDays: 8, maxDays: null };
  return { minDays: null, maxDays: null };
};

// GET /api/packages
exports.getAll = async (req, res) => {
  try {
    const status = req.query.status === "all" ? null : "published";
    const agentId = req.query.agent_id ? Number(req.query.agent_id) : null;
    const durationRange = parseDurationRange(req.query.duration);

    const hotelStars = req.query.hotel_stars ? Number(req.query.hotel_stars) : null;
    const sort = ["price_asc", "price_desc", "newest"].includes(req.query.sort)
      ? req.query.sort
      : "newest";

    const packages = await TravelPackage.findAll({
      status,
      agentId,
      search: req.query.q?.trim() || null,
      from: req.query.from?.trim() || null,
      to: req.query.to?.trim() || null,
      packageType: req.query.package_type || null,
      minDays:
        req.query.min_days != null
          ? Number(req.query.min_days)
          : durationRange.minDays,
      maxDays:
        req.query.max_days != null
          ? Number(req.query.max_days)
          : durationRange.maxDays,
      minHotelStars: hotelStars && hotelStars >= 1 && hotelStars <= 5 ? hotelStars : null,
      meals: req.query.meals?.trim() || null,
      minPrice: parsePrice(req.query.min_price),
      maxPrice: parsePrice(req.query.max_price),
      flightOption: pickAllowed(req.query.flights, FLIGHT_OPTIONS),
      transferMode: pickAllowed(req.query.transfer, TRANSFER_MODES),
      visaRequired: Object.hasOwn(VISA_OPTIONS, req.query.visa) ? VISA_OPTIONS[req.query.visa] : null,
      minAgentExperience: pickAllowed(Number(req.query.min_experience), AGENT_EXPERIENCE_OPTIONS),
      sortBy: sort,
      pagination: isPaginationRequested(req.query) ? parsePagination(req.query) : null,
    });

    if (Array.isArray(packages)) {
      return res.status(200).json(await attachThumbnails(packages));
    }

    packages.data = await attachThumbnails(packages.data);
    res.status(200).json(packages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/packages/locations?type=from|to&q=del&limit=8&related=<opposite selected location>
exports.getLocations = async (req, res) => {
  try {
    const type = req.query.type === "from" ? "from" : "to";
    const locations = await TravelPackage.findLocations(
      type,
      req.query.q || "",
      req.query.limit,
      req.query.related || ""
    );
    res.status(200).json(locations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/packages/price-range?package_type=domestic|international
exports.getPriceRange = async (req, res) => {
  try {
    const packageType = pickAllowed(req.query.package_type, PACKAGE_TYPES);
    res.status(200).json(await TravelPackage.findPriceRange(packageType));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

const PACKAGE_TYPES = ["domestic", "international"];

// GET /api/packages/type-counts
exports.getTypeCounts = async (_req, res) => {
  try {
    res.status(200).json(await TravelPackage.countByType());
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getTrendingDestinations = async (req, res) => {
  try {
    const limit = req.query.limit ? Number(req.query.limit) : 5;
    const { package_type: packageType } = req.query;
    if (packageType && !PACKAGE_TYPES.includes(packageType)) {
      return res.status(400).json({
        message: `package_type must be one of: ${PACKAGE_TYPES.join(", ")}`,
      });
    }
    const destinations = await TravelPackage.findTrendingDestinations(
      limit,
      packageType || null
    );
    res.status(200).json(destinations);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/packages/mine
exports.getMine = async (req, res) => {
  try {
    const agent = await getAgentForUser(req.user.id);
    if (!agent) {
      return res.status(404).json({ message: "Agent profile not found" });
    }

    const packages = await TravelPackage.findByAgentId(agent.id);
    res.status(200).json(await attachThumbnails(packages));
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/packages/manage
exports.getManageList = async (req, res) => {
  try {
    const status =
      req.query.status === "published" || req.query.status === "draft"
        ? req.query.status
        : null;

    const result = await TravelPackage.findPaginated({
      page: req.query.page,
      limit: req.query.limit,
      search: req.query.q?.trim() || null,
      agentId: req.query.agent_id ? Number(req.query.agent_id) : null,
      status,
    });

    result.data = await attachThumbnails(result.data);
    res.status(200).json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// GET /api/packages/:idOrSlug  (slug for SEO URLs, numeric id kept for legacy links)
exports.getById = async (req, res) => {
  try {
    const packageId = await TravelPackage.resolveId(req.params.id);
    const pkg = packageId ? await TravelPackage.findFullById(packageId) : null;
    if (!pkg) return res.status(404).json({ message: "Package not found" });

    if (pkg.status !== "published") {
      const agent = await getAgentForUser(req.user?.id);
      if (!agent || pkg.agent_id !== agent.id) {
        return res.status(404).json({ message: "Package not found" });
      }
    }

    res.status(200).json(pkg);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// POST /api/packages
exports.create = async (req, res) => {
  try {
    const agent = await getAgentForUser(req.user.id);
    if (!agent) {
      return res.status(404).json({ message: "Agent profile not found" });
    }

    const built = buildPackagePayload(req.body);
    if (built.error) return res.status(400).json({ message: built.error });

    const itinerary = parseItinerary(req.body.itinerary);
    if (!itinerary.length) {
      return res.status(400).json({ message: "At least one itinerary day is required" });
    }

    const galleryPaths = parseUploadList(req.body.gallery);
    if (!galleryPaths) return res.status(400).json({ message: GALLERY_FORMAT_ERROR });
    // Attached before the package exists so a bad file fails the request without a half-saved package.
    const mediaItems = await attachGallery(galleryPaths, req.user.id);

    const payload = await polishDescriptionOnPublish(built.payload);

    const packageId = await TravelPackage.create({
      ...payload,
      slug: await TravelPackage.generateUniqueSlug(built.payload.package_name),
      agent_id: agent.id,
    });

    await TravelPackage.replaceItinerary(packageId, itinerary);

    if (mediaItems.length) {
      await TravelPackage.addMedia(packageId, mediaItems);
    }

    const created = await TravelPackage.findFullById(packageId);
    res.status(201).json(created);
  } catch (err) {
    sendError(res, err);
  }
};

// PUT /api/packages/:id
exports.update = async (req, res) => {
  try {
    const ownership = await ensurePackageOwner(req.params.id, req.user);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    const built = buildPackagePayload(req.body);
    if (built.error) return res.status(400).json({ message: built.error });

    const galleryPaths = parseUploadList(req.body.gallery);
    if (!galleryPaths) return res.status(400).json({ message: GALLERY_FORMAT_ERROR });
    // New files go after the current gallery; attached first so a bad file changes nothing.
    const currentMedia = galleryPaths.length ? await TravelPackage.getMedia(req.params.id) : [];
    const newMediaItems = await attachGallery(galleryPaths, req.user.id, currentMedia.length);

    const { pkg: existing } = ownership;
    const payload = await polishDescriptionOnPublish(
      built.payload,
      existing.status === "published" ? existing.location_description : null
    );
    const nameChanged = existing.package_name !== payload.package_name;
    const slug =
      nameChanged || !existing.slug
        ? await TravelPackage.generateUniqueSlug(payload.package_name, existing.id)
        : existing.slug;

    await TravelPackage.update(req.params.id, { ...payload, slug });

    if (req.body.itinerary !== undefined) {
      const itinerary = parseItinerary(req.body.itinerary);
      if (!itinerary.length) {
        return res.status(400).json({ message: "At least one itinerary day is required" });
      }
      await TravelPackage.replaceItinerary(req.params.id, itinerary);
    }

    if (newMediaItems.length) {
      await TravelPackage.addMedia(req.params.id, newMediaItems);
    }

    const updated = await TravelPackage.findFullById(req.params.id);
    res.status(200).json(updated);
  } catch (err) {
    sendError(res, err);
  }
};

// DELETE /api/packages/:id
exports.delete = async (req, res) => {
  try {
    const ownership = await ensurePackageOwner(req.params.id, req.user);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    await deletePackageFull(req.params.id);
    res.status(200).json({ message: "Package deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// DELETE /api/packages/:id/media/:mediaId
exports.deleteMedia = async (req, res) => {
  try {
    const ownership = await ensurePackageOwner(req.params.id, req.user);
    if (ownership.error) {
      return res.status(ownership.status).json({ message: ownership.error });
    }

    const media = await TravelPackage.getMedia(req.params.id);
    const target = media.find((item) => String(item.id) === String(req.params.mediaId));
    if (!target) {
      return res.status(404).json({ message: "Media not found" });
    }

    await TravelPackage.deleteMediaByIds([target.id]);
    await deleteStoredFile(target.file_path);

    res.status(200).json({ message: "Media deleted successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

// Exported for unit tests.
exports.buildPackagePayload = buildPackagePayload;
