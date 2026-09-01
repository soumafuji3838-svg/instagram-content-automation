const designs = require("../config/designs.json");

function getDesign(id) {
  return designs.find((design) => design.id === id) || designs[0];
}

module.exports = { designs, getDesign };
