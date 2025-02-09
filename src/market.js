'use strict';

const coupling = require('./coupling');

const {
    MINIMUM_BUY_REQUIREMENT,
    TRADE_HASH_PREFIX,
    TRANSFER_HASH_PREFIX
} = require('./_constants')["market"];

const MINI_PERIOD_INTERVAL = require('./_constants')['app']['PERIOD_INTERVAL'] / 10;

var DB, assetList; //container for database and allowed assets

function login(floID, proxyKey) {
    return new Promise((resolve, reject) => {
        DB.query("INSERT INTO UserSession (floID, proxyKey) VALUE (?, ?) " +
                "ON DUPLICATE KEY UPDATE session_time=DEFAULT, proxyKey=?",
                [floID, proxyKey, proxyKey])
            .then(result => resolve("Login Successful"))
            .catch(error => reject(error))
    })
}

function logout(floID) {
    return new Promise((resolve, reject) => {
        DB.query("DELETE FROM UserSession WHERE floID=?", [floID])
            .then(result => resolve("Logout successful"))
            .catch(error => reject(error))
    })
}

function getRateHistory(asset, duration) {
    return new Promise((resolve, reject) => {
        if (!asset || !assetList.includes(asset))
            reject(INVALID(`Invalid asset(${asset})`));
        else
            coupling.price.getHistory(asset, duration)
            .then(result => resolve(result))
            .catch(error => reject(error))
    })
}

function getBalance(floID, token) {
    return new Promise((resolve, reject) => {
        if (floID && !floCrypto.validateAddr(floID))
            reject(INVALID(`Invalid floID(${floID})`));
        else if (token && token !== floGlobals.currency && !assetList.includes(token))
            reject(INVALID(`Invalid token(${token})`));
        else if (!floID && !token)
            reject(INVALID('Missing parameters: requires atleast one (floID, token)'));
        else {
            var promise;
            if (floID && token)
                promise = getBalance.floID_token(floID, token);
            else if (floID)
                promise = getBalance.floID(floID);
            else if (token)
                promise = getBalance.token(token);
            promise.then(result => resolve(result)).catch(error => reject(error))
        }
    })
}

getBalance.floID_token = (floID, token) => new Promise((resolve, reject) => {
    (token === floGlobals.currency ?
        DB.query("SELECT IFNULL(SUM(balance), 0) AS balance FROM Cash WHERE floID=?", [floID]) :
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS balance FROM Vault WHERE floID=? AND asset=?", [floID, token])
    ).then(result => resolve({
        floID,
        token,
        balance: result[0].balance.toFixed(8)
    })).catch(error => reject(error))
});

getBalance.floID = (floID) => new Promise((resolve, reject) => {
    Promise.all([
        DB.query("SELECT IFNULL(SUM(balance), 0) AS balance FROM Cash WHERE floID=?", [floID]),
        DB.query("SELECT asset, IFNULL(SUM(quantity), 0) AS balance FROM Vault WHERE floID=? GROUP BY asset", [floID])
    ]).then(result => {
        let response = {
            floID,
            balance: {}
        };
        response.balance[floGlobals.currency] = result[0][0].balance.toFixed(8);
        for (let row of result[1])
            response.balance[row.asset] = row.balance.toFixed(8);
        resolve(response);
    }).catch(error => reject(error))
});

getBalance.token = (token) => new Promise((resolve, reject) => {
    (token === floGlobals.currency ?
        DB.query("SELECT floID, balance FROM Cash") :
        DB.query("SELECT floID, IFNULL(SUM(quantity), 0) AS balance FROM Vault WHERE asset = ? GROUP BY floID", [token])
    ).then(result => {
        let response = {
            token: token,
            balance: {}
        };
        for (let row of result)
            response.balance[row.floID] = row.balance.toFixed(8);
        resolve(response);
    }).catch(error => reject(error))
});

const getAssetBalance = (floID, asset) => new Promise((resolve, reject) => {
    let promises = (asset === floGlobals.currency) ? [
        DB.query("SELECT IFNULL(SUM(balance), 0) AS balance FROM Cash WHERE floID=?", [floID]),
        DB.query("SELECT IFNULL(SUM(quantity*maxPrice), 0) AS locked FROM BuyOrder WHERE floID=?", [floID])
    ] : [
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS balance FROM Vault WHERE floID=? AND asset=?", [floID, asset]),
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS locked FROM SellOrder WHERE floID=? AND asset=?", [floID, asset])
    ];
    Promise.all(promises).then(result => resolve({
        total: result[0][0].balance,
        locked: result[1][0].locked,
        net: result[0][0].balance - result[1][0].locked
    })).catch(error => reject(error))
});

