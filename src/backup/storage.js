const config = require('../../args/backup-config.json');
const floGlobals = require('../../public/floGlobals');
require('../set_globals');
require('../lib');
require('../floCrypto');
const WebSocket = require('ws');

const WAIT_TIME = 1 * 60 * 1000,
    BACKUP_INTERVAL = 1 * 60 * 1000;

const myPrivKey = config.private_key,
    myPubKey = floCrypto.getPubKeyHex(config.private_key),
    myFloID = floCrypto.getFloID(config.private_key);

const Database = require("../database");
var DB; //Container for Database connection

function startBackupStorage() {
    console.log("Logged in as", myFloID);
    Database(config["sql_user"], config["sql_pwd"], config["sql_db"], config["sql_host"]).then(db => {
        DB = db;
        IntervalFunction();
        const BackupInterval = setInterval(IntervalFunction, BACKUP_INTERVAL);
        console.log("Backup Storage Started");
    })
}

function IntervalFunction() {
    IntervalFunction.count += 1;
    console.log(Date.now().toString(), "Instance #" + IntervalFunction.count);
    requestInstance.open();
}
IntervalFunction.count = 0;

function connectToWSServer(url) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        ws.on('open', _ => resolve(ws));
        ws.on('error', _ => reject(error));
    })
}

function requestBackupSync(ws) {
    return new Promise((resolve, reject) => {
        const tables = {
            Users: "created",
            Request_Log: "request_time",
            Transactions: "tx_time",
            priceHistory: "rec_time",
            _backup: "timestamp"
        };
        let subs = [];
        for (t in tables)
            subs.push(`SELECT MAX(${tables[t]}) as ts FROM ${t}`);
        DB.query(`SELECT MAX(ts) as last_time FROM (${subs.join(' UNION ')}) AS Z`).then(result => {
            let request = {
                floID: myFloID,
                pubKey: myPubKey,
                type: "BACKUP_SYNC",
                last_time: result[0].last_time,
                req_time: Date.now()
            };
            request.sign = floCrypto.signData(request.type + "|" + request.req_time, myPrivKey);
            console.debug("REQUEST: ", request);
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
    last_response_time: null
};

requestInstance.open = function() {
    const self = this;
    //Check if there is an active request 
    if (self.request) {
        console.log("A request is already active");
        if (self.last_response_time < Date.now() - WAIT_TIME)
            self.close();
        else
            return;
    }
    connectToWSServer(config["main_server_url"]).then(ws => {
        requestBackupSync(ws).then(request => {
            self.request = request;
            self.ws = ws;
            ws.on('message', processBackupData)
            ws.onclose = _ => console.log("Connection was Interrupted");
        }).catch(error => console.error(error))
    }).catch(error => console.error(error))
}

requestInstance.close = function() {
    const self = this;
    self.ws.onclose = () => null;
    self.ws.close();
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

function processBackupData(message) {
    const self = requestInstance;
    self.last_response_time = Date.now();
    try {
        const response = JSON.parse(message);
        console.debug(response);
        if (response.error) {
            console.log(response.error);
            self.close();
            return;
        }
        switch (response.mode) {
            case "END":
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
            case "DELETE":
                self.delete_data = response.delete_data;
                self.delete_sync += 1;
                deleteData(response.delete_data);
                break;
            case "ADD_UPDATE_HEADER":
                self.add_data = response.add_data;
                self.total_add = Object.keys(response.add_data).length;
                break;
            case "ADD_UPDATE":
                self.add_sync += 1;
                addUpdateData(response.table, response.data);
                break;
            case "ADD_IMMUTABLE":
                self.immutable_sync += 1;
                addImmutableData(response.table, response.data);
                break;
        }
    } catch (error) {
        console.error(error);
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
    let cols = Object.keys(data[0]),
        _mark = "(" + Array(cols.length).fill('?') + ")";
    values = data.map(r => cols.map(c => validateValue(r[c]))).flat();
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
    values = data.map(r => cols.map(c => validateValue(r[c]))).flat();
    let statement = `INSERT INTO ${table} (${cols}) VALUES ${Array(data.length).fill(_mark)}`;
    if (table in primaryKeys)
        statement += ` ON DUPLICATE KEY UPDATE ${primaryKeys[table]}=${primaryKeys[table]}`;
    DB.query(statement, values).then(_ => null).catch(error => console.error(error));
}

const validateValue = val => (typeof val === "string" && /\.\d{3}Z$/.test(val)) ? val.substring(0, val.length - 1) : val;

startBackupStorage();