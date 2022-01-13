'use strict';
const slave = require('./slave');
const WebSocket = require('ws');
const shareThreshold = 50 / 100;

var DB, app, wss; //Container for database and app
var nodeShares = null,
    nodeSinkID = null,
    connectedSlaves = {},
    mod = null;
const SLAVE_MODE = 0,
    MASTER_MODE = 1;

//Backup Transfer
function sendBackup(timestamp, ws) {
    if (!timestamp) timestamp = 0;
    else if (typeof timestamp === "string" && /\.\d{3}Z$/.test(timestamp))
        timestamp = timestamp.substring(0, timestamp.length - 1);
    let promises = [
        send_dataSync(timestamp, ws),
        send_deleteSync(timestamp, ws),
        send_dataImmutable(timestamp, ws)
    ];
    Promise.allSettled(promises).then(result => {
        let failedSync = [];
        result.forEach(r => r.status === "rejected" ? failedSync.push(r.reason) : null);
        if (failedSync.length) {
            console.info("Backup Sync Failed:", failedSync);
            ws.send(JSON.stringify({
                command: "SYNC_END",
                status: false,
                info: failedSync
            }));
        } else {
            console.info("Backup Sync completed");
            ws.send(JSON.stringify({
                command: "SYNC_END",
                status: true
            }));
        }
    });
}

function send_deleteSync(timestamp, ws) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM _backup WHERE mode is NULL AND timestamp > ?", [timestamp]).then(result => {
            ws.send(JSON.stringify({
                command: "SYNC_DELETE",
                delete_data: result
            }));
            resolve("deleteSync");
        }).catch(error => {
            console.error(error);
            reject("deleteSync");
        });
    })
}

function send_dataSync(timestamp, ws) {
    const sendTable = (table, id_list) => new Promise((res, rej) => {
        DB.query(`SELECT * FROM ${table} WHERE id IN (${id_list})`)
            .then(data => {
                ws.send(JSON.stringify({
                    table,
                    command: "SYNC_ADD_UPDATE",
                    data
                }));
                res(table);
            }).catch(error => {
                console.error(error);
                rej(table);
            });
    });
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM _backup WHERE mode=TRUE AND timestamp > ?", [timestamp]).then(result => {
            let sync_needed = {};
            result.forEach(r => r.t_name in sync_needed ? sync_needed[r.t_name].push(r.id) : sync_needed[r.t_name] = [r.id]);
            ws.send(JSON.stringify({
                command: "SYNC_ADD_UPDATE_HEADER",
                add_data: result
            }));
            let promises = [];
            for (let table in sync_needed)
                promises.push(sendTable(table, sync_needed[table]));
            Promise.allSettled(promises).then(result => {
                let failedTables = [];
                result.forEach(r => r.status === "rejected" ? failedTables.push(r.reason) : null);
                if (failedTables.length)
                    reject(["dataSync", failedTables]);
                else
                    resolve("dataSync");
            });
        }).catch(error => {
            console.error(error);
            reject("dataSync");
        });
    });
}

function send_dataImmutable(timestamp, ws) {
    const immutable_tables = {
        Users: "created",
        Request_Log: "request_time",
        Transactions: "tx_time",
        priceHistory: "rec_time"
    };
    const sendTable = (table, timeCol) => new Promise((res, rej) => {
        DB.query(`SELECT * FROM ${table} WHERE ${timeCol} > ?`, [timestamp])
            .then(data => {
                ws.send(JSON.stringify({
                    table,
                    command: "SYNC_ADD_IMMUTABLE",
                    data
                }));
                res(table);
            }).catch(error => {
                console.error(error);
                rej(table);
            });
    });

    return new Promise((resolve, reject) => {
        let promises = [];
        for (let table in immutable_tables)
            promises.push(sendTable(table, immutable_tables[table]));
        Promise.allSettled(promises).then(result => {
            let failedTables = [];
            result.forEach(r => r.status === "rejected" ? failedTables.push(r.reason) : null);
            if (failedTables.length)
                reject(["dataImmutable", failedTables]);
            else
                resolve("dataImmutable");
        });
    })
}

//Shares
function generateNewSink() {
    let sink = floCrypto.generateNewID();
    let nextNodes = KB.nextNode(global.myFloID, null);
    let shares = floCrypto.createShamirsSecretShares(sink.privKey, nextNodes.length, Math.ceil(nextNodes.length * shareThreshold));
    sink.shares = {};
    for (let i in nextNodes)
        sink.shares[nextNodes[i]] = shares[i];
    return sink;
}

function sendShare(ws, sinkID, keyShare) {
    ws.send(JSON.stringify({
        command: "SINK_SHARE",
        sinkID,
        keyShare
    }));
}

function sendSharesToNodes(sinkID, shares) {
    nodeSinkID = sinkID;
    nodeShares = shares;
    for (let node in shares)
        if (node in connectedSlaves)
            sendShare(connectedSlaves[node], sinkID, shares[node]);
}

function storeSink(sinkID, sinkPrivKey) {
    global.sinkID = sinkID;
    global.sinkPrivKey = sinkPrivKey;
    let encryptedKey = Crypto.AES.encrypt(sinkPrivKey, global.myPrivKey);
    DB.query('INSERT INTO sinkShares (floID, share) VALUE (?, ?)', [sinkID, '$$$' + encryptedKey])
        .then(_ => console.log('SinkID:', sinkID, '|SinkEnKey:', encryptedKey))
        .catch(error => console.error(error));
}