getAssetBalance.check = (floID, asset, amount) => new Promise((resolve, reject) => {
    getAssetBalance(floID, asset).then(balance => {
        if (balance.total < amount)
            reject(INVALID(`Insufficient ${asset}`));
        else if (balance.net < amount)
            reject(INVALID(`Insufficient ${asset} (Some are locked in orders)`));
        else
            resolve(true);
    }).catch(error => reject(error))
});

const consumeAsset = (floID, asset, amount, txQueries = []) => new Promise((resolve, reject) => {
    //If asset/token is currency update Cash else consume from Vault
    if (asset === floGlobals.currency) {
        txQueries.push(["UPDATE Cash SET balance=balance-? WHERE floID=?", [amount, floID]]);
        return resolve(txQueries);
    } else
        DB.query("SELECT id, quantity FROM Vault WHERE floID=? AND asset=? ORDER BY locktime", [floID, asset]).then(coins => {
            let rem = amount;
            for (let i = 0; i < coins.length && rem > 0; i++) {
                if (rem < coins[i].quantity) {
                    txQueries.push(["UPDATE Vault SET quantity=quantity-? WHERE id=?", [rem, coins[i].id]]);
                    rem = 0;
                } else {
                    txQueries.push(["DELETE FROM Vault WHERE id=?", [coins[i].id]]);
                    rem -= coins[i].quantity;
                }
            }
            if (rem > 0) //should not happen AS the total and net is checked already
                reject(INVALID("Insufficient Asset"));
            else
                resolve(txQueries);
        }).catch(error => reject(error));
});

function addSellOrder(floID, asset, quantity, min_price) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(`Invalid floID (${floID})`));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(`Invalid quantity (${quantity})`));
        else if (typeof min_price !== "number" || min_price <= 0)
            return reject(INVALID(`Invalid min_price (${min_price})`));
        else if (!assetList.includes(asset))
            return reject(INVALID(`Invalid asset (${asset})`));
        getAssetBalance.check(floID, asset, quantity).then(_ => {
            checkSellRequirement(floID, asset).then(_ => {
                DB.query("INSERT INTO SellOrder(floID, asset, quantity, minPrice) VALUES (?, ?, ?, ?)", [floID, asset, quantity, min_price])
                    .then(result => resolve('Sell Order placed successfully'))
                    .catch(error => reject(error));
            }).catch(error => reject(error))
        }).catch(error => reject(error));
    });
}

const checkSellRequirement = (floID, asset) => new Promise((resolve, reject) => {
    DB.query("SELECT * FROM UserTag WHERE floID=? AND tag=?", [floID, "MINER"]).then(result => {
        if (result.length)
            return resolve(true);
        //TODO: Should seller need to buy same type of asset before selling?
        DB.query("SELECT IFNULL(SUM(quantity), 0) AS brought FROM TradeTransactions WHERE buyer=? AND asset=?", [floID, asset]).then(result => {
            if (result[0].brought >= MINIMUM_BUY_REQUIREMENT)
                resolve(true);
            else
                reject(INVALID(`Sellers required to buy atleast ${MINIMUM_BUY_REQUIREMENT} ${asset} before placing a sell order unless they are a Miner`));
        }).catch(error => reject(error))
    }).catch(error => reject(error))
});

