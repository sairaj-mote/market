const fs = require('fs');
let Database = require('../src/database');

function createSchema() {
    const config = require(`../args/config${process.env.I || ""}.json`);
    return new Promise((resolve, reject) => {
        fs.readFile(__dirname + '/../args/schema.sql', 'utf8', (err, data) => {
            if (err) {
                console.error(err);
                return reject(null);
            }
            Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(DB => {
                let txQueries = data.split(';');
                txQueries.pop();
                txQueries = txQueries.map(q => q.trim().replace(/\n/g, ' '));
                //console.log(txQueries);
                DB.transaction(txQueries).then(_ => {
                    console.log('SQL Schema created successfully!');
                    resolve(true);
                }).catch(error => {
                    console.error(error.message);
                    console.log('SQL Schema creation failed! Check user permission');
                    reject(true);
                });
            }).catch(error => {
                console.error(error);
                console.log('Unable to connect to MySQL database! Check user permission');
                reject(false);
            });
        });
    });
}

if (!module.parent)
    createSchema().then(_ => null).catch(_ => null);
else
    module.exports = createSchema;