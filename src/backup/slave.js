'use strict';

const WAIT_TIME = 10 * 60 * 1000,
    BACKUP_INTERVAL = 1 * 60 * 1000;

var DB; //Container for Database connection
var masterWS = null; //Container for Master websocket connection

var intervalID = null;

function startSlaveProcess(ws) {
    if (!ws) throw Error("Master WS connection required");
    //stop existing process
    stopSlaveProcess();
    //set masterWS
    ws.on('message', processDataFromMaster);
    masterWS = ws;
    //inform master
    let message = {
        floID: global.myFloID,
        pubKey: global.pubKey,
        req_time: Date.now(),
        type: "SLAVE_CONNECT"
    }
    message.sign = floCrypto.signData(message.type + "|" + message.req_time, global.myPrivKey);
    //start sync
    requestInstance.open();
    intervalID = setInterval(requestInstance.open, BACKUP_INTERVAL);
}

function stopSlaveProcess() {
    if (masterWS !== null) {
        masterWS.onclose = () => null;
        masterWS.close();
        requestInstance.close();
        masterWS = null;
    }
    if (intervalID !== null) {
        clearInterval(intervalID);
        intervalID = null;
    }
}

function requestBackupSync(ws) {
    return new Promise((resolve, reject) => {
        DB.query('SELECT MAX(timestamp) as last_time FROM _backup').then(result => {
            let request = {
                floID: global.myFloID,
                pubKey: myPubKey,
                type: "BACKUP_SYNC",
                last_time: result[0].last_time,
                req_time: Date.now()
            };
            request.sign = floCrypto.signData(request.type + "|" + request.req_time, global.myPrivKey);
            ws.send(JSON.stringify(request));
            resolve(request);
        }).catch(error => reject(error))
    })
}

const requestInstance = {
    ws: null,
    cache: null,
    delete_count: null,
    add_count: null,
    delete_data: null,
    add_data: null,
    total_add: null,
    request: null,
    onetime: null,
    last_response_time: null
};

requestInstance.open = function(ws = null) {
    const self = this;
    //Check if there is an active request 
    if (self.request) {
        console.log("A request is already active");
        if (self.last_response_time < Date.now() - WAIT_TIME)
            self.close();
        else
            return;
    }
    //Use websocket connection if passed, else use masterWS if available
    if (ws) {
        ws.on('message', processDataFromMaster);
        self.onetime = true;
    } else if (masterWS)
        ws = masterWS;
    else return console.warn("Not connected to master");

    requestBackupSync(ws).then(request => {
        self.request = request;
        self.cache = [];
        self.add_count = self.delete_count = 0;
        self.ws = ws;
    }).catch(error => console.error(error))
}

requestInstance.close = function() {
    const self = this;
    if (self.onetime)
        self.ws.close();
    self.onetime = null;
    self.ws = null;
    self.cache = null;
    self.delete_count = null;
    self.add_count = null;
    self.delete_data = null;
    self.add_data = null;
    self.total_add = null;
    self.request = null;
    self.last_response_time = null;
}

function processDataFromMaster(message) {
    try {
        message = JSON.parse(message);
        console.debug("Master:", message);
        if (message.command.startsWith("SYNC"))
            processBackupData(message);
        else switch (message.command) {
            case "SINK_SHARE":
                storeSinkShare(message);
                break;
            case "SEND_SHARE":
                sendSinkShare();
                break;
        }
    } catch (error) {
        console.error(error);
    }
}

function storeSinkShare(message) {
    console.debug(Date.now(), '|sinkID:', message.sinkID, '|share:', message.keyShare);
    DB.query("INSERT INTO sinkShares (floID, share) VALUE (?, ?)", [message.sinkID, message.keyShare])
        .then(_ => null).catch(error => console.error(error));
}

function sendSinkShare() {
    DB.query("SELECT floID, share FROM sinkShares ORDER BY time_ DESC LIMIT 1").then(result => {
        let response = {
            type: "SINK_SHARE",
            sinkID: result[0].floID,
            share: result[0].share,
            floID: global.myFloID,
            pubKey: global.pubKey,
            req_time: Date.now()
        }
        response.sign = floCrypto.signData(response.type + "|" + response.req_time, global.myPrivKey); //TODO: strengthen signature
        masterWS.send(JSON.stringify(response));
    }).catch(error => console.error(error));
}

function processBackupData(response) {
    //TODO: Sync improvements needed. (2 types)
    //1. Either sync has to be completed or rollback all
    //2. Each table/data should be treated as independent chunks
    const self = requestInstance;
    self.last_response_time = Date.now();
    switch (response.command) {
        case "SYNC_ERROR":
            console.log(response.error);
            self.close();
            break;
        case "SYNC_END":
            if (response.status) {
                if (self.total_add !== self.add_count)
                    console.info(`Backup Sync Instance finished!, ${self.total_add - self.add_count} packets not received.`);
                else
                    console.info("Backup Sync Instance finished successfully");
                storeBackupData(self.cache, self.add_data, self.delete_data);
            } else
                console.info("Backup Sync was not successful! Failed info: ", response.info);
            self.close();
            break;
        case "SYNC_DELETE":
            self.delete_data = response.delete_data;
            self.delete_count += 1;
            self.cache.push(cacheBackupData(null, response.delete_data));
            break;
        case "SYNC_HEADER":
            self.add_data = response.add_data;
            self.total_add = Object.keys(response.add_data).length;
            break;
        case "SYNC_UPDATE":
            self.add_count += 1;
            self.cache.push(cacheBackupData(response.table, response.data));
            break;
    }
}