function addBuyOrder(floID, asset, quantity, max_price) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(`Invalid floID (${floID})`));
        else if (typeof quantity !== "number" || quantity <= 0)
            return reject(INVALID(`Invalid quantity (${quantity})`));
        else if (typeof max_price !== "number" || max_price <= 0)
            return reject(INVALID(`Invalid max_price (${max_price})`));
        else if (!assetList.includes(asset))
            return reject(INVALID(`Invalid asset (${asset})`));
        getAssetBalance.check(floID, floGlobals.currency, quantity * max_price).then(_ => {
            DB.query("INSERT INTO BuyOrder(floID, asset, quantity, maxPrice) VALUES (?, ?, ?, ?)", [floID, asset, quantity, max_price])
                .then(result => resolve('Buy Order placed successfully'))
                .catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function cancelOrder(type, id, floID) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(`Invalid floID (${floID})`));
        let tableName;
        if (type === "buy")
            tableName = "BuyOrder";
        else if (type === "sell")
            tableName = "SellOrder";
        else
            return reject(INVALID("Invalid Order type! Order type must be buy (or) sell"));
        DB.query(`SELECT floID FROM ${tableName} WHERE id=?`, [id]).then(result => {
            if (result.length < 1)
                return reject(INVALID("Order not found!"));
            else if (result[0].floID !== floID)
                return reject(INVALID("Order doesnt belong to the current user"));
            //Delete the order 
            DB.query(`DELETE FROM ${tableName} WHERE id=?`, [id])
                .then(result => resolve(tableName + "#" + id + " cancelled successfully"))
                .catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function getAccountDetails(floID) {
    return new Promise((resolve, reject) => {
        let select = [];
        select.push(["balance", "Cash"]);
        select.push(["asset, AVG(base) AS avg_base, IFNULL(SUM(quantity), 0) AS quantity", "Vault", "GROUP BY asset"]);
        select.push(["id, asset, quantity, minPrice, time_placed", "SellOrder"]);
        select.push(["id, asset, quantity, maxPrice, time_placed", "BuyOrder"]);
        let promises = select.map(a => DB.query(`SELECT ${a[0]} FROM ${a[1]} WHERE floID=? ${a[2] || ""}`, [floID]));
        Promise.allSettled(promises).then(results => {
            let response = {
                floID: floID,
                time: Date.now()
            };
            results.forEach((a, i) => {
                if (a.status === "rejected")
                    console.error(a.reason);
                else
                    switch (i) {
                        case 0:
                            response.cash = a.value.length ? a.value[0].balance : 0;
                            break;
                        case 1:
                            response.vault = a.value;
                            break;
                        case 2:
                            response.sellOrders = a.value;
                            break;
                        case 3:
                            response.buyOrders = a.value;
                            break;
                    }
            });
            DB.query("SELECT * FROM TradeTransactions WHERE seller=? OR buyer=?", [floID, floID])
                .then(result => response.transactions = result)
                .catch(error => console.error(error))
                .finally(_ => resolve(response));
        });
    });
}

function getTransactionDetails(txid) {
    return new Promise((resolve, reject) => {
        let tableName, type;
        if (txid.startsWith(TRANSFER_HASH_PREFIX)) {
            tableName = 'TransferTransactions';
            type = 'transfer';
        } else if (txid.startsWith(TRADE_HASH_PREFIX)) {
            tableName = 'TradeTransactions';
            type = 'trade';
        } else
            return reject(INVALID("Invalid TransactionID"));
        DB.query(`SELECT * FROM ${tableName} WHERE txid=?`, [txid]).then(result => {
            if (result.length) {
                let details = result[0];
                details.type = type;
                if (tableName === 'TransferTransactions') //As json object is stored for receiver in transfer (to support one-to-many)
                    details.receiver = JSON.parse(details.receiver);
                resolve(details);
            } else
                reject(INVALID("Transaction not found"));
        }).catch(error => reject(error))
    })
}

function transferToken(sender, receivers, token) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(sender))
            reject(INVALID(`Invalid sender (${sender})`));
        else if (token !== floGlobals.currency && !assetList.includes(token))
            reject(INVALID(`Invalid token (${token})`));
        else {
            let invalidIDs = [],
                totalAmount = 0;
            for (let floID in receivers)
                if (!floCrypto.validateAddr(floID))
                    invalidIDs.push(floID);
                else
                    totalAmount += receivers[floID];
            if (invalidIDs.length)
                reject(INVALID(`Invalid receiver (${invalidIDs})`));
            else getAssetBalance.check(sender, token, totalAmount).then(_ => {
                consumeAsset(sender, token, totalAmount).then(txQueries => {
                    if (token === floGlobals.currency)
                        for (let floID in receivers)
                            txQueries.push(["INSERT INTO Cash (floID, balance) VALUE (?, ?) ON DUPLICATE KEY UPDATE balance=balance+?", [floID, receivers[floID], receivers[floID]]]);
                    else
                        for (let floID in receivers)
                            txQueries.push(["INSERT INTO Vault(floID, quantity, asset) VALUES (?, ?, ?)", [floID, receivers[floID], token]]);
                    let time = Date.now();
                    let hash = TRANSFER_HASH_PREFIX + Crypto.SHA256(JSON.stringify({
                        sender: sender,
                        receiver: receivers,
                        token: token,
                        totalAmount: totalAmount,
                        tx_time: time,
                    }));
                    txQueries.push([
                        "INSERT INTO TransferTransactions (sender, receiver, token, totalAmount, tx_time, txid) VALUE (?, ?, ?, ?, ?, ?)",
                        [sender, JSON.stringify(receivers), token, totalAmount, global.convertDateToString(time), hash]
                    ]);
                    DB.transaction(txQueries)
                        .then(result => resolve(hash))
                        .catch(error => reject(error))
                }).catch(error => reject(error))
            }).catch(error => reject(error))
        }
    })
}

