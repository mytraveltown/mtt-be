const db = require("../config/db");
const { buildPaginationMeta } = require("../utils/pagination");
const { slugify, isNumericId } = require("../utils/slug");

class TravelPackage {
  static parseDay(day) {
    if (!day) return null;
    let activities = day.activities;
    if (typeof activities === "string") {
      try {
        activities = JSON.parse(activities);
      } catch {
        activities = [];
      }
    }
    return { ...day, activities: activities || [] };
  }

  static parsePackage(row) {
    if (!row) return null;
    return {
      ...row,
      price: row.price != null ? Number(row.price) : null,
      visa_required: !!row.visa_required,
      cab_to_hotel: !!row.cab_to_hotel,
      cab_from_hotel: !!row.cab_from_hotel,
    };
  }

  static async attachDetails(pkg) {
    if (!pkg) return null;
    const [days] = await db.query(
      "SELECT * FROM travel_package_day WHERE package_id = ? ORDER BY day_number ASC",
      [pkg.id]
    );
    const [media] = await db.query(
      "SELECT * FROM travel_package_media WHERE package_id = ? ORDER BY sort_order ASC, id ASC",
      [pkg.id]
    );
    return {
      ...pkg,
      itinerary: days.map(TravelPackage.parseDay),
      media,
    };
  }

