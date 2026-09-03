const { loadEnv } = require("../src/env");
const { verifyInstagramConnection } = require("../src/instagram");

loadEnv();

verifyInstagramConnection()
  .then((result) => {
    console.log(`Instagram接続成功: @${result.username || "unknown"} (User ID: ${result.userId})`);
  })
  .catch((error) => {
    console.error(`Instagram接続失敗: ${error.message}`);
    process.exitCode = 1;
  });