function depositFLO(floID, txid) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT status FROM InputFLO WHERE txid=? AND floID=?", [txid, floID]).then(result => {
            if (result.length) {
                switch (result[0].status) {
                    case "PENDING":
                        return reject(INVALID("Transaction already in process"));
                    case "REJECTED":
                        return reject(INVALID("Transaction already rejected"));
                    case "SUCCESS":
                        return reject(INVALID("Transaction already used to add coins"));
                }
            } else
                DB.query("INSERT INTO InputFLO(txid, floID, status) VALUES (?, ?, ?)", [txid, floID, "PENDING"])
                .then(result => resolve("Deposit request in process"))
                .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function confirmDepositFLO() {
    DB.query("SELECT id, floID, txid FROM InputFLO WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            confirmDepositFLO.checkTx(req.floID, req.txid).then(amount => {
                let txQueries = [];
                txQueries.push(["INSERT INTO Vault(floID, quantity, asset) VALUES (?, ?, ?)", [req.floID, amount, "FLO"]]);
                txQueries.push(["UPDATE InputFLO SET status=?, amount=? WHERE id=?", ["SUCCESS", amount, req.id]]);
                DB.transaction(txQueries)
                    .then(result => console.debug("FLO deposited:", req.floID, amount))
                    .catch(error => console.error(error))
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE InputFLO SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

confirmDepositFLO.checkTx = function(sender, txid) {
    return new Promise((resolve, reject) => {
        let receiver = global.sinkID; //receiver should be market's floID (ie, sinkID)
        if (!receiver)
            return reject([false, 'sinkID not loaded']);
        floBlockchainAPI.getTx(txid).then(tx => {
            let vin_sender = tx.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            if (vin_sender.length !== tx.vin.length)
                return reject([true, "Transaction input containes other floIDs"]);
            if (!tx.blockheight)
                return reject([false, "Transaction not included in any block yet"]);
            if (!tx.confirmations)
                return reject([false, "Transaction not confirmed yet"]);
            let amount = tx.vout.reduce((a, v) => v.scriptPubKey.addresses[0] === receiver ? a + v.value : a, 0);
            if (amount == 0)
                return reject([true, "Transaction receiver is not market ID"]);
            else
                resolve(amount);
        }).catch(error => reject([false, error]))
    })
}

function withdrawFLO(floID, amount) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(`Invalid floID (${floID})`));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(`Invalid amount (${amount})`));
        getAssetBalance.check(floID, "FLO", amount).then(_ => {
            consumeAsset(floID, "FLO", amount).then(txQueries => {
                DB.transaction(txQueries).then(result => {
                    //Send FLO to user via blockchain API
                    floBlockchainAPI.sendTx(global.sinkID, floID, amount, global.sinkPrivKey, 'Withdraw FLO Coins from Market').then(txid => {
                        if (!txid)
                            throw Error("Transaction not successful");
                        //Transaction was successful, Add in DB
                        DB.query("INSERT INTO OutputFLO (floID, amount, txid, status) VALUES (?, ?, ?, ?)", [floID, amount, txid, "WAITING_CONFIRMATION"])
                            .then(_ => null).catch(error => console.error(error))
                            .finally(_ => resolve("Withdrawal was successful"));
                    }).catch(error => {
                        console.error(error);
                        DB.query("INSERT INTO OutputFLO (floID, amount, status) VALUES (?, ?, ?)", [floID, amount, "PENDING"])
                            .then(_ => null).catch(error => console.error(error))
                            .finally(_ => resolve("Withdrawal request is in process"));
                    });
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function retryWithdrawalFLO() {
    DB.query("SELECT id, floID, amount FROM OutputFLO WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.sendTx(global.sinkID, req.floID, req.amount, global.sinkPrivKey, 'Withdraw FLO Coins from Market').then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE OutputFLO SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, req.id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error));
        })
    }).catch(error => reject(error));
}

function confirmWithdrawalFLO() {
    DB.query("SELECT id, floID, amount, txid FROM OutputFLO WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floBlockchainAPI.getTx(req.txid).then(tx => {
                if (!tx.blockheight || !tx.confirmations) //Still not confirmed
                    return;
                DB.query("UPDATE OutputFLO SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("FLO withdrawed:", req.floID, req.amount))
                    .catch(error => console.error(error))
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function depositToken(floID, txid) {
    return new Promise((resolve, reject) => {
        DB.query("SELECT status FROM InputToken WHERE txid=? AND floID=?", [txid, floID]).then(result => {
            if (result.length) {
                switch (result[0].status) {
                    case "PENDING":
                        return reject(INVALID("Transaction already in process"));
                    case "REJECTED":
                        return reject(INVALID("Transaction already rejected"));
                    case "SUCCESS":
                        return reject(INVALID("Transaction already used to add tokens"));
                }
            } else
                DB.query("INSERT INTO InputToken(txid, floID, status) VALUES (?, ?, ?)", [txid, floID, "PENDING"])
                .then(result => resolve("Deposit request in process"))
                .catch(error => reject(error));
        }).catch(error => reject(error))
    });
}

function confirmDepositToken() {
    DB.query("SELECT id, floID, txid FROM InputToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            confirmDepositToken.checkTx(req.floID, req.txid).then(amounts => {
                DB.query("SELECT id FROM InputFLO where floID=? AND txid=?", [req.floID, req.txid]).then(result => {
                    let txQueries = [],
                        token_name = amounts[0],
                        amount_token = amounts[1];
                    //Add the FLO balance if necessary
                    if (!result.length) {
                        let amount_flo = amounts[2];
                        txQueries.push(["INSERT INTO Vault(floID, asset, quantity) VALUES (?, ?, ?)", [req.floID, "FLO", amount_flo]]);
                        txQueries.push(["INSERT INTO InputFLO(txid, floID, amount, status) VALUES (?, ?, ?, ?)", [req.txid, req.floID, amount_flo, "SUCCESS"]]);
                    }
                    txQueries.push(["UPDATE InputToken SET status=?, token=?, amount=? WHERE id=?", ["SUCCESS", token_name, amount_token, req.id]]);
                    if (token_name === floGlobals.currency)
                        txQueries.push(["INSERT INTO Cash (floID, balance) VALUE (?, ?) ON DUPLICATE KEY UPDATE balance=balance+?", [req.floID, amount_token, amount_token]]);
                    else
                        txQueries.push(["INSERT INTO Vault(floID, asset, quantity) VALUES (?, ?, ?)", [req.floID, token_name, amount_token]]);
                    DB.transaction(txQueries)
                        .then(result => console.debug("Token deposited:", req.floID, token_name, amount_token))
                        .catch(error => console.error(error));
                }).catch(error => console.error(error));
            }).catch(error => {
                console.error(error);
                if (error[0])
                    DB.query("UPDATE InputToken SET status=? WHERE id=?", ["REJECTED", req.id])
                    .then(_ => null).catch(error => console.error(error));
            });
        })
    }).catch(error => console.error(error))
}

confirmDepositToken.checkTx = function(sender, txid) {
    return new Promise((resolve, reject) => {
        let receiver = global.sinkID; //receiver should be market's floID (ie, sinkID)
        if (!receiver)
            return reject([false, 'sinkID not loaded']);
        floTokenAPI.getTx(txid).then(tx => {
            if (tx.parsedFloData.type !== "transfer")
                return reject([true, "Transaction type not 'transfer'"]);
            else if (tx.parsedFloData.transferType !== "token")
                return reject([true, "Transaction transfer is not 'token'"]);
            var token_name = tx.parsedFloData.tokenIdentification,
                amount_token = tx.parsedFloData.tokenAmount;
            if ((!assetList.includes(token_name) && token_name !== floGlobals.currency) || token_name === "FLO")
                return reject([true, "Token not authorised"]);
            let vin_sender = tx.transactionDetails.vin.filter(v => v.addr === sender)
            if (!vin_sender.length)
                return reject([true, "Transaction not sent by the sender"]);
            let amount_flo = tx.transactionDetails.vout.reduce((a, v) => v.scriptPubKey.addresses[0] === receiver ? a + v.value : a, 0);
            if (amount_flo == 0)
                return reject([true, "Transaction receiver is not market ID"]);
            else
                resolve([token_name, amount_token, amount_flo]);
        }).catch(error => reject([false, error]))
    })
}

function withdrawToken(floID, token, amount) {
    return new Promise((resolve, reject) => {
        if (!floCrypto.validateAddr(floID))
            return reject(INVALID(`Invalid floID (${floID})`));
        else if (typeof amount !== "number" || amount <= 0)
            return reject(INVALID(`Invalid amount (${amount})`));
        else if ((!assetList.includes(token) && token !== floGlobals.currency) || token === "FLO")
            return reject(INVALID("Invalid Token"));
        //Check for FLO balance (transaction fee)
        let required_flo = floGlobals.sendAmt + floGlobals.fee;
        getAssetBalance.check(floID, "FLO", required_flo).then(_ => {
            getAssetBalance.check(floID, token, amount).then(_ => {
                consumeAsset(floID, "FLO", required_flo).then(txQueries => {
                    consumeAsset(floID, token, amount, txQueries).then(txQueries => {
                        DB.transaction(txQueries).then(result => {
                            //Send FLO to user via blockchain API
                            floTokenAPI.sendToken(global.sinkPrivKey, amount, floID, '(withdrawal from market)', token).then(txid => {
                                if (!txid) throw Error("Transaction not successful");
                                //Transaction was successful, Add in DB
                                DB.query("INSERT INTO OutputToken (floID, token, amount, txid, status) VALUES (?, ?, ?, ?, ?)", [floID, token, amount, txid, "WAITING_CONFIRMATION"])
                                    .then(_ => null).catch(error => console.error(error))
                                    .finally(_ => resolve("Withdrawal was successful"));
                            }).catch(error => {
                                console.error(error);
                                DB.query("INSERT INTO OutputToken (floID, token, amount, status) VALUES (?, ?, ?, ?)", [floID, token, amount, "PENDING"])
                                    .then(_ => null).catch(error => console.error(error))
                                    .finally(_ => resolve("Withdrawal request is in process"));
                            });
                        }).catch(error => reject(error));
                    }).catch(error => reject(error));
                }).catch(error => reject(error));
            }).catch(error => reject(error));
        }).catch(error => reject(error));
    });
}

function retryWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount FROM OutputToken WHERE status=?", ["PENDING"]).then(results => {
        results.forEach(req => {
            floTokenAPI.sendToken(global.sinkPrivKey, req.amount, req.floID, '(withdrawal from market)', req.token).then(txid => {
                if (!txid)
                    throw Error("Transaction not successful");
                //Transaction was successful, Add in DB
                DB.query("UPDATE OutputToken SET status=?, txid=? WHERE id=?", ["WAITING_CONFIRMATION", txid, req.id])
                    .then(_ => null).catch(error => console.error(error));
            }).catch(error => console.error(error));
        });
    }).catch(error => reject(error));
}

