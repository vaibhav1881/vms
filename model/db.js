const dotenv = require("dotenv");
dotenv.config({ path: "./.env" });

const mariadb = require("mariadb");

const pool = mariadb.createPool({
  host: "localhost",
  port: "3305",
  user: "root",
  password: "root",
  database: "vms",
});

module.exports = pool;
