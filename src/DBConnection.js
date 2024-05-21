const { get } = require('lodash');
const { getConfigValue } = require('./util');
const mysql = require("mysql2");

const pool = mysql.createPool({
    host: getConfigValue('DB_HOST'),
    user: getConfigValue('DB_USERNAME'),
    password: getConfigValue('DB_PASSWORD'),
    database: getConfigValue('DB_NAME'),
});

pool.getConnection((err, connection) => {
    if(err) throw err;  // not connected!

    console.log("Database connected!");

    // When done with the connection, release it.
    connection.release();
});

module.exports = pool;