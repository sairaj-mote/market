const WebSocket = require('ws');

var DB; //Container for database
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
                mode: "END",
                status: false,
                info: failedSync
            }));
        } else {
            console.info("Backup Sync completed");
            ws.send(JSON.stringify({
                mode: "END",
                status: true
            }));
        }
    });
}

function send_deleteSync(timestamp, ws) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT * FROM _backup WHERE mode is NULL AND timestamp > ?", [timestamp]).then(result => {
            ws.send(JSON.stringify({
                mode: "DELETE",
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
                    mode: "ADD_UPDATE",
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
                mode: "ADD_UPDATE_HEADER",
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
                    mode: "ADD_IMMUTABLE",
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

function startBackupTransmitter(db, port, backupIDs) {
    DB = db;
    this.port = port;
    this.backupIDs = backupIDs;

    const wss = this.wss = new WebSocket.Server({
        port: port
    });
    this.close = () => wss.close();
    wss.on('connection', ws => {
        ws.on('message', message => {
            //verify if from a backup node
            try {
                let invalid = null,
                    request = JSON.parse(message);
                console.debug(request);
                if (!backupIDs.includes(request.floID))
                    invalid = "FLO ID not approved for backup";
                else if (request.floID !== floCrypto.getFloID(request.pubKey))
                    invalid = "Invalid pubKey";
                else if (!floCrypto.verifySign(request.type + "|" + request.req_time, request.sign, request.pubKey))
                    invalid = "Invalid signature";
                else if (request.type !== "BACKUP_SYNC")
                    invalid = "Invalid Request Type";
                //TODO: check if request time is valid;
                if (invalid)
                    ws.send(JSON.stringify({
                        error: invalid
                    }));
                else
                    sendBackup(request.last_time, ws);
            } catch (error) {
                console.error(error);
                ws.send(JSON.stringify({
                    error: 'Unable to process the request!'
                }));
            }
        });
    });

    console.log("Backup Transmitter running in port", port);
}

module.exports = startBackupTransmitter;