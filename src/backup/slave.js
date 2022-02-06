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
        const tables = {
            Users: "created",
            Request_Log: "request_time",
            TransactionHistory: "tx_time",
            //PriceHistory: "rec_time",
            _backup: "timestamp"
        };
        let subs = [];
        for (let t in tables)
            subs.push(`SELECT MAX(${tables[t]}) as ts FROM ${t}`);
        DB.query(`SELECT MAX(ts) as last_time FROM (${subs.join(' UNION ')}) AS Z`).then(result => {
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
    delete_sync: null,
    add_sync: null,
    immutable_sync: null,
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
        self.ws = ws;
    }).catch(error => console.error(error))
}

requestInstance.close = function() {
    const self = this;
    if (self.onetime)
        self.ws.close();
    self.onetime = null;
    self.ws = null;
    self.delete_sync = null;
    self.add_sync = null;
    self.immutable_sync = null;
    self.delete_data = null;
    self.add_data = null;
    self.total_add = null;
    self.request = null;
    self.last_response_time = null;
}

function processDataFromMaster(message) {
    try {
        message = JSON.parse(message);
        console.debug(message);
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
                if (self.total_add !== self.add_sync)
                    console.info(`Backup Sync Instance finished!, ${self.total_add - self.add_sync} packets not received.`);
                else
                    console.info("Backup Sync Instance finished successfully");
                updateBackupTable(self.add_data, self.delete_data)
            } else
                console.info("Backup Sync was not successful! Failed info: ", response.info);
            self.close();
            break;
        case "SYNC_DELETE":
            self.delete_data = response.delete_data;
            self.delete_sync += 1;
            deleteData(response.delete_data);
            break;
        case "SYNC_ADD_UPDATE_HEADER":
            self.add_data = response.add_data;
            self.total_add = Object.keys(response.add_data).length;
            break;
        case "SYNC_ADD_UPDATE":
            self.add_sync += 1;
            addUpdateData(response.table, response.data);
            break;
        case "SYNC_ADD_IMMUTABLE":
            self.immutable_sync += 1;
            addImmutableData(response.table, response.data);
            break;
    }
}

function updateBackupTable(add_data, delete_data) {
    //update _backup table for added data
    DB.transaction(add_data.map(r => [
        "INSERT INTO _backup (t_name, id, mode, timestamp) VALUES (?, ?, TRUE, ?) ON DUPLICATE KEY UPDATE mode=TRUE, timestamp=?",
        [r.t_name, r.id, validateValue(r.timestamp), validateValue(r.timestamp)]
    ])).then(_ => null).catch(error => console.error(error));
    //update _backup table for deleted data
    let del_queries = [];
    delete_data.forEach(r => del_queries.push([]));
    DB.transaction(delete_data.map(r => [
        "INSERT INTO _backup (t_name, id, mode, timestamp) VALUES (?, ?, NULL, ?) ON DUPLICATE KEY UPDATE mode=NULL, timestamp=?",
        [r.t_name, r.id, validateValue(r.timestamp), validateValue(r.timestamp)]
    ])).then(_ => null).catch(error => console.error(error));
}

function deleteData(data) {
    let delete_needed = {};
    data.forEach(r => r.t_name in delete_needed ? delete_needed[r.t_name].push(r.id) : delete_needed[r.t_name] = [r.id]);
    let queries = [];
    for (let table in delete_needed)
        queries.push(`DELETE FROM ${table} WHERE id IN (${delete_needed[table]})`);
    DB.transaction(queries).then(_ => null).catch(error => console.error(error));
}

function addUpdateData(table, data) {
    if (!data.length)
        return;
    let cols = Object.keys(data[0]),
        _mark = "(" + Array(cols.length).fill('?') + ")";
    let values = data.map(r => cols.map(c => validateValue(r[c]))).flat();
    let statement = `INSERT INTO ${table} (${cols}) VALUES ${Array(data.length).fill(_mark)} AS new` +
        " ON DUPLICATE KEY UPDATE " + cols.filter(c => c != 'id').map(c => c + " = new." + c);
    DB.query(statement, values).then(_ => null).catch(error => console.error(error));
}

function addImmutableData(table, data) {
    if (!data.length)
        return;
    const primaryKeys = {
        Users: "floID"
    };
    let cols = Object.keys(data[0]),
        _mark = "(" + Array(cols.length).fill('?') + ")";
    let values = data.map(r => cols.map(c => validateValue(r[c]))).flat();
    let statement = `INSERT INTO ${table} (${cols}) VALUES ${Array(data.length).fill(_mark)}`;
    if (table in primaryKeys)
        statement += ` ON DUPLICATE KEY UPDATE ${primaryKeys[table]}=${primaryKeys[table]}`;
    DB.query(statement, values).then(_ => null).catch(error => console.error(error));
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