function confirmWithdrawalToken() {
    DB.query("SELECT id, floID, token, amount, txid FROM OutputToken WHERE status=?", ["WAITING_CONFIRMATION"]).then(results => {
        results.forEach(req => {
            floTokenAPI.getTx(req.txid).then(tx => {
                DB.query("UPDATE OutputToken SET status=? WHERE id=?", ["SUCCESS", req.id])
                    .then(result => console.debug("Token withdrawed:", req.floID, req.token, req.amount))
                    .catch(error => console.error(error));
            }).catch(error => console.error(error));
        })
    }).catch(error => console.error(error));
}

function periodicProcess() {
    blockchainReCheck();
    assetList.forEach(asset => coupling.initiate(asset));
}

function blockchainReCheck() {
    if (blockchainReCheck.timeout) {
        clearTimeout(blockchainReCheck.timeout);
        blockchainReCheck.timeout = null;
    }
    if (!global.sinkID)
        return blockchainReCheck.timeout = setTimeout(blockchainReCheck, MINI_PERIOD_INTERVAL);

    confirmDepositFLO();
    confirmDepositToken();
    retryWithdrawalFLO();
    retryWithdrawalToken();
    confirmWithdrawalFLO();
    confirmWithdrawalToken();
}
blockchainReCheck.timeout = null;

module.exports = {
    login,
    logout,
    get rates() {
        return coupling.price.currentRates;
    },
    addBuyOrder,
    addSellOrder,
    cancelOrder,
    getRateHistory,
    getBalance,
    getAccountDetails,
    getTransactionDetails,
    transferToken,
    depositFLO,
    withdrawFLO,
    depositToken,
    withdrawToken,
    periodicProcess,
    group: coupling.group,
    set DB(db) {
        DB = db;
        coupling.DB = db;
    },
    set assetList(assets) {
        assetList = assets;
    }
};