const cacheBackupData = (tableName, dataCache) => new Promise((resolve, reject) => {
    DB.query("INSERT INTO _backupCache (t_name, data_cache) VALUE (?, ?)", [tableName, JSON.stringify(dataCache)])
        .then(_ => resolve(true)).catch(error => {
            console.error(error);
            reject(false);
        })
});

function storeBackupData(cache_promises, add_header, delete_header) {
    Promise.allSettled(cache_promises).then(_ => {
        console.log("START: BackupCache -> Tables");
        //Process 'Users' table 1st as it provides foreign key attribute to other tables
        DB.query("SELECT * FROM _backupCache WHERE t_name=?", ["Users"]).then(data => {
            Promise.allSettled(data.map(d => updateTableData("Users", JSON.parse(d.data_cache)))).then(result => {
                storeBackupData.commit(data, result).then(_ => {
                    DB.query("SELECT * FROM _backupCache WHERE t_name IS NOT NULL").then(data => {
                        Promise.allSettled(data.map(d => updateTableData(d.t_name, JSON.parse(d.data_cache)))).then(result => {
                            storeBackupData.commit(data, result).then(_ => {
                                DB.query("SELECT * FROM _backupCache WHERE t_name IS NULL").then(data => {
                                    Promise.allSettled(data.map(d => deleteTableData(JSON.parse(d.data_cache)))).then(result => {
                                        storeBackupData.commit(data, result).then(_ => {
                                            console.log("END: BackupCache -> Tables");
                                            updateBackupTable(add_header, delete_header);
                                        });
                                    })
                                })
                            })
                        })
                    }).catch(error => {
                        console.error(error);
                        console.warn("ABORT: BackupCache -> Tables")
                    });
                })
            })
        }).catch(error => {
            console.error(error);
            console.warn("ABORT: BackupCache -> Tables")
        })
    }).catch(error => reject(error))
}

storeBackupData.commit = function(data, result) {
    let promises = [];
    for (let i = 0; i < data.length; i++)
        switch (result[i].status) {
            case "fulfilled":
                promises.push(DB.query("DELETE FROM _backupCache WHERE id=?", data[i].id));
                break;
            case "rejected":
                console.error(result[i].reason);
                promises.push(DB.query("UPDATE _backupCache SET status=FALSE WHERE id=?", data[i].id));
                break;
        }
    return Promise.allSettled(promises);
}

function updateBackupTable(add_data, delete_data) {
    //update _backup table for added data
    DB.transaction(add_data.map(r => [
        "INSERT INTO _backup (t_name, id, mode, timestamp) VALUES (?, ?, TRUE, ?) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=?",
        [r.t_name, r.id, validateValue(r.timestamp), validateValue(r.timestamp)]
    ])).then(_ => null).catch(error => console.error(error));
    //update _backup table for deleted data
    DB.transaction(delete_data.map(r => [
        "INSERT INTO _backup (t_name, id, mode, timestamp) VALUES (?, ?, NULL, ?) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=?",
        [r.t_name, r.id, validateValue(r.timestamp), validateValue(r.timestamp)]
    ])).then(_ => null).catch(error => console.error(error));
}

function deleteTableData(data) {
    return new Promise((resolve, reject) => {
        let delete_needed = {};
        data.forEach(r => r.t_name in delete_needed ? delete_needed[r.t_name].push(r.id) : delete_needed[r.t_name] = [r.id]);
        let queries = [];
        for (let table in delete_needed)
            queries.push(`DELETE FROM ${table} WHERE id IN (${delete_needed[table]})`);
        DB.transaction(queries).then(_ => resolve(true)).catch(error => reject(error));
    })
}

function updateTableData(table, data) {
    return new Promise((resolve, reject) => {
        if (!data.length)
            return resolve(null);
        let cols = Object.keys(data[0]),
            _mark = "(" + Array(cols.length).fill('?') + ")";
        let values = data.map(r => cols.map(c => validateValue(r[c]))).flat();
        let statement = `INSERT INTO ${table} (${cols}) VALUES ${Array(data.length).fill(_mark)} AS new` +
            " ON DUPLICATE KEY UPDATE " + cols.map(c => c + " = new." + c);
        DB.query(statement, values).then(_ => resolve(true)).catch(error => reject(error));
    })
}

const validateValue = val => (typeof val === "string" && /\.\d{3}Z$/.test(val)) ? val.substring(0, val.length - 1) : val;

module.exports = {
    set DB(db) {
        DB = db;
    },
    get masterWS() {
        return masterWS;
    },
    start: startSlaveProcess,
    stop: stopSlaveProcess,
    syncRequest: ws => requestInstance.open(ws)
}