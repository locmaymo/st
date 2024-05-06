const { get } = require('lodash');
const { getConfigValue } = require('./util');
const mysql = require("mysql2");

let connection = mysql.createConnection({
    host: getConfigValue('DB_HOST'),
    user: getConfigValue('DB_USERNAME'),
    password: getConfigValue('DB_PASSWORD'),
    database: getConfigValue('DB_NAME'),
});

connection.connect(function(err) {
    if (err) throw err;
    console.log("Database connected!");
});

module.exports = connection;
