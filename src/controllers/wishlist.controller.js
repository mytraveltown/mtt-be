const Wishlist = require("../models/wishlist.model");
const TravelPackage = require("../models/package.model");

const parsePackageId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

exports.getMine = async (req, res) => {
  try {
    const rows = await Wishlist.findPackagesByUserId(req.user.id);
    const packages = await TravelPackage.attachImages(
      rows.map((row) => TravelPackage.parsePackage(row))
    );
    res.status(200).json(packages);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.getMyIds = async (req, res) => {
  try {
    const ids = await Wishlist.findPackageIdsByUserId(req.user.id);
    res.status(200).json(ids);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.add = async (req, res) => {
  try {
    const packageId = parsePackageId(req.params.packageId);
    if (!packageId) {
      return res.status(400).json({ message: "Invalid package id" });
    }

    const pkg = await TravelPackage.findById(packageId);
    if (!pkg || pkg.status !== "published") {
      return res.status(404).json({ message: "Package not found" });
    }

    await Wishlist.add(req.user.id, packageId);
    res.status(200).json({ message: "Added to wishlist", package_id: packageId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const packageId = parsePackageId(req.params.packageId);
    if (!packageId) {
      return res.status(400).json({ message: "Invalid package id" });
    }

    await Wishlist.remove(req.user.id, packageId);
    res.status(200).json({ message: "Removed from wishlist", package_id: packageId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error", err: err.message });
  }
};
