const dotenv = require("dotenv");
dotenv.config({ path: './.env' });

const mariadb = require("mariadb");

const pool = mariadb.createPool({
  host: process.env.DATABASE_HOST,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PWD,
  database: process.env.DATABASE,
});

module.exports = pool;
