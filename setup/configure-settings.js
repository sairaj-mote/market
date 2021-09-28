const fs = require('fs');
const getInput = require('./getInput');

var config, flag = false;
try {
    config = require('./args/config.json');
    flag = true;
} catch (error) {
    config = {
        "secret": null,
        "blockchain_id": null,
        "blockchain_private": null,
        "port": "8080",

        "sql_user": null,
        "sql_pwd": null,
        "sql_db": "exchange",
        "sql_host": "localhost"
    };
}

function configurePort() {
    return new Promise(resolve => {
        getInput.Text('Enter port', config["port"]).then(port => {
            config["port"] = port;
            resolve(true);
        })
    })
};

function configureSQL() {
    return new Promise(resolve => {
        getInput.YesOrNo('Do you want to re-configure mySQL connection').then(value => {
            if (value) {
                console.log('Enter mySQL connection values: ')
                getInput.Text('Host', config['sql_host']).then(host => {
                    config['sql_host'] = host;
                    getInput.Text('Database name', config['sql_db']).then(dbname => {
                        config['sql_db'] = dbname;
                        getInput.Text('MySQL username', config['sql_user']).then(sql_user => {
                            config['sql_user'] = sql_user;
                            getInput.Text('Mysql password', config['sql_pwd']).then(sql_pwd => {
                                config['sql_pwd'] = sql_pwd;
                                resolve(true);
                            })
                        })
                    })
                })
            } else
                resolve(false);
        })
    })
};

function configure() {
    return new Promise((resolve, reject) => {
        configurePort().then(port_result => {
            configureSQL().then(sql_result => {
                fs.writeFile(__dirname + '/../args/config.json', JSON.stringify(config), 'utf8', (err) => {
                    if (err) {
                        console.error(err);
                        return reject(false);
                    }
                    console.log('Configuration successful!');
                    if (sql_result) {
                        getInput.YesOrNo('Do you want to create schema in the database').then(value => {
                            if (value) {
                                const createSchema = require('./create-schema');
                                createSchema().then(result => resolve(result))
                                    .catch(error => {
                                        console.log('Retry using: \n' + 'npm run create-schema');
                                        reject(error);
                                    });
                            } else {
                                console.log('To create schema, use: \n' + 'npm run create-schema');
                                resolve(true);
                            }
                        });
                    } else
                        resolve(true);
                })
            })
        });
    })
}

if (!module.parent)
    configure().then(_ => null).catch(_ => null);
else
    module.exports = configure;