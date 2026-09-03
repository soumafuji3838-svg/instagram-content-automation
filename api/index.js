const { handler } = require("../src/app");

module.exports = async function vercelHandler(req, res) {
  return handler(req, res);
};
