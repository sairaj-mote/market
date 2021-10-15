const fs = require('fs');
const getInput = require('./getInput');

var config, flag_new;
try {
    config = require('../args/app-config.json');
    flag_new = false;
} catch (error) {
    config = {
        "secret": null,
        "port": "8080",

        "sql_user": null,
        "sql_pwd": null,
        "sql_db": "exchange",
        "sql_host": "localhost",

        "backup-port": "8081",
        "backup-floIDs": []
    };
    flag_new = true;
}

function flaggedYesOrNo(text) {
    return new Promise((resolve) => {
        if (flag_new)
            resolve(true);
        else
            getInput.YesOrNo(text)
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
}

function getBackupIDs(ids) {
    return new Promise((resolve, reject) => {
        getInput("", "continue").then(id => {
            if (id === "continue")
                resolve(Array.from(new Set(ids)));
            else {
                ids.push(id);
                getBackupIDs(ids)
                    .then(result => resolve(result))
                    .catch(error => reject(error));
            }
        })
    })
}

function configureBackup() {
    return new Promise(resolve => {
        getInput.Text('Enter backup port (N = No backup)', config["backup-port"]).then(backup_port => {
            config["backup-port"] = backup_port === N ? null : backup_port;
            if (!config["backup-port"])
                return resolve(true);
            getInput.YesOrNo('Do you want to add/remove backup floIDs?').then(value => {
                if (value) {
                    console("Enter floIDs to add as backup: ");
                    getBackupIDs(config["backup-floIDs"]).then(ids => {
                        //delete backup IDs
                        let tmp_obj = {};
                        for (let i in ids) {
                            console.log(i + 1, ":", ids[i]);
                            tmp_obj[i + 1] = ids[i];
                        }
                        getInput.Text("Enter numbers to delete (seperated by comma)", "continue").then(ri => {
                            if (ri === "continue")
                                config["backup-floIDs"] = ids;
                            else {
                                for (let i of ri.split(","))
                                    delete tmp_obj[parseInt(i)];
                                let tmp_array = [];
                                for (let id of tmp_obj)
                                    tmp_array.push(id);
                                config["backup-floIDs"] = tmp_array;
                            }
                            resolve(true);
                        })
                    })
                } else
                    resolve(true);
            })
        })
    })
}

function configurePort() {
    return new Promise(resolve => {
        getInput.Text('Enter port', config["port"]).then(port => {
            config["port"] = port;
            configureBackup()
                .then(result => resolve(true))
        })
    })
}

function configureSQL() {
    return new Promise(resolve => {
        flaggedYesOrNo('Do you want to re-configure mySQL connection').then(value => {
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
}

function randomizeSessionSecret() {
    return new Promise((resolve) => {
        flaggedYesOrNo('Do you want to randomize the session secret').then(value => {
            if (value) {
                let N = Math.floor(Math.random() * (64 - 32 + 1)) + 32;
                var secret = '';
                var characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
                for (var i = 0; i < N; i++)
                    secret += characters.charAt(Math.floor(Math.random() * characters.length));
                config['secret'] = secret;
                resolve(true);
            } else
                resolve(false);
        })
    })
}

function configure() {
    return new Promise((resolve, reject) => {
        configurePort().then(port_result => {
            randomizeSessionSecret().then(secret_result => {
                configureSQL().then(sql_result => {
                    fs.writeFile(__dirname + '/../args/app-config.json', JSON.stringify(config), 'utf8', (err) => {
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
            })
        });
    })
}

if (!module.parent)
    configure().then(_ => null).catch(_ => null);
else
    module.exports = configure;