const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });

const mariadb = require("mariadb");

const pool = mariadb.createPool({
  host: "127.0.0.1",
  port: "3308",
  user: "root",
  password: "mariadb",
  database: "vms",
});

module.exports = pool;
