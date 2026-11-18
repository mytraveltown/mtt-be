const Hashids = require("hashids");

const SECRET = process.env.INVOICE_SECRET;

const hashids = new Hashids(SECRET, 10);

const encryptId = (id) => {
    return hashids.encode(id);
};

const decryptId = (hash) => {
    const decoded = hashids.decode(hash);

    if (!decoded.length) {
        throw new Error("Invalid Token");
    }

    return Number(decoded[0]);
};

module.exports = {
    encryptId,
    decryptId
};