var DB; //Container for database

//Backup Transfer
function sendBackupData(timestamp, checksum, ws) {
    if (!timestamp) timestamp = 0;
    else if (typeof timestamp === "string" && /\.\d{3}Z$/.test(timestamp))
        timestamp = timestamp.substring(0, timestamp.length - 1);
    let promises = [
        backupSync_data(timestamp, ws),
        backupSync_delete(timestamp, ws)
    ];
    if (checksum)
        promises.push(backupSync_checksum(ws));
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

function backupSync_delete(timestamp, ws) {
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

function backupSync_data(timestamp, ws) {
    const sendTable = (table, id_list) => new Promise((res, rej) => {
        DB.query(`SELECT * FROM ${table} WHERE id IN (${id_list})`)
            .then(data => {
                ws.send(JSON.stringify({
                    table,
                    command: "SYNC_UPDATE",
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
                command: "SYNC_HEADER",
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

function backupSync_checksum(ws) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT DISTINCT t_name FROM _backup").then(result => {
            let tableList = result.map(r => r['t_name']);
            DB.query("CHECKSUM TABLE " + tableList.join()).then(result => {
                let checksum = Object.fromEntries(result.map(r => [r.Table.split(".").pop(), r.Checksum]));
                ws.send(JSON.stringify({
                    command: "SYNC_CHECKSUM",
                    checksum: checksum
                }));
                resolve("checksum");
            }).catch(error => {
                console.error(error);
                reject("checksum");
            })
        }).catch(error => {
            console.error(error);
            reject("checksum");
        })
    })

}

function sendTableData(tables, ws) {
    let promises = [
        tableSync_data(tables, ws),
        tableSync_delete(tables, ws),
        tableSync_checksum(tables, ws)
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

function tableSync_delete(tables, ws) {
    return new Promise((resolve, reject) => {
        DB.query(`SELECT * FROM _backup WHERE mode is NULL AND t_name IN (${Array(tables.length).fill("?").join()})`, tables).then(result => {
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

function tableSync_data(tables, ws) {
    const sendTable = table => new Promise((res, rej) => {
        DB.query(`SELECT * FROM ${table}`)
            .then(data => {
                ws.send(JSON.stringify({
                    table,
                    command: "SYNC_UPDATE",
                    data
                }));
                res(table);
            }).catch(error => {
                console.error(error);
                rej(table);
            });
    });
    return new Promise((resolve, reject) => {
        DB.query(`SELECT * FROM _backup WHERE mode=TRUE AND t_name IN (${Array(tables.length).fill("?").join()})`, tables).then(result => {
            ws.send(JSON.stringify({
                command: "SYNC_HEADER",
                add_data: result
            }));
            Promise.allSettled(tables.map(t => sendTable(t))).then(result => {
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

function tableSync_checksum(tables, ws) {
    return new Promise((resolve, reject) => {
        DB.query("CHECKSUM TABLE " + tables.join()).then(result => {
            let checksum = Object.fromEntries(result.map(r => [r.Table.split(".").pop(), r.Checksum]));
            ws.send(JSON.stringify({
                command: "SYNC_CHECKSUM",
                checksum: checksum
            }));
            resolve("checksum");
        }).catch(error => {
            console.error(error);
            reject("checksum");
        })
    })

}

module.exports = {
    sendBackupData,
    sendTableData,
    set DB(db) {
        DB = db;
    }
}