function transferMoneyToNewSink(oldSinkID, oldSinkKey) {
    return new Promise((resolve, reject) => {
        let newSink = generateNewSink();
        floBlockchainAPI.getBalance(oldSinkID).then(balFLO => {
            tokenAPI.getBalance(oldSinkID).then(balRupee => {
                floBlockchainAPI.sendTx(oldSinkID, newSink.floID, balFLO - floGlobals.fee, oldSinkKey, `send ${balRupee} ${floGlobals.token}# |Exchange-market New sink`)
                    .then(result => resolve(newSink))
                    .catch(error => reject(error))
            }).catch(error => reject(error));
        }).catch(error => reject(error))
    })
}

function collectShares(floID, sinkID, share) {
    if (!collectShares.sinkID) {
        collectShares.sinkID = sinkID;
        collectShares.shares = {};
    } else if (collectShares.sinkID !== sinkID)
        return console.error("Something is wrong! Slaves are sending different sinkID");
    collectShares.shares[floID] = share;
    try {
        let privKey = floCrypto.retrieveShamirSecret(Object.values(collectShares.shares));
        if (floCrypto.verifyPrivKey(privKey, collectShares.sinkID)) {
            transferMoneyToNewSink(collectShares.sinkID, privKey).then(newSink => {
                delete collectShares.sinkID;
                delete collectShares.shares;
                collectShares.active = false;
                storeSink(newSink.floID, newSink.privKey);
                sendSharesToNodes(newSink.floID, newSink.shares);
            }).catch(error => console.error(error));
        }
    } catch (error) {
        //Unable to retrive sink private key. Waiting for more shares! Do nothing for now
    };
}

function connectWS(floID) {
    let url = nodeURL[floID];
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', _ => resolve(ws));
        ws.on('error', _ => reject(error));
    })
}

function connectToMaster(i = 0) {
    if (i >= nodeList.length) {
        console.error("No master is found, and myFloID is not in list. This should not happen!");
        process.exit(1);
    }
    let floID = nodeList[i];
    if (floID === myFloID)
        serveAsMaster();
    else
        connectWS(floID).then(ws => {
            ws.floID = floID;
            ws.onclose = () => connectToMaster(i);
            serveAsSlave(ws);
        }).catch(error => {
            console.log(`Node(${floID}) is offline`);
            connectToMaster(i + 1)
        });
}

//Node becomes master
function serveAsMaster() {
    app.resume();
    slave.stop();
    mod = MASTER_MODE;
    informLiveNodes();
    collectShares.active = true;
}

function serveAsSlave(ws) {
    app.pause();
    slave.start(ws);
    mod = SLAVE_MODE;
}

function informLiveNodes() {
    let message = {
        floID: global.myFloID,
        type: "UPDATE_MASTER",
        pubKey: global.myPubKey,
        req_time: Date.now()
    };
    message.sign = floCrypto.signData(message.type + "|" + message.req_time, global.myPrivKey);
    message = JSON.stringify(message);
    for (let n in nodeURL)
        if (n !== global.myFloID)
            connectWS(n).then(ws => {
                ws.send(message);
                ws.close();
            }).catch(error => console.warn(`Node ${n} is offline`));
}

function updateMaster(floID) {
    let currentMaster = mod === MASTER_MODE ? global.floID : slave.masterWS.floID;
    if (nodeList.indexOf(floID) < nodeList.indexOf(currentMaster))
        connectToMaster();
}

function slaveConnect(floID, ws) {
    ws.floID = floID;
    connectedSlaves[floID] = ws;
    if (collectShares.active)
        ws.send(JSON.stringify({
            command: "SEND_SHARE"
        }));
    else if (nodeShares[floID])
        sendShare(ws, nodeSinkID, nodeShares[floID]);
}

//Transmistter
var nodeList; //Container for (backup) node list
function startBackupTransmitter(server) {
    wss = new WebSocket.Server({
        server
    });
    wss.on('connection', ws => {
        ws.on('message', message => {
            //verify if from a backup node
            try {
                let invalid = null,
                    request = JSON.parse(message);
                console.debug(request);
                if (!nodeList.includes(request.floID))
                    invalid = `floID ${request.floID} not in nodeList`;
                else if (request.floID !== floCrypto.getFloID(request.pubKey))
                    invalid = "Invalid pubKey";
                else if (!floCrypto.verifySign(request.type + "|" + request.req_time, request.sign, request.pubKey))
                    invalid = "Invalid signature";
                //TODO: check if request time is valid;
                else switch (request.type) {
                    case "BACKUP_SYNC":
                        sendBackup(request.last_time, ws);
                        break;
                    case "UPDATE_MASTER":
                        updateMaster(request.floID);
                        break;
                    case "SLAVE_CONNECT":
                        slaveConnect(request.floID, ws);
                        break;
                    case "SINK_SHARE":
                        collectShares(request.floID, request.sinkID, request.share)
                    default:
                        invalid = "Invalid Request Type";
                }
                if (invalid)
                    ws.send(JSON.stringify({
                        error: invalid
                    }));
            } catch (error) {
                console.error(error);
                ws.send(JSON.stringify({
                    command: "SYNC_ERROR",
                    error: 'Unable to process the request!'
                }));
            }
        });
        ws.on('close', () => {
            // remove from connected slaves (if needed)
            if (ws.floID in connectedSlaves)
                delete connectedSlaves[ws.floID];
        })
    });
}

function initProcess(a) {
    app = a;
    startBackupTransmitter(app.server);
    connectToMaster();
}

module.exports = {
    init: initProcess,
    set nodeList(ids) {
        nodeList = ids;
    },
    set DB(db) {
        DB = db;
        slave.DB = db;
    },
    get wss() {
        return wss;
    }
};