  static async findAll({
    status = "published",
    agentId = null,
    search = null,
    from = null,
    to = null,
    packageType = null,
    minDays = null,
    maxDays = null,
    minHotelStars = null,
    meals = null,
    minPrice = null,
    maxPrice = null,
    flightOption = null,
    transferMode = null,
    visaRequired = null,
    minAgentExperience = null,
    sortBy = "newest",
    pagination = null,
  } = {}) {
    let sql = `
      FROM travel_package p
      JOIN agent a ON a.id = p.agent_id
      JOIN users u ON u.id = a.user_id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      sql += " AND p.status = ?";
      params.push(status);
    }
    if (agentId) {
      sql += " AND p.agent_id = ?";
      params.push(agentId);
    }
    if (search) {
      const term = `%${search}%`;
      sql += ` AND (
        p.package_name LIKE ?
        OR p.from_location LIKE ?
        OR p.to_location LIKE ?
        OR p.location_description LIKE ?
        OR a.company_name LIKE ?
      )`;
      params.push(term, term, term, term, term);
    }
    if (from) {
      sql += " AND p.from_location LIKE ?";
      params.push(`%${from}%`);
    }
    if (to) {
      sql += " AND p.to_location LIKE ?";
      params.push(`%${to}%`);
    }
    if (packageType) {
      sql += " AND p.package_type = ?";
      params.push(packageType);
    }
    if (minDays != null) {
      sql += " AND p.days >= ?";
      params.push(minDays);
    }
    if (maxDays != null) {
      sql += " AND p.days <= ?";
      params.push(maxDays);
    }
    if (minHotelStars != null) {
      sql += ` AND EXISTS (
        SELECT 1 FROM travel_package_day d
        WHERE d.package_id = p.id AND d.hotel_stars >= ?
      )`;
      params.push(minHotelStars);
    }
    if (minPrice != null) {
      sql += " AND p.price >= ?";
      params.push(minPrice);
    }
    if (maxPrice != null) {
      sql += " AND p.price <= ?";
      params.push(maxPrice);
    }
    if (meals) {
      sql += ` AND EXISTS (
        SELECT 1 FROM travel_package_day d
        WHERE d.package_id = p.id AND d.meals = ?
      )`;
      params.push(meals);
    }
    if (flightOption) {
      sql += " AND p.flight_option = ?";
      params.push(flightOption);
    }
    if (transferMode) {
      // Both pickup and drop must cover the mode; "both" covers airport and railway.
      sql += ` AND p.cab_to_hotel = 1 AND p.cab_to_hotel_from IN (?, 'both')
               AND p.cab_from_hotel = 1 AND p.cab_from_hotel_to IN (?, 'both')`;
      params.push(transferMode, transferMode);
    }
    if (visaRequired != null) {
      sql += " AND p.package_type = 'international' AND p.visa_required = ?";
      params.push(visaRequired ? 1 : 0);
    }
    if (minAgentExperience != null) {
      sql += " AND a.experience >= ?";
      params.push(minAgentExperience);
    }

    const sortMap = {
      price_asc: "p.price IS NULL, p.price ASC, p.created_at DESC",
      price_desc: "p.price IS NULL, p.price DESC, p.created_at DESC",
      newest: "p.created_at DESC",
    };
    const selectSql = "SELECT p.*, a.company_name AS agent_company, u.name AS agent_name";
    const orderSql = ` ORDER BY ${sortMap[sortBy] || sortMap.newest}`;

    if (!pagination) {
      const [rows] = await db.query(`${selectSql} ${sql} ${orderSql}`, params);
      return rows.map(TravelPackage.parsePackage);
    }

    const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total ${sql}`, params);
    const [rows] = await db.query(
      `${selectSql} ${sql} ${orderSql}, p.id DESC LIMIT ? OFFSET ?`,
      [...params, pagination.limit, pagination.offset]
    );
    return {
      data: rows.map(TravelPackage.parsePackage),
      pagination: buildPaginationMeta({
        page: pagination.page,
        limit: pagination.limit,
        total: Number(total),
      }),
    };
  }

  static async findPaginated({
    page = 1,
    limit = 10,
    search = null,
    agentId = null,
    status = null,
  } = {}) {
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 10));
    const offset = (safePage - 1) * safeLimit;

    let where = "WHERE 1=1";
    const params = [];

    if (status) {
      where += " AND p.status = ?";
      params.push(status);
    }
    if (agentId) {
      where += " AND p.agent_id = ?";
      params.push(agentId);
    }
    if (search) {
      const term = `%${search}%`;
      where += ` AND (
        p.package_name LIKE ?
        OR p.from_location LIKE ?
        OR p.to_location LIKE ?
        OR a.company_name LIKE ?
        OR u.name LIKE ?
      )`;
      params.push(term, term, term, term, term);
    }

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total
       FROM travel_package p
       JOIN agent a ON a.id = p.agent_id
       JOIN users u ON u.id = a.user_id
       ${where}`,
      params
    );

    const [rows] = await db.query(
      `SELECT p.*, a.company_name AS agent_company, u.name AS agent_name
       FROM travel_package p
       JOIN agent a ON a.id = p.agent_id
       JOIN users u ON u.id = a.user_id
       ${where}
       ORDER BY a.company_name ASC, p.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, safeLimit, offset]
    );

    return {
      data: rows.map(TravelPackage.parsePackage),
      pagination: {
        page: safePage,
        limit: safeLimit,
        total: Number(total),
        totalPages: Math.ceil(Number(total) / safeLimit) || 1,
      },
    };
  }

  static async findById(id) {
    const [[row]] = await db.query(
      `SELECT p.*, a.company_name AS agent_company, u.name AS agent_name
       FROM travel_package p
       JOIN agent a ON a.id = p.agent_id
       JOIN users u ON u.id = a.user_id
       WHERE p.id = ?`,
      [id]
    );
    return TravelPackage.parsePackage(row);
  }

  static async findIdBySlug(slug) {
    const [[row]] = await db.query("SELECT id FROM travel_package WHERE slug = ?", [slug]);
    return row?.id ?? null;
  }

  /** Accepts either a numeric id (legacy URLs) or a slug and returns the package id, if any. */
  static async resolveId(idOrSlug) {
    if (isNumericId(idOrSlug)) return Number(idOrSlug);
    return TravelPackage.findIdBySlug(String(idOrSlug).toLowerCase());
  }

  /**
   * Builds a slug from the package name that no other package uses yet,
   * appending -2, -3, ... on collisions. `excludeId` lets a package keep its own slug on update.
   */
  static async generateUniqueSlug(packageName, excludeId = null) {
    const base = slugify(packageName);
    const [rows] = await db.query(
      `SELECT slug FROM travel_package
       WHERE (slug = ? OR slug LIKE ?) AND (? IS NULL OR id != ?)`,
      [base, `${base}-%`, excludeId, excludeId]
    );
    const taken = new Set(rows.map((row) => row.slug));
    if (!taken.has(base)) return base;

    let suffix = 2;
    while (taken.has(`${base}-${suffix}`)) suffix += 1;
    return `${base}-${suffix}`;
  }

  /** Minimal rows for the XML sitemap: every publicly visible package, newest first. */
  static async findSitemapEntries() {
    const [rows] = await db.query(
      `SELECT id, slug, updated_at
       FROM travel_package
       WHERE status = 'published'
       ORDER BY updated_at DESC`
    );
    return rows;
  }

  static async findFullById(id) {
    const pkg = await TravelPackage.findById(id);
    return TravelPackage.attachDetails(pkg);
  }

  static async findByAgentId(agentId, { status = null } = {}) {
    let sql = `
      SELECT p.*, a.company_name AS agent_company, u.name AS agent_name
      FROM travel_package p
      JOIN agent a ON a.id = p.agent_id
      JOIN users u ON u.id = a.user_id
      WHERE p.agent_id = ?
    `;
    const params = [agentId];

    if (status) {
      sql += " AND p.status = ?";
      params.push(status);
    }

    sql += " ORDER BY p.created_at DESC";
    const [rows] = await db.query(sql, params);
    return rows.map(TravelPackage.parsePackage);
  }

  static async create(packageData) {
    const [result] = await db.query("INSERT INTO travel_package SET ?", [
      packageData,
    ]);
    return result.insertId;
  }

  static async update(id, packageData) {
    const [result] = await db.query("UPDATE travel_package SET ? WHERE id = ?", [
      packageData,
      id,
    ]);
    return result.affectedRows;
  }

  static async delete(id) {
    const [result] = await db.query("DELETE FROM travel_package WHERE id = ?", [
      id,
    ]);
    return result.affectedRows;
  }

  static async replaceItinerary(packageId, itinerary = []) {
    await db.query("DELETE FROM travel_package_day WHERE package_id = ?", [
      packageId,
    ]);

    for (const day of itinerary) {
      await db.query("INSERT INTO travel_package_day SET ?", [
        {
          package_id: packageId,
          day_number: day.day_number,
          description: day.description || null,
          activities: JSON.stringify(day.activities || []),
          activity_count: day.activity_count ?? (day.activities || []).length,
          hotel_stars: day.hotel_stars ?? 3,
          meals: day.meals || null,
        },
      ]);
    }
  }

  static async addMedia(packageId, mediaItems = []) {
    for (const item of mediaItems) {
      await db.query("INSERT INTO travel_package_media SET ?", [
        {
          package_id: packageId,
          file_path: item.file_path,
          media_type: item.media_type || "image",
          sort_order: item.sort_order ?? 0,
        },
      ]);
    }
  }

  static async getMedia(packageId) {
    const [rows] = await db.query(
      "SELECT * FROM travel_package_media WHERE package_id = ? ORDER BY sort_order ASC, id ASC",
      [packageId]
    );
    return rows;
  }

  /**
   * Adds `images` (all image paths, in display order) and `thumbnail` (the first image)
   * to each package using a single query instead of one query per package.
   */
  static async attachImages(packages) {
    if (!packages.length) return packages;

    const [rows] = await db.query(
      `SELECT package_id, file_path
       FROM travel_package_media
       WHERE package_id IN (?) AND media_type = 'image'
       ORDER BY sort_order ASC, id ASC`,
      [packages.map((pkg) => pkg.id)]
    );

    const imagesByPackage = new Map();
    for (const { package_id, file_path } of rows) {
      if (!imagesByPackage.has(package_id)) imagesByPackage.set(package_id, []);
      imagesByPackage.get(package_id).push(file_path);
    }

    return packages.map((pkg) => {
      const images = imagesByPackage.get(pkg.id) || [];
      return { ...pkg, images, thumbnail: images[0] || null };
    });
  }

  static async findLocations(field, search = "", limit = 8, related = "") {
    const column = field === "from" ? "from_location" : "to_location";
    const relatedColumn = field === "from" ? "to_location" : "from_location";
    const relatedTerm = String(related).trim().slice(0, 100);
    const safeLimit = Math.min(50, Math.max(1, Number(limit) || 8));
    const term = String(search).trim().slice(0, 100);
    const escaped = term.replace(/[\\%_]/g, "\\$&");

    const [rows] = await db.query(
      `SELECT name, package_count
       FROM (
         SELECT TRIM(p.${column}) AS name, COUNT(*) AS package_count
         FROM travel_package p
         WHERE p.status = 'published'
           AND p.${column} IS NOT NULL
           AND TRIM(p.${column}) != ''
           AND TRIM(p.${column}) LIKE ?
           ${relatedTerm ? `AND p.${relatedColumn} LIKE ?` : ""}
         GROUP BY TRIM(p.${column})
       ) AS locations
       ORDER BY (name LIKE ?) DESC, package_count DESC, name ASC
       LIMIT ?`,
      [
        `%${escaped}%`,
        ...(relatedTerm ? [`%${relatedTerm.replace(/[\\%_]/g, "\\$&")}%`] : []),
        `${escaped}%`,
        safeLimit,
      ]
    );

    return rows.map((row) => ({
      name: row.name,
      package_count: Number(row.package_count) || 0,
    }));
  }

  /** Published package totals per package type, e.g. { domestic: 24, international: 8 }. */
  static async countByType() {
    const [rows] = await db.query(
      `SELECT package_type, COUNT(*) AS total
       FROM travel_package
       WHERE status = 'published'
       GROUP BY package_type`
    );
    const counts = { domestic: 0, international: 0 };
    for (const { package_type: type, total } of rows) {
      if (type in counts) counts[type] = Number(total) || 0;
    }
    return counts;
  }

  /**
   * Lowest and highest published package price.
   * @param {"domestic"|"international"|null} packageType optional type filter
   */
  static async findPriceRange(packageType = null) {
    const typeClause = packageType ? "AND package_type = ?" : "";
    const [[row]] = await db.query(
      `SELECT MIN(price) AS min_price, MAX(price) AS max_price
       FROM travel_package
       WHERE status = 'published' AND price IS NOT NULL ${typeClause}`,
      packageType ? [packageType] : []
    );
    return {
      min: row?.min_price != null ? Number(row.min_price) : 0,
      max: row?.max_price != null ? Number(row.max_price) : 0,
    };
  }

  /**
   * Destinations ranked by published package count.
   * @param {number} limit max destinations (1-10)
   * @param {"domestic"|"international"|null} packageType optional type filter
   */
  static async findTrendingDestinations(limit = 5, packageType = null) {
    const safeLimit = Math.min(20, Math.max(1, Number(limit) || 5));
    const typeClause = packageType ? "AND p.package_type = ?" : "";
    const [rows] = await db.query(
      `SELECT
         TRIM(p.to_location) AS name,
         COUNT(*) AS package_count,
         MIN(CASE WHEN p.price > 0 THEN p.price END) AS starting_price,
         MAX(p.package_type) AS package_type,
         SUBSTRING_INDEX(
           GROUP_CONCAT(p.id ORDER BY p.created_at DESC),
           ',',
           1
         ) AS sample_package_id,
         SUBSTRING_INDEX(
           GROUP_CONCAT(
             CASE
               WHEN p.location_description IS NOT NULL AND p.location_description != ''
               THEN p.location_description
             END
             ORDER BY p.created_at DESC
             SEPARATOR '|||'
           ),
           '|||',
           1
         ) AS tag
       FROM travel_package p
       WHERE p.status = 'published' AND TRIM(p.to_location) != ''
         ${typeClause}
       GROUP BY TRIM(p.to_location)
       ORDER BY package_count DESC, MAX(p.created_at) DESC
       LIMIT ?`,
      [...(packageType ? [packageType] : []), safeLimit]
    );

    return Promise.all(
      rows.map(async (row) => {
        const packageId = Number(row.sample_package_id);
        const media = packageId ? await TravelPackage.getMedia(packageId) : [];
        const image =
          media.find((item) => item.media_type === "image") || media[0];

        return {
          name: row.name,
          package_count: Number(row.package_count) || 0,
          starting_price:
            row.starting_price != null ? Number(row.starting_price) : null,
          package_type: row.package_type,
          thumbnail: image?.file_path || null,
          tag: row.tag || null,
        };
      })
    );
  }

  static async deleteMediaByIds(mediaIds = []) {
    if (!mediaIds.length) return;
    await db.query("DELETE FROM travel_package_media WHERE id IN (?)", [
      mediaIds,
    ]);
  }
}

module.exports = TravelPackage;
