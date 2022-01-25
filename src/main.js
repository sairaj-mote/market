'use strict';
global.floGlobals = require('../public/floGlobals');
require('./set_globals');
require('./lib');
require('./floCrypto');
require('./floBlockchainAPI');
require('./tokenAPI');

const Database = require("./database");
const App = require('./app');

const backup = require('./backup/head');

var DB, app;

function refreshData(startup = false) {
    return new Promise((resolve, reject) => {
        refreshDataFromBlockchain().then(result => {
            loadDataFromDB(result, startup)
                .then(_ => resolve("Data refresh successful"))
                .catch(error => reject(error))
        }).catch(error => reject(error))
    })
}

function refreshDataFromBlockchain() {
    return new Promise((resolve, reject) => {
        DB.query("SELECT num FROM lastTx WHERE floID=?", [floGlobals.adminID]).then(result => {
            let lastTx = result.length ? result[0].num : 0;
            floBlockchainAPI.readData(floGlobals.adminID, {
                ignoreOld: lastTx,
                sentOnly: true,
                pattern: floGlobals.application
            }).then(result => {
                let promises = [],
                    nodes_change = false,
                    trusted_change = false;
                result.data.reverse().forEach(data => {
                    var content = JSON.parse(data)[floGlobals.application];
                    //Node List
                    if (content.Nodes) {
                        nodes_change = true;
                        if (content.Nodes.remove)
                            for (let n of content.Nodes.remove)
                                promises.push(DB.query("DELETE FROM nodeList WHERE floID=?", [n]));
                        if (content.Nodes.add)
                            for (let n in content.Nodes.add)
                                promises.push(DB.query("INSERT INTO nodeList (floID, uri) VALUE (?,?) AS new ON DUPLICATE KEY UPDATE uri=new.uri", [n, content.Nodes.add[n]]));
                    }
                    //Trusted List
                    if (content.Trusted) {
                        trusted_change = true;
                        if (content.Trusted.remove)
                            for (let id of content.Trusted.remove)
                                promises.push(DB.query("DELETE FROM trustedList WHERE floID=?", [id]));
                        if (content.Trusted.add)
                            for (let id of content.Trusted.add)
                                promises.push(DB.query("INSERT INTO trustedList (floID) VALUE (?) AS new ON DUPLICATE KEY UPDATE floID=new.floID", [id]));
                    }
                    //Tag List with priority and API
                    if (content.Tag) {
                        if (content.Tag.remove)
                            for (let t of content.Tag.remove)
                                promises.push(DB.query("DELETE FROM TagList WHERE tag=?", [t]));
                        if (content.Tag.add)
                            for (let t in content.Tag.add)
                                promises.push(DB.query("INSERT INTO TagList (tag, sellPriority, buyPriority, api) VALUE (?,?,?,?) AS new ON DUPLICATE KEY UPDATE tag=new.tag", [t, content.Tag.add[t].sellPriority, content.Tag.add[t].buyPriority, content.Tag.add[t].api]));
                        if (content.Tag.update)
                            for (let t in content.Tag.update)
                                for (let a in content.Tag.update[t])
                                    promises.push(`UPDATE TagList WHERE tag=? SET ${a}=?`, [t, content.Tag.update[t][a]]);
                    }
                });
                promises.push(DB.query("INSERT INTO lastTx (floID, num) VALUE (?, ?) AS new ON DUPLICATE KEY UPDATE num=new.num", [floGlobals.adminID, result.totalTxs]));
                //Check if all save process were successful
                Promise.allSettled(promises).then(results => {
                    console.debug(results.filter(r => r.status === "rejected"));
                    if (results.reduce((a, r) => r.status === "rejected" ? ++a : a, 0))
                        console.warn("Some data might not have been saved in database correctly");
                });
                resolve({
                    nodes: nodes_change,
                    trusted: trusted_change
                });
            }).catch(error => reject(error));
        }).catch(error => reject(error))
    })
}

function loadDataFromDB(changes, startup) {
    return new Promise((resolve, reject) => {
        let promises = [];
        if (startup || changes.nodes)
            promises.push(loadDataFromDB.nodeList());
        if (startup || changes.trusted)
            promises.push(loadDataFromDB.trustedIDs());
        Promise.all(promises)
            .then(_ => resolve("Data load successful"))
            .catch(error => reject(error))
    })
}

loadDataFromDB.nodeList = function() {
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM nodeList").then(result => {
            let nodes = {}
            for (let i in result)
                nodes[result[i].floID] = result[i].uri;
            //update dependents
            backup.nodeList = nodes;
            resolve(nodes);
        }).catch(error => reject(error))
    })
}

loadDataFromDB.trustedIDs = function() {
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM trustedList").then(result => {
            let trustedIDs = [];
            for (let i in result)
                trustedIDs.push(result[i].floID);
            //update dependents
            app.trustedIDs = trustedIDs;
            resolve(trustedIDs);
        }).catch(error => reject(error))
    })
}

function setDB(db) {
    DB = db;
    backup.DB = DB;
}

module.exports = function startServer(public_dir) {
    const config = require(`../args/config${process.env.I || ""}.json`);
    try {
        var _tmp = require(`../args/keys${process.env.I || ""}.json`);
        _tmp = floCrypto.retrieveShamirSecret(_tmp);
        var _pass = process.env.PASSWORD;
        if (!_pass) {
            console.error('Password not entered!');
            process.exit(1);
        }
        global.myPrivKey = Crypto.AES.decrypt(_tmp, _pass);
        global.myPubKey = floCrypto.getPubKeyHex(global.myPrivKey);
        global.myFloID = floCrypto.getFloID(global.myPubKey);
        if (!global.myFloID || !global.myPubKey || !global.myPrivKey)
            throw "Invalid Keys";
    } catch (error) {
        console.error('Unable to load private key!');
        process.exit(1);
    }

    global.PUBLIC_DIR = public_dir;
    console.debug(PUBLIC_DIR, global.myFloID);

    Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(db => {
        setDB(db);
        app = new App(config['secret'], DB);
        refreshData(true).then(_ => {
            app.start(config['port']).then(result => {
                console.log(result);
                backup.init(app);
            }).catch(error => console.error(error))
        }).catch(error => console.error(error))
    }).catch(error => console.error(error));
};